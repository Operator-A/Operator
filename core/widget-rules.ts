// A department's Overview as a grid of widgets (docs/packs.md, packs slice 2, decided 2026-11-28). A department
// pack may say which widgets its department's Overview shows and in what rows; the widgets themselves are a fixed
// catalog in core, so a pack can only arrange what core already draws, from data OPERATOR already saved. A
// department with no layout keeps the default Overview, exactly as before. Pure: no database, no network, no model,
// so `npm run check:widgets` can test it.
import { MEASURES, fmt, type Unit } from "@/core/goal-rules";

/** Core's widgets. A pack names them; it can't add one. */
export const WIDGETS = [
  "needs", "report", "week_tile", "waiting_tile", "spend_tile", "goal_tile", "runs_chart", "drafts", "spend", "goal_chart", "agents", "chains",
  "measure_tile", "series_chart", "run_metric",
] as const;
export type WidgetKind = (typeof WIDGETS)[number];

/** What each widget is called on the page and in a pack's checks. */
export const WIDGET_LABEL: Record<WidgetKind, string> = {
  needs: "What needs you", report: "The written report", week_tile: "Runs, last 7 days", waiting_tile: "Waiting on you", spend_tile: "AI spend, last 7 days",
  goal_tile: "Goal", runs_chart: "Runs per day", drafts: "Drafts, last 7 days", spend: "AI spend by agent", goal_chart: "Goal over time", agents: "Agents",
  chains: "Chains", measure_tile: "Number tile", series_chart: "Daily chart", run_metric: "Agent number",
};

/** The widgets that take settings; every other widget shows once at most. */
const MANY: ReadonlySet<WidgetKind> = new Set(["measure_tile", "series_chart", "run_metric"]);
/** How many of the 3 columns a widget takes when the layout doesn't say. */
const SPAN: Partial<Record<WidgetKind, 1 | 2 | 3>> = { needs: 3, report: 2, agents: 3, chains: 3 };
/** The fields each widget may hold beside `w` and `span`. */
const FIELDS: Record<WidgetKind, readonly string[]> = {
  needs: [], report: [], week_tile: [], waiting_tile: [], spend_tile: [], goal_tile: [], runs_chart: [], drafts: [], spend: [], goal_chart: [], agents: [], chains: [],
  measure_tile: ["measure", "label"], series_chart: ["field", "days"], run_metric: ["agent", "key", "label", "unit"],
};

/** The saved daily numbers a daily chart can draw (kpi_snapshots columns). */
export const SERIES_FIELDS = ["revenue", "orders", "cash_usd"] as const;
export type SeriesField = (typeof SERIES_FIELDS)[number];
export const SERIES_DAYS = [14, 30, 90] as const;
export const SERIES_LABEL: Record<SeriesField, string> = { revenue: "Revenue per day", orders: "Orders per day", cash_usd: "Cash in the bank" };
/** How an agent's number reads: a count, dollars, a share (0.024 is 2.4%) or a plain rate. */
export const METRIC_UNITS = ["count", "usd", "pct", "rate"] as const;
export type MetricUnit = (typeof METRIC_UNITS)[number];
/** The measures a number tile can show: core's goal measures. */
export const TILE_MEASURES: readonly string[] = MEASURES.map((m) => m.key);
/** Measures counted from the saved daily numbers; any other reads its goal's saved daily readings. */
export const SNAPSHOT_MEASURES: Readonly<Record<string, "revenue" | "orders">> = { revenue_month: "revenue", orders_month: "orders" };

export const MAX_ROWS = 12;
export const MAX_WIDGETS = 24;
const AGENT_ID = /^[a-z][a-z0-9_]{1,39}$/;
const METRIC_KEY = /^[a-z][a-z0-9_]{0,63}$/;

export interface Widget {
  w: WidgetKind;
  span?: 1 | 2 | 3;
  measure?: string; label?: string;
  field?: SeriesField; days?: (typeof SERIES_DAYS)[number];
  agent?: string; key?: string; unit?: MetricUnit;
}
/** Rows of 1 to 3 widgets, top to bottom. On a phone every widget is full width, in the same order. */
export type Layout = Widget[][];

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const label = (x: unknown) => typeof x === "string" && !!x.trim() && x.length <= 40;

/** How many columns a widget takes. */
export const spanOf = (x: Widget): 1 | 2 | 3 => x.span ?? SPAN[x.w] ?? 1;

/**
 * What's wrong with a layout. `agents` is the department's agents, when known (a pack's own agents): an agent
 * number may only name one of them. An empty list of problems means the layout is safe to draw.
 */
export function layoutProblems(raw: unknown, agents?: readonly string[]): string[] {
  if (!Array.isArray(raw)) return ["overview: a list of rows"];
  const out: string[] = [];
  if (!raw.length || raw.length > MAX_ROWS) out.push(`overview: 1 to ${MAX_ROWS} rows`);
  const seen = new Set<string>();
  let count = 0;
  raw.forEach((row, i) => {
    const at = `overview row ${i + 1}`;
    if (!Array.isArray(row) || !row.length || row.length > 3) { out.push(`${at}: 1 to 3 widgets`); return; }
    let cols = 0;
    for (const x of row) {
      count++;
      if (!isObj(x) || !WIDGETS.includes(x.w as WidgetKind)) { out.push(`${at}: each widget is one of ${WIDGETS.join(", ")}`); continue; }
      const w = x.w as WidgetKind;
      for (const k of Object.keys(x)) if (k !== "w" && k !== "span" && !FIELDS[w].includes(k)) out.push(`${at}: ${w} has no field ${k}`);
      if (x.span !== undefined && x.span !== 1 && x.span !== 2 && x.span !== 3) out.push(`${at}: ${w} span is 1, 2 or 3`);
      cols += x.span === 2 || x.span === 3 ? x.span : x.span === undefined ? (SPAN[w] ?? 1) : 1;
      if (!MANY.has(w)) { if (seen.has(w)) out.push(`${at}: ${w} shows once`); seen.add(w); }
      if (w === "measure_tile") {
        if (typeof x.measure !== "string" || !TILE_MEASURES.includes(x.measure)) out.push(`${at}: measure_tile measure is one of ${TILE_MEASURES.join(", ")}`);
        if (x.label !== undefined && !label(x.label)) out.push(`${at}: measure_tile label is 1 to 40 characters`);
      }
      if (w === "series_chart") {
        if (!SERIES_FIELDS.includes(x.field as SeriesField)) out.push(`${at}: series_chart field is one of ${SERIES_FIELDS.join(", ")}`);
        if (x.days !== undefined && !SERIES_DAYS.includes(x.days as 14)) out.push(`${at}: series_chart days is 14, 30 or 90`);
      }
      if (w === "run_metric") {
        if (typeof x.agent !== "string" || !AGENT_ID.test(x.agent)) out.push(`${at}: run_metric agent is an agent id`);
        else if (agents && !agents.includes(x.agent)) out.push(`${at}: run_metric agent ${x.agent} isn't one of this department's agents`);
        if (typeof x.key !== "string" || !METRIC_KEY.test(x.key)) out.push(`${at}: run_metric key is a number's name like now_sessions`);
        if (!label(x.label)) out.push(`${at}: run_metric label is 1 to 40 characters`);
        if (x.unit !== undefined && !METRIC_UNITS.includes(x.unit as MetricUnit)) out.push(`${at}: run_metric unit is one of ${METRIC_UNITS.join(", ")}`);
      }
    }
    if (cols > 3) out.push(`${at}: the widgets take ${cols} of 3 columns`);
  });
  if (count > MAX_WIDGETS) out.push(`overview: at most ${MAX_WIDGETS} widgets`);
  return out;
}

/** A saved layout, or null (the default Overview) when there's none or it doesn't pass its checks. */
export function readLayout(raw: unknown): Layout | null {
  if (raw == null || layoutProblems(raw).length) return null;
  return raw as Layout;
}

/** What the page reads for the widgets a layout shows. Null (the default Overview) reads everything it always did. */
export type Need = "reports" | "cards" | "trust" | "chains" | "claude";
const NEEDS: Partial<Record<WidgetKind, Need[]>> = {
  report: ["reports"], waiting_tile: ["cards"], drafts: ["cards", "trust"], chains: ["chains"], spend: ["claude"], spend_tile: ["claude"], agents: ["claude"],
};
export function widgetNeeds(layout: Layout | null): Set<Need> {
  if (!layout) return new Set(["reports", "cards", "trust", "chains", "claude"]);
  return new Set(layout.flat().flatMap((x) => NEEDS[x.w] ?? []));
}

/** "store-analytics@1" as the header says it: the pack's id and version. */
export function packFrom(raw: unknown): { id: string; version: number } | null {
  const m = typeof raw === "string" ? /^([a-z][a-z0-9-]{1,30})@(\d{1,4})$/.exec(raw) : null;
  return m ? { id: m[1], version: Number(m[2]) } : null;
}

// ---- The new widgets' numbers, worked out in code.

export interface SnapRow { date: string; revenue: number; orders: number; cash_usd: number | null }
const DAY = 864e5;
const shiftDay = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;
const daysIn = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const prevMonth = (ym: string) => { const y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

export interface TileView { value: string; change: number | null; changeWord: string | null; sub: string; empty: boolean }

/**
 * A number tile from the saved daily numbers: this month so far (to the latest saved day) against the same days
 * of last month. A change is a share (0.12 is 12% up); there's none when last month has no saved day in that range.
 */
export function monthTile(snaps: readonly SnapRow[], field: "revenue" | "orders", today: string): TileView {
  const ym = today.slice(0, 7);
  const month = snaps.filter((s) => s.date.startsWith(ym) && s.date <= today);
  if (!month.length) return { value: "No reading", change: null, changeWord: null, sub: "No daily numbers saved this month", empty: true };
  const lastDay = month.map((s) => s.date).sort().at(-1)!;
  const upTo = Math.min(Number(lastDay.slice(8, 10)), daysIn(prevMonth(ym)));
  const prior = snaps.filter((s) => s.date.startsWith(prevMonth(ym)) && Number(s.date.slice(8, 10)) <= upTo);
  const sum = (rows: readonly SnapRow[]) => rows.reduce((t, s) => t + (Number(s[field]) || 0), 0);
  const now = sum(month), before = sum(prior);
  const change = prior.length && before > 0 ? r4((now - before) / before) : null;
  const missing = Number(lastDay.slice(8, 10)) - month.length;
  return {
    value: fmt(Math.round(now), field === "revenue" ? "usd" : "count"), change, changeWord: change == null ? null : pctWord(change),
    sub: `${change == null ? "No saved days last month to compare" : "on the same days last month"}${missing > 0 ? ` · ${missing} day${missing === 1 ? "" : "s"} not saved` : ""}`,
    empty: false,
  };
}

/**
 * A number tile from a goal's saved daily readings (overview slice 4): the newest reading against the one nearest
 * 7 days before it (from 4 to 10 days before). Empty when no goal uses the measure yet.
 */
export function readingTile(readings: readonly { day: string; value: number }[], unit: Unit, today: string): TileView {
  const rs = [...readings].filter((r) => Number.isFinite(r.value) && r.day <= today).sort((a, b) => a.day.localeCompare(b.day));
  const last = rs.at(-1);
  if (!last) return { value: "No reading", change: null, changeWord: null, sub: "Saved each morning once a goal uses this number", empty: true };
  const ago = (d: string) => Math.round((Date.parse(`${last.day}T12:00:00Z`) - Date.parse(`${d}T12:00:00Z`)) / DAY);
  const then = rs.filter((r) => ago(r.day) >= 4 && ago(r.day) <= 10).sort((a, b) => Math.abs(ago(a.day) - 7) - Math.abs(ago(b.day) - 7))[0];
  const change = then && then.value !== 0 ? r4((last.value - then.value) / Math.abs(then.value)) : null;
  const asOf = last.day === today ? "" : ` · as of ${last.day.slice(5).replace("-", "/")}`;
  return { value: fmt(last.value, unit), change, changeWord: change == null ? null : pctWord(change), sub: `${change == null ? "No reading from a week before" : "on a week before"}${asOf}`, empty: false };
}

export interface SeriesBar { day: string; value: number | null; pct: number }
/**
 * A daily chart: the last `days` days ending today, oldest first. A day with no saved row is null (drawn as a gap,
 * never as 0); each bar's height is its share of the tallest day, and a day with any value shows at least 4%.
 */
export function seriesBars(snaps: readonly SnapRow[], field: SeriesField, days: number, today: string): { bars: SeriesBar[]; saved: number; top: number } {
  const by = new Map(snaps.map((s) => [s.date, s]));
  const keys = Array.from({ length: days }, (_, i) => shiftDay(today, i - (days - 1)));
  const vals = keys.map((day) => { const s = by.get(day); const v = s ? s[field] : null; return { day, value: v == null || !Number.isFinite(Number(v)) ? null : Number(v) }; });
  const top = Math.max(0, ...vals.map((v) => v.value ?? 0));
  return {
    bars: vals.map((v) => ({ ...v, pct: v.value == null || v.value <= 0 || top <= 0 ? 0 : Math.max(4, Math.round((v.value / top) * 100)) })),
    saved: vals.filter((v) => v.value != null).length, top,
  };
}

export interface MetricView { value: string | null; changeWord: string | null; up: boolean | null; points: { x: number; y: number }[]; runs: number }
/**
 * An agent number: `key` from the metrics of the agent's newest runs (newest first, as read), the newest value, its
 * change since the run before, and a line over at most `n` runs scaled to a 300 by 46 box. Runs without the number
 * are skipped.
 */
export function runMetric(runs: readonly { metrics: unknown }[], key: string, unit: MetricUnit, n = 7): MetricView {
  const vals = runs.map((r) => (isObj(r.metrics) ? r.metrics[key] : undefined)).filter((v): v is number => typeof v === "number" && Number.isFinite(v)).slice(0, n).reverse();
  if (!vals.length) return { value: null, changeWord: null, up: null, points: [], runs: 0 };
  const last = vals[vals.length - 1], prev = vals.length > 1 ? vals[vals.length - 2] : null;
  let changeWord: string | null = null, up: boolean | null = null;
  if (prev != null && prev !== last) {
    up = last > prev;
    changeWord = unit === "pct" ? `${up ? "+" : "−"}${Math.abs(Math.round((last - prev) * 1000) / 10)} pts` : prev !== 0 ? pctWord((last - prev) / Math.abs(prev)) : null;
  } else if (prev != null) changeWord = "No change";
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const points = vals.length < 2 ? [] : vals.map((v, i) => ({ x: Math.round(8 + (i * 284) / (vals.length - 1)), y: Math.round(hi === lo ? 23 : 42 - ((v - lo) / (hi - lo)) * 36) }));
  return { value: metricWord(last, unit), changeWord, up, points, runs: vals.length };
}

/** A metric as the tile says it. */
export function metricWord(v: number, unit: MetricUnit): string {
  if (unit === "pct") return `${Math.round(v * 1000) / 10}%`;
  if (unit === "usd") return fmt(v, "usd");
  if (unit === "rate") return (Math.round(v * 100) / 100).toLocaleString("en-US");
  return fmt(Math.round(v), "count");
}

/** A change as words: +12%, −3%, No change. */
export function pctWord(share: number): string {
  const p = Math.round(share * 100);
  return p === 0 ? "No change" : `${p > 0 ? "+" : "−"}${Math.abs(p)}%`;
}
