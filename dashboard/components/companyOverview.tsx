// The Company page's Overview tab (overview slice 3), built to the approved canvas's Company artboard: what needs you
// across departments, the company report (written from the department reports, each line with a chip to the
// department line's run, then action items), four tiles, revenue per day, runs per day by department, and a card
// per department. It only draws: every number arrives worked out (dashboard/company-overview-rules.ts) and every
// report line arrives already checked against the department lines it cites (core/report-rules.ts).
import Link from "next/link";
import type { OvReport } from "@/dashboard/overview-rules";
import { Report } from "./overview";

export interface CoNeed { kind: string; cls: "yel" | "red" | "acc" | "mint"; dept: string; title: string; sub: string; href: string; btn: string }
export interface CoTile { label: string; value: string; unit?: string; sub: string; empty?: boolean; href?: string }
export interface CoRevBar { key: string; pct: number | null; tip: string }
export interface CoStack { key: string; parts: number[]; tip: string }
export interface CoDept { id: string; name: string; hue: string; led: string; need: number; headline: string; runs: string; spend: string; goal: React.ReactNode; href: string }
export interface CompanyOverviewData {
  needs: CoNeed[];
  report: OvReport;
  tiles: CoTile[];
  rev: CoRevBar[]; revLabels: [string, string, string]; revNote: string | null; revEmpty: boolean;
  stackNames: { name: string; hue: string }[]; stack: CoStack[]; stackLabels: [string, string, string]; stackTotal: number;
  depts: CoDept[];
}

export function CompanyOverview({ d, write, before, goalTile }: { d: CompanyOverviewData; write: React.ReactNode; before?: React.ReactNode; goalTile: React.ReactNode }) {
  const top = Math.max(1, ...d.stack.map((x) => x.parts.reduce((t, n) => t + n, 0)));
  const h = (n: number) => (n > 0 ? `${Math.max(4, Math.round((n / top) * 100))}%` : "0px");
  return (
    <div className="dp-scroll">
      <div className="ov co-ov">
        {before}
        {d.needs.length > 0 && (
          <section className="ov-card co-ov-needs" aria-label="Needs you">
            {d.needs.map((n, i) => (
              <div key={i} className="co-ov-need">
                <span className={`ov-kind ${n.cls}`}>{n.kind}</span>
                <span className="co-ov-dept">{n.dept}</span>
                <span className="ov-need-t"><b>{n.title}</b> {n.sub}</span>
                <Link href={n.href} scroll={false} className="dp-btn">{n.btn}</Link>
              </div>
            ))}
          </section>
        )}

        <div className="ov-top">
          <Report r={d.report} write={write} />
          <div className="ov-tiles">
            {d.tiles.map((t) => {
              const body = <><span className="ov-tl">{t.label}</span><b className={t.empty ? "sm" : undefined}>{t.value}{t.unit && <span className="co-unit"> {t.unit}</span>}</b><span className="ov-ts">{t.sub}</span></>;
              return t.href ? <Link key={t.label} href={t.href} className="ov-card ov-tile">{body}</Link> : <div key={t.label} className="ov-card ov-tile">{body}</div>;
            })}
            {goalTile}
          </div>
        </div>

        <div className="ov-charts co-charts">
          <figure className="ov-card ov-fig">
            <figcaption><b>Revenue per day</b><span>last 30 days, from the daily numbers</span></figcaption>
            {d.revEmpty ? <p className="ov-empty">No daily numbers saved in the last 30 days. They come from the daily numbers job once a store is connected.</p> : (
              <>
                <div className="co-rev" role="img" aria-label={`Revenue per day for 30 days${d.revNote ? "; some days have no reading" : ""}`}>
                  {d.rev.map((b) => (
                    <div key={b.key} className="co-revbar" title={b.tip}>
                      {b.pct == null ? <i className="none" /> : <i style={{ height: b.pct > 0 ? `${Math.max(2, b.pct)}%` : "0px" }} />}
                    </div>
                  ))}
                </div>
                <div className="ov-axis"><span>{d.revLabels[0]}</span><span>{d.revLabels[1]}</span><span>{d.revLabels[2]}</span></div>
              </>
            )}
            {d.revNote && <div className="ov-foot">{d.revNote}</div>}
          </figure>

          <figure className="ov-card ov-fig">
            <figcaption><b>Runs per day by department</b><span>last 14 days</span></figcaption>
            <div className="ov-legend co-legend">{d.stackNames.map((x) => <span key={x.name}><i style={{ background: x.hue }} />{x.name}</span>)}</div>
            <div className="ov-bars" role="img" aria-label={`Runs per day stacked by department for 14 days, ${d.stackTotal} in all`}>
              {d.stack.map((x) => (
                <div key={x.key} className="ov-bar co-stack" title={x.tip}>
                  {[...x.parts.keys()].reverse().map((i) => x.parts[i] > 0 && <i key={i} style={{ height: h(x.parts[i]), background: d.stackNames[i].hue }} />)}
                </div>
              ))}
            </div>
            <div className="ov-axis"><span>{d.stackLabels[0]}</span><span>{d.stackLabels[1]}</span><span>{d.stackLabels[2]}</span></div>
          </figure>
        </div>

        {d.depts.length > 0 && (
          <section className="co-ov-depts" aria-label="Departments">
            {d.depts.map((x) => (
              <Link key={x.id} href={x.href} className="ov-card co-ov-dcard" style={{ "--hue": x.hue } as React.CSSProperties}>
                <div className="co-ov-dh"><i /><b>{x.name}</b><span>{x.led}</span>{x.need > 0 ? <span className="co-chip warn">{x.need} need{x.need === 1 ? "s" : ""} you</span> : <span className="co-chip ok">All clear</span>}</div>
                <p>{x.headline}</p>
                <div className="co-ov-dn"><span>{x.runs}</span><span>{x.spend}</span>{x.goal}</div>
              </Link>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
