// Checks a department's Overview tab (overview slice 1): the counts, sums and bars worked out in code, and that
// the page draws them without a model. No database, no network. Run: npm run check:overview
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STACK_HUES, companyTiles, deptRuns7, deptStack, goalsTile, headline, lastDays, revenueDays, type Snap } from "../dashboard/company-overview-rules";
import { barPct, chainLast, dayKey, draftOutcomes, isWork, lastWeek, money, recentFailures, runsPerDay, spendRows, type OvRun } from "../dashboard/overview-rules";

const now = Date.parse("2026-11-26T18:00:00Z"); // 10 AM in Los Angeles, Thursday
const tz = "America/Los_Angeles";
const H = 36e5;
let n = 0;
const run = (hoursAgo: number, over: Partial<OvRun> = {}): OvRun => ({ id: `r${n++}`, agent_id: "a", trigger: "schedule", started_at: new Date(now - hoursAgo * H).toISOString(), status: "ok", cost_usd: 0.01, summary: "Done.", error: null, ...over });

// days are the org's calendar days, not UTC's
assert.equal(dayKey(now, tz), "2026-11-26");
assert.equal(dayKey(Date.parse("2026-11-26T05:00:00Z"), tz), "2026-11-25", "9 PM the night before in Los Angeles is still the 25th");
assert.equal(dayKey(now, "Not/AZone"), "2026-11-26", "a bad time zone falls back to UTC");

// runs per day: 14 days, oldest first, today last; failed apart; chat, tries, approvals and skips left out
const runs = [run(1), run(2, { status: "failed" }), run(13), run(13, { trigger: "chat" }), run(3, { trigger: "approval" }), run(4, { status: "skipped" }), run(5, { status: "running" }), run(24 * 13 + 1), run(24 * 20)];
const bars = runsPerDay(runs, now, tz, 14);
assert.equal(bars.length, 14);
assert.equal(bars[13].key, "2026-11-26");
assert.equal(bars[0].key, "2026-11-13");
assert.deepEqual({ f: bars[13].finished, x: bars[13].failed }, { f: 1, x: 1 }, "today: one finished, one failed; the running one counts as neither");
assert.equal(bars[12].finished, 1, "13 hours ago was yesterday in Los Angeles; its chat reply isn't counted");
assert.equal(bars[0].finished, 1, "the oldest day holds the run from 13 days ago");
assert.equal(bars.reduce((t, b) => t + b.finished + b.failed, 0), 4, "the run from 20 days ago is outside the window");
// across the daylight-saving change (Nov 1 in the US) the window still has 14 distinct days
const dst = runsPerDay([], Date.parse("2026-11-08T18:00:00Z"), tz, 14);
assert.equal(new Set(dst.map((b) => b.key)).size, 14);
assert.deepEqual([dst[0].key, dst[13].key], ["2026-10-26", "2026-11-08"]);
assert.ok(!isWork({ trigger: "preview", status: "ok" }) && isWork({ trigger: "chain", status: "failed" }));

// bars: a day with one run always shows; empty days are flat
assert.equal(barPct(0, 5), 0);
assert.equal(barPct(1, 100), 4);
assert.equal(barPct(3, 3), 100);
assert.equal(barPct(2, 0), 0);

// the last 7 days: work counted, every run's cost (chat too) added up in code
const w = lastWeek([...runs, run(30, { trigger: "chat", cost_usd: 0.1 }), run(24 * 8, { cost_usd: 5 })], now);
assert.equal(w.runs, 4, "finished, failed and running work in the last 7 days");
assert.equal(w.finished, 2);
assert.equal(w.failed, 1);
assert.equal(w.costUsd, 0.17, "seven runs at $0.01 and one chat at $0.10 in the week; the $5 run is older");

// drafts: how the last 7 days of cards ended; expired ones nobody decided are left out
const card = (status: string, hoursAgo = 2) => ({ status, created_at: new Date(now - hoursAgo * H).toISOString() });
const dr = draftOutcomes([card("approved"), card("approved"), card("edited"), card("rejected"), card("sent_back"), card("pending"), card("expired"), card("approved", 24 * 9)], now);
assert.deepEqual(dr, { asWritten: 2, edited: 1, rejected: 2, waiting: 1, total: 6 });
assert.deepEqual(draftOutcomes([], now), { asWritten: 0, edited: 0, rejected: 0, waiting: 0, total: 0 });

// spend: most first, bars against the most, an agent in Claude at $0 and saying why
const sp = spendRows(["m", "b", "t"], { b: 2.4, t: 1.7, m: 0 }, new Set(["m"]));
assert.deepEqual(sp.map((r) => [r.id, r.usd, r.pct, r.claude]), [["b", 2.4, 100, false], ["t", 1.7, 71, false], ["m", 0, 0, true]]);
assert.deepEqual(spendRows(["x"], {}, new Set()).map((r) => r.pct), [0], "nothing spent: no bar, no divide by zero");
assert.equal(money(0), "$0");
assert.equal(money(1.2), "$1.20");

// failures: the newest failed run per agent in the last 3 days, unless that agent has run fine since
const f = recentFailures([run(5, { agent_id: "a", status: "failed" }), run(1, { agent_id: "a" }), run(6, { agent_id: "b", status: "failed" }), run(10, { agent_id: "b", status: "failed" }), run(100, { agent_id: "c", status: "failed" }), run(2, { agent_id: "d", status: "failed", trigger: "chat" })], now);
assert.deepEqual(f.map((r) => r.agent_id), ["b"], "a recovered; b's newest failure shows once; c's is too old; a chat failure isn't a run");

// chains: the newest firing, step by step, with its OK step
const cr = (chain_id: string, step: number, status: string, hoursAgo: number) => ({ chain_key: "mon", chain_id, chain_step: step, status, started_at: new Date(now - hoursAgo * H).toISOString() });
const last = chainLast("mon", 3, [cr("old", 0, "failed", 50), cr("new", 0, "ok", 5), cr("new", 1, "ok", 4.9)], [{ chain_id: "new", step: 2, status: "pending" }]);
assert.deepEqual(last?.steps, ["done", "done", "waiting"]);
assert.equal(last?.at, new Date(now - 5 * H).toISOString(), "the firing's time is its first step's");
assert.deepEqual(chainLast("mon", 2, [cr("x", 0, "failed", 1)], [])?.steps, ["failed", "not_reached"]);
assert.equal(chainLast("other", 2, [cr("x", 0, "ok", 1)], []), null, "a chain that hasn't fired has no last run");

// the page draws what code worked out: no model call, no Date.now() while drawing, chat behind the Ask button
const page = readFileSync("app/(room)/dept/[id]/page.tsx", "utf8"), ov = readFileSync("dashboard/components/overview.tsx", "utf8"), srv = readFileSync("dashboard/overview.ts", "utf8");
for (const [name, src] of [["page", page], ["overview", ov], ["loader", srv]] as const) {
  assert.ok(!/integrations\/llm|callModel|anthropic/i.test(src), `the ${name} calls no model`);
}
assert.ok(!/Date\.now\(\)/.test(ov), "the Overview draws with the roster's time, not its own clock");
assert.ok(/tab === "overview"\) return <OverviewPane/.test(page), "Overview is a tab of the page");
assert.ok(/<AskSheet[\s\S]*?<Chat /.test(page), "the head's chat opens in the Ask sheet");
assert.ok(!/className=\{`dp\$\{tab === "chat"/.test(page), "the page has no chat mode any more");
assert.ok(/from\("approvals"\)\.select\("status, created_at"\)\.eq\("department_id", deptId\)/.test(srv), "drafts are this department's cards only");
assert.ok(/import \{ db \} from "@\/core\/db"/.test(srv), "every read goes through db(), so it is this org's");

// ---- the Company Overview (overview slice 3): tiles, revenue per day with gaps, runs by department, department cards
assert.deepEqual(lastDays(now, tz, 3), ["2026-11-24", "2026-11-25", "2026-11-26"]);
const snap = (date: string, revenue: number, orders: number, cash: number | null = null): Snap => ({ date, revenue, orders, cash_usd: cash });
const snaps = [snap("2026-10-05", 1000, 20), snap("2026-10-20", 1000, 20), snap("2026-11-02", 300, 6, 9030), snap("2026-11-19", 500, 10, 9030), snap("2026-11-25", 200, 4, 8420)];
const rev = revenueDays(snaps, now, tz, 30);
assert.equal(rev.length, 30); assert.equal(rev[29].key, "2026-11-26");
assert.equal(rev[29].usd, null, "a day with no saved reading is null, never 0");
assert.equal(rev.find((r) => r.key === "2026-11-25")?.usd, 200);
assert.equal(rev.filter((r) => r.usd != null).length, 3);
const tl = companyTiles(snaps, now, tz);
assert.equal(tl.revenue.value, "$1,000", "this month's saved days, added in code");
assert.equal(tl.revenue.sub, "50% of last month, 4 days left · 23 days not saved", "against last month, and the missing days counted, not passed off as slow ones");
assert.equal(tl.orders.value, "20"); assert.equal(tl.orders.sub, "Average order $50");
assert.equal(tl.cash.value, "$8,420"); assert.equal(tl.cash.sub, "Down $610 this week · as of 11/25", "the latest reading against the one a week before it");
assert.equal(companyTiles([snap("2026-11-25", 0, 0, 500)], now, tz).cash.sub, "No reading from a week before · as of 11/25");
const none = companyTiles([], now, tz);
assert.ok(none.revenue.empty && none.cash.empty && none.orders.empty, "no saved numbers: the tiles say so");
assert.equal(companyTiles([snap("2026-11-26", 0, 0)], now, tz).orders.sub, "No orders yet this month");
assert.deepEqual(goalsTile([{ title: "List size", status: "behind" }, { title: "Runway", status: "on_track" }, { title: "Accounts won", status: "missed" }, { title: "Reach", status: "no_measure" }]), { ok: 1, total: 4, sub: "Behind: list size, accounts won" });
assert.deepEqual(goalsTile([]), { ok: 0, total: 0, sub: "No goals yet" });
assert.equal(goalsTile([{ title: "A", status: "reached" }, { title: "B", status: "no_measure" }]).sub, "1 not measured yet");
const deptOfA = (a: string) => (a === "a" ? "fin" : a === "b" ? "sales" : null);
const st = deptStack([run(1), run(2, { agent_id: "b", status: "failed" }), run(3, { agent_id: "c" }), run(4, { trigger: "chat" }), run(5, { status: "running" }), run(24 * 20)], deptOfA, ["fin", "sales"], now, tz, 14);
assert.equal(st.length, 14);
assert.deepEqual(st[13], { key: "2026-11-26", counts: [1, 1], total: 2 }, "finished and failed work runs by department; chats, running and runs in no department left out");
assert.equal(st.reduce((t, x) => t + x.total, 0), 2, "nothing older than 14 days");
assert.deepEqual(deptRuns7([run(1), run(24 * 6), run(24 * 8), run(2, { agent_id: "b" }), run(3, { trigger: "report" })], deptOfA, now), { fin: 2, sales: 1 });
assert.ok(STACK_HUES.length >= 4);
assert.equal(headline({ day: "2026-11-26", lines: [{ section: "happened", text: "Cash is $8,420." }, { section: "look", text: "Tuesday's review failed." }] }, "2026-11-26", null), "Tuesday's review failed; Cash is $8,420.", "worth a look first");
assert.equal(headline({ day: "2026-11-24", lines: [{ section: "happened", text: "All charges categorized." }] }, "2026-11-26", null), "Last report: All charges categorized.");
assert.equal(headline(null, "2026-11-26", "Drafted 2 emails."), "Drafted 2 emails.");
assert.equal(headline({ day: "2026-11-26", lines: [] }, "2026-11-26", null), "No report yet.");

// the Company page: Overview first, drawn from code, Avery's chat behind Ask, the report from core/reports
const home = readFileSync("app/(room)/page.tsx", "utf8"), coView = readFileSync("dashboard/components/companyOverview.tsx", "utf8"), coRules = readFileSync("dashboard/company-overview-rules.ts", "utf8");
for (const [name, src] of [["company page", home], ["company overview", coView], ["company rules", coRules]] as const) {
  assert.ok(!/integrations\/llm|callModel|anthropic/i.test(src), `the ${name} calls no model`);
}
assert.ok(!/Date\.now\(\)/.test(coView) && !/Date\.now\(\)/.test(coRules), "drawn with the floor's time");
assert.ok(/return <OverviewPane \{\.\.\.p\} \/>;/.test(home), "Overview is the Company page's default tab");
assert.ok(/latestReports\(COMPANY_SCOPE\)/.test(home) && /company: true/.test(home), "the company report is the saved one, drawn as the company's");
assert.ok(/from\("kpi_snapshots"\)\.select\("date, revenue, orders, cash_usd"\)/.test(srv), "revenue, orders and cash come from the saved daily numbers");
console.log("check:overview ok");
