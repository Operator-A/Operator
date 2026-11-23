// The Desk's first job card (card 154, docs/setup.md). Server-drawn; the one button is a client
// ActionButton bound to startFirstJob. Every line comes from code: the pick, the steps, the cost.
import Link from "next/link";
import { ActionButton } from "./client";
import { startFirstJob } from "@/dashboard/actions";
import { monthWords, usd } from "@/core/cost-rules";
import { hm } from "@/dashboard/format";
import { zoneLabel } from "@/core/time";
import { firstSentence } from "@/dashboard/desk";
import type { FirstJobView } from "@/dashboard/firstJob";
import { laterWords, type DeptWait } from "@/core/first-job-rules";

function Waits({ waits }: { waits: DeptWait[] }) {
  if (!waits.length) return null;
  return (
    <div className="stack rule" style={{ gap: 6, paddingTop: 12 }}>
      <span className="ted-k">Your other departments</span>
      {waits.map((w) => (
        <span key={w.templateId} className="row" style={{ gap: 8, fontSize: 13.5 }}>
          <span className="dot" style={{ width: 8, height: 8, background: w.waitsOn.length ? "var(--yel)" : "var(--mint)" }} />
          <b style={{ fontWeight: 600 }}>{w.dept}</b>
          <span className="ink2">{w.waitsOn.length ? `waits on ${w.waitsOn.join(" and ")}` : w.templateId.startsWith("design:") ? "ready: give each agent a try from its page on Crew" : "ready: approve its playbook on Crew when you want it working"}</span>
          {w.waitsOn.length > 0 && <Link href="/connections" className="muted" style={{ marginLeft: "auto", fontSize: 12.5 }}>Connect</Link>}
        </span>
      ))}
    </div>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return <ol className="ink2" style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6 }}>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>;
}

export function FirstJobCard({ v, owner, look = "card" }: { v: FirstJobView; owner: boolean; look?: string }) {
  if (v.phase === "offer") {
    const j = v.job;
    return (
      <section className={look} style={{ gap: 12 }} aria-labelledby="first-h">
        <h2 id="first-h" className="card-t">First job</h2>
        {j ? (
          <>
            <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <b style={{ fontSize: 16, fontWeight: 600 }}>{j.name}, {j.role} in {j.dept}</b>
              <span className="ink2" style={{ fontSize: 14, textWrap: "pretty" }}>{firstSentence(j.job, 240)}</span>
            </span>
            {j.kind === "try" ? (
              <>
                <span className="sub">Avery designed this department for you, so it has no routine yet. Its first job is one try that reads only:</span>
                <span className="ink2" style={{ fontSize: 13.5 }}>{j.steps.join(", ")}</span>
                <span className="ink2" style={{ fontSize: 13 }}>It sends nothing and stays off duty. Its routine is drafted from what worked, for you to approve.</span>
              </>
            ) : (
              <>
                <span className="sub">Its first playbook, the steps every run follows:</span>
                <Steps steps={j.steps} />
              </>
            )}
            {j.later.length > 0 && <span className="ink2" style={{ fontSize: 13 }}>{laterWords(j.later)}</span>}
            <span className="muted" style={{ fontSize: 12.5 }}>
              {j.kind === "try" ? (j.cost?.perRun != null ? `About ${usd(j.cost.perRun)} for the try` : "Cost shows after the try.") : j.cost ? `${j.cost.perRun != null && j.cost.runsPerMonth ? `About ${usd(j.cost.perRun)} a run · ` : ""}${monthWords(j.cost)}` : "Cost shows after its first run."}
              {j.kind === "try" ? "" : j.proposes ? " · Anything it wants to change comes back as an approval card for you to tap. Nothing changes until you do." : " · It reads and reports; it changes nothing."}
              {v.averyWaits ? " Avery’s first playbook is approved with it, so her summary of the day comes each morning at 7:00." : ""}
            </span>
            {owner ? (
              <div className="row wrap" style={{ gap: 12 }}>
                <ActionButton className="btn dark" action={startFirstJob.bind(null, j.agentId)} busyLabel="Starting…">{j.kind === "try" ? "Start its first try" : "Approve and start"}</ActionButton>
                <span className="sub">Every other agent stays off duty until you approve its playbook.</span>
              </div>
            ) : <span className="sub">An owner of this business starts the first job.</span>}
          </>
        ) : <span className="sub">No agent is ready yet: each department waits on a tool. Connect one and the first job shows here.</span>}
        <Waits waits={v.waits} />
      </section>
    );
  }
  const r = v.run;
  const going = v.phase === "running";
  return (
    <section className={look} style={{ gap: 12 }} aria-labelledby="first-h">
      <div className="row" style={{ gap: 10 }}>
        <span className={`dot${going ? " pulse" : ""}`} style={{ width: 10, height: 10, background: going ? "var(--acc)" : r?.status === "ok" ? "var(--mint)" : "var(--red)" }} />
        <h2 id="first-h" className="card-t">{v.kind === "try" ? (going ? `${v.name} is on a first try` : `${v.name} finished a first try`) : going ? `${v.name} is on the first job` : `${v.name} finished the first job`}</h2>
      </div>
      {going ? (
        <>
          <span className="ink2" style={{ fontSize: 14 }}>{r ? `Started at ${hm(r.started_at, v.tz)} ${zoneLabel(v.tz, r.started_at)}. ` : "Starting. "}A run usually takes a few minutes; this card updates when it ends.</span>
          {v.kind !== "try" && <Steps steps={v.steps} />}
        </>
      ) : r ? (
        <>
          <span className="ink2" style={{ fontSize: 14, textWrap: "pretty" }}>{r.status === "ok" ? firstSentence(r.summary ?? "Done.", 300) : `It didn’t finish: ${firstSentence(r.error ?? r.summary ?? "see the run", 240)}`}</span>
          {v.kind === "try" && (v.steps.length
            ? <span className="ink2" style={{ fontSize: 13.5 }}>Its routine is drafted from this try, {v.steps.length} step{v.steps.length === 1 ? "" : "s"}: {v.steps.join(", ")}. Approve it, then put {v.name} on duty.</span>
            : <span className="ink2" style={{ fontSize: 13.5 }}>No routine was drafted from this try. Open {v.name} to see why and try again.</span>)}
          <span className="muted" style={{ fontSize: 12.5 }}>Ended at {hm(r.ended_at ?? r.started_at, v.tz)} {zoneLabel(v.tz, r.ended_at ?? r.started_at)} · {usd(r.cost_usd)}{v.approvalsPending ? ` · ${v.approvalsPending} approval${v.approvalsPending === 1 ? "" : "s"} waiting for you` : ""}</span>
        </>
      ) : null}
      <div className="row wrap" style={{ gap: 10 }}>
        {r && <Link href={`/runs/${r.id}`} className="btn outline sm">{going ? "Watch the run" : "See the run"}</Link>}
        {!going && v.kind === "try" && <Link href={`/agents/${v.agentId}`} className="btn dark sm">Review its routine</Link>}
        {!going && !!v.approvalsPending && <Link href="/approvals" className="btn dark sm">Review approvals</Link>}
      </div>
      <Waits waits={v.waits} />
    </section>
  );
}
