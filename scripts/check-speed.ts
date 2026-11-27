// A click answers right away, with one server trip (card 201, docs/speed.md): `npm run check:speed`. Pure: no database.
// 1. Every exported server action refreshes the page itself (revalidatePath or refresh() from next/cache),
//    or redirects, or is named below as read-only. In a server action that refresh comes back in the
//    action's own reply, so the browser never has to ask for the page a second time.
// 2. So no client code calls router.refresh() after an action. The few that refresh for another reason
//    say so on the same line: `// refresh-ok: <reason>`.
// 3. The Control Room has a loading frame (app/(room)/loading.tsx): a click shows it at once, and Next.js
//    pre-loads dynamic pages up to it.
// 4-14. Pages load only what they show; pages just seen come back from the browser (staleTimes); navigation
//    starts loading on hover, touch or focus (IntentLink). Each rule is below, where it is checked.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { statusMap } from "../core/mcp-rules";
import { liveKey, runOfPath, shouldRefresh } from "../dashboard/live-rules";

// actions that change nothing the page shows: they answer with text only
const READ_ONLY = new Set([
  "dashboard/actions.ts:dryRun", "dashboard/actions.ts:previewChain",
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
// 6. Navigation starts loading on intent (card 301): the sidebar, crew chips, agent tabs, the Departments views and Settings
//    sections use IntentLink, which loads the whole page on hover, touch or focus. A plain Link there waits for the click.
export function plainLinks(src: string): number[] {
  return src.split("\n").flatMap((line, i) => (/<Link\b/.test(line) ? [i + 1] : []));
}
assert.deepEqual(plainLinks(`<IntentLink href="/">\n<Link href="/x">`), [2]);
const NAV: [string, RegExp][] = [
  ["dashboard/components/client.tsx", /export function SideLink\b[\s\S]*?\n\}/g],
  ["dashboard/components/deptTabs.tsx", /export function DeptTabs\b[\s\S]*?\n\}/g],
  ["dashboard/components/settingsNav.tsx", /export function SettingsNav\b[\s\S]*?\n\}/g],
  ["app/(room)/page.tsx", /<nav className="co-vseg" aria-label="Departments view">[\s\S]*?<\/nav>/g],
];
for (const [f, part] of NAV) {
  const parts = [...read(f).matchAll(part)].map((m) => m[0]);
  if (!parts.length) problems.push(`${f}: navigation not found for check:speed rule 6; update NAV in scripts/check-speed.ts.`);
  for (const p of parts) if (plainLinks(p).length || !/<IntentLink\b/.test(p)) problems.push(`${f}: navigation should use IntentLink (loads on hover, touch or focus), not a plain Link (card 301).`);
}
// 7. One round of loads per page (card 302): the floor sends its sign-in check and time zone with every other read,
//    pages read the org chart from the floor (f.chart) instead of again, and no page awaits its loads one by one
//    behind conditions (`const x = c ? await a() : null` then `const y = d ? await b() : null`).
export function floorRounds(data: string, name = "getFloor", needTz = true): string[] {
  const body = data.match(new RegExp(`export const ${name} = cache\\(async \\(\\)[\\s\\S]*?\\n\\}\\);`))?.[0] ?? "";
  if (!body) return ["not found"];
  const out: string[] = [];
  if (/await orgTz\(\)/.test(body)) out.push("awaits orgTz() on its own");
  const lines = body.split("\n").filter((l) => /^\s*await requireSession\(\);/.test(l));
  if (lines.length) out.push("awaits requireSession() before its reads");
  const all = body.match(/await Promise\.all\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
  if (!/requireSession\(\),/.test(all) || (needTz && !/orgTz\(\)/.test(all))) out.push(`does not send requireSession()${needTz ? " and orgTz()" : ""} in its one Promise.all`);
  return out;
}
/** Card 304: the whole floor is its pieces in one round, so a page that shows less can ask for less. */
export const FLOOR_PIECES = ["getRoster", "getCounts", "getHealth", "getTz", "getOrgSwitch"] as const;
export function floorIsPieces(data: string): boolean {
  const body = data.match(/export const getFloor = cache\(async \(\)[\s\S]*?\n\}\);/)?.[0] ?? "";
  const all = body.match(/await Promise\.all\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
  return !!all && FLOOR_PIECES.every((p) => all.includes(`${p}()`)) && !/db\(\)/.test(body);
}
export function chainedLoads(src: string): number[] {
  const lines = src.split("\n");
  return lines.flatMap((l, i) => (i > 0 && /^\s*(const|let) [^=]+= [^\n]*\? await \w/.test(l) && /^\s*(const|let) [^=]+= [^\n]*\? await \w/.test(lines[i - 1]) ? [i + 1] : []));
}
assert.deepEqual(floorRounds(`export const getFloor = cache(async (): Promise<Floor> => {\n  await requireSession();\n  const tz = await orgTz();\n  const [a] = await Promise.all([\n    x(),\n  ]);\n});`), ["awaits orgTz() on its own", "awaits requireSession() before its reads", "does not send requireSession() and orgTz() in its one Promise.all"]);
assert.deepEqual(floorRounds(`export const getFloor = cache(async (): Promise<Floor> => {\n  if (!h) { await requireSession(); return e; }\n  const [, tz, a] = await Promise.all([\n    requireSession(),\n    orgTz(),\n    x(),\n  ]);\n});`), []);
assert.deepEqual(chainedLoads(`  const a = x ? await f() : null;\n  const b = y ? await g() : null;\n  const c = await h();`), [2]);
const dataSrc = read("dashboard/data.ts");
for (const [piece, tz] of [["getTz", true], ["getRoster", false], ["getCounts", false], ["getOrgSwitch", false]] as const) {
  for (const p of floorRounds(dataSrc, piece, tz)) problems.push(`dashboard/data.ts: ${piece} ${p}. Send them with its other reads in one round (card 302).`);
}
for (const f of ["app/(room)/layout.tsx", "app/(room)/page.tsx", "dashboard/components/orgChartPane.tsx", "app/(room)/agents/[id]/page.tsx"]) {
  if (/\bloadOrg\(/.test(read(f))) problems.push(`${f}: reads the org chart again; use the floor's (f.chart), read in the same round (card 302).`);
}
for (const f of ["app"].filter(existsSync).flatMap(walk).filter((x) => x.startsWith(join("app", "(room)")))) {
  for (const n of chainedLoads(readFileSync(f, "utf8"))) problems.push(`${f}:${n}: loads awaited one after another; start them together with Promise.all (card 302).`);
}
// 8. The page frame draws first (card 303): what calls the business's tools (goal numbers, a connection's account
//    details, how agents think) streams in behind <Suspense>, so the title, tabs and fast cards don't wait for it.
const SUSPENDED = (inner: string) => new RegExp(`<Suspense(?: key=\\{[\\w.]+\\})? fallback=\\{<\\w+[^}]*\\}>${inner}`);
assert.ok(SUSPENDED("<Pane\\b").test(`<Suspense key={tab} fallback={<PaneSkel />}><Pane tab={tab} />`));
assert.ok(!SUSPENDED("<Pane\\b").test(`<section><Pane tab={tab} />`));
const home = read("app/(room)/page.tsx");
if (!SUSPENDED("<Pane\\b").test(home) || !SUSPENDED("<GoalsTileOf\\b").test(home) || /export default async function Company[\s\S]*?await goalsByDept\([\s\S]*?\n\}\n/.test(home.split("\ntype P = ")[0])) problems.push("app/(room)/page.tsx: the Company page's tabs and its Goals tile (goal numbers read from the tools) should stream in behind <Suspense> (Pane, GoalsTileOf), not hold up the title and tabs (card 303).");
const conn = read("app/(room)/connections/page.tsx");
if (!SUSPENDED("<SelDetail\\b").test(conn) || !SUSPENDED("<ClaudeCard\\b").test(conn)) problems.push("app/(room)/connections/page.tsx: a connection's detail (SelDetail) and ClaudeCard call services; each should sit in <Suspense> (card 303).");
if (!/<Pane tab=\{tab\} dview=\{dview\}/.test(home) || !/dview !== "cards"\) return [\s\S]{0,120}<OrgChartPane\b/.test(home)) problems.push("app/(room)/page.tsx: the org chart (goal numbers from the tools) should stream in inside the suspended Pane under the title and views (card 303).");

// 9. Each page reads only what it shows (card 304): the floor is pieces (the crew and its runs, what waits on the owner,
//    which tools are set up, the time zone, the org switch), each read once per request. Only the pages that show all of
//    it (the frame, the Company page, an agent, a run's replay, Settings > Schedule) and the first-job action ask for the whole floor; the rest
//    name their pieces (getRoster, getCrewFloor, getTz, ...).
assert.ok(floorIsPieces(`export const getFloor = cache(async (): Promise<Floor> => {\n  const [a, b, c, d, e] = await Promise.all([getRoster(), getCounts(), getHealth(), getTz(), getOrgSwitch()]);\n  return x;\n});`));
assert.ok(!floorIsPieces(`export const getFloor = cache(async (): Promise<Floor> => {\n  const [a, b] = await Promise.all([getRoster(), db().from("x").select("y")]);\n  return x;\n});`));
if (!floorIsPieces(dataSrc)) problems.push("dashboard/data.ts: getFloor should be its pieces (getRoster, getCounts, getHealth, getTz, getOrgSwitch) in one round, reading nothing itself (card 304).");
const WHOLE_FLOOR = new Set(["app/(room)/layout.tsx", "app/(room)/page.tsx", "app/(room)/agents/[id]/page.tsx", "app/(room)/runs/[id]/page.tsx", "app/(room)/settings/schedule/page.tsx", "dashboard/actions.ts", "dashboard/data.ts"].map((x) => join(...x.split("/"))));
for (const f of ["app", "dashboard"].filter(existsSync).flatMap(walk).filter((x) => /\.tsx?$/.test(x) && !WHOLE_FLOOR.has(x))) {
  if (/\bgetFloor\(\)/.test(readFileSync(f, "utf8"))) problems.push(`${f}: reads the whole floor; ask for only the pieces this page shows (getRoster, getCrewFloor, getTz, getCounts, getHealth, getOrgSwitch; card 304).`);
}
if (!/prefetch=\{warm \? true : null\}/.test(read("dashboard/components/intentLink.tsx"))) problems.push("dashboard/components/intentLink.tsx: IntentLink should pre-load the full page once warm and only to the loading frame before (card 301).");

// 10. No timer renders the whole app (slice 1 of the click-speed fix): while a run is live the frame asks /live which runs are
//     live and renders again only when that set changes (or on a live run's own page). A render on every tick re-ran the
//     frame's 20+ queries every 4 s, threw away every pre-loaded page, and made any button click wait behind it.
export function timerRefreshes(src: string): number[] {
  return src.split("\n").flatMap((line, i) => (/\bsetInterval\(/.test(line) && /\brouter\.refresh\(\)/.test(line) ? [i + 1] : []));
}
assert.deepEqual(timerRefreshes(`const h = setInterval(() => router.refresh(), 4000); // refresh-ok: polls\nconst g = setInterval(tick, 4000);`), [1]);
assert.equal(liveKey(["b", "a", "b"]), "a,b");
assert.equal(shouldRefresh({ shown: "a", got: "a", lastAsked: null, watching: false }), false);
assert.equal(shouldRefresh({ shown: "a", got: "", lastAsked: null, watching: false }), true);
assert.equal(shouldRefresh({ shown: "a", got: "", lastAsked: "", watching: false }), false);
assert.equal(shouldRefresh({ shown: "a", got: "a", lastAsked: "a", watching: true }), true);
assert.equal(runOfPath("/runs/982823c3-a066-461d-9a63-d770274d7c6d"), "982823c3-a066-461d-9a63-d770274d7c6d");
assert.equal(runOfPath("/runs"), null);
for (const f of ["app", "dashboard", "ee"].filter(existsSync).flatMap(walk)) {
  for (const n of timerRefreshes(readFileSync(f, "utf8"))) problems.push(`${f}:${n}: router.refresh() on a timer renders the whole app every tick. Poll a small route and refresh only when something changed (rule 10).`);
}
const lr = read("dashboard/components/client.tsx").match(/export function LiveRefresher\b[\s\S]*?\n\}/)?.[0] ?? "";
if (!/fetch\("\/live"/.test(lr) || !/shouldRefresh\(/.test(lr)) problems.push("dashboard/components/client.tsx: LiveRefresher should ask /live and refresh only when the live runs change (rule 10).");
if (!existsSync("app/(room)/live/route.ts")) problems.push("app/(room)/live/route.ts is missing: LiveRefresher has nothing small to poll (rule 10).");

// 11. A tap shows at once (slice 2 of the click-speed fix): an approval card fades the moment Approve or Reject is pressed
//     (ActionButton `dim`, RejectButton) and comes back if refused; the agent sheet's duty switch flips at once
//     (useOptimistic); a button says it is working after a confirm too; Run now answers once the run is logged
//     (withRun's onStart), not after the agent's memory and checks load.
const ab = read("dashboard/components/approvalBits.tsx");
const approves = [...ab.matchAll(/<ActionButton\b[^>]*action=\{approve\.bind/g)].map((m) => m[0]);
if (!approves.length || approves.some((a) => !/\bdim\b/.test(a))) problems.push("dashboard/components/approvalBits.tsx: every Approve button should fade its card at once (ActionButton dim) (rule 11).");
if ((ab.match(/data-dim-card/g) ?? []).length < 3) problems.push("dashboard/components/approvalBits.tsx: each approval card look should carry data-dim-card so Approve and Reject can fade it (rule 11).");
if (!/dimCard\(btn\.current\)/.test(read("dashboard/components/react.tsx"))) problems.push("dashboard/components/react.tsx: Reject should fade its card at once (dimCard) (rule 11).");
if (!/useOptimistic\(d\.enabled\)/.test(read("dashboard/components/agentSheet.tsx"))) problems.push("dashboard/components/agentSheet.tsx: the duty switch should flip at once (useOptimistic) (rule 11).");
if (/busy && !confirm/.test(read("dashboard/components/client.tsx"))) problems.push("dashboard/components/client.tsx: ActionButton should say it is working after a confirm too (rule 11).");
if (!/onStart: markStarted/.test(read("dashboard/actions.ts"))) problems.push("dashboard/actions.ts: Run now should answer once the run is logged (withRun onStart) (rule 11).");

// 12. The department page's queries stay few (slice 3 of the click-speed fix). The trust lines read in two rounds whatever
//     the number of agents (dashboard/trust.ts: specs in one query, every pair's standing at once through standingsOf),
//     a department asks only for its own agents, the roster's 1,000 runs leave out each run's memory record, and the
//     org chart is read once per request (orgChartOnce).
const tv = read("dashboard/trust.ts").match(/export async function trustView\b[\s\S]*?\n\}/)?.[0] ?? "";
if (!tv || /\bloadSpec\(|\bstandingOf\(|for \([^)]*\) \{[^}]*await /.test(tv) || !/standingsOf\(/.test(tv)) problems.push("dashboard/trust.ts: trustView should read specs in one query and every standing at once (standingsOf), never one query per agent or pair (rule 12).");
if (!/trustView\(ids\)/.test(read("app/(room)/dept/[id]/page.tsx"))) problems.push("app/(room)/dept/[id]/page.tsx: ask trustView for this department's agents only (rule 12).");
if (!/select\(ROSTER_RUN_COLS\)/.test(dataSrc) || /ROSTER_RUN_COLS = "[^"]*memory_json/.test(dataSrc)) problems.push("dashboard/data.ts: getRoster should read its runs with ROSTER_RUN_COLS, without memory_json (rule 12).");
if (/\bloadOrg\(\)\.catch/.test(dataSrc)) problems.push("dashboard/data.ts: read the org chart with orgChartOnce(), once per request (rule 12).");

// 13. Something shows at every click (slice 4 of the click-speed fix). The loading frame also sits under a department,
//     a run, a goal, a proposal and Settings, so moving between two of the same kind shows it at once; a department's
//     pane and an agent's sheet stream in behind <Suspense> (the sheet slides in as a skeleton); a sheet closes and its
//     page loads at the same moment, not 320 ms later; an agent's address reads only the org chart before it redirects;
//     the IntentLink just clicked pulses until its page shows (useLinkStatus).
for (const d of ["dept/[id]", "runs/[id]", "goals/[id]", "proposals/[id]", "settings"]) if (!existsSync(`app/(room)/${d}/loading.tsx`)) problems.push(`app/(room)/${d}/loading.tsx is missing: moving between these pages would show nothing until the server answers (rule 13).`);
const dept = read("app/(room)/dept/[id]/page.tsx");
if (!SUSPENDED("<Pane\\b").test(dept) || !SUSPENDED("<AgentSheetFor\\b").test(dept) || !SUSPENDED("<AgentSheetFor\\b").test(home)) problems.push("a department's pane and an agent's sheet (dept and Company pages) should stream in behind <Suspense> (rule 13).");
for (const f of ["agentSheet", "askSheet", "deptSettings", "newAgentSheet"].map((n) => `dashboard/components/${n}.tsx`)) if (/setTimeout\(\(\) => router\.push/.test(read(f))) problems.push(`${f}: closing waits before loading the page under it; push at once (rule 13).`);
if (/\bgetRoster\(/.test(read("app/(room)/agents/[id]/page.tsx"))) problems.push("app/(room)/agents/[id]/page.tsx: the hop to an agent's sheet should read only the org chart (orgChartOnce), not the roster (rule 13).");
if (!/useLinkStatus\(\)/.test(read("dashboard/components/intentLink.tsx"))) problems.push("dashboard/components/intentLink.tsx: the link just clicked should show it is loading (useLinkStatus) (rule 13).");

// 14. Fewer, shorter cold starts and less to download (slice 5 of the click-speed fix). Every Control Room page has the
//     same maxDuration as the room layout, so Vercel keeps them in one warm function instead of several; core/mcp-rules.ts
//     (which some client components import for constants) hashes with core/sha256.ts, not node:crypto, whose browser
//     polyfills added about 150 KB to Connections and setup.
const roomMax = Number(read("app/(room)/layout.tsx").match(/export const maxDuration = (\d+)/)?.[1]);
if (!roomMax) problems.push("app/(room)/layout.tsx: set the Control Room's maxDuration (rule 14).");
for (const f of ["app"].filter(existsSync).flatMap(walk).filter((x) => x.startsWith(join("app", "(room)")))) {
  const m = readFileSync(f, "utf8").match(/export const maxDuration = (\d+)/);
  if (m && Number(m[1]) !== roomMax) problems.push(`${f}: maxDuration ${m[1]} differs from the room layout's ${roomMax}; one value keeps every page in one warm function (rule 14).`);
}
if (/from "node:crypto"|from "crypto"/.test(read("core/mcp-rules.ts"))) problems.push("core/mcp-rules.ts: client components import this file; hash with core/sha256.ts, not node:crypto (rule 14).");

if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log("check:speed ok");
