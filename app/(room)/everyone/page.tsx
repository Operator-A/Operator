import Link from "next/link";
import { cookies } from "next/headers";
import { getFloor } from "@/dashboard/data";
import { needs, split, PRI_COLOR } from "@/dashboard/needs";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import { deptAgentIds, needsByDept } from "@/dashboard/dept-rules";
import { companySeat, seatOf } from "@/core/org";
import { stateLook, stateOf } from "@/dashboard/status";
import { when } from "@/dashboard/format";
import { Avatar, Empty, Pill } from "@/dashboard/components/ui";
import type { CrewMember } from "@/dashboard/crew";

// Everyone (docs/department-pages.md): the bell opens it. What waits on you first, then every
// department's agents with their last run, so one screen answers "who is doing what".

export default async function Everyone() {
  const [f, jar] = await Promise.all([getFloor(), cookies()]);
  const { now, later } = split(needs(f, f.now, parseSeen(jar.get(SEEN_COOKIE)?.value)));
  const org = f.chart;
  const red = org ? needsByDept(org.departments.map((d) => d.id), f.approvalOwners.map((o) => o.dept)).byDept : {};
  const row = (a: CrewMember) => {
    const st = stateOf(a, f.agents[a.id], f.runs, f.spentToday[a.id] ?? 0);
    const last = f.runs.find((r) => r.agent_id === a.id && r.status !== "skipped");
    return (
      <Link key={a.id} href={`/agents/${a.id}`} className="row rule wrap" style={{ gap: 10, padding: "10px 0", color: "inherit", textDecoration: "none", alignItems: "flex-start" }}>
        <Avatar a={a} size={30} working={st === "running"} />
        <span className="stack" style={{ gap: 2, flex: 1, minWidth: 200 }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{a.name} <span className="muted" style={{ fontWeight: 500 }}>· {a.role}</span></span>
          <span className="ink2" style={{ fontSize: 13, lineHeight: 1.45 }}>{last ? `${when(last.started_at, f.tz)}: ${last.summary ?? (last.status === "failed" ? last.error ?? "The run failed." : "Working now.")}` : "Never run"}</span>
        </span>
        <Pill look={stateLook(st, f.org.on)} sm />
      </Link>
    );
  };
  const top = org ? companySeat(org) : null;
  const company = top?.holder === "agent" && top.agentId && f.byId[top.agentId] ? f.byId[top.agentId] : null;
  const offChart = org ? f.crew.filter((a) => !seatOf(org, a.id)) : f.crew;

  return (
    <>
      <div className="stack" style={{ gap: 6 }}>
        <h1 className="h1">Everyone</h1>
        <span className="sub">What waits on you, then every agent and its last run.</span>
      </div>

      <div className="card" style={{ gap: 4 }}>
        <span className="card-t" style={{ marginBottom: 6 }}>Needs you</span>
        {!now.length && !later.length && <span className="sub">Nothing needs you right now.</span>}
        {[...now, ...later].map((n) => (
          <Link key={`${n.title}:${n.href}`} href={n.href} className="row rule wrap" style={{ gap: 10, padding: "9px 0", color: "inherit", textDecoration: "none" }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: PRI_COLOR[n.pri], flex: "none" }} />
            <span className="stack" style={{ gap: 2, flex: 1, minWidth: 200 }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{n.title}</span>
              {n.sub && <span className="sub">{n.sub}</span>}
            </span>
          </Link>
        ))}
      </div>

      {company && <div className="card" style={{ gap: 0 }}><span className="card-t" style={{ marginBottom: 4 }}>Company</span>{row(company)}</div>}
      {!f.crew.length && <Empty title="No agents yet." />}
      {(org?.departments ?? []).map((d) => {
        const ids = deptAgentIds(org!, d.id).filter((a) => f.byId[a]);
        return (
          <div key={d.id} className="card" style={{ gap: 0 }}>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <Link href={`/dept/${d.id}`} className="card-t" style={{ flex: 1, color: "inherit" }}>{d.name} ›</Link>
              {!!red[d.id] && <Link href={`/dept/${d.id}?tab=approvals`} className="count red">{red[d.id]}</Link>}
            </div>
            {!ids.length && <span className="sub" style={{ padding: "8px 0" }}>No agents here yet.</span>}
            {ids.map((a) => row(f.byId[a]))}
          </div>
        );
      })}
      {offChart.filter((a) => a.id !== company?.id).length > 0 && (
        <div className="card" style={{ gap: 0 }}>
          <span className="card-t" style={{ marginBottom: 4 }}>Not in a department</span>
          {offChart.filter((a) => a.id !== company?.id).map(row)}
        </div>
      )}
    </>
  );
}
