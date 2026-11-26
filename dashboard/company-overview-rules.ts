// The Company Overview's numbers (overview slice 3): the four tiles, revenue per day, runs per day by department,
// and each department card's line. Worked out here in code from rows already saved (kpi_snapshots, agent_runs,
// goals, reports); no model writes a number on this page. Pure: no database, no network, so `npm run check:overview`
// can test it.
import { dayKey, isWork, type OvRun } from "./overview-rules";

const DAY = 864e5;

/** One saved day of the daily numbers job (kpi_snapshots), as the page needs it. */
export interface Snap { date: string; revenue: number; orders: number; cash_usd: number | null }

/** The last `days` calendar days in the business's time zone, oldest first, ending today. */
export function lastDays(now: number, tz: string, days: number): string[] {
  const today = Date.parse(`${dayKey(now, tz)}T12:00:00Z`);
  return Array.from({ length: days }, (_, i) => dayKey(today - (days - 1 - i) * DAY, "UTC"));
}

const usd0 = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const signed = (n: number) => usd0(Math.abs(n));

export interface RevDay { key: string; usd: number | null }
/** Revenue per day for the last `days` days: a day with no saved reading is null (drawn as an outlined bar), never 0. */
export function revenueDays(snaps: readonly Snap[], now: number, tz: string, days = 30): RevDay[] {
  const by = new Map(snaps.map((s) => [s.date, s]));
  return lastDays(now, tz, days).map((key) => ({ key, usd: by.has(key) ? Number(by.get(key)!.revenue) || 0 : null }));
}

export interface Tile { value: string; sub: string; empty?: boolean }
export interface Tiles { revenue: Tile; cash: Tile; orders: Tile }

/** Days in a month given as "YYYY-MM". */
const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const prevMonth = (ym: string) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

/**
 * Revenue and orders this month (the saved days of this calendar month, in the business's time zone), and cash in the
 * bank (the latest saved reading, against the reading nearest 7 days before it). Days with no saved reading add
 * nothing and are counted, so a tile never passes a gap off as a slow day.
 */
export function companyTiles(snaps: readonly Snap[], now: number, tz: string): Tiles {
  const today = dayKey(now, tz), ym = today.slice(0, 7), last = prevMonth(ym);
  const month = snaps.filter((s) => s.date.startsWith(ym) && s.date <= today);
  const prior = snaps.filter((s) => s.date.startsWith(last));
  const rev = month.reduce((t, s) => t + (Number(s.revenue) || 0), 0);
  const orders = month.reduce((t, s) => t + (Number(s.orders) || 0), 0);
  const priorRev = prior.reduce((t, s) => t + (Number(s.revenue) || 0), 0);
  const left = daysIn(ym) - Number(today.slice(8, 10));
  const elapsed = Number(today.slice(8, 10));
  const missing = elapsed - month.length;
  const gap = missing > 0 ? ` · ${missing} day${missing === 1 ? "" : "s"} not saved` : "";
  const leftWords = `${left} day${left === 1 ? "" : "s"} left`;
  const revenue: Tile = !month.length
    ? { value: "No reading", sub: "No daily numbers saved this month", empty: true }
    : { value: usd0(rev), sub: `${prior.length && priorRev > 0 ? `${Math.round((rev / priorRev) * 100)}% of last month, ` : ""}${leftWords}${gap}` };
  const withCash = snaps.filter((s) => s.cash_usd != null && Number.isFinite(Number(s.cash_usd)) && s.date <= today).sort((a, b) => a.date.localeCompare(b.date));
  const latest = withCash[withCash.length - 1];
  let cash: Tile = { value: "No reading", sub: "No cash reading saved yet", empty: true };
  if (latest) {
    // the reading nearest 7 days before the latest, from 4 to 10 days before it (the job skips days)
    const ago = (s: Snap) => Math.round((Date.parse(`${latest.date}T12:00:00Z`) - Date.parse(`${s.date}T12:00:00Z`)) / DAY);
    const then = withCash.filter((s) => ago(s) >= 4 && ago(s) <= 10).sort((a, b) => Math.abs(ago(a) - 7) - Math.abs(ago(b) - 7))[0];
    const diff = then ? Number(latest.cash_usd) - Number(then.cash_usd) : null;
    const asOf = latest.date === today ? "" : ` · as of ${latest.date.slice(5).replace("-", "/")}`;
    cash = {
      value: usd0(Number(latest.cash_usd)),
      sub: `${diff == null ? "No reading from a week before" : diff === 0 ? "Same as a week before" : `${diff < 0 ? "Down" : "Up"} ${signed(diff)} this week`}${asOf}`,
    };
  }
  const ordersTile: Tile = !month.length
    ? { value: "No reading", sub: "No daily numbers saved this month", empty: true }
    : { value: orders.toLocaleString("en-US"), sub: orders > 0 ? `Average order ${usd0(rev / orders)}` : "No orders yet this month" };
  return { revenue, cash, orders: ordersTile };
}

export interface GoalsTile { ok: number; total: number; sub: string }
/** "3 of 5 on track" and which are behind, counted from each goal's measured status. */
export function goalsTile(goals: readonly { title: string; status: string }[]): GoalsTile {
  const ok = goals.filter((g) => g.status === "on_track" || g.status === "reached" || g.status === "done").length;
  const behind = goals.filter((g) => g.status === "behind" || g.status === "missed").map((g) => g.title.toLowerCase());
  const unmeasured = goals.length - ok - behind.length;
  const sub = !goals.length ? "No goals yet" : behind.length ? `Behind: ${behind.slice(0, 3).join(", ")}${behind.length > 3 ? ` and ${behind.length - 3} more` : ""}`
    : unmeasured ? `${unmeasured} not measured yet` : "All on track";
  return { ok, total: goals.length, sub };
}

/** The chart colours for departments, in order (the canvas's; a sixth department and on reuse them). */
export const STACK_HUES = ["#4F6BE8", "#E0752F", "#1F9E8A", "#B455C8", "#C9A227", "#D6404A"];

export interface StackDay { key: string; counts: number[]; total: number }
/** Finished and failed work runs per day for the last `days` days, split by department (order of `depts`). */
export function deptStack(runs: readonly OvRun[], deptOfAgent: (agentId: string) => string | null, depts: readonly string[], now: number, tz: string, days = 14): StackDay[] {
  const keys = lastDays(now, tz, days);
  const at = new Map(depts.map((d, i) => [d, i]));
  const rows = new Map(keys.map((k) => [k, { key: k, counts: depts.map(() => 0), total: 0 }]));
  for (const r of runs) {
    if (!isWork(r) || (r.status !== "ok" && r.status !== "failed")) continue;
    const row = rows.get(dayKey(r.started_at, tz));
    const d = deptOfAgent(r.agent_id);
    const i = d == null ? undefined : at.get(d);
    if (!row || i == null) continue;
    row.counts[i]++; row.total++;
  }
  return keys.map((k) => rows.get(k)!);
}

/** Work runs in the last 7 days for each department (the department cards). */
export function deptRuns7(runs: readonly OvRun[], deptOfAgent: (agentId: string) => string | null, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of runs) {
    if (!isWork(r) || Date.parse(r.started_at) < now - 7 * DAY) continue;
    const d = deptOfAgent(r.agent_id);
    if (d) out[d] = (out[d] ?? 0) + 1;
  }
  return out;
}

/** A department card's headline: its latest day report's lines (worth a look first), else its head's latest result. */
export function headline(report: { day: string; lines: readonly { section: string; text: string }[] } | null, today: string, fallback: string | null): string {
  if (report && report.lines.length) {
    const lines = [...report.lines].sort((a, b) => Number(b.section === "look") - Number(a.section === "look"));
    const text = lines.slice(0, 2).map((l) => l.text.replace(/\.$/, "")).join("; ");
    return `${report.day === today ? "" : "Last report: "}${text}.`;
  }
  return fallback ?? "No report yet.";
}

export { usd0 };
