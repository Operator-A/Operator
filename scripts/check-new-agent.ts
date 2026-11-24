// Checks New agent (card 420): the blank sheet's form as the server reads it, the v1 spec it becomes, which
// actions a new agent may be given, and what Create says back. No database, no network. Run: npm run check:new-agent
import assert from "node:assert/strict";
import { NEW_AGENT, closedActions, createdWords, jobLine, newSpecDraft, readNewAgent, type NewAgentForm } from "../dashboard/new-agent-rules";
import { madeAgentHref, newAgentHref } from "../dashboard/dept-rules";
import { madeAgentCompanyHref, newAgentCompanyHref } from "../dashboard/company-rules";

const CEIL = 5;
const base = {
  name: "  Tune-up Reminder ", role: "Service follow-up", job: "Find customers due a tune-up. Draft a reminder for each.", good: "",
  runsOn: { on: "operator", model: "claude-haiku-5-5" }, tools: ["shop_customers", "gmail_draft", "shop_customers"],
  start: { kind: "manual" }, place: { deptId: "service", seatId: null }, budget: "1.5",
};
const ok = (raw: unknown): NewAgentForm => { const r = readNewAgent(raw, CEIL); assert.ok("form" in r, "problem" in r ? r.problem : ""); return r.form; };
const bad = (raw: unknown, word: RegExp) => { const r = readNewAgent(raw, CEIL); assert.ok("problem" in r, "expected a problem"); assert.match(r.problem, word); };

// ---- a good form: trimmed, tools unique, budget a number to the cent
const f = ok(base);
assert.equal(f.name, "Tune-up Reminder");
assert.deepEqual(f.tools, ["shop_customers", "gmail_draft"]);
assert.equal(f.budget, 1.5);
assert.deepEqual(f.place, { deptId: "service", seatId: null });
assert.deepEqual(f.start, { kind: "manual" });

// ---- what refuses the whole form, in plain words
bad({ ...base, name: " " }, /name/);
bad({ ...base, name: "new" }, /another name/);
bad({ ...base, job: "" }, /job/);
bad({ ...base, runsOn: {} }, /runs on/);
bad({ ...base, runsOn: { on: "operator", model: "" } }, /runs on/);
bad({ ...base, tools: [] }, /reads/);
bad({ ...base, budget: 6 }, /\$0 to \$5/);
bad({ ...base, budget: -1 }, /budget/);
bad({ ...base, budget: "x" }, /budget/);
bad({ ...base, place: { deptId: "Service!" } }, /department/);
bad({ ...base, place: { deptId: "service", seatId: "nope" } }, /seat/);
bad({ ...base, tools: Array.from({ length: 41 }, (_, i) => `t${i}`) }, /at most 40/);

// ---- starts: a schedule needs days and a quarter-hour time; after another agent needs a valid id
assert.deepEqual(ok({ ...base, start: { kind: "schedule", days: [1, 2, 3, 4, 5], time: "07:15" } }).start, { kind: "schedule", days: "weekdays", time: "07:15" });
assert.deepEqual(ok({ ...base, start: { kind: "schedule", days: [1], time: "09:00" } }).start, { kind: "schedule", days: "mondays", time: "09:00" });
bad({ ...base, start: { kind: "schedule", days: [], time: "09:00" } }, /day/);
bad({ ...base, start: { kind: "schedule", days: [1], time: "09:10" } }, /quarter hour/);
assert.deepEqual(ok({ ...base, start: { kind: "after", agentId: "b_pip", passAlong: true } }).start, { kind: "after", agentId: "b_pip", passAlong: true });
assert.deepEqual(ok({ ...base, start: { kind: "after", agentId: "b_pip" } }).start, { kind: "after", agentId: "b_pip", passAlong: false });
bad({ ...base, start: { kind: "after", agentId: "Bad Id" } }, /runs after/);
// anything else is "only when you press Run now"
assert.deepEqual(ok({ ...base, start: { kind: "whenever" } }).start, { kind: "manual" });

// ---- no department
assert.equal(ok({ ...base, place: null }).place, null);

// ---- a Claude routine: its trigger id and key (or neither, for later), never OPERATOR tools or connector labels
const RT = `trig_${"A1".repeat(10)}`, KEY = ["sk", "ant", "oat01", "x".repeat(40)].join("-");
const linked = ok({ ...base, tools: [], runsOn: { on: "claude", routine: { routine: ` ${RT} `, token: KEY } } });
assert.deepEqual(linked.runsOn, { on: "claude", routine: { routine: RT, token: KEY } });
assert.deepEqual(linked.tools, []);
assert.deepEqual(ok({ ...base, tools: [], runsOn: { on: "claude" } }).runsOn, { on: "claude" }, "the routine can be connected later on its sheet");
assert.deepEqual(ok({ ...base, tools: [], runsOn: { on: "claude", tools: ["Gmail"] } }).runsOn, { on: "claude" }, "connector labels are ignored");
bad({ ...base, runsOn: { on: "claude" } }, /no OPERATOR reads/);
bad({ ...base, tools: [], runsOn: { on: "claude", routine: { routine: RT, token: "" } } }, /sk-ant-oat01-/);
bad({ ...base, tools: [], runsOn: { on: "claude", routine: { routine: "", token: KEY } } }, /trig_/);
bad({ ...base, tools: [], runsOn: { on: "claude", routine: { routine: "trig_../x", token: KEY } } }, /trig_/);

// ---- the v1 spec: the builder's shape, its job as the directive, a short job line, the role as its output's name
assert.equal(jobLine("Find customers due a tune-up. Draft a reminder for each."), "Find customers due a tune-up.");
assert.equal(jobLine("x".repeat(300)).length, 200);
const spec = newSpecDraft(f, "claude-haiku-5-5", { maxSteps: 12, maxCostUsd: 0.5 });
assert.equal(spec.directive, f.job);
assert.equal(spec.mandate, "Find customers due a tune-up.");
assert.equal(spec.model, "claude-haiku-5-5");
assert.equal(spec.outputName, "Service follow-up");
assert.deepEqual(spec.tools, ["shop_customers", "gmail_draft"]);
assert.deepEqual(spec.limits, { maxSteps: 12, maxCostUsd: 0.5 });
// a Claude routine keeps the fallback model on file, unused while it runs in Claude
assert.equal(newSpecDraft(linked, "claude-haiku-5-5", { maxSteps: 12, maxCostUsd: 0.5 }).model, "claude-haiku-5-5");
assert.equal(newSpecDraft({ ...f, role: "" }, "m", { maxSteps: 1, maxCostUsd: 0.01 }).outputName, "result");

// ---- actions: only those open to any agent an approver grants; reads pass through
const rule: Record<string, "granted" | readonly string[] | null> = { gmail_draft: "granted", annotate: ["cfo", "bookkeeper"], legacy: null };
const agentsOf = (id: string) => (id in rule ? rule[id] : undefined);
assert.deepEqual(closedActions(["shop_customers", "gmail_draft"], agentsOf), []);
assert.deepEqual(closedActions(["shop_customers", "annotate", "legacy"], agentsOf), ["annotate", "legacy"]);

// ---- what Create says back
assert.equal(createdWords("Rae", "in a new Parts buyer seat in Service", [], null), "Rae is created, off duty, as v1 in a new Parts buyer seat in Service. Try it once, then put it on duty.");
assert.equal(createdWords("Rae", null, ["Its schedule wasn’t set: Real runs are off."], null), "Rae is created, off duty, as v1. Its schedule wasn’t set: Real runs are off. Try it once, then put it on duty.");
assert.match(createdWords("Rae", null, [], "Rae is on a first try."), /off duty, as v1\. Rae is on a first try\.$/);

// ---- where the blank sheet opens, and where the new agent's sheet opens after
assert.equal(NEW_AGENT, "new");
assert.equal(newAgentHref("service"), "/dept/service?tab=agents&agent=new");
assert.equal(madeAgentHref("service").replace("{id}", "b_rae"), "/dept/service?tab=agents&agent=b_rae");
assert.equal(newAgentCompanyHref(), "/?tab=departments&agent=new");
assert.equal(madeAgentCompanyHref().replace("{id}", "b_rae"), "/?tab=departments&agent=b_rae");

console.log("check:new-agent ok");
