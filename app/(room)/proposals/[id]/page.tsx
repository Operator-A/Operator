import { orgTz } from "@/core/tz";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/dashboard/data";
import { proposalAccept, proposalDecline } from "@/dashboard/proposalActions";
import { ActionButton } from "@/dashboard/components/client";
import { NotNowButton } from "@/dashboard/components/proposals";
import { when } from "@/dashboard/format";
import { getProposal, proposalChecks, toolLabel, type Proposal } from "@/core/proposals";
import { BRAINS, HIRE_STEPS, KIND_WORDS, changeWhat, changesSpec } from "@/core/proposal-rules";
import { changeRows } from "@/dashboard/change-rules";
import { agentNames, agentsIn, deptSpent, loadOrg, monthSpendByAgent } from "@/core/org";
import { billing, hireCost } from "@/dashboard/cost";
import { draftView } from "@/dashboard/department";
import { DraftBody } from "@/dashboard/components/department";
import { costDetail, monthWords, usd as costUsd } from "@/core/cost-rules";
import { CHECKS, hasCheck } from "@/core/setup-check-rules";

// One proposal (docs/company-mode.md, slice 3, the Hire artboard): who asked and why, what it
// holds, what a yes does, what code checks again at the tap, and Yes / Change it first / Not now.

const usd = (n: number) => `$${n.toFixed(2)}`;

function Lines({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {rows.map(([k, v], n) => (
        <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16, padding: "9px 0", fontSize: 13 }}>
          <span className="muted" style={{ flexShrink: 0 }}>{k}</span>
          <span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere", whiteSpace: "pre-wrap" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

const GOAL_STATE_DOES = {
  drop: { label: "Drop this goal", does: "Drops the goal. Its history stays." },
  pause: { label: "Pause this goal", does: "Pauses the goal. It stays on the chart, greyed, and the head stops planning around it." },
  resume: { label: "Turn it back on", does: "Turns the paused goal back on. Its head plans around it from the next run." },
  done: { label: "Mark it done", does: "Marks the goal done. Its history stays." },
} as const;

function yesDoes(p: Proposal["payload"]): { label: string; does: string } {
  switch (p.kind) {
    case "hire": return { label: `Hire ${p.name}, off duty`, does: `Creates ${p.name} as v1, off duty, with only the read tools above, ${p.seatId ? `in the open ${p.seat} seat` : `in a new ${p.seat} seat`}. Nothing runs until you Try it and Go live.` };
    case "grant_tool": return { label: `Give ${p.agent} ${toolLabel(p.tool)}`, does: `Saves a draft version of ${p.agent} with ${toolLabel(p.tool)} added. What runs today doesn’t change until you Try it and Go live.` };
    case "new_tool": return { label: "Find a tool for it", does: "Opens Find a tool, where you pick how: a connection you already have, a server you add by its address, or an ask for a built-in connector. Nothing is granted to anyone until you do it in an agent’s sheet." };
    case "department": return { label: `Create ${p.draft.name}`, does: `Adds the ${p.draft.name} department with its head seat, creates ${[p.draft.head, ...p.draft.agents].filter(Boolean).map((x) => x!.name).join(" and ") || "no agents"} off duty with only the read tools shown, sets ${p.draft.goals.length} goal${p.draft.goals.length === 1 ? "" : "s"}, and logs a connection request for any source still missing. Nothing turns on.` };
    case "goal": return p.change === "new"
      ? { label: "Set this goal", does: "Adds the goal to its department, as if you set it on Goals. Code counts its measure; its head plans around it from the next run." }
      : p.change === "change"
        ? { label: "Change this goal", does: "Saves the change. A new measure starts its pace again from today." }
        : { label: GOAL_STATE_DOES[p.change].label, does: GOAL_STATE_DOES[p.change].does };
    case "change_agent": return { label: `Change ${p.agent}`, does: changesSpec(p)
      ? `Saves a draft version of ${p.agent} with ${changeWhat(p).filter((w) => w !== "when it runs" && w !== "daily budget").join(", ")} changed${p.when || p.budget != null ? `, and sets its ${[p.when ? "schedule" : "", p.budget != null ? "budget" : ""].filter(Boolean).join(" and ")} now` : ""}. The draft runs only after a clean try and Go live.`
      : `Sets ${p.agent}’s ${[p.when ? "schedule" : "", p.budget != null ? "daily budget" : ""].filter(Boolean).join(" and ")}, through the same checks as its sheet.` };
    case "move_agent": return { label: `Put ${p.agent} in ${p.department ?? "the department"}`, does: `Moves ${p.agent} ${p.seatId ? `into the open ${p.seat} seat` : "into a new seat under the head"} of ${p.department ?? "the department"}; its old seat, if it had one, opens. What it reads, can do, its budget and when it runs stay as they are.` };
    case "setup_finding": return { label: "Open it again", does: "Opens the finding again on Connections, with its click-by-click steps and any Fix it for me. Nothing in the tool changes, and any fix still waits on Approvals." };
    case "retire": return p.agentId
      ? { label: `Retire ${p.agent}`, does: `Takes ${p.agent} off duty and opens its seat. Its versions, runs and memory stay, and you can turn it back on.` }
      : { label: `Close the ${p.seat} seat`, does: `Removes the empty ${p.seat} seat from the chart.` };
  }
}

export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();
  const { id } = await params;
  const [pr, org, tz] = await Promise.all([getProposal(id), loadOrg().catch(() => null), orgTz()]);
  if (!pr || !org) notFound();
  const p = pr.payload;
  const members = pr.department_id ? agentsIn(org, pr.department_id) : [];
  const [names, spend, checks, bill] = await Promise.all([
    agentNames([...(pr.from_agent ? [pr.from_agent] : []), ...members]).catch(() => ({} as Record<string, string>)),
    monthSpendByAgent(members).catch(() => ({} as Record<string, number>)),
    pr.state === "pending" ? proposalChecks(pr, org).catch((e) => [{ ok: false, text: e instanceof Error ? e.message : String(e) }]) : Promise.resolve([]),
    billing(),
  ]);
  const dept = org.departments.find((d) => d.id === pr.department_id) ?? null;
  const fromName = pr.from_agent ? names[pr.from_agent] ?? pr.from_agent : pr.source === "claude" ? "Claude" : "You";
  const yes = yesDoes(p);
  const blocked = checks.some((c) => !c.ok);

  const detail: [string, React.ReactNode][] =
    p.kind === "hire" ? [
      ["Seat", p.seatId ? `${p.seat} (open)` : `${p.seat} (new)`],
      ["Job", p.job],
      ["Each run", p.eachRun],
      ["Good result", p.goodResult],
      ["Brain", BRAINS[p.brain].label],
      ["A month", (() => { const c = hireCost(p, bill); return `${monthWords(c.byHand)} (${costDetail(c.byHand)}). On a daily schedule, about ${costUsd(c.daily.month)} a month.`; })()],
      ["Reads", p.tools.map(toolLabel).join(", ")],
      ["Hands you", `A ${p.seat} result each run, up to ${HIRE_STEPS} steps`],
    ]
    : p.kind === "grant_tool" ? [["Teammate", p.agent], ["Tool", toolLabel(p.tool)]]
    : p.kind === "new_tool" ? [["What it reads", p.what]]
    : p.kind === "department" ? []
    : p.kind === "setup_finding" ? [["Tool", hasCheck(p.tile) ? CHECKS[p.tile].name : p.tile], ["Finding", p.title]]
    : p.kind === "change_agent" ? changeRows(p, toolLabel).map((r) => [r.k, r.to] as [string, string])
    : p.kind === "move_agent" ? [["Agent", p.agent], ["Now", p.fromDeptId ? org.departments.find((d) => d.id === p.fromDeptId)?.name ?? "Another department" : "No department"], ["Goes to", p.department ?? ""], ["Seat", p.seatId ? `${p.seat} (open)` : "A new seat under the head"]]
    : p.kind === "goal" ? [
      ["Department", dept?.name ?? ""],
      ["Change", p.change === "new" ? "A new goal" : p.change === "change" ? `Change “${p.goal}”` : `${GOAL_STATE_DOES[p.change].label}: “${p.goal}”`],
      ...(p.change !== "new" && p.change !== "change" ? [] : [
        ...(p.title ? [["Goal", p.title] as [string, string]] : []),
        ...(p.measure ? [["Measure", p.measure === "none" ? "None: words only" : p.measure] as [string, string]] : []),
        ...(p.target ? [["Target", p.target] as [string, string]] : []),
        ...(p.dueOn ? [["Due", p.dueOn] as [string, string]] : []),
      ]),
    ]
    : [[p.agentId ? "Agent" : "Seat", p.agent ?? p.seat ?? ""]];
  const deptView = p.kind === "department" ? await draftView(p.draft) : null;

  return (
    <>
      <div className="stack" style={{ gap: 8 }}>
        <span className="sub"><Link href="/approvals">Approvals</Link> › <Link href="/proposals">Proposals</Link> › {KIND_WORDS[pr.kind]}</span>
        <span className="sub">From {fromName}{dept ? ` · ${dept.name}` : ""} · {when(pr.created_at, tz)}{pr.state !== "pending" && pr.decided_at ? ` · decided ${when(pr.decided_at, tz)}` : ""}</span>
        <h1 className="h1">{pr.title}</h1>
      </div>

      <div className="card" style={{ gap: 10, borderLeft: "4px solid var(--acc)" }}>
        <span className="ted-k">Why · {fromName}’s words</span>
        <span style={{ fontSize: 14.5, lineHeight: 1.55, whiteSpace: "pre-wrap" }}>{pr.why}</span>
      </div>

      <div className="home-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 320px), 1fr))" }}>
        <div className="card" style={{ gap: 12 }}>
          <span className="card-t">{p.kind === "hire" ? "The job" : p.kind === "department" ? "The department" : "What it asks"}</span>
          {deptView ? <DraftBody v={deptView} /> : <Lines rows={detail} />}
        </div>
        <div className="card" style={{ gap: 12 }}>
          {pr.state === "pending" ? (
            <>
              <span className="card-t">What your yes does</span>
              <span style={{ fontSize: 13.5, lineHeight: 1.55 }}>{yes.does}</span>
              {p.kind === "hire" && (
                <span className="ink2" style={{ fontSize: 13, lineHeight: 1.5 }}>
                  {monthWords(hireCost(p, bill).byHand)}, at most {usd(BRAINS[p.brain].maxCostUsd)} a run.{dept ? ` ${dept.name} has spent ${usd(deptSpent(org, dept.id, spend))} on AI this month${dept.monthlyBudgetUsd != null ? ` of ${usd(dept.monthlyBudgetUsd)}` : ""}.` : ""}
                </span>
              )}
              <div className="row wrap" style={{ gap: 8 }}>
                <ActionButton className="btn primary" disabled={blocked} title={blocked ? "A check below failed. Change it first, or say not now." : undefined} action={proposalAccept.bind(null, pr.id)} follow={p.kind === "new_tool"}
                  confirm={{ title: `${yes.label}?`, body: yes.does, confirmLabel: yes.label, kind: "primary" }}>{yes.label}</ActionButton>
                {p.kind === "hire" && pr.department_id && <Link className="btn outline" href={`/dept/${pr.department_id}`}>Change it in the chat</Link>}
                <NotNowButton decline={proposalDecline.bind(null, pr.id)} headName={pr.from_agent ? fromName : null} />
              </div>
              <span className="card-t" style={{ marginTop: 6 }}>Checked in code</span>
              <div className="stack" style={{ gap: 6 }}>
                {checks.map((c) => <span key={c.text} className="row" style={{ gap: 8, fontSize: 13, alignItems: "flex-start" }}><span aria-hidden style={{ color: c.ok ? "var(--mint)" : "var(--red)", fontWeight: 700 }}>{c.ok ? "✓" : "✕"}</span><span>{c.text}</span></span>)}
              </div>
              <span className="muted" style={{ fontSize: 11.5 }}>Checked again when you tap, against the chart and the tool list as they are then.</span>
            </>
          ) : (
            <>
              <span className="card-t">Decided</span>
              <span style={{ fontSize: 13.5, lineHeight: 1.55 }}>{pr.outcome ?? pr.state}</span>
              {pr.kind === "new_tool" && pr.state === "accepted" && <Link href={`/connections/find?for=${pr.id}`}>Find a tool for it ›</Link>}
              {pr.result_ref && pr.kind === "department" && <Link href="/crew">See it on the org chart ›</Link>}
              {pr.result_ref && pr.kind !== "new_tool" && pr.kind !== "department" && <Link href={`/agents/${pr.result_ref}`}>Open {names[pr.result_ref] ?? "the agent"} ›</Link>}
            </>
          )}
        </div>
      </div>
    </>
  );
}
