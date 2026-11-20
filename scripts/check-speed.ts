// A click answers right away, with one server trip (card 201, docs/speed.md): `npm run check:speed`. Pure: no database.
// 1. Every exported server action refreshes the page itself (revalidatePath or refresh() from next/cache),
//    or redirects, or is named below as read-only. In a server action that refresh comes back in the
//    action's own reply, so the browser never has to ask for the page a second time.
// 2. So no client code calls router.refresh() after an action. The few that refresh for another reason
//    say so on the same line: `// refresh-ok: <reason>`.
// 3. The Control Room has a loading frame (app/(room)/loading.tsx): a click shows it at once, and Next.js
//    pre-loads dynamic pages up to it.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// actions that change nothing the page shows: they answer with text only
const READ_ONLY = new Set([
  "dashboard/actions.ts:dryRun", "dashboard/actions.ts:previewChain", "dashboard/actions.ts:dryRunBuilt",
  "dashboard/connectionActions.ts:customScopes", "dashboard/authActions.ts:signIn",
]);

/** Exported server actions in one "use server" file that neither refresh nor redirect. */
export function quietActions(src: string): string[] {
  if (!/^\s*(\/\/[^\n]*\n\s*)*["']use server["']/.test(src)) return [];
  // a helper such as `const done = (...) => { revalidatePath(...); ... }` counts where it is called
  // (top level only: a one-line arrow, or a function whose body refreshes)
  const helpers = [
    ...[...src.matchAll(/^const (\w+) = [^\n]*=>[^\n]*(?:revalidatePath|\brefresh)\(/gm)].map((m) => m[1]),
    ...[...src.matchAll(/^(?:async )?function (\w+)\([\s\S]*?\n\}/gm)].filter((m) => /revalidatePath\(|\brefresh\(\)/.test(m[0])).map((m) => m[1]),
  ];
  return src.split(/\nexport async function /).slice(1).flatMap((part) => {
    const name = part.match(/^(\w+)/)?.[1] ?? "?";
    const body = part.split(/\n(?:export |\/\*\*|async function |function )/)[0];
    const refreshes = /revalidatePath\(|\brefresh\(\)|redirect\(/.test(body) || helpers.some((h) => new RegExp(`\\b${h}\\(`).test(body));
    return refreshes ? [] : [name];
  });
}

/** Lines that call router.refresh() without saying why. */
export function bareRefreshes(src: string): number[] {
  return src.split("\n").flatMap((line, i) => (/\brouter\.refresh\(\)/.test(line) && !/\/\/ refresh-ok: \S/.test(line) ? [i + 1] : []));
}

// the checks check themselves
assert.deepEqual(quietActions(`"use server";\nexport async function a() { await x(); revalidatePath("/"); }\nexport async function b() { return 1; }\n`), ["b"]);
assert.deepEqual(quietActions(`"use server";\nconst done = (t: string) => { revalidatePath("/start"); return t; };\nexport async function a() { return done(""); }\n`), []);
assert.deepEqual(quietActions(`"use server";\nexport async function a() { redirect("/"); }\n`), []);
assert.deepEqual(quietActions(`export async function notAnAction() { return 1; }\n`), []);
assert.deepEqual(bareRefreshes(`a\n  router.refresh();\n  router.refresh(); // refresh-ok: polling\n`), [2]);

const SKIP = new Set(["node_modules", ".git", ".next", ".schemas"]);
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => {
  const p = d === "." ? n : join(d, n);
  if (SKIP.has(p)) return [];
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
});
const problems: string[] = [];
for (const f of ["app", "dashboard", "core", "ee", "templates"].filter(existsSync).flatMap(walk)) {
  const src = readFileSync(f, "utf8");
  for (const a of quietActions(src)) if (!READ_ONLY.has(`${f}:${a}`)) problems.push(`${f}: server action ${a} neither calls revalidatePath nor redirects. Refresh in the action (or add it to READ_ONLY in scripts/check-speed.ts if it changes nothing on screen).`);
  for (const n of bareRefreshes(src)) problems.push(`${f}:${n}: router.refresh() renders the page a second time. The server action should call revalidatePath instead; if this refresh has another reason, end the line with // refresh-ok: <reason>.`);
}
for (const k of READ_ONLY) { const [f, a] = k.split(":"); if (!existsSync(f) || !new RegExp(`export async function ${a}\\b`).test(readFileSync(f, "utf8"))) problems.push(`scripts/check-speed.ts: READ_ONLY names ${k}, which no longer exists.`); }
if (!existsSync("app/(room)/loading.tsx")) problems.push("app/(room)/loading.tsx is missing: Control Room clicks would wait on a blank pause.");

if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("check:speed ok");
