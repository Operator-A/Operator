// A department's Overview from a pack's layout (packs slice 2), built to the approved mockup: rows of core's widgets on
// a 3 column grid, every widget full width on a phone in the same order. The default Overview's widgets arrive drawn
// from the data the page read in one round; the new ones (number tile, daily chart, agent number) each stream into
// their own frame with a skeleton, so a slow read never holds the rest. Every number is worked out in code
// (core/widget-rules.ts).
import { Suspense } from "react";
import { Agents, Chains, DraftsChart, Needs, Report, RunsChart, SpendChart, SpendTile, WaitingTile, WeekTile, type OverviewData } from "@/dashboard/components/overview";
import { SERIES_LABEL, SNAPSHOT_MEASURES, monthTile, readingTile, runMetric, seriesBars, spanOf, type Layout, type TileView, type Widget } from "@/core/widget-rules";
import { MeasureTileView, RunMetricView, SeriesChartView, SkelChart, SkelTile } from "@/dashboard/components/widgetViews";
import { measureOf } from "@/core/goal-rules";
import { measureReadings, metricRuns, snapsFrom } from "@/dashboard/widgets";

const DAY = 864e5;
const shift = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
/** One read of the saved daily numbers covers every number tile and daily chart: 90 days, and last month's start. */
const SNAP_DAYS = 92;

export interface GridCtx { today: string; names: Record<string, string>; agentsHref: string }

export function WidgetGrid({ layout, d, write, goal, goalChart, ctx, banner }: { layout: Layout; d: OverviewData; write: React.ReactNode; goal: React.ReactNode; goalChart: React.ReactNode; ctx: GridCtx; banner?: React.ReactNode }) {
  return (
    <div className="dp-scroll">
      {banner}
      <div className="ov-gridwrap"><div className="ov ov-grid">
        {layout.flat().map((x, i) => {
          const el = widget(x, d, write, goal, goalChart, ctx);
          return el ? <div key={i} className={`ov-cell ov-s${spanOf(x)}`}>{el}</div> : null;
        })}
      </div></div>
    </div>
  );
}

function widget(x: Widget, d: OverviewData, write: React.ReactNode, goal: React.ReactNode, goalChart: React.ReactNode, ctx: GridCtx): React.ReactNode {
  switch (x.w) {
    case "needs": return d.needs.length ? <Needs d={d} /> : null;
    case "report": return <Report r={d.report} write={write} />;
    case "week_tile": return <WeekTile d={d} />;
    case "waiting_tile": return <WaitingTile d={d} />;
    case "spend_tile": return <SpendTile d={d} />;
    case "goal_tile": return goal;
    case "runs_chart": return <RunsChart d={d} />;
    case "drafts": return <DraftsChart d={d} />;
    case "spend": return <SpendChart d={d} />;
    case "goal_chart": return goalChart;
    case "agents": return <Agents d={d} />;
    case "chains": return d.chains.length ? <Chains d={d} /> : null;
    case "measure_tile": return <Suspense fallback={<SkelTile label={x.label ?? measureOf(x.measure)?.label ?? "Number"} />}><MeasureTile x={x} today={ctx.today} /></Suspense>;
    case "series_chart": return <Suspense fallback={<SkelChart />}><SeriesChart x={x} today={ctx.today} /></Suspense>;
    case "run_metric": return <Suspense fallback={<SkelTile label={x.label ?? "Number"} />}><RunMetric x={x} names={ctx.names} href={ctx.agentsHref} /></Suspense>;
  }
}

/** A goal measure as a tile: from the saved daily numbers for revenue and orders, else from its goal's saved readings. */
async function MeasureTile({ x, today }: { x: Widget; today: string }) {
  const m = measureOf(x.measure);
  const from = shift(today, -SNAP_DAYS);
  const field = x.measure ? SNAPSHOT_MEASURES[x.measure] : undefined;
  let t: TileView;
  if (field) {
    const snaps = await snapsFrom(from);
    t = snaps ? monthTile(snaps, field, today) : { value: "No reading", change: null, changeWord: null, sub: "The daily numbers table isn’t there yet", empty: true };
  } else {
    t = readingTile((await measureReadings(x.measure ?? "", from)) ?? [], m?.unit ?? "count", today);
  }
  return <MeasureTileView label={x.label ?? m?.label ?? "Number"} t={t} />;
}

/** A saved daily number per day over 14, 30 or 90 days. */
async function SeriesChart({ x, today }: { x: Widget; today: string }) {
  const field = x.field ?? "revenue", days = x.days ?? 30;
  const s = seriesBars((await snapsFrom(shift(today, -SNAP_DAYS))) ?? [], field, days, today);
  return <SeriesChartView title={SERIES_LABEL[field]} days={days} {...s} money={field !== "orders"} />;
}

/** A number an agent's tools returned on its runs. */
async function RunMetric({ x, names, href }: { x: Widget; names: Record<string, string>; href: string }) {
  const v = runMetric(await metricRuns(x.agent ?? ""), x.key ?? "", x.unit ?? "count");
  return <RunMetricView label={x.label ?? "Number"} v={v} who={names[x.agent ?? ""] ?? null} href={href} />;
}
