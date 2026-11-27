// Goal readings (overview slice 4): once a day the scheduler saves where each goal stands, so a goal gets a line over
// time instead of only its latest reading. When the reading is due, which goals give a row, the job's payload, and the
// line the Overview draws. Pure: no database, no network, no model, so `npm run check:goal-readings` can test it.
import { localAt } from "./time";
import { todayIn } from "./report-rules";

/** The reading is taken after the morning's runs have had time to finish: from 9 AM in the business's time zone. */
export const READING_AT = "09:00";
export const READING_KIND = "goal_reading";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether today's reading is due: from READING_AT on, and only when today's isn't saved yet. */
export function readingDue(now: number, tz: string, savedToday: boolean): boolean {
  return !savedToday && now >= localAt(todayIn(tz, now), READING_AT, tz);
}

export const readingPayload = (day: string) => ({ day });
export const readingDedupe = (day: string) => `${READING_KIND}:${day}`;
export function readReadingPayload(p: unknown): { day: string } | null {
  const o = p as { day?: unknown } | null;
  return o && typeof o.day === "string" && DAY_RE.test(o.day) ? { day: o.day } : null;
}

/** One goal's progress as code worked it out (core/goals.ts goalsNow). */
export interface GoalNowLite { goal: { id: string; state: string }; progress: { status: string; value: number | null; pct: number | null } }
export interface ReadingRow { goal_id: string; day: string; value: number; pct: number | null; status: string }

/**
 * The rows to save for a day: one per active goal whose measure gave a number. A paused goal, or one that couldn't be
 * read, saves nothing: a gap in the line is honest, a made-up 0 is not.
 */
export function readingRows(now: readonly GoalNowLite[], day: string): ReadingRow[] {
  const seen = new Set<string>();
  const out: ReadingRow[] = [];
  for (const n of now) {
    const v = n.progress.value;
    if (n.goal.state !== "active" || seen.has(n.goal.id) || v == null || !Number.isFinite(v) || Math.abs(v) > 1e12) continue;
    seen.add(n.goal.id);
    const pct = n.progress.pct == null || !Number.isFinite(n.progress.pct) ? null : Math.max(0, Math.min(100, n.progress.pct));
    out.push({ goal_id: n.goal.id, day, value: v, pct, status: n.progress.status.slice(0, 20) });
  }
  return out;
}

export interface LinePoint { day: string; value: number; x: number; y: number }
export interface GoalLine { points: LinePoint[]; target: { value: number; y: number } | null; min: number; max: number; days: number }

/**
 * The goal's line for the Overview: its saved readings over the last `days` days (oldest left, today right) scaled into
 * a `w` × `h` box, with the target as a level line when there is one. Only days with a reading get a point.
 */
export function goalLine(readings: readonly { day: string; value: number }[], target: number | null, today: string, days = 30, w = 400, h = 150, pad = 16): GoalLine {
  const t0 = Date.parse(`${today}T12:00:00Z`);
  const ago = (d: string) => Math.round((t0 - Date.parse(`${d}T12:00:00Z`)) / 864e5);
  const kept = [...new Map(readings.filter((r) => DAY_RE.test(r.day) && Number.isFinite(r.value) && ago(r.day) >= 0 && ago(r.day) < days).map((r) => [r.day, r])).values()]
    .sort((a, b) => a.day.localeCompare(b.day));
  const vals = [...kept.map((r) => r.value), ...(target != null && Number.isFinite(target) ? [target] : [])];
  let min = vals.length ? Math.min(...vals) : 0, max = vals.length ? Math.max(...vals) : 1;
  if (min === max) { min -= 1; max += 1; }
  const y = (v: number) => Math.round((h - pad - ((v - min) / (max - min)) * (h - 2 * pad)) * 10) / 10;
  const x = (d: string) => Math.round(((days - 1 - ago(d)) / Math.max(1, days - 1)) * w * 10) / 10;
  return {
    points: kept.map((r) => ({ day: r.day, value: r.value, x: x(r.day), y: y(r.value) })),
    target: target != null && Number.isFinite(target) ? { value: target, y: y(target) } : null,
    min, max, days,
  };
}
