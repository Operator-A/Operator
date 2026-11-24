// Checks the agent sheet's hand-offs and Can do by tool (card 400): running after another agent, the chains an
// agent is in, each head's report as the company seat sees it, where a head's report goes, and the tool groups.
// No database, no network. Run: npm run check:handoff
import assert from "node:assert/strict";
import { flowProblems, withAgentAfter, type Flow } from "../core/flow-rules";
import type { Org } from "../core/org-rules";
import { canGroups, chainsOf, fillQuery, headRows, quarterBefore, readFill, upTo, type CanChoice } from "../dashboard/handoff-rules";
import type { Schedule } from "../dashboard/crew";

const flow: Flow = { chains: [
  { key: "morning", name: "Morning", on: true, start: { type: "schedule", days: "daily", time: "07:00" }, steps: [{ agent: "cfo" }, { agent: "cos", days: "weekdays", when: "any", notBefore: "07:30", passAlong: true }] },
  { key: "solo-coffee", name: "Coffee head", on: true, start: { type: "schedule", days: "weekdays", time: "07:15" }, steps: [{ agent: "coffee" }] },
  { key: "solo-sales", name: "Sales head", on: true, start: { type: "schedule", days: "weekdays", time: "09:00" }, steps: [{ agent: "sales" }] },
  { key: "full", name: "Full", on: false, start: { type: "schedule", days: "daily", time: "05:00" }, steps: ["d", "e", "f", "g", "h", "a", "b", "c"].map((agent) => ({ agent })) },
] };
const crew = { ids: ["cfo", "cos", "coffee", "sales", "mkt", "a", "b", "c", "d", "e", "f", "g", "h", "rae"], manualOnly: new Set<string>(["mkt", "rae"]) };
assert.deepEqual(flowProblems(flow, crew), []);

// ---- running after another agent
const r1 = withAgentAfter(flow, "rae", "Rae", "coffee", "Coffee head", true);
assert.ok("flow" in r1);
const coffee = r1.flow.chains.find((c) => c.key === "solo-coffee")!;
assert.deepEqual(coffee.steps, [{ agent: "coffee" }, { agent: "rae", when: "ok", passAlong: true }]);
assert.equal(r1.chain, "Coffee head");
assert.deepEqual(flowProblems(r1.flow, { ...crew, manualOnly: new Set(["mkt"]) }), []);
// without pass along, the step carries no hand-off
const r2 = withAgentAfter(flow, "rae", "Rae", "coffee", "Coffee head", false);
assert.ok("flow" in r2);
assert.deepEqual(r2.flow.chains.find((c) => c.key === "solo-coffee")!.steps[1], { agent: "rae", when: "ok" });
// its own one-step schedule comes out, so it doesn't run twice; other chains stay as they were
const r3 = withAgentAfter(flow, "sales", "Sales head", "coffee", "Coffee head", true);
assert.ok("flow" in r3);
assert.equal(r3.flow.chains.some((c) => c.key === "solo-sales"), false);
assert.equal(r3.flow.chains.length, flow.chains.length - 1);
assert.deepEqual(r3.flow.chains.find((c) => c.key === "morning"), flow.chains[0]);
// refusals
const why = (r: ReturnType<typeof withAgentAfter>) => ("refuse" in r ? r.refuse : "");
assert.match(why(withAgentAfter(flow, "rae", "Rae", "mkt", "Marketing head", true)), /doesn’t run on a schedule yet/);
assert.match(why(withAgentAfter(flow, "rae", "Rae", "rae", "Rae", true)), /after itself/);
assert.match(why(withAgentAfter(flow, "rae", "Rae", "cfo", "CFO", true)), /isn’t the last agent in Morning/);
assert.match(why(withAgentAfter(flow, "rae", "Rae", "c", "C", true)), /already has 8 agents/);
assert.match(why(withAgentAfter(flow, "cfo", "CFO", "cos", "Chief", true)), /already in Morning/);
// the flow it was given is never changed
assert.equal(flow.chains.find((c) => c.key === "solo-coffee")!.steps.length, 1);

// ---- the chains an agent is in
const names = { cfo: "Morgan", cos: "Avery", coffee: "Marlow", sales: "Rico", mkt: "Sloane", a: "A", b: "B", c: "C", rae: "Rae" };
const inCos = chainsOf("cos", flow.chains, names, (c) => `/x/${c.key}`);
assert.equal(inCos.length, 1);
assert.deepEqual(inCos[0].nodes.map((n) => [n.name, n.at, n.me]), [["Morgan", "7:00 AM daily", false], ["Avery", "weekdays, not before 7:30 AM", true]]);
assert.deepEqual(inCos[0].prev, { name: "Morgan", passAlong: true });
assert.equal(inCos[0].next, null);
const inCfo = chainsOf("cfo", flow.chains, names, (c) => `/x/${c.key}`);
assert.equal(inCfo[0].prev, null);
assert.deepEqual(inCfo[0].next, { name: "Avery", passAlong: true });
// a one-step chain (an agent's own schedule) isn't a hand-off
assert.deepEqual(chainsOf("coffee", flow.chains, names, (c) => `/x/${c.key}`), []);
assert.equal(inCos[0].href, "/x/morning", "each chain opens where it lives");

// ---- times
assert.equal(quarterBefore("07:30"), "07:15");
assert.equal(quarterBefore("07:00"), "06:45");
assert.equal(quarterBefore("00:00"), "00:00");
assert.deepEqual(readFill("07:15", "12345"), { time: "07:15", days: [1, 2, 3, 4, 5] });
assert.equal(readFill("07:10", "12345"), null);
assert.equal(readFill("07:15", "9"), null);
assert.equal(readFill(undefined, "1"), null);
assert.equal(fillQuery({ time: "07:15", days: [1, 2, 3, 4, 5] }), "&at=07:15&days=12345");

// ---- each head's report, as the company seat sees it
const org: Org = {
  departments: [
    { id: "finance", name: "Finance", sort: 1, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false },
    { id: "coffee", name: "Coffee", sort: 2, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false },
    { id: "sales", name: "Sales", sort: 3, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false },
    { id: "marketing", name: "Marketing", sort: 4, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false },
    { id: "ops", name: "Ops", sort: 5, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false },
    { id: "studio", name: "Studio", sort: 6, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false },
  ],
  seats: [
    { id: "c", departmentId: null, parentId: null, title: "Chief of Staff", sub: "", holder: "agent", agentId: "cos", sort: 0 },
    { id: "f", departmentId: "finance", parentId: null, title: "CFO", sub: "", holder: "agent", agentId: "cfo", sort: 0 },
    { id: "k", departmentId: "coffee", parentId: null, title: "Head of coffee", sub: "", holder: "agent", agentId: "coffee", sort: 0 },
    { id: "s", departmentId: "sales", parentId: null, title: "Head of sales", sub: "", holder: "agent", agentId: "sales", sort: 0 },
    { id: "s1", departmentId: "sales", parentId: "s", title: "Follow-ups", sub: "", holder: "agent", agentId: "rae", sort: 0 },
    { id: "m", departmentId: "marketing", parentId: null, title: "Head of marketing", sub: "", holder: "agent", agentId: "mkt", sort: 0 },
    { id: "o", departmentId: "ops", parentId: null, title: "Head of ops", sub: "", holder: "open", agentId: null, sort: 0 },
    { id: "st", departmentId: "studio", parentId: null, title: "Head of studio", sub: "", holder: "owner", agentId: null, sort: 0 },
  ],
};
const sched: Record<string, Schedule> = {
  cfo: { kind: "daily", time: "07:00" }, cos: { kind: "weekdays", time: "07:30" }, coffee: { kind: "weekdays", time: "07:15" },
  sales: { kind: "weekdays", time: "09:00" }, mkt: { kind: "manual" }, rae: { kind: "manual" },
};
const rows = headRows(org, sched.cos, sched, names);
assert.deepEqual(rows.map((h) => [h.deptName, h.head?.name ?? null, h.state]), [
  ["Finance", "Morgan", "before"], ["Coffee", "Marlow", "before"], ["Sales", "Rico", "after"], ["Marketing", "Sloane", "none"], ["Ops", null, "open"], ["Studio", null, "you"],
]);
assert.equal(rows[0].when, "Daily 7:00 AM");
assert.equal(rows[0].fill, null);
// a head with no schedule, or one after the reader, gets a time a quarter hour before it, on its days
assert.deepEqual(rows[3].fill, { time: "07:15", days: [1, 2, 3, 4, 5] });
assert.deepEqual(rows[2].fill, { time: "07:15", days: [1, 2, 3, 4, 5] });
assert.equal(rows[4].fill, null);

// ---- where a head's report goes
const reads = (id: string) => id === "cos";
assert.deepEqual(upTo(org, "mkt", sched.mkt, sched, names, reads), { id: "cos", name: "Avery", when: "Weekdays 7:30 AM", state: "none", fill: { time: "07:15", days: [1, 2, 3, 4, 5] } });
assert.equal(upTo(org, "coffee", sched.coffee, sched, names, reads)!.state, "before");
assert.equal(upTo(org, "coffee", sched.coffee, sched, names, reads)!.fill, null);
assert.equal(upTo(org, "sales", sched.sales, sched, names, reads)!.state, "after");
// not a head, the company seat itself, or a reader without Department reports: nothing
assert.equal(upTo(org, "rae", sched.rae, sched, names, reads), null);
assert.equal(upTo(org, "cos", sched.cos, sched, names, reads), null);
assert.equal(upTo(org, "mkt", sched.mkt, sched, names, () => false), null);
// a reader with no schedule
assert.equal(upTo(org, "mkt", sched.mkt, { ...sched, cos: { kind: "manual" } }, names, reads)!.state, "reader_manual");

// ---- Can do by tool
const can: CanChoice[] = [
  { id: "hubspot.move", label: "Move a HubSpot deal", on: false, ready: false, why: "Not connected", conn: "hubspot" },
  { id: "shopify.tag", label: "Tag an order or customer", on: false, ready: true, conn: "shopify" },
  { id: "calendar.hold", label: "Hold time on the calendar", on: false, ready: true, conn: "calendar" },
  { id: "shopify.copy", label: "Rewrite product copy", on: false, ready: true, conn: "shopify" },
  { id: "stripe.invoice", label: "Draft a Stripe invoice", on: true, ready: false, why: "Not connected", conn: "stripe" },
  { id: "square.invoice", label: "Draft a Square invoice", on: false, ready: false, why: "Not connected", conn: "square" },
];
const label: Record<string, string> = { hubspot: "HubSpot", shopify: "Shopify", calendar: "Google Calendar", stripe: "Stripe", square: "Square" };
const g = canGroups(can, (c) => label[c]);
assert.deepEqual(g.shown.map((x) => [x.name, x.connected, x.items.map((i) => i.id)]), [
  ["Shopify", true, ["shopify.tag", "shopify.copy"]], ["Google Calendar", true, ["calendar.hold"]],
  // an action already on stays in view even when its tool isn't connected
  ["Stripe", false, ["stripe.invoice"]],
]);
assert.deepEqual(g.later.map((x) => x.name), ["HubSpot", "Square"]);
assert.deepEqual(canGroups([], (c) => c), { shown: [], later: [] });

console.log("check:handoff ok");
