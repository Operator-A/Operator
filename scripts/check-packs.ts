// Packs (core/pack-rules.ts, core/packs.ts, docs/packs.md): `npm run check:packs`. Pure: no database.
// Packs are data: every file in packs/ is JSON, listed once in core/packs.ts, names only core's tools and
// measures, installs switched off on its own and with any other pick, never grants an action, names no
// business, and the compiled pack mechanism card 134 removed stays gone.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { mergePacks, packProblems, versionAtLeast, PACK_MAX_BYTES, type AgentPack, type DepartmentPack, type Pack } from "../core/pack-rules";
import { agentPackProblems, crewProblems, installRows } from "../core/install-rules";
import { TOOLS } from "../core/tools/catalog";
import { OPERATOR_VERSION } from "../core/version";
import { brandWords } from "./lib/brand.mjs";

const exists = (f: string) => { try { statSync(f); return true; } catch { return false; } };

// ---- packs/ holds data only, and one reader lists it
const files = readdirSync("packs");
assert.ok(files.length >= 4, "the starting set is there");
for (const f of files) assert.match(f, /^[a-z][a-z0-9-]+\.json$/, `packs/${f}: packs are JSON files, no code`);
const reader = readFileSync("core/packs.ts", "utf8");
for (const f of files) assert.match(reader, new RegExp(`from "@/packs/${f.replace(".", "\\.")}"`), `core/packs.ts lists packs/${f}`);
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|mjs)$/.test(n) ? [p] : []; });
for (const f of ["core", "agents", "dashboard", "app", "integrations", "ee", "scripts"].flatMap(walk)) {
  if (f === "core/packs.ts" || f === "scripts/check-packs.ts") continue;
  assert.doesNotMatch(readFileSync(f, "utf8"), /from "(@\/|(\.\.\/)+)packs\//, `${f} reads packs/: only core/packs.ts does`);
}

// ---- the compiled mechanism card 134 removed stays gone: packs are data, never code
for (const gone of ["templates", "templates/index.ts", "templates/registry.ts", "templates/types.ts", "packs/index.ts", "core/templates.ts", "core/template-rules.ts", "scripts/check-templates.ts"]) {
  assert.ok(!exists(gone), `${gone} is gone`);
}
for (const f of ["core/tools/catalog.ts", "core/measures.ts", "core/shopify-queries.ts", "core/goal-rules.ts", "core/install.ts", "core/packs.ts", "dashboard/roster.ts", "dashboard/data.ts"]) {
  if (exists(f)) assert.doesNotMatch(readFileSync(f, "utf8"), /packTools|packMeasure|PACK_SHOPIFY|PACK_MEASURE_DEFS|plannedSeats|plannedIds/, `${f} has no compiled pack hooks or planned seats`);
}
assert.ok(!/check:templates/.test(readFileSync("package.json", "utf8")), "check:packs replaced check:templates");

// ---- each pack on its own
const all: Pack[] = files.map((f) => JSON.parse(readFileSync(join("packs", f), "utf8")));
const brand = brandWords();
for (const [i, t] of all.entries()) {
  assert.deepEqual(packProblems(t, OPERATOR_VERSION), [], `${files[i]}: shape`);
  assert.equal(`${t.id}.json`, files[i], `${files[i]}: named by its id`);
  const text = JSON.stringify(t);
  for (const re of brand) assert.doesNotMatch(text, re, `${t.id} names a business`);
  assert.doesNotMatch(text, /\b(coffee|roast\w*|green lots?)\b/i, `${t.id} is generic`);
  if (t.kind === "agent") { assert.deepEqual(agentPackProblems(t), [], `${t.id}: contents`); continue; }
  assert.deepEqual(crewProblems(mergePacks([t])), [], `${t.id} installs on its own`);
  for (const a of t.agents) for (const tool of (t.specs[a.id] as { tools: string[] }).tools) assert.ok(TOOLS[tool], `${t.id}: ${a.id} names ${tool}, which isn't a core tool`);
}
const depts = all.filter((t): t is DepartmentPack => t.kind === "department");
// ids are unique across department packs, so any pick merges cleanly
const ids = (k: (t: DepartmentPack) => string[]) => depts.flatMap(k);
for (const [what, list] of [["department", ids((t) => t.departments.map((d) => d.id))], ["agent", ids((t) => t.agents.map((a) => a.id))], ["seat", ids((t) => t.seats.map((s) => s.key))]] as const) {
  assert.equal(new Set(list).size, list.length, `a ${what} id is used by two packs`);
}
assert.equal(new Set(all.map((t) => t.id)).size, all.length, "pack ids are unique");

// ---- picks
const by = (id: string) => depts.find((t) => t.id === id)!;
const order = ["finance", "chief-of-staff", "prospecting", "email-marketing", "store-analytics"];
const everything = mergePacks(order.map(by));
assert.deepEqual(crewProblems(everything), [], "all five install together");
const morning = (everything.flow.chains as { key: string; steps: { agent: string }[] }[]).find((c) => c.key === "morning")!;
assert.deepEqual(morning.steps.map((s) => s.agent), ["cfo", "chief_of_staff"], "the morning chain: the numbers, then the brief");
const briefOnly = mergePacks([by("chief-of-staff")]);
assert.deepEqual((briefOnly.flow.chains as { steps: { agent: string }[] }[]).flatMap((c) => c.steps.map((s) => s.agent)), ["chief_of_staff"]);
const noBrief = mergePacks([by("finance"), by("prospecting")]);
assert.ok((noBrief.flow.chains as { steps: { agent: string }[] }[]).every((c) => c.steps.every((s) => s.agent !== "chief_of_staff")), "a step for an agent not installed is dropped");
for (let mask = 1; mask < 1 << order.length; mask++) {
  const pick = order.filter((_, i) => mask & (1 << i)).map(by);
  assert.deepEqual(crewProblems(mergePacks(pick)), [], `pick ${pick.map((t) => t.id).join("+")} installs`);
}
// everything installs switched off
const rows = installRows(order.join("+"), everything);
assert.ok(rows.agents.every((a) => a.enabled === false), "every agent off duty");
assert.ok(rows.agent_playbooks.every((p) => p.status === "proposed"), "every playbook waits for the owner");
assert.ok((rows.crew_flow[0].flow as { chains: { on: boolean }[] }).chains.every((c) => !c.on), "every chain off");
assert.ok(rows.agent_defs.every((d) => String(d.created_by).startsWith("pack:")), "install says which packs it came from");
assert.equal(rows.departments.length, 4);
const toolsOf = (id: string) => ((everything.specs as Record<string, { tools?: string[] }>)[id]?.tools ?? []);
// card 159: the first-version departments, each with a head; the store analytics head reads the week in code
for (const id of ["finance", "prospecting", "email_marketing", "store_analytics"]) assert.ok(everything.departments.some((d) => d.id === id), `${id} is offered`);
assert.ok(toolsOf("analytics_head").includes("weekly_numbers"), "the store analytics head reads Week over week");
assert.deepEqual(toolsOf("campaign_writer").filter((t) => TOOLS[t]?.kind === "action"), ["klaviyo_campaign_draft"], "card 159b: the Campaign writer's one action is a Klaviyo draft for approval");
assert.ok(TOOLS.klaviyo_campaign_draft.agents?.includes("campaign_writer") && TOOLS.klaviyo_campaign_draft.params.some((p) => p.type === "pick" && p.name === "list"), "the list is a pick from Email lists, never typed by the model");
assert.ok(toolsOf("campaign_writer").includes("product_facts"), "the Campaign writer claims only Product facts");
// the gateway's action types still match the agents that use them
for (const id of ["cfo", "bookkeeper", "wholesale_hunter"]) assert.ok(everything.agents.some((a) => a.id === id), `${id} keeps its id: the gateway's policy names it`);

// ---- a department pack that reaches past its rights is refused
const refused = (f: (t: DepartmentPack) => void, why: RegExp) => { const t = structuredClone(by("finance")); f(t); assert.match(crewProblems(mergePacks([t])).join("; "), why); };
refused((t) => { (t.specs.cfo as { tools: string[] }).tools.push("send_money_now"); }, /cfo/);
const grantedAction = Object.values(TOOLS).find((t) => t.kind === "action" && t.agents === "granted")!;
refused((t) => { (t.specs.cfo as { tools: string[] }).tools.push(grantedAction.id); }, /only by an approver/);
refused((t) => { (t.specs.cfo as { notionPages: unknown[] }).notionPages = [{ id: "0123456789abcdef0123456789abcdef", label: "Ours" }]; }, /Notion pages/);
refused((t) => { (t.specs.cfo as { readsFrom: unknown[] }).readsFrom = [{ agentId: "someone_else", label: "x" }]; }, /isn't in the pack/);
refused((t) => { t.agents[0].daily_budget_usd = 51; }, /daily budget/);

// ---- shape and version
const head = { id: "x-pack", kind: "department", version: 1, name: "X", about: "A pack.", author: "Someone", license: "MIT", needs_operator: "0.1.0" };
const deptShape = { ...head, departments: [], agents: [], seats: [], chains: [], goals: [], specs: {}, playbooks: {} };
assert.deepEqual(packProblems(deptShape, "0.1.0"), []);
assert.deepEqual(packProblems(null, "0.1.0"), ["a pack is an object"]);
assert.ok(packProblems({ id: "X", name: "", about: "" }, "0.1.0").length >= 6, "every missing field is named");
assert.match(packProblems({ ...deptShape, kind: "theme" }, "0.1.0").join(), /kind/);
assert.match(packProblems({ ...deptShape, version: 0 }, "0.1.0").join(), /version/);
assert.match(packProblems({ ...deptShape, needs_operator: "9.0.0" }, "0.1.0").join(), /needs OPERATOR 9\.0\.0 or newer/);
assert.match(packProblems({ ...deptShape, needs_operator: "latest" }, "0.1.0").join(), /needs_operator/);
assert.match(packProblems({ ...deptShape, about: "x".repeat(PACK_MAX_BYTES) }, "0.1.0").join(), /at most 200 KB/);
assert.match(packProblems({ ...head }, "0.1.0").join(), /departments: a list/);
assert.ok(versionAtLeast("0.2.0", "0.1.9") && versionAtLeast("1.0.0", "1.0.0") && !versionAtLeast("0.1.0", "0.1.1") && !versionAtLeast("0.10", "0.1.0"));

// ---- agent packs: the same rules for one seat
const agentPack: AgentPack = {
  ...head, id: "search-seo", kind: "agent", name: "Search and SEO", about: "Drafts missing search titles and descriptions from the store's own facts.",
  seat: { title: "Search and SEO", sub: "Search titles, descriptions", matches: ["seo", "search"] },
  agent: { name: "Otto", role: "Search and SEO", model: "claude-sonnet-5-5", icon: null, hue: "#8FB8A8", daily_budget_usd: 1 },
  spec: { name: "Otto", model: "claude-sonnet-5-5", effort: "medium", tools: ["product_facts"], limits: { maxSteps: 12, maxCostUsd: 0.25 }, mandate: "Search and SEO", directive: "You hold the Search and SEO seat for the business.", goodResult: "", outputName: "search report", readsFrom: [], reportPage: null, notionPages: [] },
  playbook: [{ tool: "product_facts", input: {} }],
  starts: { days: "mondays", time: "08:00" },
  suggests: [grantedAction.id],
};
assert.deepEqual(packProblems(agentPack, "0.1.0"), [], "an agent pack's shape");
assert.deepEqual(agentPackProblems(agentPack), [], "an agent pack's contents");
const badAgent = (f: (p: AgentPack) => void, why: RegExp) => { const p = structuredClone(agentPack); f(p); assert.match([...packProblems(p, "0.1.0"), ...agentPackProblems(p)].join("; "), why); };
badAgent((p) => { (p.spec as { tools: string[] }).tools.push(grantedAction.id); }, /list it in suggests/);
badAgent((p) => { p.suggests = ["product_facts"]; }, /isn't an action an approver can give/);
badAgent((p) => { p.suggests = [grantedAction.id, grantedAction.id]; }, /listed twice/);
badAgent((p) => { (p.spec as { tools: string[] }).tools.push("send_money_now"); }, /not on the tool list/);
badAgent((p) => { p.agent.model = "claude-haiku-5-5"; }, /model isn't the agent's/);
badAgent((p) => { p.playbook = [{ tool: "web_search", input: {} }]; }, /isn't one of its tools/);
badAgent((p) => { p.starts = { days: "sometimes", time: "25:00" }; }, /24 hour time/);
badAgent((p) => { p.agent.daily_budget_usd = 0; }, /daily budget/);
badAgent((p) => { (p.spec as { reportPage: unknown }).reportPage = { id: "0123456789abcdef0123456789abcdef", label: "Ours" }; }, /Notion pages/);
badAgent((p) => { (p.spec as { readsFrom: unknown[] }).readsFrom = [{ agentId: "cfo", label: "CFO" }]; }, /isn't in the pack/);
badAgent((p) => { p.seat.title = ""; }, /seat:/);

console.log(`check:packs ok (${all.length} packs, ${everything.agents.length} agents in the department packs)`);
