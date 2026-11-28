// A department's Overview tab (overview slices 1 and 2), built to the approved canvas: what needs you, the written
// report (each line with chips to the runs it came from), four tiles, runs per day, drafts this week, AI spend by
// agent, the agents and the chains. It only draws: every number arrives worked out (dashboard/overview-rules.ts),
// and every report line arrives already checked against its runs (core/report-rules.ts).
import Link from "next/link";
import type { Drafts, OvLine, OvReport, StepState, WeekCounts } from "@/dashboard/overview-rules";
import { STEP_WORD, money } from "@/dashboard/overview-rules";
import type { GoalLine } from "@/core/goal-reading-rules";

export interface OvNeed { kind: "approve" | "failed"; title: string; sub: string; href: string; btn: string }
export interface OvBar { key: string; finished: number; failed: number; tip: string }
export interface OvSpend { name: string; label: string; pct: number }
export interface OvAgent { id: string; name: string; initial: string; hue: string; where: string; next: string; last: string; state: string; bad: boolean; href: string }
export interface OvChain { key: string; name: string; on: boolean; steps: { name: string; state: StepState }[]; when: string | null; href: string }
export interface OverviewData {
  name: string;
  report: OvReport;
  needs: OvNeed[];
  week: WeekCounts; waiting: number; waitingSub: string; claudeCount: number;
  bars: OvBar[]; barLabels: [string, string, string];
  drafts: Drafts; trust: string | null;
  spend: OvSpend[]; spendNote: string | null;
  agents: OvAgent[]; agentsHref: string;
  chains: OvChain[]; chainsHref: string;
}

const KIND: Record<OvNeed["kind"], { word: string; cls: string }> = { approve: { word: "To approve", cls: "yel" }, failed: { word: "Failed run", cls: "red" } };
const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function Overview({ d, goal, write, goalChart }: { d: OverviewData; goal: React.ReactNode; write: React.ReactNode; goalChart?: React.ReactNode }) {
  return (
    <div className="dp-scroll">
      <div className="ov">
        <Needs d={d} />

        <div className="ov-top">
          <Report r={d.report} write={write} />

          <div className="ov-tiles">
            <WeekTile d={d} />
            <WaitingTile d={d} />
            <SpendTile d={d} />
            {goal}
          </div>
        </div>

        <div className="ov-charts">
          <RunsChart d={d} />
          <DraftsChart d={d} />
          <SpendChart d={d} />
        </div>

        <div className="ov-mid">
        {goalChart}
        <Agents d={d} />
        </div>

        <Chains d={d} />
      </div>
    </div>
  );
}

// Each widget of the Overview on its own (packs slice 2), so a pack's layout (dashboard/components/widgetGrid.tsx)
// can place them; the default Overview above places them as it always did.

/** What needs you: drafts waiting and failed runs. Nothing when nothing does. */
export function Needs({ d }: { d: OverviewData }) {
  if (!d.needs.length) return null;
  return (
    <section className="ov-needs" aria-label="Needs you">
      {d.needs.map((n, i) => (
        <div key={i} className="ov-need">
          <span className={`ov-kind ${KIND[n.kind].cls}`}>{KIND[n.kind].word}</span>
          <span className="ov-need-t"><b>{n.title}</b> {n.sub}</span>
          <Link href={n.href} scroll={false} className={`dp-btn${n.kind === "approve" ? " dark" : ""}`}>{n.btn}</Link>
        </div>
      ))}
    </section>
  );
}

export const WeekTile = ({ d }: { d: OverviewData }) => <div className="ov-card ov-tile"><span className="ov-tl">Runs, last 7 days</span><b>{d.week.runs}</b><span className="ov-ts">{d.week.finished} finished · {d.week.failed} failed</span></div>;
export const WaitingTile = ({ d }: { d: OverviewData }) => <div className="ov-card ov-tile"><span className="ov-tl">Waiting on you</span><b>{d.waiting}</b><span className="ov-ts">{d.waitingSub}</span></div>;
export const SpendTile = ({ d }: { d: OverviewData }) => <div className="ov-card ov-tile"><span className="ov-tl">AI spend, last 7 days</span><b>{money(d.week.costUsd)}</b><span className="ov-ts">{d.claudeCount ? `Agents in Claude use your Claude plan: $0` : "Every run’s model cost"}</span></div>;

export function RunsChart({ d }: { d: OverviewData }) {
  const top = Math.max(1, ...d.bars.map((b) => b.finished + b.failed));
  const pct = (n: number) => (n > 0 ? `${Math.max(4, Math.round((n / top) * 100))}%` : "0px");
  return (
    <figure className="ov-card ov-fig">
      <figcaption><b>Runs per day</b><span>last 14 days</span></figcaption>
      <div className="ov-legend"><span><i className="ok" />Finished</span><span><i className="bad" />Failed</span></div>
      <div className="ov-bars" role="img" aria-label={`Runs per day for 14 days: ${d.week.runs} in the last 7 days, ${d.week.failed} failed`}>
        {d.bars.map((b) => (
          <div key={b.key} className="ov-bar" title={b.tip}>
            <i className="bad" style={{ height: pct(b.failed) }} />
            <i className={`ok${b.failed ? " under" : ""}`} style={{ height: pct(b.finished) }} />
          </div>
        ))}
      </div>
      <div className="ov-axis"><span>{d.barLabels[0]}</span><span>{d.barLabels[1]}</span><span>{d.barLabels[2]}</span></div>
    </figure>
  );
}

export function DraftsChart({ d }: { d: OverviewData }) {
  const dr = d.drafts;
  return (
    <figure className="ov-card ov-fig">
      <figcaption><b>Drafts, last 7 days</b><span>{s(dr.total, "approval card")}</span></figcaption>
      {dr.total > 0 ? (
        <>
          <div className="ov-split" role="img" aria-label={`${dr.asWritten} approved as written, ${dr.edited} edited, ${dr.rejected} rejected, ${dr.waiting} waiting`}>
            {dr.asWritten > 0 && <i className="a" style={{ flex: dr.asWritten }} />}
            {dr.edited > 0 && <i className="e" style={{ flex: dr.edited }} />}
            {dr.rejected > 0 && <i className="r" style={{ flex: dr.rejected }} />}
            {dr.waiting > 0 && <i className="w" style={{ flex: dr.waiting }} />}
          </div>
          <div className="ov-keys">
            <span><i className="a" />Approved as written <b>{dr.asWritten}</b></span>
            <span><i className="e" />Edited, then approved <b>{dr.edited}</b></span>
            <span><i className="r" />Rejected <b>{dr.rejected}</b></span>
            <span><i className="w" />Waiting <b>{dr.waiting}</b></span>
          </div>
        </>
      ) : <p className="ov-empty">No drafts from {d.name} in the last 7 days.</p>}
      {d.trust && <div className="ov-note">{d.trust}</div>}
    </figure>
  );
}

export function SpendChart({ d }: { d: OverviewData }) {
  return (
    <figure className="ov-card ov-fig">
      <figcaption><b>AI spend by agent</b><span>this month</span></figcaption>
      {d.spend.map((a) => (
        <div key={a.name} className="ov-spend">
          <div><span>{a.name}</span><span>{a.label}</span></div>
          <div className="ov-track"><i style={{ width: `${a.pct}%` }} /></div>
        </div>
      ))}
      {!d.spend.length && <p className="ov-empty">No agents in {d.name} yet.</p>}
      {d.spendNote && <div className="ov-foot">{d.spendNote}</div>}
    </figure>
  );
}

export function Agents({ d }: { d: OverviewData }) {
  return (
    <section className="ov-card ov-agents" aria-label="Agents">
      <div className="ov-sec-h"><b>Agents</b><span>latest result and next run</span><Link href={d.agentsHref} className="ov-more">All agents</Link></div>
      {d.agents.map((a) => (
        <Link key={a.id} href={a.href} scroll={false} className="ov-agent">
          <span className="ov-av" style={{ "--h": a.hue } as React.CSSProperties}>{a.initial}</span>
          <span className="ov-an"><b>{a.name}</b> · {a.where}</span>
          <span className="ov-next">{a.next}</span>
          <span className="ov-last">{a.last}</span>
          <span className={`ov-state${a.bad ? " bad" : ""}`}>{a.state}</span>
        </Link>
      ))}
      {!d.agents.length && <p className="ov-empty">No agents in {d.name} yet.</p>}
    </section>
  );
}

/** The chains and how each one's last run went. Nothing when the department has none. */
export function Chains({ d }: { d: OverviewData }) {
  if (!d.chains.length) return null;
  return (
    <section className="ov-card ov-chains" aria-label="Chains">
      <div className="ov-sec-h"><b>Chains</b><span>last run of each</span><Link href={d.chainsHref} className="ov-more">All chains</Link></div>
      {d.chains.map((c) => (
        <Link key={c.key} href={c.href} className="ov-chain">
          <b>{c.name}{c.on ? "" : " (off)"}</b>
          <span className="ov-steps">
            {c.steps.map((st, i) => (
              <span key={i} className="ov-stepw">{i > 0 && <span className="ov-arrow" aria-hidden="true">→</span>}<span className={`ov-step ${st.state}`}>{st.name} <small>{STEP_WORD[st.state]}</small></span></span>
            ))}
          </span>
          <span className="ov-when">{c.when ?? "Hasn’t run in 30 days"}</span>
        </Link>
      ))}
    </section>
  );
}

/** The goal tile: the department's first goal, measured in code, or a line saying there's none. */
export function GoalTile({ title, line, pct, href }: { title: string | null; line: string; pct: number | null; href: string }) {
  return (
    <Link href={href} className="ov-card ov-tile ov-goal">
      <span className="ov-tl">{title ? `Goal: ${title}` : "Goals"}</span>
      {pct != null ? <b>{Math.round(pct)}%</b> : <b className="sm">{title ? "Not measured yet" : "None yet"}</b>}
      {pct != null && <span className="ov-meter"><i style={{ width: `${Math.max(2, Math.min(100, pct))}%` }} /></span>}
      <span className="ov-ts">{line}</span>
    </Link>
  );
}

/**
 * A goal over time (overview slice 4), to the canvas: one saved reading a day as a line, the target as a dashed level
 * line, today's point marked. The points arrive scaled in code (core/goal-reading-rules.ts goalLine).
 */
export function GoalChart({ title, href, line, fmt, targetWord, note }: { title: string; href: string; line: GoalLine; fmt: { day: string; value: string }[]; targetWord: string | null; note: string }) {
  const pts = line.points;
  const last = pts[pts.length - 1];
  return (
    <figure className="ov-card ov-fig ov-goalfig">
      <figcaption><b>{title}</b><span>goal over time</span><Link href={href} className="ov-more">Goal</Link></figcaption>
      {pts.length >= 2 ? (
        <svg viewBox="0 0 400 150" width="100%" height="150" role="img" aria-label={`${title}: ${fmt.map((f) => `${f.day} ${f.value}`).join(", ")}${targetWord ? `; ${targetWord}` : ""}`}>
          {line.target && <line x1="0" y1={line.target.y} x2="400" y2={line.target.y} className="tgt" strokeWidth="1.5" strokeDasharray="5 5" />}
          {line.target && targetWord && <text x="396" y={Math.max(11, line.target.y - 8)} textAnchor="end" fontSize="11" className="tgt-t">{targetWord}</text>}
          <line x1="0" y1="140" x2="400" y2="140" className="base" />
          <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" className="ln" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          {pts.map((p, i) => <circle key={p.day} cx={p.x} cy={p.y} r={p === last ? 5 : 2.5} className={p === last ? "now" : "pt"}><title>{`${fmt[i].day}: ${fmt[i].value}`}</title></circle>)}
        </svg>
      ) : (
        <div className="ov-goalwait"><span className="ov-kind acc">Needs data</span>{last && <b>{fmt[fmt.length - 1].value} <small>on {fmt[fmt.length - 1].day}</small></b>}</div>
      )}
      <div className="ov-foot">{note}</div>
    </figure>
  );
}

const Lines = ({ title, lines, todo }: { title: string; lines: OvLine[]; todo?: boolean }) => (
  <div className="ov-rsec">
    <h3>{title}</h3>
    {lines.map((l, i) => (
      <p key={i} className={`ov-line${todo ? " todo" : ""}`}>{l.text}{l.chips.map((c, j) => <Link key={j} href={c.href} className="ov-chip"><i className={c.failed ? "bad" : undefined} />{c.label}</Link>)}</p>
    ))}
  </div>
);

/** The written report: Today or the last 7 days, each line with chips to its runs, what runs next, and Write it now. */
export function Report({ r, write }: { r: OvReport; write: React.ReactNode }) {
  return (
    <article className="ov-card ov-report">
      <div className="ov-report-h">
        <div><h2>{r.heading}</h2>{r.sub && <span className="ov-sub">{r.sub}</span>}</div>
        <nav className="ov-period" aria-label="Report period">
          <Link href={r.dayHref} scroll={false} aria-current={!r.week ? "true" : undefined}>Today</Link>
          <Link href={r.weekHref} scroll={false} aria-current={r.week ? "true" : undefined}>Last 7 days</Link>
        </nav>
      </div>
      {r.empty && <p className="ov-empty">{r.empty}</p>}
      {r.sections.map((x) => <Lines key={x.title} title={x.title} lines={x.lines} todo={x.todo} />)}
      {r.coming.length > 0 && (
        <div className="ov-rsec">
          <h3>Coming up</h3>
          {r.coming.map((c, i) => <p key={i} className="ov-line">{c.text}<Link href={c.href} className="ov-chip">Schedule</Link></p>)}
        </div>
      )}
      <div className="ov-rfoot">
        <span>{r.note}</span>
        {write}
        {r.allHref && <Link href={r.allHref}>{r.allLabel}</Link>}
      </div>
    </article>
  );
}
