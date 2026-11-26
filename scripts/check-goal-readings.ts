// Checks goal readings (overview slice 4): when the daily reading is due, which goals give a row (one per goal per
// day, nothing made up), the job's payload, the line the Overview draws, and that the scheduler, the worker, the table
// and the page are wired the way docs/department-pages.md says. No database, no network. Run: npm run check:goal-readings
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  READING_AT, READING_KIND, goalLine, readReadingPayload, readingDedupe, readingDue, readingPayload, readingRows, type GoalNowLite,
} from "../core/goal-reading-rules";
import { JOB_KINDS } from "../core/job-rules";
import { TENANT_TABLES } from "../core/tenancy";

const read = (p: string) => readFileSync(p, "utf8");
const tz = "America/Chicago";
const at = (hh: string) => Date.parse(`2026-11-26T${hh}:00-06:00`);

// due: from 9 AM in the business's time zone, once a day
assert.equal(READING_AT, "09:00");
assert.equal(readingDue(at("08:59"), tz, false), false, "not before 9 AM");
assert.equal(readingDue(at("09:00"), tz, false), true, "from 9 AM");
assert.equal(readingDue(at("23:30"), tz, false), true, "still due late in the day if missed");
assert.equal(readingDue(at("10:00"), tz, true), false, "not again once today's is saved");
assert.equal(readingDue(Date.parse("2026-11-26T14:59:00Z"), tz, false), false, "9 AM is the business's, not UTC");

// payload and dedupe: a day, nothing else
assert.deepEqual(readingPayload("2026-11-26"), { day: "2026-11-26" });
assert.equal(readingDedupe("2026-11-26"), "goal_reading:2026-11-26", "one job per business per day");
assert.deepEqual(readReadingPayload({ day: "2026-11-26", goal: "x" }), { day: "2026-11-26" });
assert.equal(readReadingPayload({ day: "tomorrow" }), null);
assert.equal(readReadingPayload(null), null);

// rows: one per active goal with a number; paused, unreadable or repeated goals save nothing
const g = (id: string, value: number | null, over: Partial<GoalNowLite["progress"]> = {}, state = "active"): GoalNowLite => ({ goal: { id, state }, progress: { status: "on_track", value, pct: 50, ...over } });
const rows = readingRows([
  g("a", 1200), g("a", 1300), g("b", null), g("c", 5, {}, "paused"), g("d", Number.NaN), g("e", 7, { pct: 140, status: "a very long status name indeed" }),
  g("f", 2e12), g("h", 0, { pct: null, status: "behind" }),
], "2026-11-26");
assert.deepEqual(rows.map((r) => r.goal_id), ["a", "e", "h"], "one per goal; paused, empty and out-of-range goals give no row");
assert.equal(rows[0].value, 1200, "the first reading of a goal wins");
assert.equal(rows[1].pct, 100, "pct is held to 0-100");
assert.equal(rows[1].status.length, 20, "status is cut to fit the column");
assert.deepEqual(rows[2], { goal_id: "h", day: "2026-11-26", value: 0, pct: null, status: "behind" }, "a real 0 is kept");
assert.ok(rows.every((r) => r.day === "2026-11-26"));

// the line: last 30 days, today at the right edge, only days with a reading get a point, the target as a level line
const today = "2026-11-26";
const line = goalLine([
  { day: "2026-11-26", value: 30 }, { day: "2026-10-28", value: 10 }, { day: "2026-11-12", value: 20 },
  { day: "2026-10-01", value: 999 }, { day: "2026-11-27", value: 999 }, { day: "2026-11-12", value: 22 },
], 40, today);
assert.deepEqual(line.points.map((p) => p.day), ["2026-10-28", "2026-11-12", "2026-11-26"], "outside the 30 days is left out; one point a day");
assert.equal(line.points[1].value, 22, "a day read twice keeps its later reading");
assert.equal(line.points[0].x, 0, "29 days ago is the left edge");
assert.equal(line.points[2].x, 400, "today is the right edge");
assert.equal(line.min, 10); assert.equal(line.max, 40, "the scale takes in the target");
assert.equal(line.target?.y, 16, "the target at the top");
assert.equal(line.points[0].y, 134, "the lowest reading at the bottom");
assert.equal(goalLine([], null, today).points.length, 0);
assert.equal(goalLine([{ day: today, value: 5 }], null, today).target, null);
const flat = goalLine([{ day: today, value: 5 }, { day: "2026-11-25", value: 5 }], null, today);
assert.ok(flat.min < flat.max && flat.points[0].y === flat.points[1].y, "a flat line still draws");

// wiring
assert.ok(JOB_KINDS.includes(READING_KIND), "the worker knows the job");
assert.ok(TENANT_TABLES.includes("goal_readings"), "goal_readings is scoped to the org");
const mig = read("supabase/migrations/20270113090000_goal_readings.sql");
assert.match(mig, /unique \(org_id, goal_id, day\)/, "one row per goal per day, in the database too");
assert.match(mig, /create policy org_rows on goal_readings/);
assert.match(mig, /references goals\(id\) on delete cascade/);
assert.match(mig, /'chain_step', 'report', 'goal_reading'/);
const server = read("core/goal-readings.ts");
assert.match(server, /onConflict: "org_id,goal_id,day"/, "a second reading the same day replaces the row");
assert.match(server, /if \(!\(await orgOn\(\)\)\) return null/, "nothing is queued while the org is off");
assert.doesNotMatch(server, /callModel|integrations\/llm|fetch\(/, "no model and no network: readings are worked out in code");
assert.match(read("app/api/dispatch/route.ts"), /on \? await queueGoalReadings\(now\)/, "the scheduler queues the reading");
assert.match(read("app/api/jobs/[id]/route.ts"), /job\.kind === "goal_reading"[\s\S]{0,400}saveGoalReadings/, "the worker saves it");
const dept = read("app/(room)/dept/[id]/page.tsx");
assert.match(dept, /<Suspense fallback=\{null\}><GoalChartOf /, "the goal chart streams in");
assert.match(dept, /readingsFor\(/);

console.log("check:goal-readings ok");
