// The new widgets of a department's widget grid (packs slice 2), as drawings only: a number tile, a daily chart and an
// agent number, to the approved mockup. Every value arrives worked out (core/widget-rules.ts); the reads are in
// dashboard/components/widgetGrid.tsx, so these can be drawn and measured without a database.
import Link from "next/link";
import type { MetricView, SeriesBar, TileView } from "@/core/widget-rules";

const md = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

const Change = ({ word, up }: { word: string | null; up: boolean | null }) =>
  word ? <span className={up == null || word === "No change" ? undefined : up ? "ov-up" : "ov-down"}>{word}</span> : null;

/** A goal measure as a tile, with its change. */
export function MeasureTileView({ label, t }: { label: string; t: TileView }) {
  return (
    <div className="ov-card ov-tile">
      <span className="ov-tl">{label}</span>
      <b className={t.empty ? "sm" : undefined}>{t.value}</b>
      <span className="ov-ts"><Change word={t.changeWord} up={t.change == null ? null : t.change > 0} />{t.changeWord ? " " : ""}{t.sub}</span>
    </div>
  );
}

/** A saved daily number per day; a day with nothing saved is an outlined gap. */
export function SeriesChartView({ title, days, bars, saved, top, money }: { title: string; days: number; bars: SeriesBar[]; saved: number; top: number; money: boolean }) {
  const word = (v: number) => (money ? `$${Math.round(v).toLocaleString("en-US")}` : v.toLocaleString("en-US"));
  return (
    <figure className="ov-card ov-fig">
      <figcaption><b>{title}</b><span>last {days} days, from saved daily numbers</span></figcaption>
      {saved ? (
        <>
          <div className="ov-series" role="img" aria-label={`${title} for ${days} days: ${saved} days saved, highest ${word(top)}`}>
            {bars.map((b) => <i key={b.day} className={b.value == null ? "none" : undefined} style={b.value == null ? undefined : { height: `${b.pct}%` }} title={`${md(b.day)}: ${b.value == null ? "not saved" : word(b.value)}`} />)}
          </div>
          <div className="ov-axis"><span>{md(bars[0].day)}</span><span>{md(bars[Math.floor(bars.length / 2)].day)}</span><span>Today</span></div>
        </>
      ) : <p className="ov-empty">No daily numbers saved in the last {days} days. They’re saved each morning once a store is connected.</p>}
    </figure>
  );
}

/** A number an agent's tools returned on its runs: the newest, its change since the run before, and its line. */
export function RunMetricView({ label, v, who, href }: { label: string; v: MetricView; who: string | null; href: string }) {
  const whose = `${who ?? "the agent"}’s`;
  const last = v.points[v.points.length - 1];
  return (
    <div className="ov-card ov-tile">
      <span className="ov-tl">{label}</span>
      <b className={v.value == null ? "sm" : undefined}>{v.value ?? "No reading yet"}</b>
      {last && (
        <svg className="ov-spark" viewBox="0 0 300 46" preserveAspectRatio="none" role="img" aria-label={`${label} over ${whose} last ${v.runs} runs, now ${v.value}`}>
          <polyline points={v.points.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          <circle cx={last.x} cy={last.y} r="3.5" />
        </svg>
      )}
      <span className="ov-ts">
        {v.value == null
          ? who ? <>Shows once {whose} runs save it. <Link href={href}>Agents</Link></> : "The agent isn’t in this business."
          : <><Change word={v.changeWord} up={v.up} />{v.changeWord ? ` since ${whose} run before · ` : ""}From {whose} {v.runs === 1 ? "last run" : `last ${v.runs} runs`}</>}
      </span>
    </div>
  );
}

export const SkelTile = ({ label }: { label: string }) => <div className="ov-card ov-tile" aria-busy="true"><span className="ov-tl">{label}</span><span className="ov-skel big" /><span className="ov-skel" /></div>;
export const SkelChart = () => <div className="ov-card ov-fig" aria-busy="true"><span className="ov-skel" style={{ width: "40%" }} /><span className="ov-skel" style={{ height: 130 }} /></div>;
