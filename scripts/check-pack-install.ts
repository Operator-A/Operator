// Installing a pack into a running business (core/pack-install-rules.ts, core/pack-install.ts, docs/packs.md, packs
// slice 3). Run: npm run check:pack-install. Pure: no database, no network.
// A department pack goes in beside what's there with every id free (installing it twice gives two departments), all
// switched off, its chains added to the active flow off; an agent pack fills only an open seat, off duty, with only
// actions it suggests and the owner turned on, its schedule a chain that starts off; a failed write takes back what
// it wrote; only the owner installs, and every install is audited.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentIdFor, liveRows, livePlan, seatFits, seatFlow, seatPlan, setupSteps, type LiveOrg } from "../core/pack-install-rules";
import { AGENT_PACKS, DEPT_PACKS, packById } from "../core/packs";
import { crewProblems } from "../core/install-rules";
import { readLayout } from "../core/widget-rules";
import { readFlow, type Flow } from "../core/flow-rules";
import { MAX_DEPARTMENTS, MAX_SEATS } from "../core/org-rules";
import type { DepartmentPack } from "../core/pack-rules";
import { agentCard, deptCard } from "../core/pack-card-rules";
import { packUpdate, readTag } from "../core/pack-update-rules";
import { agentCost, agentPage, costWords, deptCost, deptPage as deptPackPage, layoutCells, marketCards, matchCards, noMatchWords, readFilter, tileChips, type CostOf } from "../core/pack-market-rules";
import { TOOL_TILES } from "../core/tools-step-rules";
import type { ToolTileId } from "../core/tools-step-rules";

const read = (f: string) => readFileSync(f, "utf8");
let n = 0;
const ok = (v: unknown, msg: string) => { assert.ok(v, msg); n++; };
const eq = <T>(a: T, b: T, msg: string) => { assert.deepEqual(a, b, msg); n++; };

const store = packById("store-analytics", "department")!;
const empty: LiveOrg = { deptIds: [], deptNames: [], agentIds: [], chainKeys: [], seats: 1, topSort: 0 };

// ---- agent ids are builder ids from names, never one taken
eq(agentIdFor("Iris", new Set()), "b_iris", "an agent id is b_ and its name");
eq(agentIdFor("Iris", new Set(["b_iris"])), "b_iris_2", "a taken id gets a number");
eq(agentIdFor("Iris", new Set(["b_iris", "b_iris_2"])), "b_iris_3", "and the next number");
eq(agentIdFor("  ", new Set()), "b_agent", "a name with no letters is an agent");
ok(agentIdFor("A".repeat(80), new Set()).length <= 40, "ids stay short");

// ---- a department pack into a business: ids free, names numbered together, all off
{
  const p = livePlan(store, empty);
  eq(p.depts, { store_analytics: "store_analytics" }, "a free department id stays");
  eq(p.crew.departments[0].name, "Store analytics", "and its name");
  eq(p.crew.departments[0].sort, 1, "it goes after the last department");
  eq(Object.values(p.agents), ["analytics_head"], "a free agent id stays (the gateway names some actions' agents by id)");
  ok(p.crew.flow.chains.every((c) => (c as { on: boolean }).on === false), "every chain starts off");
  eq(crewProblems(p.crew), [], "the remapped crew passes the same checks as setup");
  ok(JSON.stringify(p.crew.departments[0].overview).includes('"agent":"analytics_head"'), "an agent number names the agent");
}
{
  // installed twice: the second is "Store analytics 2", with its own agent and chain
  const live: LiveOrg = { deptIds: ["store_analytics"], deptNames: ["Store analytics"], agentIds: ["analytics_head"], chainKeys: ["analytics-weekly"], seats: 3, topSort: 4 };
  const p = livePlan(store, live);
  eq(p.depts.store_analytics, "store_analytics_2", "a taken department id gets a number");
  eq(p.names.store_analytics, "Store analytics 2", "and its name the same number");
  eq(p.agents.analytics_head, "b_iris", "a taken agent id becomes a builder id from its name");
  ok(p.crew.seats.every((s) => !s.agent || s.agent === "b_iris"), "seats hold the new id");
  ok(Object.keys(p.crew.specs).every((id) => id === "b_iris") && Object.keys(p.crew.playbooks).every((id) => id === "b_iris"), "specs and playbooks too");
  const lay = readLayout(p.crew.departments[0].overview);
  ok(lay && lay.flat().some((w) => w.w === "run_metric" && w.agent === "b_iris") && !JSON.stringify(lay).includes("analytics_head"), "an agent number names the new id");
  eq(p.chains["analytics-weekly"], "analytics-weekly-2", "a taken chain key gets a number");
  eq(p.crew.departments[0].sort, 5, "after the last department");
  const steps = (p.crew.flow.chains[0] as { steps: { agent: string }[] }).steps;
  eq(steps[0].agent, "b_iris", "chain steps name the new agent");
  ok(p.crew.goals.every((g) => g.department === "store_analytics_2"), "goals go to the new department");
  ok(p.crew.seats.every((s) => s.department === "store_analytics_2"), "seats too");
}
{
  // a name taken in another case, or an id taken by a different department, both move both
  eq(livePlan(store, { ...empty, deptNames: ["STORE ANALYTICS"] }).depts.store_analytics, "store_analytics_2", "names compare without case");
  eq(livePlan(store, { ...empty, deptIds: ["store_analytics"] }).names.store_analytics, "Store analytics 2", "an id clash numbers the name too");
}
// the chart's limits
assert.throws(() => livePlan(store, { ...empty, deptIds: Array.from({ length: MAX_DEPARTMENTS }, (_, i) => `d${i}`), deptNames: Array.from({ length: MAX_DEPARTMENTS }, (_, i) => `D${i}`) }), /departments at most/); n++;
assert.throws(() => livePlan(store, { ...empty, seats: MAX_SEATS }), /seats at most/); n++;
// a pack with problems is refused before anything
assert.throws(() => livePlan({ ...store, seats: [...store.seats, { ...store.seats[1], key: "x", parent: "nobody" }] } as DepartmentPack, empty), /can't be installed/); n++;
// every built-in department pack installs into an empty business, and beside itself unless an action the gateway
// gives only to named agents (the bookkeeper and CFO, the lead finder) would end up with another id: then it is refused, never half-made
for (const pk of DEPT_PACKS) {
  const a = livePlan(pk, empty);
  eq(crewProblems(a.crew), [], `${pk.id}: installs into a running business`);
  const live: LiveOrg = { deptIds: Object.values(a.depts), deptNames: Object.values(a.names), agentIds: Object.values(a.agents), chainKeys: Object.values(a.chains), seats: a.crew.seats.length + 1, topSort: 1 };
  let b: ReturnType<typeof livePlan>;
  try { b = livePlan(pk, live); } catch (e) { assert.match(String(e), /gateway lets only/, `${pk.id}: a second install is refused only for an action named for its agents`); n++; continue; }
  ok(Object.values(b.depts).every((id) => !live.deptIds.includes(id)) && Object.values(b.agents).every((id) => !live.agentIds.includes(id)) && Object.values(b.chains).every((k) => !live.chainKeys.includes(k)), `${pk.id}: a second install shares no id with the first`);
  eq(crewProblems(b.crew), [], `${pk.id}: and passes the checks`);
}

// ---- the rows: off duty, proposed, tagged with the pack, chains appended to the active flow, off
{
  const p = livePlan(store, empty);
  const existing = [{ key: "morning", name: "Morning", on: true, start: { type: "button" }, steps: [{ agent: "b_other" }] }];
  let i = 0;
  const { rows, flow } = liveRows(store, p, existing, () => `id${++i}`);
  ok(rows.agents.every((a) => a.enabled === false && a.pack === `store-analytics@${store.version}`), "agents start off duty, tagged with the pack");
  ok(rows.agent_playbooks.every((r) => r.status === "proposed"), "playbooks wait for approval");
  eq(rows.crew_flow, [], "no flow row: the chains go in as the next version of the active flow");
  eq(flow.length, 2, "the business's chains stay, the pack's are added");
  eq((flow[0] as { on: boolean }).on, true, "a chain that was on stays on");
  eq((flow[1] as { on: boolean }).on, false, "the pack's chain starts off");
  eq(rows.departments[0].pack, `store-analytics@${store.version}`, "the department says which pack");
  ok(rows.departments[0].overview, "and keeps its layout");
}

// ---- an agent pack fits only an open seat, off duty, with only the actions it suggests that the owner turned on
const conv = packById("conversion-analyst", "agent")!;
ok(conv && AGENT_PACKS.includes(conv), "the conversion analyst is a built-in agent pack");
ok(seatFits(conv, { title: "Site and conversion", sub: "" }), "it fits the store analytics pack's open seat");
ok(!seatFits(conv, { title: "Bookkeeper", sub: "Receipts" }), "and not a bookkeeper's");
{
  const open = { holder: "open", title: "Site and conversion", sub: "" };
  const s = seatPlan(conv, open, new Set(), []);
  eq(s.agentId, "b_conversion_analyst", "a builder id from its name");
  eq(s.agent.enabled, false, "off duty");
  eq(s.agent.pack, `conversion-analyst@${conv.version}`, "tagged with the pack");
  eq(s.grants, [], "no action unless the owner turned it on");
  ok(!s.spec.tools.includes("shopify_copy"), "so the spec has none");
  eq(s.playbook?.status, "proposed", "its playbook waits for approval");
  eq(s.def.active, true, "its spec is version 1");
  const g = seatPlan(conv, open, new Set(), ["shopify_copy", "shopify_refund", "mercury_propose_annotation", "nope"]);
  eq(g.grants, ["shopify_copy"], "only actions the pack suggests are granted");
  ok(g.spec.tools.includes("shopify_copy") && !g.spec.tools.includes("shopify_refund"), "and only they reach the spec");
  eq(seatPlan(conv, open, new Set(), [], "  Cora  ").agent.name, "Cora", "the owner may rename it");
  eq(seatPlan(conv, open, new Set(), [], "   ").agent.name, conv.agent.name, "a blank name keeps the pack's");
  eq(seatPlan(conv, open, new Set(["b_conversion_analyst"]), []).agentId, "b_conversion_analyst_2", "a taken id gets a number");
  assert.throws(() => seatPlan(conv, { ...open, holder: "agent" }, new Set(), []), /isn't open/); n++;
  assert.throws(() => seatPlan({ ...conv, suggests: ["analytics_overview"] }, open, new Set(), []), /can't be installed/); n++;
  eq(seatPlan({ ...conv, starts: null }, open, new Set(), []).agent.manual_only, true, "a pack with no schedule runs by hand");
}

// ---- its schedule is its own chain, off; the chains already there don't change
{
  const before: Flow = { chains: [{ key: "morning", name: "Morning", on: true, start: { type: "schedule", days: "daily", time: "07:00" }, steps: [{ agent: "b_other" }] }] } as Flow;
  const r = seatFlow(before, "b_cora", "Cora", { days: "mondays", time: "08:00" });
  ok(r && "flow" in r, "a schedule makes a chain");
  const chains = (r as { flow: Flow }).flow.chains;
  eq(chains.length, 2, "beside the chain already there");
  eq(chains[0], before.chains[0], "which doesn't change");
  eq(chains[1].on, false, "the new chain starts off");
  eq(chains[1].steps[0].agent, "b_cora", "and runs the new agent");
  eq(readFlow({ chains }, { ids: ["b_other", "b_cora"], manualOnly: new Set<string>() }).problems, [], "the flow passes its checks");
  eq(seatFlow(before, "b_cora", "Cora", null), null, "by hand adds no chain");
  ok(seatFlow(before, "b_cora", "Cora", { days: "mondays", time: "08:10" }) && "refuse" in seatFlow(before, "b_cora", "Cora", { days: "mondays", time: "08:10" })!, "a time off the quarter hour is refused");
}

// ---- what's left to turn on, in words
eq(setupSteps({ playbooksWaiting: [], offDuty: [], chainsOff: [] }), [], "nothing left, no banner");
eq(setupSteps({ playbooksWaiting: ["Iris"], offDuty: ["Iris"], chainsOff: ["Week in numbers"] }).map((s) => s.text), [
  "Approve Iris’s playbook.", "Try Iris once, then put them on duty.", "Turn on Week in numbers.",
], "one of each");
eq(setupSteps({ playbooksWaiting: ["A", "B", "C"], offDuty: ["A", "B"], chainsOff: [] }).map((s) => s.text), [
  "Approve A’s, B’s and C’s playbooks.", "Try A and B once, then put each on duty.",
], "lists read as words");

// ---- the server: reads first, writes in order, takes back what it wrote, owner only, audited
const inst = read("core/pack-install.ts");
ok(/import "server-only"/.test(inst), "the installer runs on the server only");
ok(/livePlan\(pack, live\.org\)[\s\S]*liveRows\(/.test(inst), "it plans from what's in the business");
ok(/catch \(e\) \{\s*await rollBack\(depts, agents\)/.test(inst), "a failed department install takes back what it wrote");
ok(/catch \(e\) \{[\s\S]{0,200}await rollBack\(\[\], \[plan\.agentId\]\)/.test(inst), "a failed agent install too, and opens the seat");
ok(/saveFlowVersion\(/.test(inst) && !/active: true/.test(inst), "chains go in as a new flow version, never by switching one on");
ok(!/enabled: true|on: true|status: "approved"/.test(inst + read("core/pack-install-rules.ts")), "nothing is switched on or approved");
ok(/packById\(packId, "department"\)/.test(inst) && /packById\(packId, "agent"\)/.test(inst), "only built-in packs install, by id");
const acts = read("dashboard/packActions.ts");
for (const f of ["installDeptPack", "installSeatPack"]) {
  ok(new RegExp(`export async function ${f}[\\s\\S]{0,200}await asRole\\("owner"\\)`).test(acts), `${f}: the owner only`);
  ok(new RegExp(`export async function ${f}[\\s\\S]*?await audit\\(me, "install_pack"`).test(acts), `${f}: audited`);
}
ok(!/router\.refresh/.test(acts), "no refresh after the action");
ok(/add column if not exists pack text/.test(read("supabase/migrations/20270115090000_agent_pack.sql")), "agents say which pack they came from");
ok(/table === "agents" && \/pack\//.test(inst), "before that migration, installs leave it out");

// ---- the sheets say what a pack adds and reads, worked out in code from the pack and what's connected
{
  const c = deptCard(store, new Set<ToolTileId>(), []);
  eq(c.adds.map((r) => `${r.title}${r.rest}`), ["Store analytics department", "Iris, Head of store analytics", "Site and conversion, open seat", "Week in numbers chain", "Grow revenue to $10,000 a month goal"], "what it adds, in order");
  eq(c.adds[0].sub, "Its Overview shows the report, revenue, orders, sessions and key events per 100 sessions", "its Overview in words, from its layout");
  eq(c.adds[3].sub, "Mondays at 7:30 AM: Iris", "a chain's start and steps");
  ok(c.adds.filter((r) => r.off).length === 2, "the agent and the chain say they start off");
  eq(c.tags.map((t) => t.text), ["1 agent · 1 open seat", "Google Analytics optional", "OPERATOR · v1"], "a connection its first steps don't need is optional");
  eq(deptCard(store, new Set<ToolTileId>(["analytics"]), []).tags[1], { text: "Google Analytics connected", tone: "ok" }, "a connected one says so");
  eq(deptCard(store, new Set<ToolTileId>(), ["store ANALYTICS"]).tags[1], { text: "You have Store analytics", tone: "acc" }, "a department already there is named, not blocked");
  ok(/off duty[\s\S]*waits for your OK[\s\S]*chain is off/.test(c.offNote), "everything starts off, in words");
  eq(c.problems, [], "no problems");
  const fin = deptCard(packById("finance", "department")!, new Set<ToolTileId>(), []);
  ok(fin.tags.some((t) => t.text === "Mercury not connected" && t.tone === "warn"), "a connection its first steps need, not connected, warns");
  const a = agentCard(conv, new Set<ToolTileId>(["shopify"]));
  eq(a.tags.map((t) => t.text), ["Claude Haiku 5.5 · $0.50 a day", "Shopify connected", "Google Analytics needed", "OPERATOR · v1"], "an agent pack's card");
  eq(a.suggests, [{ id: "shopify_copy", label: "Rewrite product copy" }], "its Can do toggles are what it suggests");
  eq(a.starts, "Mondays at 8:00 AM", "and when it would run");
}

// ---- the screens: Add a department opens the sheet, Avery first; open seats offer Fill from a pack to the owner
const company = read("app/(room)/page.tsx"), deptPage = read("app/(room)/dept/[id]/page.tsx"), sheet = read("dashboard/components/packSheet.tsx");
ok(/sp\.add === "dept"/.test(company) && /<AddDeptSheetFor /.test(company), "the Company page opens the Add a department sheet");
ok(sheet.indexOf("Design one with Avery") < sheet.indexOf(">Start from a pack<"), "Avery stays the first choice");
ok(/DEPT_PACKS\.filter\(\(p\) => p\.id !== SETUP_TEMPLATE\)/.test(read("dashboard/components/packSheetFor.tsx")), "the Chief of Staff setup installs isn't offered");
ok(/owner && AGENT_PACKS\.some\(\(p\) => seatFits\(p, x\)\)/.test(deptPage), "Fill from a pack shows only to the owner, on a seat a pack fits");
ok(/fromPack && <Suspense fallback=\{null\}><PackBanner /.test(deptPage), "a department from a pack streams in its banner");
ok(/Can do \(all start off\)/.test(sheet) && /useState<string\[\]>\(\[\]\)/.test(sheet), "suggested actions start off");
ok(!/router\.refresh/.test(sheet), "no refresh after an install");

// ---- a newer version: what changed in code, drafts beside what runs, the business's own bits kept
eq(readTag("store-analytics@2"), { id: "store-analytics", version: 2 }, "a pack tag reads back");
eq(readTag("nope"), null, "and a bad one doesn't");
{
  const v1 = livePlan(store, empty);
  const live = [{ id: "analytics_head", name: "Iris", firstName: "Iris", spec: { ...(v1.crew.specs.analytics_head as object), notionPages: [{ id: "0123456789abcdef0123456789abcdef", label: "Notes" }], tools: [...(v1.crew.specs.analytics_head as { tools: string[] }).tools, "shopify_copy"] }, edited: "Nov 20" }];
  eq(packUpdate(store, store.version, v1.crew.departments[0].overview, live), null, "no offer when the pack isn't newer");
  const spec2 = { ...(store.specs.analytics_head as object), directive: "Read the numbers, then say one thing.", tools: [...(store.specs.analytics_head as { tools: string[] }).tools, "analytics_landing_pages"].filter((t, i, a) => a.indexOf(t) === i) };
  const v2 = { ...store, version: store.version + 1, specs: { analytics_head: spec2 }, agents: [...store.agents, { ...store.agents[0], id: "extra", name: "Nova", role: "Analyst" }] } as DepartmentPack;
  const u = packUpdate(v2, store.version, v1.crew.departments[0].overview, live)!;
  ok(u && u.to === store.version + 1, "a newer pack is offered");
  eq(u.drafts.length, 1, "one changed agent, one draft");
  ok(u.drafts[0].spec.directive === "Read the numbers, then say one thing.", "the draft has the new instructions");
  ok(u.drafts[0].spec.tools.includes("shopify_copy"), "and keeps the action the owner granted");
  eq(u.drafts[0].spec.notionPages, [{ id: "0123456789abcdef0123456789abcdef", label: "Notes" }], "and the business's Notion pages");
  ok(u.lines.some((l) => l.mark === "~" && /Iris’s spec: .*new instructions/.test(l.text)), "what changed, in words");
  ok(u.lines.some((l) => l.mark === "+" && /Nova/.test(l.text) && /not added/.test(l.text)), "an agent new in the version is named, not added");
  ok(u.lines.some((l) => l.text === "Chains, goals and seats unchanged"), "chains, goals and seats never change");
  eq(u.warns.length, 1, "a spec the owner edited gets a note");
  ok(/nothing you made is replaced/.test(u.warns[0]), "saying nothing is replaced");
  eq(u.overview, null, "the same layout isn't rewritten");
  const same = packUpdate({ ...store, version: store.version + 1 } as DepartmentPack, store.version, v1.crew.departments[0].overview, [{ ...live[0], spec: v1.crew.specs.analytics_head, edited: null }])!;
  eq(same.drafts, [], "an unchanged spec gets no draft");
  // a new layout replaces an edited one only after the card says so (packs slice 5)
  const newLayout = [[{ w: "needs" }], [{ w: "report", span: 2 }, { w: "week_tile" }]];
  const v3 = { ...store, version: store.version + 1, departments: [{ ...store.departments[0], overview: newLayout }] } as DepartmentPack;
  const lay = packUpdate(v3, store.version, [[{ w: "needs" }]], [], "Nov 28")!;
  eq(lay.overview, newLayout, "a new layout from the pack");
  ok(lay.warns.some((w) => /You changed this Overview’s layout on Nov 28/.test(w)), "and a note when someone changed the layout by hand");
  eq(packUpdate(v3, store.version, [[{ w: "needs" }]], [])!.warns, [], "no note when no one did");
}
const inst2 = read("core/pack-install.ts");
ok(/saveSpecVersion\(x\.agentId, x\.spec/.test(inst2) && !/activateSpecVersion/.test(inst2), "an update saves drafts, never goes live");
ok(/export async function savePackDrafts[\s\S]{0,200}await asRole\("owner"\)[\s\S]*?await audit\(me, "update_pack"/.test(read("dashboard/packActions.ts")), "the owner saves it, audited");
const mcp = read("core/operator-mcp.ts");
ok(/async function listPacks/.test(mcp) && !/installDepartmentPack|installAgentPack|savePackUpdate/.test(mcp), "Claude lists packs and links to the sheets; it never installs");


// ---- the Packs page and a pack's page (packs slice 4): worked out from the pack files, a month at the hire card's estimate
{
  // a flat $0.10 a run (and $0.50 at most) stands in for the price list
  const cost: CostOf = (_a, runs) => ({ perRun: 0.1, month: 0.1 * runs, atMost: 0.5 * (runs || 1) });
  const listed = DEPT_PACKS.filter((p) => p.id !== "chief-of-staff");
  const shopify = new Set<ToolTileId>(["shopify"] as ToolTileId[]);
  const seats = [{ id: "00000000-0000-4000-8000-000000000001", holder: "open", title: "Site and conversion", sub: "Numbers on what visitors do on the site", departmentId: "store_analytics", parentId: null }];
  const cards = marketCards({ depts: listed, agents: AGENT_PACKS, connected: shopify, have: ["Finance"], seats, cost });
  eq(cards.map((c) => c.id), [...listed.map((p) => p.id), ...AGENT_PACKS.map((p) => p.id)], "every listed pack has a card, departments first, the setup pack left out");
  ok(!cards.some((c) => c.id === "chief-of-staff"), "the setup-only pack isn't on the Packs page");
  ok(cards.find((c) => c.id === "finance")!.tags.some((t) => t.text === "You have Finance"), "a department the business has says so");
  ok(cards.find((c) => c.id === "conversion-analyst")!.tags[0].text === "Fits 1 open seat", "an agent pack says how many open seats it fits");
  ok(cards.every((c) => !c.tags.some((t) => / · v\d+$/.test(t.text))), "cards don't repeat the version (the card says Built in)");
  // the store's weekly chain runs Iris 4 times a month
  const sc = deptCost(store, cost);
  eq([sc.byHand, Math.round(sc.month * 100)], [false, 40], "a department's month is each agent at its scheduled chains' runs");
  eq(costWords(sc), "About $0.40 a month", "and reads as a month");
  const ca = agentCost(AGENT_PACKS[0], cost);
  eq(costWords(ca), "About $0.40 a month", "an agent pack on its suggested Mondays schedule");
  eq(costWords({ month: 0, perRun: 0.25, atMost: 0, byHand: true, unknown: false }), "About $0.25 a run", "nothing scheduled reads as a run");
  // search and filters
  const all = { q: "", kind: "all" as const, tile: null };
  eq(matchCards(cards, all).length, cards.length, "no filter keeps every card");
  eq(matchCards(cards, { ...all, kind: "agent" }).map((c) => c.id), ["conversion-analyst"], "the kind filter");
  eq(matchCards(cards, { ...all, q: "Bookkeeper" }).map((c) => c.id), ["finance"], "search matches roles");
  eq(matchCards(cards, { ...all, q: "campaign WRITER" }).map((c) => c.id), ["email-marketing"], "search ignores case and needs every word");
  ok(matchCards(cards, { ...all, tile: "shopify" as ToolTileId }).every((c) => c.tiles.includes("shopify" as ToolTileId)), "Works with keeps packs that read that connection");
  eq(matchCards(cards, { q: "bookkeeping", kind: "agent", tile: null }), [], "nothing matches");
  eq(noMatchWords({ q: "bookkeeping", kind: "agent", tile: null }, "Mercury"), "No pack matches “bookkeeping” among agent packs that work with Mercury.", "the empty state names what was searched");
  eq(noMatchWords(all, null), "No pack matches.", "and reads plainly with nothing searched");
  const chips = tileChips(cards, TOOL_TILES, shopify);
  ok(chips.length > 0 && chips[0].connected, "Works with chips list connected connections first");
  ok(chips.every((c) => cards.some((x) => x.tiles.includes(c.id))), "and only connections a listed pack reads");
  eq(readFilter({ kind: "agent", tool: "nope", q: "x".repeat(200) }, ["shopify"]), { q: "x".repeat(80), kind: "agent", tile: null }, "the address is read with limits; an unknown tool is dropped");
  eq(readFilter({ kind: "bad" }, []).kind, "all", "an unknown kind reads as all");
  // a department pack's page
  const page = deptPackPage(store, { connected: shopify, have: [], org: empty, cost });
  eq([page.cant, page.have], [null, null], "a pack that goes in cleanly has nothing to warn about");
  eq(page.agents.map((a) => a.name), ["Iris"], "its agents");
  ok(/asks for no actions/.test(page.agents[0].sub), "and says it asks for no actions");
  eq(page.chains.map((r) => r.off), ["Starts off"], "its chains start off");
  ok(page.cells && page.cells[0][0].name === "What needs you" && page.cells[0][0].span === 3, "its Overview drawn small, with spans");
  eq(layoutCells(null), null, "no layout: the usual Overview");
  const again = deptPackPage(store, { connected: shopify, have: ["Store analytics"], org: { ...empty, deptIds: ["store_analytics"], deptNames: ["Store analytics"], agentIds: ["analytics_head"] }, cost });
  ok(again.cant == null && /Store analytics 2/.test(again.have ?? ""), "a second install is named and allowed");
  const fin = packById("finance", "department")!;
  const fin2 = deptPackPage(fin, { connected: shopify, have: ["Finance"], org: { ...empty, deptIds: ["finance"], deptNames: ["Finance"], agentIds: ["cfo", "bookkeeper"] }, cost });
  ok(/a second can’t be added/.test(fin2.cant ?? ""), "a second Finance says why it can't be added");
  // an agent pack's page
  const ap = agentPage(AGENT_PACKS[0], { connected: shopify, seats, deptName: () => "Store analytics", head: () => "Iris", cost });
  eq(ap.fits.map((x) => [x.title, x.dept, x.head]), [["Site and conversion", "Store analytics", "Iris"]], "the open seats it fits, with their department and head");
  eq(agentPage(AGENT_PACKS[0], { connected: shopify, seats: [{ ...seats[0], holder: "agent" }], deptName: () => "", head: () => null, cost }).fits, [], "a filled seat isn't offered");
  ok(ap.suggests.length > 0 && ap.cant == null, "its suggested actions are listed (they start off)");
}

// ---- slice 4 wiring: a menu item, links from the sheets and Claude to pack pages, Add is the owner-only action
{
  const layout = read("app/(room)/layout.tsx");
  ok(/href: "\/packs"/.test(layout), "Packs is in the menu");
  const page = read("app/(room)/packs/[id]/page.tsx");
  ok(/installDeptPack/.test(page) && /atLeast\(me\.role, "owner"\)/.test(page), "a pack's page adds through the owner-only action, and shows Add to the owner only");
  ok(/packsHref\(\)/.test(read("dashboard/components/packSheet.tsx")), "the Add a department sheet links to every pack");
  ok(!/add=dept&pack/.test(read("core/operator-mcp.ts")) && /packHref\(p\.id\)/.test(read("core/operator-mcp.ts")), "list_packs links open a pack's page");
  ok(!/sp\.pack/.test(read("app/(room)/page.tsx")), "the sheet's old deep link is gone");
}

console.log(`check:pack-install ok (${n} checks)`);
