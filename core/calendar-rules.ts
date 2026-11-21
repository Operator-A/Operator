// Google Calendar (card 251, docs/mcp-everywhere.md "Google Calendar"). Pure, so `npm run check:mcp`
// and `npm run check:policy` can test it.
//
// Two Google sign-ins on our own server (integrations/calendar-server.ts), the way Gmail has two:
// - "Google Calendar" (calendar.events.readonly): the agents' reads. The week ahead, and free slots
//   in working hours, both on the business's primary calendar only. No attendee email ever leaves
//   the server: an event is a time, a cut title, and a count of guests.
// - "Calendar holds" (calendar.events): held only by the gateway, for one write, a private hold on
//   the primary calendar after an approver approves. A hold has no guests and is made with
//   sendUpdates=none, so it never emails anyone. The server has no update, move or delete code.
// Times, free slots and hours are worked out here, never by a model. The slot a hold takes is picked
// from a free-slots result by code, so an event title (written by anyone who invites the business)
// can never choose a time.

export const CALENDAR_TOOLS = ["calendar_events", "calendar_free"] as const;
export const HOLD_TOOL = "calendar_create_hold";
export const HOLD_FIELDS = ["title", "start", "end"] as const;
export interface HoldArgs { title: string; start: string; end: string }

export const LIMITS = { days: 14, titleShown: 80, holdTitle: 80, minHoldMin: 15, maxHoldMin: 480, leadMin: 5, aheadDays: 30, minSlotMin: 30, maxSlots: 40, maxEvents: 250 } as const;
const MIN = 60_000, DAY = 86_400_000;

export type CalendarArgs =
  | { tool: "calendar_events"; days: number }
  | { tool: "calendar_free"; days: number; fromHour: number; toHour: number };

const int = (v: unknown, dflt: number) => (v === undefined ? dflt : Number(v));

/** A read tool's input, checked again on our server. Anything not named here is refused. */
export function checkCalendarArgs(tool: string, raw: unknown): CalendarArgs | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed: Record<string, string[]> = { calendar_events: ["days"], calendar_free: ["days", "from_hour", "to_hour"] };
  if (!(tool in allowed)) return { problem: `${tool || "that"} isn't a Google Calendar read tool` };
  const extra = Object.keys(a).filter((k) => !allowed[tool].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  const days = int(a.days, tool === "calendar_events" ? 7 : 5);
  if (!Number.isInteger(days) || days < 1 || days > LIMITS.days) return { problem: `days is a whole number from 1 to ${LIMITS.days}` };
  if (tool === "calendar_events") return { tool: "calendar_events", days };
  const fromHour = int(a.from_hour, 9), toHour = int(a.to_hour, 17);
  if (!Number.isInteger(fromHour) || !Number.isInteger(toHour) || fromHour < 0 || toHour > 24 || fromHour >= toHour) return { problem: "from_hour and to_hour are whole hours, 0 to 24, from before to" };
  return { tool: "calendar_free", days, fromHour, toHour };
}

// ---- Time zones, with the platform's own zone data (Intl), no library.

/** Whether a name is an IANA time zone this runtime knows. */
export function zoneOk(tz: unknown): tz is string {
  if (typeof tz !== "string" || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/.test(tz)) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string, ms: number) {
  let f = fmtCache.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" }); fmtCache.set(tz, f); }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute, s: +o.second, wd: o.weekday };
}

/** The zone's offset from UTC at an instant, in minutes (Chicago in winter: -360). */
export function offsetMin(tz: string, ms: number): number {
  const p = parts(tz, ms);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000) / MIN);
}

/** The instant a wall-clock time in a zone happens (the later reading in a fall-back hour). */
export function wallToMs(tz: string, y: number, mo: number, d: number, h: number, mi = 0): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  let ms = guess - offsetMin(tz, guess) * MIN;
  ms = guess - offsetMin(tz, ms) * MIN;
  return ms;
}

const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
/** An instant as ISO 8601 in the zone, with its offset: 2026-11-24T10:00:00-06:00. */
export function isoIn(tz: string, ms: number): string {
  const p = parts(tz, ms), off = offsetMin(tz, ms);
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:00${off < 0 ? "-" : "+"}${pad(Math.trunc(off / 60))}:${pad(off % 60)}`;
}

/** A short label in the zone: "Tue Nov 24, 10:00". */
export function labelIn(tz: string, ms: number): string {
  const p = parts(tz, ms);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][p.mo - 1];
  return `${p.wd} ${mon} ${p.d}, ${pad(p.h)}:${pad(p.mi)}`;
}

/** The calendar day an instant falls on in the zone, as YYYY-MM-DD. */
export const dayIn = (tz: string, ms: number) => { const p = parts(tz, ms); return `${p.y}-${pad(p.mo)}-${pad(p.d)}`; };

/** ISO 8601 with an offset or Z, and seconds at most: what a hold's start and end must look like. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/;
export const isoMs = (s: unknown): number | null => (typeof s === "string" && ISO.test(s) && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null);

// ---- Reading events.list (raw Google JSON in, our own small rows out).

export interface CalEvent { start: string; end: string; all_day: boolean; title: string; guests: number; busy: boolean }
interface RawEvent {
  status?: unknown; summary?: unknown; transparency?: unknown; eventType?: unknown;
  start?: { dateTime?: unknown; date?: unknown }; end?: { dateTime?: unknown; date?: unknown };
  attendees?: { self?: unknown; responseStatus?: unknown }[];
}

/** One line of plain text, cut: an event title is written by whoever sent the invite, so it is untrusted. */
const plain = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);

/**
 * The events from an events.list reply, with no emails, no links and no descriptions. Busy means it
 * blocks time: not cancelled, not marked free, not declined by the calendar's owner, and not an
 * all-day event (all-day items are usually reminders, not meetings).
 */
export function readEvents(j: unknown): { timeZone: string | null; calendar: string; events: CalEvent[] } {
  const r = (j ?? {}) as { timeZone?: unknown; summary?: unknown; items?: RawEvent[] };
  const events: CalEvent[] = [];
  for (const e of (r.items ?? []).slice(0, LIMITS.maxEvents)) {
    if (e.status === "cancelled") continue;
    const allDay = typeof e.start?.date === "string";
    const s = allDay ? Date.parse(`${e.start!.date}T00:00:00Z`) : isoMs(e.start?.dateTime);
    const en = allDay ? Date.parse(`${e.end?.date}T00:00:00Z`) : isoMs(e.end?.dateTime);
    if (s === null || en === null || !Number.isFinite(s) || !Number.isFinite(en) || en <= s) continue;
    const declined = (e.attendees ?? []).some((a) => a.self === true && a.responseStatus === "declined");
    const guests = (e.attendees ?? []).filter((a) => a.self !== true).length;
    events.push({
      start: allDay ? String(e.start!.date) : String(e.start!.dateTime), end: allDay ? String(e.end!.date) : String(e.end!.dateTime),
      all_day: allDay, title: plain(e.summary, LIMITS.titleShown) || "(no title)", guests,
      busy: !allDay && e.transparency !== "transparent" && !declined && e.eventType !== "workingLocation",
    });
  }
  return { timeZone: zoneOk(r.timeZone) ? r.timeZone : null, calendar: plain(r.summary, 120), events };
}

/** The busy blocks of a list of events, as [start, end) instants, merged and sorted. */
export function busyBlocks(events: readonly CalEvent[]): [number, number][] {
  const b = events.filter((e) => e.busy).map((e) => [Date.parse(e.start), Date.parse(e.end)] as [number, number]).sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  for (const [s, e] of b) { const last = out[out.length - 1]; if (last && s <= last[1]) last[1] = Math.max(last[1], e); else out.push([s, e]); }
  return out;
}

/** The week ahead: events, plus meetings, hours in meetings and the busiest day, all counted here. */
export function weekOf(events: readonly CalEvent[], tz: string) {
  const timed = events.filter((e) => e.busy);
  const byDay = new Map<string, number>();
  for (const e of timed) { const d = dayIn(tz, Date.parse(e.start)); byDay.set(d, (byDay.get(d) ?? 0) + (Date.parse(e.end) - Date.parse(e.start)) / 3_600_000); }
  const busiest = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0];
  const hours = busyBlocks(events).reduce((n, [s, e]) => n + (e - s) / 3_600_000, 0);
  return {
    time_zone: tz,
    events: events.map((e) => ({ ...e, ...(e.all_day ? {} : { start_local: labelIn(tz, Date.parse(e.start)) }) })),
    totals: { meetings: timed.length, meeting_hours: Math.round(hours * 10) / 10, with_guests: timed.filter((e) => e.guests > 0).length },
    busiest_day: busiest ? { day: busiest[0], hours: Math.round(busiest[1] * 10) / 10 } : null,
  };
}

export interface Slot { start: string; end: string; minutes: number; label: string }

/**
 * Free time in working hours, from now (rounded up to the next quarter hour) through `days` calendar
 * days in the zone: the hours from..to each day, less the busy blocks, keeping slots of 30 minutes or
 * more. At most 40 slots, soonest first.
 */
export function freeSlots(events: readonly CalEvent[], tz: string, nowMs: number, days: number, fromHour: number, toHour: number): Slot[] {
  const busy = busyBlocks(events);
  const start = Math.ceil((nowMs + LIMITS.leadMin * MIN) / (15 * MIN)) * 15 * MIN;
  const today = parts(tz, nowMs);
  const out: Slot[] = [];
  for (let i = 0; i < days && out.length < LIMITS.maxSlots; i++) {
    const noon = Date.UTC(today.y, today.mo - 1, today.d, 12) + i * DAY;
    const dt = new Date(noon);
    const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    let s = Math.max(start, wallToMs(tz, y, mo, d, fromHour));
    const end = toHour === 24 ? wallToMs(tz, y, mo, d + 1, 0) : wallToMs(tz, y, mo, d, toHour);
    for (const [bs, be] of busy) {
      if (be <= s || bs >= end) continue;
      if (bs > s) push(s, Math.min(bs, end));
      s = Math.max(s, be);
      if (s >= end) break;
    }
    if (s < end) push(s, end);
  }
  return out.slice(0, LIMITS.maxSlots);
  function push(a: number, b: number) {
    const minutes = Math.round((b - a) / MIN);
    if (minutes >= LIMITS.minSlotMin) out.push({ start: isoIn(tz, a), end: isoIn(tz, b), minutes, label: `${labelIn(tz, a)} to ${labelIn(tz, b).split(", ")[1]} (${minutes} min)` });
  }
}

/** Whether [start, end) meets any busy block. */
export const overlaps = (events: readonly CalEvent[], startMs: number, endMs: number) => busyBlocks(events).some(([s, e]) => s < endMs && e > startMs);

// ---- The one write: a private hold.

/**
 * Why a hold is refused, or null: only a title, a start and an end; a one-line title with no links;
 * a start at least 5 minutes away and no more than 30 days out; 15 minutes to 8 hours long.
 */
export function refuseHold(args: Record<string, unknown>, nowMs: number): string | null {
  const extra = Object.keys(args).filter((k) => !(HOLD_FIELDS as readonly string[]).includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A hold has only a title, a start and an end: no guests, no place, no link.`;
  const { title, start, end } = args as Partial<HoldArgs>;
  if (typeof title !== "string" || !title.trim()) return "The hold needs a title.";
  if (title.length > LIMITS.holdTitle) return `The title is longer than ${LIMITS.holdTitle} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(title)) return "The title must be one line of plain text.";
  if (/https?:\/\/|www\.|@/i.test(title)) return "A hold's title may not hold a link or an address.";
  const s = isoMs(start), e = isoMs(end);
  if (s === null || e === null) return "start and end must be times with a time zone offset.";
  if (s < nowMs + LIMITS.leadMin * MIN) return "The hold starts in the past or within 5 minutes.";
  if (s > nowMs + LIMITS.aheadDays * DAY) return `The hold starts more than ${LIMITS.aheadDays} days out.`;
  const minutes = (e - s) / MIN;
  if (minutes < LIMITS.minHoldMin || minutes > LIMITS.maxHoldMin) return `A hold is ${LIMITS.minHoldMin} minutes to ${LIMITS.maxHoldMin / 60} hours long.`;
  return null;
}

/** The hold as Calendar's API takes it, fixed here: private, busy, no guests, no place, no reminders. */
export function holdBody(a: HoldArgs) {
  return {
    summary: a.title.trim(),
    description: "Hold made by OPERATOR after an approval.",
    start: { dateTime: a.start }, end: { dateTime: a.end },
    transparency: "opaque", visibility: "private",
    reminders: { useDefault: false, overrides: [] },
  };
}

/** An instant written with the same UTC offset as `like` (an ISO time ending in Z or ±hh:mm). */
export function isoLike(like: string, ms: number): string {
  const m = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(like);
  const off = !m || m[1] === "Z" ? 0 : (m[2] === "-" ? -1 : 1) * (Number(m[3]) * 60 + Number(m[4]));
  const t = new Date(ms + off * MIN).toISOString().slice(0, 19);
  return `${t}${!m || m[1] === "Z" ? "Z" : m[1]}`;
}

/** A slot pick's id is "start/end"; a hold takes the slot's first `minutes`, which must fit inside it. */
export function holdFromSlot(slotId: string, minutes: number): { start: string; end: string } | { problem: string } {
  const [a, b] = slotId.split("/");
  const s = isoMs(a), e = isoMs(b);
  if (s === null || e === null) return { problem: "That isn't a free slot from a Free time result." };
  if (!Number.isInteger(minutes) || minutes < LIMITS.minHoldMin || minutes > LIMITS.maxHoldMin) return { problem: `minutes is ${LIMITS.minHoldMin} to ${LIMITS.maxHoldMin}.` };
  if (s + minutes * MIN > e) return { problem: `That slot is ${Math.round((e - s) / MIN)} minutes; the hold doesn't fit.` };
  return { start: a, end: isoLike(a, s + minutes * MIN) };
}
