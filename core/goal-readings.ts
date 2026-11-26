import "server-only";
// Goal readings (overview slice 4, docs/department-pages.md): the scheduler queues one job a day per business, from 9 AM
// in its time zone while the org is on; the job measures every active goal in code (core/goals.ts, the same reads as
// the Goals tab) and saves one row per goal for the day. The Overview reads them back to draw each goal's line.
// No model, nothing sent, nothing written outside OPERATOR.
import { db } from "@/core/db";
import { enqueue } from "@/core/jobs";
import { orgOn } from "@/core/org-switch";
import { orgTz } from "@/core/tz";
import { goalsNow, listGoals } from "@/core/goals";
import { todayIn } from "@/core/report-rules";
import { READING_KIND, readingDedupe, readingDue, readingPayload, readingRows } from "@/core/goal-reading-rules";

/** Queues today's reading job once it is due. Returns the day queued, or null. */
export async function queueGoalReadings(now: number): Promise<string | null> {
  if (!(await orgOn())) return null;
  const tz = await orgTz();
  const day = todayIn(tz, now);
  const { data, error } = await db().from("goal_readings").select("id").eq("day", day).limit(1);
  if (error) return null; // the table isn't there yet: nothing to queue
  if (!readingDue(now, tz, !!data?.length)) return null;
  return (await enqueue(READING_KIND, readingPayload(day), readingDedupe(day))) ? day : null;
}

/** Measures every active goal and saves today's reading of each. Returns what happened, in words. */
export async function saveGoalReadings(now = Date.now()): Promise<{ ok: boolean; text: string }> {
  const goals = await listGoals();
  if (goals == null) return { ok: false, text: "The goals table isn’t there yet." };
  const active = goals.filter((g) => g.state === "active");
  if (!active.length) return { ok: true, text: "No active goals, so nothing to read." };
  const day = todayIn(await orgTz(), now);
  const rows = readingRows(await goalsNow(active, new Date(now)), day);
  if (rows.length) {
    const { error } = await db().from("goal_readings").upsert(rows.map((r) => ({ ...r, read_at: new Date(now).toISOString() })), { onConflict: "org_id,goal_id,day" });
    if (error) return { ok: false, text: `Readings couldn’t be saved: ${error.message.slice(0, 120)}` };
  }
  const missed = active.length - rows.length;
  return { ok: true, text: `Saved ${rows.length} goal reading${rows.length === 1 ? "" : "s"} for ${day}${missed ? `; ${missed} goal${missed === 1 ? "" : "s"} gave no number` : ""}.` };
}

/** The saved readings of these goals from `fromDay` on, oldest first, by goal. */
export async function readingsFor(goalIds: readonly string[], fromDay: string): Promise<Record<string, { day: string; value: number }[]>> {
  if (!goalIds.length) return {};
  const { data, error } = await db().from("goal_readings").select("goal_id, day, value").in("goal_id", [...goalIds]).gte("day", fromDay).order("day").limit(goalIds.length * 40);
  if (error) return {};
  const out: Record<string, { day: string; value: number }[]> = {};
  for (const r of data ?? []) (out[r.goal_id as string] ??= []).push({ day: String(r.day), value: Number(r.value) });
  return out;
}
