// What an agent costs (card 155, core/cost-rules.ts): `npm run check:cost`. No database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CREDITS_MARGIN, MIN_REAL_RUNS, REAL_RUNS, costDetail, estimateRun, monthCost, monthWords, realCost, runCost, totalCost, usd } from "../core/cost-rules";
import { DAY_RUNS } from "../core/flow-rules";
import { TEMPLATES } from "../core/templates";
import { modelDef } from "../integrations/models";

const price = (id: string) => { const m = modelDef(id); return m ? { in: m.in, out: m.out } : null; };
const near = (a: number | null, b: number, why: string) => assert.ok(a != null && Math.abs(a - b) < 0.0005, `${why}: ${a} vs ${b}`);

// the estimate: a turn per tool plus a wrap-up, capped, null without a price
const cfo = (TEMPLATES.find((t) => t.id === "finance")!.specs as Record<string, { model: string; effort: "low" | "medium" | "high"; tools: string[]; limits: { maxSteps: number; maxCostUsd: number } }>).cfo;
near(estimateRun(cfo, price(cfo.model)), 0.179, "the CFO template's estimate a run");
assert.equal(estimateRun({ ...cfo, limits: { ...cfo.limits, maxCostUsd: 0.05 } }, price(cfo.model)), 0.05, "never more than its cap");
assert.equal(estimateRun(cfo, null), null, "no price, no estimate");
assert.ok(estimateRun({ ...cfo, effort: "high" }, price(cfo.model))! > estimateRun({ ...cfo, effort: "low" }, price(cfo.model))!, "more effort costs more");

// real runs replace the estimate after MIN_REAL_RUNS; only finished, non-try runs; the last REAL_RUNS
const run = (cost: number, o: Partial<{ agent_id: string; status: string; trigger: string }> = {}) => ({ agent_id: "cfo", status: "ok", trigger: "schedule", cost_usd: cost, ...o });
assert.equal(realCost([run(0.01), run(0.01)], "cfo"), null, `fewer than ${MIN_REAL_RUNS} real runs: no average yet`);
assert.deepEqual(realCost([run(0.004), run(0.006), run(0.008), run(9, { trigger: "preview" }), run(9, { status: "failed" }), run(9, { agent_id: "x" })], "cfo"), { count: 3, avg: 0.006 });
const many = [...Array(REAL_RUNS).fill(0).map(() => run(0.01)), ...Array(10).fill(0).map(() => run(5))];
near(realCost(many, "cfo")!.avg, 0.01, "only the newest runs count");
assert.deepEqual(runCost({ count: 6, avg: 0.006 }, 0.179), { perRun: 0.006, basis: "real", runs: 6 });
assert.deepEqual(runCost(null, 0.179), { perRun: 0.179, basis: "estimate", runs: 0 });
assert.deepEqual(runCost(null, null), { perRun: null, basis: "unknown", runs: 0 });

// a month: a run × runs on its schedule, with "at most" from the cap; by hand is $0
const morgan = monthCost({ run: runCost({ count: 6, avg: 0.006 }, 0.179), cap: 0.75, runsPerMonth: DAY_RUNS.daily, billing: "own_key" });
near(morgan.month, 0.18, "Morgan, every day, from real runs");
near(morgan.atMost, 22.5, "Morgan's most on schedule");
assert.equal(monthWords(morgan), "About $0.18 a month");
assert.equal(costDetail(morgan), "at most $22.50 · from 6 real runs · billed by Anthropic to your key");
const quinn = monthCost({ run: runCost({ count: 4, avg: 0.011 }, 0.094), cap: 0.3, runsPerMonth: DAY_RUNS.weekdays, billing: "own_key" });
near(quinn.month, 0.242, "Quinn, weekdays");
const fresh = monthCost({ run: runCost(null, 0.179), cap: 0.75, runsPerMonth: 30, billing: "own_key" });
near(fresh.month, 5.37, "an estimate before any runs");
assert.match(costDetail(fresh), /estimate, no runs yet/);
const rowan = monthCost({ run: runCost({ count: 4, avg: 0.922 }, 0.004), cap: 1.25, runsPerMonth: 0, billing: "own_key" });
assert.equal(rowan.month, 0);
assert.equal(monthWords(rowan), "$0 a month: runs only when you press Run, about $0.92 each time");
assert.equal(costDetail(rowan), "at most $1.25 a run · from 4 real runs · billed by Anthropic to your key");

// on credits: the full amount the founder pays, the margin included in both numbers
const credits = monthCost({ run: runCost({ count: 6, avg: 0.006 }, null), cap: 0.75, runsPerMonth: 30, billing: "credits" });
near(credits.month, 0.18 * CREDITS_MARGIN, "credits add the margin");
near(credits.atMost, 22.5 * CREDITS_MARGIN, "and to the most");
assert.match(costDetail(credits), /on your OPERATOR credits$/);

// unknown is said, never guessed; totals add up
const unknown = monthCost({ run: runCost(null, null), cap: null, runsPerMonth: 30, billing: "own_key" });
assert.equal(monthWords(unknown), "Cost unknown");
assert.equal(unknown.month, 0);
const t = totalCost([{ name: "Morgan", cost: morgan }, { name: "Quinn", cost: quinn }, { name: "Nobody", cost: unknown }, { name: "Rowan", cost: rowan }]);
near(t.month, morgan.month + quinn.month, "the total is the sum");
near(t.atMost, 22.5 + 6.6, "the most is the sum of scheduled caps");
assert.deepEqual(t.unknown, ["Nobody"]);
assert.equal(usd(0.0004), "under $0.001");
assert.equal(usd(0.006), "$0.006");
assert.equal(usd(5.375), "$5.38");

// one formula: the builder, the roster, proposals and plans read core/cost-rules.ts, and the old ones are gone
const read = (f: string) => readFileSync(f, "utf8");
assert.match(read("dashboard/agentMap.ts"), /estimateRun\(/, "the agent map's estimate comes from core/cost-rules.ts");
assert.doesNotMatch(read("dashboard/roster.ts"), /avgCostOf/, "the roster's average comes from realCost");
for (const f of ["dashboard/orgDay.ts", "dashboard/orgPlan.ts"]) assert.doesNotMatch(read(f), /capPerRun \?\?/, `${f} doesn't plan with the cap as a run's cost`);
assert.match(read("app/(room)/proposals/[id]/page.tsx"), /hireCost\(p, bill\)/, "a hire proposal shows its month, for the business's billing");
assert.match(read("app/(room)/page.tsx"), /hireCost\(p\.payload, bill\)/, "the Desk's proposal card shows its month, for the business's billing");
assert.match(read("dashboard/cost.ts"), /export const billing = \(\): Promise<Billing> => billingNow\(\)/, "who pays is the business's own: its key, or credits (card 128 slice 4)");

console.log("check:cost ok");
