// Calendar dates and wall-clock times in a business's own time zone (card 187). Each business keeps
// one on Settings (`timeZone` in its business settings, core/tz.ts reads it); a business that never
// set one, and the scheduler's own bookkeeping, use DEFAULT_TZ. Vercel Cron runs in UTC.
export const DEFAULT_TZ = "America/Chicago";

/** A time zone Intl knows (an IANA name like "America/Los_Angeles"), or null. */
export function validTz(v: unknown): string | null {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t || t.length > 64 || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(t)) return null;
  try { return new Intl.DateTimeFormat("en-US", { timeZone: t }).resolvedOptions().timeZone; } catch { return null; }
}

/** "2026-10-27" for the calendar day `daysAgo` before now, in `tz`. */
export const localDate = (tz: string, daysAgo = 0, now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(now.getTime() - daysAgo * 864e5));
/** The zone's UTC offset on a given day, like "-05:00". */
export const offsetOn = (date: string, tz: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" })
    .formatToParts(new Date(`${date}T12:00:00Z`)).find((p) => p.type === "timeZoneName")?.value.replace("GMT", "") || "+00:00";
/** The UTC instant for a calendar date and "HH:MM" wall-clock time in `tz`. */
export const localAt = (date: string, time: string, tz: string) => Date.parse(`${date}T${time}:00${offsetOn(date, tz) || "Z"}`);
export const nextDay = (date: string) => new Date(Date.parse(`${date}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);

/** Midnight at the start of today, or of this month, in `tz`, as an ISO time. */
export function startOf(unit: "day" | "month", tz: string, now = new Date()) {
  const d = localDate(tz, 0, now);
  const day = unit === "day" ? d : `${d.slice(0, 8)}01`;
  return new Date(localAt(day, "00:00", tz)).toISOString();
}

/** The zone's short name at a moment, like "CST" or "GMT+1", shown beside times. */
export const zoneLabel = (tz: string, at: Date | number | string = Date.now()) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? tz;

/** "Thu, Oct 29" for a calendar date like "2026-10-29". */
export const dayTitle = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
