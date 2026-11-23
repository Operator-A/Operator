// A click answers right away, with one server trip (card 201, docs/speed.md): `npm run check:speed`. Pure: no database.
// 1. Every exported server action refreshes the page itself (revalidatePath or refresh() from next/cache),
//    or redirects, or is named below as read-only. In a server action that refresh comes back in the
//    action's own reply, so the browser never has to ask for the page a second time.
// 2. So no client code calls router.refresh() after an action. The few that refresh for another reason
//    say so on the same line: `// refresh-ok: <reason>`.
// 3. The Control Room has a loading frame (app/(room)/loading.tsx): a click shows it at once, and Next.js
//    pre-loads dynamic pages up to it.
// 4-6. Pages load only what they show; pages just seen come back from the browser (staleTimes); navigation
//    starts loading on hover, touch or focus (IntentLink). Each rule is below, where it is checked.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { statusMap } from "../core/mcp-rules";

// actions that change nothing the page shows: they answer with text only
const READ_ONLY = new Set([
  "dashboard/actions.ts:dryRun", "dashboard/actions.ts:previewChain", "dashboard/actions.ts:dryRunBuilt",
  "dashboard/connectionActions.ts:customScopes", "dashboard/authActions.ts:signIn",
  // the setup check card (card 281) keeps its own state: starting answers at once and the card polls the row
  "dashboard/setupCheckActions.ts:startSetupCheck", "dashboard/setupCheckActions.ts:setupCheckState", "dashboard/setupCheckActions.ts:fixFinding",
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
// 4. Pages load only what they show (card 202): one query for every connection's status, and setup
//    reads which tools are set up (getHealth), not the Desk's whole floor.
const st = statusMap([{ id: "gmail", settings: { mailbox: "a@b.co" }, connected_at: "2026-11-20T00:00:00Z", last_error: null, paused_at: null, tools_seen: { a: "1", b: "2" }, tools_checked_at: null },
  { id: "notion", settings: null, connected_at: null, last_error: "expired", paused_at: "2026-11-20T01:00:00Z", tools_seen: null, tools_checked_at: null }]);
assert.deepEqual(st.gmail, { connected: true, paused: false, connectedAt: "2026-11-20T00:00:00Z", lastError: null, settings: { mailbox: "a@b.co" }, toolsCheckedAt: null, toolsSeen: ["a", "b"] });
assert.equal(st.notion.paused, true); assert.deepEqual(st.notion.settings, {}); assert.equal(st.mercury, undefined);
const read = (f: string) => (existsSync(f) ? readFileSync(f, "utf8") : "");
if (/\bgetFloor\(/.test(read("app/start/page.tsx"))) problems.push("app/start/page.tsx calls getFloor: setup needs getHealth only (card 202).");
for (const f of ["dashboard/data.ts", "dashboard/toolsStep.ts"]) if (/\bawait mcpStatus\(/.test(read(f))) problems.push(`${f}: one query per connection; use mcpStatuses() once (card 202).`);
if (!/mcpStatuses\(\)/.test(read("dashboard/data.ts"))) problems.push("dashboard/data.ts: getHealth should read every connection with mcpStatuses() (card 202).");

if (!existsSync("app/(room)/loading.tsx")) problems.push("app/(room)/loading.tsx is missing: Control Room clicks would wait on a blank pause.");

// 5. Pages you just saw come back at once (card 301): the browser keeps a page 1 to 60 s (longer would show
//    old numbers after an agent finishes; 0, the Next 16 default, makes every back-and-forth wait on the server).
export function staleSeconds(config: string): { dynamic: number | null; static: number | null } {
  const block = config.match(/staleTimes:\s*\{([^}]*)\}/)?.[1] ?? "";
  const n = (k: string) => { const m = block.match(new RegExp(`\\b${k}:\\s*(\\d+)`)); return m ? Number(m[1]) : null; };
  return { dynamic: n("dynamic"), static: n("static") };
}
assert.deepEqual(staleSeconds(`experimental: { staleTimes: { dynamic: 30, static: 45 } }`), { dynamic: 30, static: 45 });
assert.deepEqual(staleSeconds(`experimental: {}`), { dynamic: null, static: null });
const stale = staleSeconds(read("next.config.ts"));
for (const k of ["dynamic", "static"] as const) {
  const v = stale[k];
  if (v === null || v < 1 || v > 60) problems.push(`next.config.ts: experimental.staleTimes.${k} should be 1 to 60 seconds (is ${v ?? "unset"}), so pages just seen come back at once without showing old numbers (card 301).`);
}
// 6. Navigation starts loading on intent (card 301): the sidebar, crew chips, agent tabs, Crew views and Settings
//    sections use IntentLink, which loads the whole page on hover, touch or focus. A plain Link there waits for the click.
export function plainLinks(src: string): number[] {
  return src.split("\n").flatMap((line, i) => (/<Link\b/.test(line) ? [i + 1] : []));
}
assert.deepEqual(plainLinks(`<IntentLink href="/">\n<Link href="/x">`), [2]);
const NAV: [string, RegExp][] = [
  ["dashboard/components/client.tsx", /export function (SideLink|RailLink)\b[\s\S]*?\n\}/g],
  ["dashboard/components/ui.tsx", /export function AgentTabs\b[\s\S]*?\n\}/g],
  ["dashboard/components/settingsNav.tsx", /export function SettingsNav\b[\s\S]*?\n\}/g],
  ["app/(room)/crew/page.tsx", /<nav className="seg" aria-label="Crew view">[\s\S]*?<\/nav>/g],
];
for (const [f, part] of NAV) {
  const parts = [...read(f).matchAll(part)].map((m) => m[0]);
  if (!parts.length) problems.push(`${f}: navigation not found for check:speed rule 6; update NAV in scripts/check-speed.ts.`);
  for (const p of parts) if (plainLinks(p).length || !/<IntentLink\b/.test(p)) problems.push(`${f}: navigation should use IntentLink (loads on hover, touch or focus), not a plain Link (card 301).`);
}
// 7. One round of loads per page (card 302): the floor sends its sign-in check and time zone with every other read,
//    pages read the org chart from the floor (f.chart) instead of again, and no page awaits its loads one by one
//    behind conditions (`const x = c ? await a() : null` then `const y = d ? await b() : null`).
export function floorRounds(data: string): string[] {
  const body = data.match(/export const getFloor = cache\(async \(\)[\s\S]*?\n\}\);/)?.[0] ?? "";
  if (!body) return ["getFloor not found"];
  const out: string[] = [];
  if (/await orgTz\(\)/.test(body)) out.push("awaits orgTz() on its own");
  const lines = body.split("\n").filter((l) => /^\s*await requireSession\(\);/.test(l));
  if (lines.length) out.push("awaits requireSession() before its reads");
  const all = body.match(/await Promise\.all\(\[([\s\S]*?)\n {2}\]\);/)?.[1] ?? "";
  if (!/requireSession\(\),/.test(all) || !/orgTz\(\),/.test(all)) out.push("does not send requireSession() and orgTz() in its one Promise.all");
  return out;
}
export function chainedLoads(src: string): number[] {
  const lines = src.split("\n");
  return lines.flatMap((l, i) => (i > 0 && /^\s*(const|let) [^=]+= [^\n]*\? await \w/.test(l) && /^\s*(const|let) [^=]+= [^\n]*\? await \w/.test(lines[i - 1]) ? [i + 1] : []));
}
assert.deepEqual(floorRounds(`export const getFloor = cache(async (): Promise<Floor> => {\n  await requireSession();\n  const tz = await orgTz();\n  const [a] = await Promise.all([\n    x(),\n  ]);\n});`), ["awaits orgTz() on its own", "awaits requireSession() before its reads", "does not send requireSession() and orgTz() in its one Promise.all"]);
assert.deepEqual(floorRounds(`export const getFloor = cache(async (): Promise<Floor> => {\n  if (!h) { await requireSession(); return e; }\n  const [, tz, a] = await Promise.all([\n    requireSession(),\n    orgTz(),\n    x(),\n  ]);\n});`), []);
assert.deepEqual(chainedLoads(`  const a = x ? await f() : null;\n  const b = y ? await g() : null;\n  const c = await h();`), [2]);
for (const p of floorRounds(read("dashboard/data.ts"))) problems.push(`dashboard/data.ts: getFloor ${p}. Send them with its other reads in one round (card 302).`);
for (const f of ["app/(room)/layout.tsx", "app/(room)/page.tsx", "app/(room)/crew/page.tsx", "app/(room)/agents/[id]/page.tsx", "app/(room)/build/[id]/page.tsx"]) {
  if (/\bloadOrg\(/.test(read(f))) problems.push(`${f}: reads the org chart again; use the floor's (f.chart), read in the same round (card 302).`);
}
for (const f of ["app"].filter(existsSync).flatMap(walk).filter((x) => x.startsWith(join("app", "(room)")))) {
  for (const n of chainedLoads(readFileSync(f, "utf8"))) problems.push(`${f}:${n}: loads awaited one after another; start them together with Promise.all (card 302).`);
}
// 8. The page frame draws first (card 303): what calls the business's tools (goal numbers, a connection's account
//    details, how agents think) streams in behind <Suspense>, so the title, tabs and fast cards don't wait for it.
const SUSPENDED = (inner: string) => new RegExp(`<Suspense(?: key=\\{\\w+\\})? fallback=\\{<\\w+[^}]*\\}>${inner}`);
assert.ok(SUSPENDED("<DeskGoals\\b").test(`<Suspense fallback={<SkelTiles />}><DeskGoals goalsP={goalsP} />`));
assert.ok(!SUSPENDED("<DeskGoals\\b").test(`<section><DeskGoals goalsP={goalsP} />`));
const desk = read("app/(room)/page.tsx");
if (/await goalsByDept\(/.test(desk) || !SUSPENDED("<DeskGoals\\b").test(desk) || !SUSPENDED("<DeskLine\\b").test(desk)) problems.push("app/(room)/page.tsx: the Desk's goals (read from the tools) should stream in behind <Suspense> (DeskGoals, DeskLine), not hold up the page (card 303).");
const conn = read("app/(room)/connections/page.tsx");
if (!SUSPENDED("<SelDetail\\b").test(conn) || !SUSPENDED("<ClaudeCard\\b").test(conn)) problems.push("app/(room)/connections/page.tsx: a connection's detail (SelDetail) and ClaudeCard call services; each should sit in <Suspense> (card 303).");
if (!SUSPENDED("\\{view === \"schedule\" \\? <Schedule\\b").test(read("app/(room)/crew/page.tsx"))) problems.push("app/(room)/crew/page.tsx: the chart (goal numbers from the tools) should stream in behind <Suspense> under the title and views (card 303).");
if (!/prefetch=\{warm \? true : null\}/.test(read("dashboard/components/intentLink.tsx"))) problems.push("dashboard/components/intentLink.tsx: IntentLink should pre-load the full page once warm and only to the loading frame before (card 301).");

if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("check:speed ok");
