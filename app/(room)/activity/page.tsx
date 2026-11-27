import Link from "next/link";
import { getRoster, getTz } from "@/dashboard/data";
import { readStatus } from "@/core/status";
import { REALERT_HOURS } from "@/core/status-rules";
import { emailState } from "@/integrations/email";
import { recentEvents } from "@/core/events";
import { m4 } from "@/dashboard/format";
import { CLAUDE_WAITING, clock, dayLabel } from "@/dashboard/dept-feed";
import { inClaude, runLook } from "@/dashboard/status";
import { deptHue } from "@/dashboard/dept-rules";
import { IntentLink } from "@/dashboard/components/intentLink";
import {
  ACTIVITY_HREF, RESULTS, RESULT_LABEL, STARTS, START_LABEL, activityHref, activityQ, byDay, deptOfAgents, filtered, healthWord, matchRuns, totalsLine,
} from "@/dashboard/activity-rules";

type Q = { dept?: string; status?: string; trigger?: string; q?: string };

// Activity (docs/department-pages.md, slice 12; mockup v20): Runs and Status on one page. What needs a look
// first, then every real run (each opens its replay at /runs/<id>), then live events, folded.
export default async function Activity({ searchParams }: { searchParams: Promise<Q> }) {
  // one round (card 302): the crew and its runs, the time zone, what is wrong, the alert email, live events
  const [sp, roster, tz, status, mail, events] = await Promise.all([searchParams, getRoster(), getTz(), readStatus(), emailState(), recentEvents(20)]);
  const { facts: f, problems } = status;
  const org = roster.chart;
  const depts = (org?.departments ?? []).map((d, i) => ({ id: d.id, name: d.name, hue: deptHue(i) }));
  const q = activityQ(sp, depts.map((d) => d.id));
  const deptOf = deptOfAgents(org, roster.crew.map((a) => a.id));
  const hueOf = Object.fromEntries(depts.map((d) => [d.id, d]));
  const rows = matchRuns(roster.runs, q, deptOf);
  const health = healthWord(problems);
  const chip = (id: string, label: string, hue?: string) => (
    <IntentLink key={id} href={activityHref(q, { dept: id })} className={"act-chip" + (q.dept === id ? " on" : "")} style={hue ? ({ "--hue": hue } as React.CSSProperties) : undefined}>
      {hue && <i />}{label}
    </IntentLink>
  );
  const seg = (key: "result" | "start", label: string, opts: readonly string[], names: Record<string, string>) => (
    <nav className="co-vseg" aria-label={label}>
      {["all", ...opts].map((v) => <IntentLink key={v} href={activityHref(q, { [key]: v })} className={q[key] === v ? "on" : ""}>{names[v]}</IntentLink>)}
    </nav>
  );

  return (
    <div className="stack act">
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 className="h1">Activity</h1>
        <span style={{ fontSize: 13.5 }} className="muted">What your agents did, and anything that’s broken</span>
      </div>

      <section className={"card act-health" + (health.clear ? " clear" : health.red ? "" : " warn")} id="health">
        <span className="card-t">{health.text}</span>
        {health.clear ? <span className="sub">Nothing is stuck, paused or refused. Jobs run on time and every connection is signed in.</span>
          : problems.map((p) => (
            <div key={p.key} className="act-hrow">
              <i className={p.level === "alert" ? "" : "warn"} />
              <span className="act-ht">{p.title}<small>{p.detail}</small></span>
              <Link href={p.href} className="btn ghost sm">Open</Link>
            </div>
          ))}
        <div className="act-facts">
          <span><b>{f.overdueJobs.count}</b> job{f.overdueJobs.count === 1 ? "" : "s"} late</span>
          <span><b>{f.deadJobs.count}</b> job{f.deadJobs.count === 1 ? "" : "s"} failed today</span>
          <span><b>{f.failedRuns.count}</b> run{f.failedRuns.count === 1 ? "" : "s"} failed today</span>
          <span><b>{f.refused.count}</b> refused by the gateway</span>
          <span><b>{f.paused.length}</b> connection{f.paused.length === 1 ? "" : "s"} paused</span>
        </div>
      </section>

      <section className="card act-runs" id="runs">
        <div className="row wrap" style={{ gap: 10 }}><span className="card-t">Runs</span><span className="sp" /><span className="muted" style={{ fontSize: 12 }}>Every real run, last 60 days. Tap one to replay it.</span></div>
        <div className="act-fil">{chip("all", "All")}{depts.length > 0 && chip("company", "Company", "var(--mut)")}{depts.map((d) => chip(d.id, d.name, d.hue))}</div>
        <div className="act-fil">
          {seg("result", "Result", RESULTS, RESULT_LABEL)}
          {seg("start", "How it started", STARTS, START_LABEL)}
          <form action={ACTIVITY_HREF} className="act-search">
            {q.dept !== "all" && <input type="hidden" name="dept" value={q.dept} />}
            {q.result !== "all" && <input type="hidden" name="status" value={q.result} />}
            {q.start !== "all" && <input type="hidden" name="trigger" value={q.start} />}
            <input className="input" name="q" defaultValue={q.q} placeholder="Search summaries and errors" aria-label="Search runs" />
          </form>
        </div>
        {!roster.ok && <div className="card" style={{ background: "var(--red-soft)", color: "var(--red-ink)" }}>{roster.problem}</div>}
        {byDay(rows.slice(0, 300), tz, roster.now).map((g) => (
          <div key={g.day}>
            <h6 className="act-day">{g.day}</h6>
            {g.runs.map((r) => {
              const a = roster.byId[r.agent_id], d = hueOf[deptOf[r.agent_id]], look = runLook(r, roster.now);
              return (
                <Link key={r.id} href={`/runs/${r.id}`} className="act-run" title={dayLabel(r.started_at, tz, roster.now)}>
                  <span className="act-tm">{clock(r.started_at, tz)}</span>
                  <span className="act-mid">
                    <span className="act-who" style={{ "--hue": d?.hue ?? "var(--mut)" } as React.CSSProperties}><i />{a?.name ?? r.agent_id}<span className="muted">· {d?.name ?? "Company"}</span></span>
                    <span className="act-sum">{inClaude(r, roster.now) ? CLAUDE_WAITING : r.error ? `Error: ${r.error}` : r.summary ?? (r.status === "running" ? "Working now." : "Ran.")}</span>
                  </span>
                  <span className="act-rt"><span className="act-st" style={{ background: look.bg, color: look.fg }}>{look.label}</span>{r.status === "skipped" ? "—" : m4(r.cost_usd)}</span>
                </Link>
              );
            })}
          </div>
        ))}
        {!rows.length && <div style={{ padding: 32, textAlign: "center", fontSize: 14 }} className="muted">No runs match.</div>}
        <div className="act-foot">
          <span>{totalsLine(rows)} · {m4(rows.reduce((s, r) => s + r.cost_usd, 0))} spent</span>
          {filtered(q) && <Link href={ACTIVITY_HREF}>Clear filters</Link>}
        </div>
      </section>

      <details className="card act-events" id="live-events">
        <summary>Live events · {events.length}</summary>
        {events.length === 0 ? <span className="sub">No events yet. Set a service up under <Link href="/connections#live-events">Connections &gt; Live events</Link>, then start a chain on it in Settings &gt; Schedule.</span>
          : events.map((e) => (
            <div key={e.id} className="act-ev">
              <b>{clock(e.at, tz)}</b>
              <span>{e.label}{e.test ? " (test)" : ""}<small>{e.outcome ?? "Checking which chains start…"}</small></span>
              <small>{dayLabel(e.at, tz, roster.now)}</small>
            </div>
          ))}
      </details>

      <span className="sub">
        {mail.ok ? `Red items also email you, once when they start and then at most every ${REALERT_HOURS} hours while they last.` : `Red items show here. ${mail.text}`}
      </span>
    </div>
  );
}
