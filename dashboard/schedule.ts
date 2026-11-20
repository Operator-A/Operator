// Shift times in the business's own time zone (card 187), from each agent's place in the crew flow (dashboard/roster.ts scheduleOf).
// The dispatcher (app/api/dispatch) runs them while the org is on (docs/org-schedule.md).
import { DAY_WORDS, onDay } from "@/core/flow-rules";
import { localAt, localDate, nextDay } from "@/core/time";
import type { Schedule } from "./crew";
import { t12 } from "./format";

const fires = (s: Schedule, date: string) => s.kind !== "manual" && onDay(s.kind, date);

/** The scheduled firing on a calendar date in `tz`, if any. */
export function firingOn(s: Schedule | undefined, date: string, tz: string) {
  return s && s.kind !== "manual" && s.time && fires(s, date) ? localAt(date, s.time, tz) : null;
}

export function nextRuns(s: Schedule | undefined, from: number, n: number, tz: string) {
  const out: number[] = [];
  if (!s || s.kind === "manual" || !s.time) return out;
  let d = localDate(tz, 0, new Date(from));
  for (let i = 0; i < 30 && out.length < n; i++, d = nextDay(d)) {
    const t = firingOn(s, d, tz);
    if (t && t > from) out.push(t);
  }
  return out;
}

export function schedWords(s: Schedule | undefined) {
  if (!s || s.kind === "manual" || !s.time) return "Manual only";
  return `${{ daily: "Daily", weekdays: "Weekdays", mondays: "Mondays" }[s.kind]} ${t12(s.time)}`;
}

export function schedSentence(s: Schedule | undefined) {
  if (!s || s.kind === "manual" || !s.time) return "No automatic runs. Runs only when you press Run.";
  return `Runs ${DAY_WORDS[s.kind]} at ${t12(s.time)}.`;
}
