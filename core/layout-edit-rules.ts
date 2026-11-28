// Editing a department's Overview (docs/packs.md, packs slice 5, to the approved mockup). The editor holds the widgets
// in reading order with their widths; rows are worked out by filling three columns in order, so moving a widget never
// leaves a gap. What's saved is checked by layoutProblems, the same check a pack's layout gets. Pure: no database, no
// network, so `npm run check:widgets` can test it.
import { MEASURES } from "@/core/goal-rules";
import { METRIC_UNITS, SERIES_DAYS, SERIES_FIELDS, SERIES_LABEL, WIDGETS, WIDGET_LABEL, layoutProblems, readLayout, spanOf, MAX_WIDGETS, type Layout, type MetricUnit, type SeriesField, type Widget, type WidgetKind } from "@/core/widget-rules";

/** The usual Overview as widgets, so a department with no layout starts editing from what it sees, never from empty. */
export const DEFAULT_LAYOUT: Layout = [
  [{ w: "needs", span: 3 }],
  [{ w: "report", span: 2 }, { w: "week_tile" }],
  [{ w: "waiting_tile" }, { w: "spend_tile" }, { w: "goal_tile" }],
  [{ w: "runs_chart" }, { w: "drafts" }, { w: "spend" }],
  [{ w: "goal_chart" }, { w: "agents", span: 2 }],
  [{ w: "chains", span: 3 }],
];

/** Widgets that can be on the page more than once: each has its own settings. */
export const MANY_KINDS: readonly WidgetKind[] = ["measure_tile", "series_chart", "run_metric"];
/** What each widget is, in the Add a widget catalog. */
export const WIDGET_ABOUT: Record<WidgetKind, string> = {
  needs: "Drafts waiting and runs that stopped, here", report: "The department’s written report", week_tile: "Finished and failed runs",
  waiting_tile: "Cards and questions here", spend_tile: "Every run’s model cost", goal_tile: "The department’s first goal",
  runs_chart: "Runs per day, last 14 days", drafts: "Approval cards, last 7 days", spend: "This month, by agent", goal_chart: "The goal’s saved daily readings",
  agents: "Latest result and next run", chains: "This department’s chains and their last run",
  measure_tile: "One number this month: revenue, orders, cash, email list size and other goal measures", series_chart: "Revenue, orders or cash per day, for 14, 30 or 90 days",
  run_metric: "A number one of this department’s agents works out each run, with its trend",
};

/** The layout in reading order. */
export const flatten = (l: Layout): Widget[] => l.flat();

/** Widgets in order, filled into rows of three columns (at most 3 widgets a row). */
export function flow(items: readonly Widget[]): Layout {
  const rows: Widget[][] = [];
  let row: Widget[] = [], cols = 0;
  for (const x of items) {
    const s = spanOf(x);
    if (row.length && (cols + s > 3 || row.length === 3)) { rows.push(row); row = []; cols = 0; }
    row.push(x); cols += s;
  }
  if (row.length) rows.push(row);
  return rows;
}

/** One widget moved one place earlier (-1) or later (+1). */
export function move(items: readonly Widget[], i: number, dir: -1 | 1): Widget[] {
  const j = i + dir;
  if (i < 0 || i >= items.length || j < 0 || j >= items.length) return [...items];
  const out = [...items];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
/** A widget's width: a third, two thirds or the full row. */
export const resize = (items: readonly Widget[], i: number, span: 1 | 2 | 3): Widget[] => items.map((x, k) => (k === i ? { ...x, span } : x));
export const remove = (items: readonly Widget[], i: number): Widget[] => items.filter((_, k) => k !== i);
/** A widget added at the end; a widget that shows once is refused while it's on the page. */
export function add(items: readonly Widget[], x: Widget): Widget[] {
  if (items.length >= MAX_WIDGETS) return [...items];
  if (!MANY_KINDS.includes(x.w) && items.some((y) => y.w === x.w)) return [...items];
  return [...items, x];
}
export const replace = (items: readonly Widget[], i: number, x: Widget): Widget[] => items.map((y, k) => (k === i ? x : y));

/** The catalog: core's widgets, each marked when it shows once and is already on the page. */
export function catalog(items: readonly Widget[]): { w: WidgetKind; label: string; about: string; used: boolean; many: boolean }[] {
  return WIDGETS.map((w) => ({ w, label: WIDGET_LABEL[w], about: WIDGET_ABOUT[w], many: MANY_KINDS.includes(w), used: !MANY_KINDS.includes(w) && items.some((x) => x.w === w) }));
}

/** A new widget with settings starts from these, then opens its settings. */
export function fresh(w: WidgetKind, agents: readonly { id: string; name: string; keys: string[] }[]): Widget {
  if (w === "measure_tile") return { w, measure: MEASURES[0].key };
  if (w === "series_chart") return { w, field: "revenue", days: 30 };
  if (w === "run_metric") { const a = agents.find((x) => x.keys.length) ?? agents[0]; return { w, agent: a?.id ?? "", key: a?.keys[0] ?? "", label: a?.keys[0] ? keyWords(a.keys[0]) : "Agent number" }; }
  return { w };
}

/** "now_sessions" as a label: "Now sessions". */
export const keyWords = (k: string) => { const s = k.replace(/_/g, " ").trim(); return (s[0]?.toUpperCase() ?? "") + s.slice(1, 40); };

/** A widget's name and line in the editor. */
export function blockWords(x: Widget, names: Record<string, string>): { name: string; sub: string } {
  if (x.w === "measure_tile") return { name: x.label ?? MEASURES.find((m) => m.key === x.measure)?.label ?? WIDGET_LABEL.measure_tile, sub: "Number tile" };
  if (x.w === "series_chart") return { name: `${SERIES_LABEL[(x.field ?? "revenue") as SeriesField]}, ${x.days ?? 30} days`, sub: "Daily chart" };
  if (x.w === "run_metric") return { name: x.label ?? WIDGET_LABEL.run_metric, sub: `Agent number · ${names[x.agent ?? ""] ?? "an agent not in this department"}` };
  return { name: WIDGET_LABEL[x.w], sub: WIDGET_ABOUT[x.w] };
}
export const hasSettings = (x: Widget) => MANY_KINDS.includes(x.w);

/** The choices a widget's settings offer, from lists in code. */
export const SETTINGS = {
  measures: MEASURES.map((m) => ({ key: m.key, label: m.label })),
  fields: SERIES_FIELDS.map((f) => ({ key: f, label: SERIES_LABEL[f] })),
  days: SERIES_DAYS,
  units: METRIC_UNITS.map((u) => ({ key: u, label: ({ count: "A count", usd: "Dollars", pct: "A share (0.024 is 2.4%)", rate: "A plain number" } as Record<MetricUnit, string>)[u] })),
};

/** The keys of numbers an agent's last runs saved, most recent first. */
export function metricKeys(runs: readonly { metrics: unknown }[]): string[] {
  const out: string[] = [];
  for (const r of runs) {
    const m = r.metrics;
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) if (typeof v === "number" && /^[a-z][a-z0-9_]{0,63}$/.test(k) && !out.includes(k)) out.push(k);
  }
  return out.slice(0, 20);
}

/**
 * What saving would keep: null for the usual Overview, else the rows. Problems (from layoutProblems, with this
 * department's agents) refuse the save. An empty page saves as the usual Overview.
 */
export function toSave(items: readonly Widget[] | null, agents: readonly string[]): { layout: Layout | null; problems: string[] } {
  if (items == null || !items.length) return { layout: null, problems: [] };
  const layout = flow(items.map(clean));
  return { layout, problems: layoutProblems(layout, agents) };
}
/** A widget with only the fields its kind takes (what the editor carries is never trusted as is). */
function clean(x: Widget): Widget {
  const o: Widget = { w: x.w };
  if (x.span === 1 || x.span === 2 || x.span === 3) o.span = x.span;
  if (x.w === "measure_tile") { o.measure = x.measure; if (x.label?.trim()) o.label = x.label.trim().slice(0, 40); }
  if (x.w === "series_chart") { o.field = x.field; o.days = x.days; }
  if (x.w === "run_metric") { o.agent = x.agent; o.key = x.key; o.label = (x.label ?? "").trim().slice(0, 40); if (x.unit) o.unit = x.unit; }
  return o;
}

/**
 * Where the department's layout came from, for the line beside Edit layout: the pack (its layout as saved, or no one
 * has saved one since it was installed), whoever saved it last ("Laid out by you, Nov 28"), or the usual Overview.
 */
export function layoutSource(saved: unknown, pack: { name: string; layout: Layout | null } | null, last: { by: string; at: string } | null, me: string): string {
  const l = readLayout(saved);
  if (!l) return "The usual Overview";
  if (pack?.layout && JSON.stringify(l) === JSON.stringify(pack.layout)) return `Laid out by the ${pack.name} pack`;
  if (last) {
    const day = new Date(last.at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
    return `Laid out by ${last.by.toLowerCase() === me.toLowerCase() ? "you" : last.by}, ${day}`;
  }
  return pack ? `Laid out by the ${pack.name} pack` : "Your own layout";
}

/** A pack's layout with its agent numbers pointed at this department's agents; a number whose agent isn't here is left out. */
export function packLayoutHere(raw: unknown, ids: ReadonlyMap<string, string>): Layout | null {
  if (!Array.isArray(raw)) return null;
  const rows = raw.map((row) => (Array.isArray(row) ? row.flatMap((w) => {
    const x = w as Widget;
    if (x?.w !== "run_metric") return [x];
    const to = x.agent ? ids.get(x.agent) : undefined;
    return to ? [{ ...x, agent: to }] : [];
  }) : row)).filter((row) => !Array.isArray(row) || row.length);
  return readLayout(rows);
}
