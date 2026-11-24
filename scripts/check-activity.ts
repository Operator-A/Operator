// Activity (docs/department-pages.md, slice 12; mockup v20): Runs and Status on one page. `npm run check:activity`.
// Pure: the filters, departments, day groups and totals, then the files (redirects, the menu, what the old pages had).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { Org } from "../core/org-rules";
import { ACTIVITY_HREF, activityHref, activityQ, byDay, deptOfAgents, filtered, healthWord, matchRuns, totalsLine, type RunIn } from "../dashboard/activity-rules";

const read = (p: string) => readFileSync(p, "utf8");

// ---- filters from the address: old Runs links keep working, anything odd is "all"
const ids = ["money", "sales"];
assert.deepEqual(activityQ({}, ids), { dept: "all", result: "all", start: "all", q: "" });
assert.deepEqual(activityQ({ dept: "money", status: "failed", trigger: "chain", q: "  receipts " }, ids), { dept: "money", result: "failed", start: "chain", q: "receipts" });
assert.equal(activityQ({ dept: "company" }, ids).dept, "company", "agents in no department have their own chip");
assert.deepEqual(activityQ({ dept: "nope", status: "running", trigger: "approval" }, ids), { dept: "all", result: "all", start: "all", q: "" }, "an unknown department, result or start is all");
assert.equal(activityQ({ q: "x".repeat(300) }, ids).q.length, 100, "search is cut to 100 characters");
const all = activityQ({}, ids);
assert.equal(activityHref(all), "/activity");
assert.equal(activityHref(all, { dept: "money", result: "failed" }), "/activity?dept=money&status=failed");
assert.equal(activityHref(activityQ({ dept: "money", q: "a b" }, ids), { dept: "all" }), "/activity?q=a+b", "a filter put back to all leaves the address");
assert.ok(!filtered(all) && filtered(activityQ({ trigger: "cron" }, ids)));

// ---- each agent's department; agents in none are "company"
const org = { departments: [{ id: "money" }, { id: "sales" }], seats: [{ holder: "agent", agentId: "a1", departmentId: "money" }, { holder: "agent", agentId: "a2", departmentId: "sales" }] } as unknown as Org;
assert.deepEqual(deptOfAgents(org, ["a1", "a2", "chief"]), { a1: "money", a2: "sales", chief: "company" });
assert.deepEqual(deptOfAgents(null, ["a1"]), { a1: "company" }, "before the org chart every agent is Company");

// ---- matching runs
const run = (id: string, agent: string, status: string, trigger: string, at: string, summary: string | null = null, error: string | null = null, cost = 0.01): RunIn =>
  ({ id, agent_id: agent, status, trigger, started_at: at, summary, error, cost_usd: cost });
const now = Date.parse("2026-11-24T18:00:00Z");
const runs = [
  run("r1", "a1", "failed", "cron", "2026-11-24T15:10:00Z", null, "Gmail sign-in expired"),
  run("r2", "chief", "ok", "cron", "2026-11-24T14:00:00Z", "Sent your morning summary"),
  run("r3", "a2", "ok", "manual", "2026-11-23T22:15:00Z", "Found 6 shops"),
  run("r4", "a1", "skipped", "chain", "2026-11-23T20:00:00Z", null, null, 0),
  run("r5", "a2", "ok", "approval", "2026-11-20T20:00:00Z", "Applied a tag"),
];
const deptOf = deptOfAgents(org, ["a1", "a2", "chief"]);
const ids2 = (q: Parameters<typeof matchRuns>[1]) => matchRuns(runs, q, deptOf).map((r) => r.id);
assert.deepEqual(ids2(all), ["r1", "r2", "r3", "r4", "r5"]);
assert.deepEqual(ids2({ ...all, dept: "money" }), ["r1", "r4"]);
assert.deepEqual(ids2({ ...all, dept: "company" }), ["r2"]);
assert.deepEqual(ids2({ ...all, result: "ok", start: "manual" }), ["r3"]);
assert.deepEqual(ids2({ ...all, q: "GMAIL" }), ["r1"], "search reads errors too, any case");

// ---- day groups (Chicago) and the totals line
assert.deepEqual(byDay(runs, "America/Chicago", now).map((g) => [g.day, g.runs.map((r) => r.id)]), [["Today", ["r1", "r2"]], ["Yesterday", ["r3", "r4"]], ["Fri, Nov 20", ["r5"]]]);
assert.equal(totalsLine(runs), "5 runs · 3 OK · 1 failed · 1 skipped");
assert.equal(totalsLine([runs[1]]), "1 run · 1 OK · 0 failed · 0 skipped");

// ---- the health strip
assert.deepEqual(healthWord([]), { text: "All clear", clear: true, red: false });
assert.deepEqual(healthWord([{ level: "alert" }, { level: "warn" }]), { text: "1 needs a look", clear: false, red: true });
assert.deepEqual(healthWord([{ level: "alert" }, { level: "alert" }]).text, "2 need a look");
assert.deepEqual(healthWord([{ level: "warn" }]), { text: "1 to know", clear: false, red: false });

// ---- files
const page = read("app/(room)/activity/page.tsx"), layout = read("app/(room)/layout.tsx");
assert.equal(ACTIVITY_HREF, "/activity");
for (const p of ["app/(room)/runs/page.tsx", "app/(room)/status/page.tsx"]) assert.match(read(p), /redirect\(/, `${p} only sends old links to Activity`);
assert.ok(existsSync("app/(room)/runs/[id]/page.tsx"), "a run's replay stays at /runs/<id>");
assert.ok(!existsSync("dashboard/components/RunTable.tsx"), "the Runs table is gone");
for (const bit of ["readStatus()", "problems.map", "f.overdueJobs.count", "f.deadJobs.count", "f.failedRuns.count", "f.refused.count", "f.paused.length", "recentEvents(", "matchRuns(", "byDay(", "`/runs/${r.id}`", 'id="live-events"', "<details"])
  assert.ok(page.includes(bit), `Activity has what Runs and Status had: ${bit}`);
assert.ok(!/getFloor\(\)/.test(page), "Activity reads only its pieces, not the whole floor (card 304)");
assert.ok(/label: "Activity", dot: broken/.test(layout) && /alertCount\(\)/.test(layout), "Activity in the menu carries a red dot while something is broken");
assert.ok(!/label: "Runs"|label="Status"|href="\/status"/.test(layout), "Runs and Status left the menu");
const statusRules = read("core/status-rules.ts");
assert.ok(!/href: "\/(runs|status)"/.test(statusRules), "what Status lists opens Activity");

console.log("check:activity ok");
