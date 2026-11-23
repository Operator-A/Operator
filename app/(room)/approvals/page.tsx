import Link from "next/link";
import { acceptPromotion, applyWaiting, approveAll, cancelAction, declinePromotion, queueQuinn, retryAction, trustToDraft } from "@/dashboard/actions";
import { trustView, type TrustView } from "@/dashboard/trust";
import { getApprovals, getCounts, getReactRules, getRoster, getTz, type ApprovalItem, type ReactRules } from "@/dashboard/data";
import { when } from "@/dashboard/format";
import { controlsOn } from "@/dashboard/session";
import { ActionButton } from "@/dashboard/components/client";
import { Empty } from "@/dashboard/components/ui";
import { ApprovalCard, Tag } from "@/dashboard/components/approvalBits";
import { writeBlocker } from "@/core/gateway";

// Applying a batch calls Mercury once or twice per change.
export const maxDuration = 300;

export default async function Approvals({ searchParams }: { searchParams: Promise<{ dept?: string }> }) {
  const [sp, roster, tz, { proposalsPending }, all, trust] = await Promise.all([searchParams, getRoster(), getTz(), getCounts(), getApprovals(), trustView().catch((e): TrustView => ({ offers: [], scheduled: [], lines: [], undoMinutes: 30, problem: e instanceof Error ? e.message : String(e) }))]);
  const f = { ...roster, tz, proposalsPending }; // the crew, the time zone and the proposal count only (card 304)
  // the department filter: one department, the ones off the chart ("none"), or everything
  const dept = all?.departments.some((d) => d.id === sp.dept) || sp.dept === "none" ? sp.dept : undefined;
  const inDept = (i: ApprovalItem) => !dept || (dept === "none" ? !i.department_id : i.department_id === dept);
  const view = all && { ...all, pending: all.pending.filter(inDept), withLead: all.withLead.filter(inDept), waiting: all.waiting.filter(inDept), decided: all.decided.filter(inDept) };
  const controls = controlsOn();
  // what a Reject with words can save to or replace, per agent with a card waiting; read with the write check in one round (card 302)
  const open = view ? [...view.pending, ...view.withLead] : [];
  const ruleIds = [...new Set(open.map((i) => i.agent_id))];
  const [blocker, rulePairs] = await Promise.all([
    !controls ? "Real runs are off on this OPERATOR" : writeBlocker(),
    Promise.all(ruleIds.map(async (id) => [id, await getReactRules(id)] as const)),
  ]);
  const rules: Record<string, ReactRules> = Object.fromEntries(rulePairs);
  const quinnOn = !!f.agents.bookkeeper?.enabled;
  const live = !blocker && quinnOn;
  const card = (i: ApprovalItem) => <ApprovalCard key={i.id} i={i} view={view} byId={f.byId} tz={f.tz} rules={rules} />;

  return (
    <>
      <div className="row wrap" style={{ gap: 10 }}>
        <h1 className="h1" style={{ flex: 1 }}>Approvals</h1>
        <ActionButton className="btn ghost sm" action={queueQuinn} title="Turns Quinn’s saved proposals into approvals. Writes nothing to Mercury.">Check for Quinn’s proposals</ActionButton>
      </div>

      {!!f.proposalsPending && (
        <Link href="/proposals" className="card row wrap" style={{ gap: 10, borderLeft: "4px solid var(--acc)", textDecoration: "none", color: "inherit" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, flex: 1 }}>{f.proposalsPending} proposal{f.proposalsPending === 1 ? "" : "s"} to decide</span>
          <span className="sub">Hires, departments, goal changes, tools and retirements. Open them ›</span>
        </Link>
      )}

      <div className="card" style={{ gap: 8, borderLeft: `4px solid ${live ? "var(--mint)" : "var(--yel)"}` }}>
        <span style={{ fontSize: 14.5, fontWeight: 600 }}>{live ? "Approving writes to Mercury right away." : "Approving records your decision. Nothing is written to Mercury yet."}</span>
        <span style={{ fontSize: 13, lineHeight: 1.55 }} className="ink2">
          The gateway only ever writes a receipt, a category and a memo on a charge that already exists. Before each write it re-checks the charge in Mercury, and it never replaces a category, memo or attachment that’s already there.
          {!live && <> Waiting on: {[blocker, !quinnOn && "Quinn is off duty (turn on at launch)"].filter(Boolean).join(", ")}. Approved items stay approved and go out once these are in place.</>}
          {" "}Items older than {view?.staleHours ?? 72} hours expire unreviewed.
        </span>
      </div>

      {!view ? (
        <Empty title="The approvals tables aren’t there yet">Apply the gateway migration (supabase/migrations/20261110120000_gateway.sql) to your Supabase project.</Empty>
      ) : (
        <>
          {view.departments.length > 0 && (
            <nav className="seg" aria-label="Department" style={{ flexWrap: "wrap" }}>
              <Link href="/approvals" className={!dept ? "on" : ""} aria-current={!dept ? "page" : undefined}>All</Link>
              {view.departments.map((d) => <Link key={d.id} href={`/approvals?dept=${d.id}`} className={dept === d.id ? "on" : ""} aria-current={dept === d.id ? "page" : undefined}>{d.name}</Link>)}
              <Link href="/approvals?dept=none" className={dept === "none" ? "on" : ""} aria-current={dept === "none" ? "page" : undefined}>Not in a department</Link>
            </nav>
          )}
          {trust.offers.map((o) => (
            <div key={`${o.agentId}:${o.tool}`} className="card" style={{ gap: 10, borderLeft: "4px solid var(--mint)" }}>
              <span className="card-t">Earned trust</span>
              <span style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.45 }}>{o.text}</span>
              <span className="sub">Caps, refusals and fresh checks still apply to every one. A “wrong” or “against the rules” later drops it straight back to Draft.</span>
              <div className="row" style={{ gap: 8 }}>
                <ActionButton className="btn primary" action={acceptPromotion.bind(null, o.agentId, o.tool)}>Yes, promote</ActionButton>
                <ActionButton className="btn ghost" action={declinePromotion.bind(null, o.agentId, o.tool)}>Not yet</ActionButton>
              </div>
            </div>
          ))}

          {trust.scheduled.length > 0 && (
            <div className="card" style={{ gap: 8 }}>
              <div className="stack" style={{ gap: 2 }}>
                <span className="card-t">Going out on earned trust ({trust.scheduled.length})</span>
                <span className="sub">Each runs by itself when its undo window ends ({trust.undoMinutes} minutes, checked every 15, so up to {trust.undoMinutes + 15}). Cancel writes nothing.</span>
              </div>
              {trust.scheduled.map((a) => (
                <div key={a.id} className="row rule wrap" style={{ gap: 10, padding: "8px 0", fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 200 }}>{a.name} · {a.what}: {a.label}</span>
                  <span className="muted" style={{ fontSize: 12 }}>after {when(a.executeAfter, f.tz)}</span>
                  <ActionButton className="btn ghost xs" action={cancelAction.bind(null, a.id, "not_now")}>Cancel</ActionButton>
                  <ActionButton className="btn ghost xs" action={cancelAction.bind(null, a.id, "wrong")} title="Cancels it and drops this kind back to Draft">Cancel, it’s wrong</ActionButton>
                </div>
              ))}
            </div>
          )}

          <div className="row wrap" style={{ gap: 10 }}>
            <span className="card-t">Waiting on you ({view.pending.length})</span>
            {view.pending.length > 1 && (
              <ActionButton className="btn primary sm" action={approveAll.bind(null, view.pending.map((i) => i.id))}
                confirm={{ title: `Approve all ${view.pending.length}?`, body: live ? "Each change is re-checked against Mercury, then written: receipt, category and memo only." : "Your approvals are recorded. Nothing goes to Mercury until the write token, controls and Quinn are on.", lines: [{ k: "Changes", v: String(view.pending.length) }], confirmLabel: "Approve all" }}>
                Approve all {view.pending.length}
              </ActionButton>
            )}
          </div>
          {!view.pending.length && <Empty title="Nothing waiting on you.">{dept ? "Nothing from this department right now." : "Quinn’s matched receipts and category suggestions land here, one card per charge, after each real run."}</Empty>}
          {view.pending.map(card)}

          {view.withLead.length > 0 && (
            <>
              <div className="stack" style={{ gap: 2 }}>
                <span className="card-t">With the lead first ({view.withLead.length})</span>
                <span className="sub">Departments with “Lead checks drafts first” on. The lead adds a note or sends a draft back once; only your tap approves.</span>
              </div>
              {view.withLead.map(card)}
            </>
          )}

          {view.waiting.length > 0 && (
            <div className="card" style={{ gap: 10 }}>
              <div className="card-h">
                <span className="card-t">Approved, not applied yet ({view.waiting.length})</span>
                <ActionButton className="btn dark sm" disabled={!controls} title={!controls ? "Real runs are off on this OPERATOR" : undefined} action={applyWaiting}
                  confirm={{ title: "Apply approved changes?", body: "Each one is checked again first: a Mercury change against Mercury, a Gmail draft against the leads list. Each runs as its agent, so it’s skipped while that agent is off duty.", confirmLabel: "Apply now" }}>Apply now</ActionButton>
              </div>
              {view.waiting.map((i) => (
                <div key={i.id} className="row rule wrap" style={{ gap: 12, padding: "10px 0", fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 200 }}>{i.title}{i.action_reason && <span className="muted"> · {i.action_reason}</span>}</span>
                  <Tag s={i.action_status} />
                  {i.action_status === "failed" && <ActionButton className="btn ghost xs" disabled={!controls} action={retryAction.bind(null, i.action_id)}>Retry</ActionButton>}
                </div>
              ))}
            </div>
          )}

          {(trust.lines.length > 0 || trust.problem) && (
            <div className="card" style={{ gap: 4 }}>
              <div className="card-h" style={{ marginBottom: 6 }}><span className="card-t">Trust levels</span><span className="sub">Earned per agent and kind of action: 28 of the last 30 approved unedited, then you confirm</span></div>
              {trust.problem && <span className="sub">{trust.problem}</span>}
              {trust.lines.map((l) => (
                <div key={`${l.agentId}:${l.tool}`} className="row rule wrap" style={{ gap: 12, padding: "9px 0", fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 220 }}><b style={{ fontWeight: 600 }}>{l.name} · {l.what}</b> <span className="muted">· {l.levelWords}</span><br /><span className="ink2" style={{ fontSize: 12.5 }}>{l.words}{l.reason && l.level === "draft" && l.changedAt ? ` Last change: ${l.reason}` : ""}</span></span>
                  {l.level !== "draft" && <ActionButton className="btn ghost xs" action={trustToDraft.bind(null, l.agentId, l.tool)}>Back to Draft</ActionButton>}
                </div>
              ))}
            </div>
          )}

          {view.decided.length > 0 && (
            <div className="card" style={{ gap: 4 }}>
              <span className="card-t" style={{ marginBottom: 6 }}>Decided</span>
              {view.decided.map((i) => (
                <div key={i.id} className="row rule wrap" style={{ gap: 12, padding: "10px 0", fontSize: 13 }}>
                  <span style={{ flex: 1, minWidth: 200 }}>{i.title}{i.action_reason && <span className="muted"> · {i.action_reason}</span>}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{i.decided_at ? when(i.decided_at, f.tz) : ""}</span>
                  <Tag s={i.status === "expired" ? "expired" : i.action_status} />
                </div>
              ))}
            </div>
          )}

          <div className="card" style={{ gap: 4 }}>
            <div className="card-h" style={{ marginBottom: 6 }}><span className="card-t">Gateway log</span><span className="sub">Every write an agent asked for, allowed or refused</span></div>
            {!view.log.length && <span className="muted" style={{ fontSize: 13 }}>No actions yet.</span>}
            {view.log.map((g) => (
              <div key={g.id} className="row rule wrap" style={{ gap: 12, padding: "9px 0", fontSize: 12.5 }}>
                <span style={{ width: 110 }} className="muted">{when(g.created_at, f.tz)}</span>
                <span style={{ width: 70 }}>{f.byId[g.agent_id]?.name ?? g.agent_id}</span>
                <span style={{ flex: 1, minWidth: 180 }}><code>{g.tool}</code> · {g.action_type}{g.reason && <span className="muted"> · {g.reason}</span>}</span>
                <Tag s={g.status} />
                {g.exec_run_id && <Link href={`/runs/${g.exec_run_id}`} style={{ fontSize: 12 }}>run</Link>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
