// Week over week (card 159, docs/packs.md "Store analytics"): the last 7 full days against the 7
// before, worked out in code from the saved daily numbers and, when Google Analytics is connected, its
// visits by day. Pure, so `npm run check:weekly-numbers` can test it. A model never does this sum.

/** One saved day (kpi_snapshots). Nulls are days code couldn't count that number. */
export interface DayRow { date: string; revenue: number | null; orders: number | null; repeat_rate: number | null; cost_of_goods: number | null; margin: number | null }
export interface VisitDay { date: string; sessions: number; key_events: number }

export interface Side {
  from: string; to: string;
  /** Days in the window that have a saved row: fewer than 7 means some days are missing. */
  days: number;
  revenue: number; orders: number;
  aov: number | null; repeat_rate: number | null; margin: number | null;
  sessions: number | null; key_events: number | null; key_events_per_100_sessions: number | null;
}
export interface Line { key: string; label: string; now: number | null; before: number | null; change: number | null; unit: "usd" | "count" | "pct" | "rate" }
export interface WeekOverWeek { now: Side; before: Side; lines: Line[]; missing: string[] }

const day = 864e5;
const at = (d: string) => Date.parse(`${d}T12:00:00Z`);
export const shift = (d: string, n: number) => new Date(at(d) + n * day).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function side(rows: readonly DayRow[], visits: readonly VisitDay[] | null, from: string, to: string): Side {
  const inside = (d: string) => d >= from && d <= to;
  const rs = rows.filter((r) => inside(r.date));
  const revenue = r2(rs.reduce((s, r) => s + (num(r.revenue) ?? 0), 0));
  const orders = rs.reduce((s, r) => s + (num(r.orders) ?? 0), 0);
  // repeat rate: the days' rates weighted by their orders; margin: from cost and revenue on days that have a cost
  const rated = rs.filter((r) => num(r.repeat_rate) != null && (num(r.orders) ?? 0) > 0);
  const ratedOrders = rated.reduce((s, r) => s + (num(r.orders) ?? 0), 0);
  const costed = rs.filter((r) => num(r.cost_of_goods) != null && (num(r.revenue) ?? 0) > 0);
  const costedRevenue = costed.reduce((s, r) => s + (num(r.revenue) ?? 0), 0);
  const vs = visits?.filter((v) => inside(v.date)) ?? null;
  const sessions = vs ? vs.reduce((s, v) => s + v.sessions, 0) : null;
  const key_events = vs ? vs.reduce((s, v) => s + v.key_events, 0) : null;
  return {
    from, to, days: new Set(rs.map((r) => r.date)).size, revenue, orders,
    aov: orders > 0 ? r2(revenue / orders) : null,
    repeat_rate: ratedOrders > 0 ? r4(rated.reduce((s, r) => s + (num(r.repeat_rate) ?? 0) * (num(r.orders) ?? 0), 0) / ratedOrders) : null,
    margin: costedRevenue > 0 ? r4((costedRevenue - costed.reduce((s, r) => s + (num(r.cost_of_goods) ?? 0), 0)) / costedRevenue) : null,
    sessions, key_events,
    key_events_per_100_sessions: sessions && key_events != null ? r2((key_events / sessions) * 100) : null,
  };
}

/** The change from before to now: a share for money and counts, points for rates. Null when there's nothing to compare. */
export function change(now: number | null, before: number | null, unit: Line["unit"]): number | null {
  if (now == null || before == null) return null;
  if (unit === "pct" || unit === "rate") return r4(now - before);
  if (before === 0) return null;
  return r4((now - before) / before);
}

/**
 * The last 7 full days (ending `yesterday`) against the 7 before. `visits` is null when Google
 * Analytics isn't connected, and its lines are left out.
 */
export function weekOverWeek(rows: readonly DayRow[], visits: readonly VisitDay[] | null, yesterday: string): WeekOverWeek {
  const now = side(rows, visits, shift(yesterday, -6), yesterday);
  const before = side(rows, visits, shift(yesterday, -13), shift(yesterday, -7));
  const defs: [keyof Side, string, Line["unit"]][] = [
    ["revenue", "Revenue", "usd"], ["orders", "Orders", "count"], ["aov", "Average order", "usd"],
    ["repeat_rate", "Repeat rate", "pct"], ["margin", "Margin", "pct"],
    ...(visits ? [["sessions", "Sessions", "count"], ["key_events", "Key events", "count"], ["key_events_per_100_sessions", "Key events per 100 sessions", "rate"]] as [keyof Side, string, Line["unit"]][] : []),
  ];
  const lines = defs.map(([key, label, unit]) => {
    const a = now[key] as number | null, b = before[key] as number | null;
    return { key, label, now: a, before: b, change: change(a, b, unit), unit };
  });
  const missing = [
    ...(now.days < 7 ? [`${7 - now.days} of the last 7 days have no saved numbers`] : []),
    ...(before.days < 7 ? [`${7 - before.days} of the 7 days before have no saved numbers`] : []),
    ...(!visits ? ["Google Analytics isn't connected, so there are no visits"] : []),
  ];
  return { now, before, lines, missing };
}

/** Flat numbers for the run's trace: now_*, before_*, change_*. */
export function weekNumbers(w: WeekOverWeek): Record<string, number> {
  const out: Record<string, number> = { days_now: w.now.days, days_before: w.before.days };
  for (const l of w.lines) {
    if (l.now != null) out[`now_${l.key}`] = l.now;
    if (l.before != null) out[`before_${l.key}`] = l.before;
    if (l.change != null) out[`change_${l.key}`] = l.change;
  }
  return out;
}
