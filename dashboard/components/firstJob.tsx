// The Desk's first job card (card 154, docs/setup.md). Server-drawn; the one button is a client
// ActionButton bound to startFirstJob. Every line comes from code: the pick, the steps, the cost.
import Link from "next/link";
import { ActionButton } from "./client";
import { startFirstJob } from "@/dashboard/actions";
import { monthWords, usd } from "@/core/cost-rules";
import { hm } from "@/dashboard/format";
import { firstSentence } from "@/dashboard/desk";
import type { FirstJobView } from "@/dashboard/firstJob";
import type { DeptWait } from "@/core/first-job-rules";

function Waits({ waits }: { waits: DeptWait[] }) {
  if (!waits.length) return null;
  return (
    <div className="stack rule" style={{ gap: 6, paddingTop: 12 }}>
      <span className="ted-k">Your other departments</span>
      {waits.map((w) => (
        <span key={w.templateId} className="row" style={{ gap: 8, fontSize: 13.5 }}>
          <span className="dot" style={{ width: 8, height: 8, background: w.waitsOn.length ? "var(--yel)" : "var(--mint)" }} />
          <b style={{ fontWeight: 600 }}>{w.dept}</b>
          <span className="ink2">{w.waitsOn.length ? `waits on ${w.waitsOn.join(" and ")}` : "ready: approve its playbook on Crew when you want it working"}</span>
          {w.waitsOn.length > 0 && <Link href="/connections" className="muted" style={{ marginLeft: "auto", fontSize: 12.5 }}>Connect</Link>}
        </span>
      ))}
    </div>
  );
}

function Steps({ steps }: { steps: string[] }) {
  return <ol className="ink2" style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.6 }}>{steps.map((s, i) => <li key={i}>{s}</li>)}</ol>;
}

export function FirstJobCard({ v, owner }: { v: FirstJobView; owner: boolean }) {
  if (v.phase === "offer") {
    const j = v.job;
    return (
      <section className="card" style={{ gap: 12 }} aria-labelledby="first-h">
        <h2 id="first-h" className="card-t">First job</h2>
        {j ? (
          <>
            <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <b style={{ fontSize: 16, fontWeight: 600 }}>{j.name}, {j.role} in {j.dept}</b>
              <span className="ink2" style={{ fontSize: 14, textWrap: "pretty" }}>{firstSentence(j.job, 240)}</span>
            </span>
            <span className="sub">Its first playbook, the steps every run follows:</span>
            <Steps steps={j.steps} />
            <span className="muted" style={{ fontSize: 12.5 }}>
              {j.cost ? `${j.cost.perRun != null && j.cost.runsPerMonth ? `About ${usd(j.cost.perRun)} a run · ` : ""}${monthWords(j.cost)}` : "Cost shows after its first run."}
              {j.proposes ? " · Anything it wants to change comes back as an approval card for you to tap. Nothing changes until you do." : " · It reads and reports; it changes nothing."}
              {v.averyWaits ? " Avery’s first playbook is approved with it, so her summary of the day comes each morning at 7:00." : ""}
            </span>
            {owner ? (
              <div className="row wrap" style={{ gap: 12 }}>
                <ActionButton className="btn dark" action={startFirstJob.bind(null, j.agentId)} busyLabel="Starting…">Approve and start</ActionButton>
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
    <section className="card" style={{ gap: 12 }} aria-labelledby="first-h">
      <div className="row" style={{ gap: 10 }}>
        <span className={`dot${going ? " pulse" : ""}`} style={{ width: 10, height: 10, background: going ? "var(--acc)" : r?.status === "ok" ? "var(--mint)" : "var(--red)" }} />
        <h2 id="first-h" className="card-t">{going ? `${v.name} is on the first job` : `${v.name} finished the first job`}</h2>
      </div>
      {going ? (
        <>
          <span className="ink2" style={{ fontSize: 14 }}>{r ? `Started at ${hm(r.started_at)} CT. ` : "Starting. "}A run usually takes a few minutes; this card updates when it ends.</span>
          <Steps steps={v.steps} />
        </>
      ) : r ? (
        <>
          <span className="ink2" style={{ fontSize: 14, textWrap: "pretty" }}>{r.status === "ok" ? firstSentence(r.summary ?? "Done.", 300) : `It didn’t finish: ${firstSentence(r.error ?? r.summary ?? "see the run", 240)}`}</span>
          <span className="muted" style={{ fontSize: 12.5 }}>Ended at {hm(r.ended_at ?? r.started_at)} CT · {usd(r.cost_usd)}{v.approvalsPending ? ` · ${v.approvalsPending} approval${v.approvalsPending === 1 ? "" : "s"} waiting for you` : ""}</span>
        </>
      ) : null}
      <div className="row wrap" style={{ gap: 10 }}>
        {r && <Link href={`/runs/${r.id}`} className="btn outline sm">{going ? "Watch the run" : "See the run"}</Link>}
        {!going && !!v.approvalsPending && <Link href="/approvals" className="btn dark sm">Review approvals</Link>}
      </div>
      <Waits waits={v.waits} />
    </section>
  );
}
