import Link from "next/link";
import { Suspense } from "react";
import { SkelPane } from "@/dashboard/components/skeletons";
import { IntentLink } from "@/dashboard/components/intentLink";
import { previewChain, rollBackFlow, runChainNow, saveCrewFlow, setAgentTime, setEnabled, turnOffOrg, turnOrgBackOn } from "@/dashboard/actions";
import { orgDay } from "@/dashboard/orgDay";
import { OrgDay } from "@/dashboard/components/OrgDay";
import { planOrgOn } from "@/dashboard/orgPlan";
import { OrgSwitch } from "@/dashboard/components/OrgSwitch";
import { getCrewCanvas, getFloor } from "@/dashboard/data";
import { canvasData, deptExtras, orgView } from "@/dashboard/org";
import { goalsByDept } from "@/dashboard/goals";
import { listProposals, proposalsBySeat } from "@/core/proposals";
import { GOALS_MISSING } from "@/core/goals";
import { orgAddDepartment, orgAddDeptRule, orgAddSeat, orgEditDeptRule, orgEditSeat, orgForgetDeptRule, orgRemoveDepartment, orgRemoveSeat, orgRenameDepartment, orgSetDeptBudget, orgSetDeptEmails, orgSetHolder, orgSetLeadChecks } from "@/dashboard/orgActions";
import { controlsOn } from "@/dashboard/session";
import { loadFlow } from "@/core/flow";
import { AgentCard } from "@/dashboard/components/orgBits";
import { OrgCanvas } from "@/dashboard/components/OrgCanvas";
import { CrewCanvas } from "@/dashboard/components/CrewCanvas";
import { Icon } from "@/dashboard/components/Icon";
import { OrgChart } from "@/dashboard/components/OrgChart";

// Crew has three views. Canvas (docs/crew-canvas.md): the org chart as a living thing, read only,
// where you open a department to see what its agents are doing. Edit chart (docs/org-chart.md):
// the structured chart for seats, budgets and rules. Schedule (docs/org-schedule.md): the org
// switch and the chains, the one place a schedule is turned on. New agent opens the builder flow.

// Preview dry-runs up to three agents in a row. (Goals read Shopify or Mercury when the chart opens.)
export const maxDuration = 300;

const VIEWS = { canvas: ["/crew", "Canvas"], edit: ["/crew?view=edit", "Edit chart"], schedule: ["/crew?view=schedule", "Schedule"] } as const;
const SUBS = {
  canvas: "Your agents by department. Open a department to see what each agent is doing and how work moves between them.",
  edit: "Add and rename seats and departments, pick who sits where, and set each department’s budget and rules.",
  schedule: "When your org works, what it costs, and when you hear from it.",
};

export default async function Crew({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const q = (await searchParams).view;
  const view = q === "schedule" || q === "edit" ? q : "canvas";
  const f = await getFloor();
  return (
    <>
      <div className="row wrap" style={{ gap: 12, alignItems: "flex-end" }}>
        <div className="stack" style={{ gap: 6, flex: "1 1 320px" }}>
          <h1 className="h1">Crew</h1>
          <span className="sub">{SUBS[view]}</span>
        </div>
        <Link href="/build/new" className="btn dark"><Icon name="user-plus" size={15} />New agent</Link>
      </div>
      <nav className="seg" aria-label="Crew view">
        {(Object.keys(VIEWS) as (keyof typeof VIEWS)[]).map((k) => <IntentLink key={k} href={VIEWS[k][0]} className={view === k ? "on" : ""} aria-current={view === k ? "page" : undefined}>{VIEWS[k][1]}</IntentLink>)}
      </nav>
      {/* the chart's goal numbers are read from the tools: the title and views draw at once, the chart streams in (card 303) */}
      <Suspense key={view} fallback={<SkelPane />}>{view === "schedule" ? <Schedule f={f} /> : <Chart f={f} edit={view === "edit"} />}</Suspense>
    </>
  );
}

const NO_ORG = "The org chart tables aren’t up to date: apply the org chart migrations (20261115090000_org_chart.sql, 20261116090000_department_budgets.sql).";

async function Chart({ f, edit }: { f: Awaited<ReturnType<typeof getFloor>>; edit: boolean }) {
  const org = f.chart; // read once with the floor (card 302)
  if (!org) return <div className="card"><span className="sub">{NO_ORG}</span></div>;
  // the canvas also draws hand-offs, from the chains that are on; without the flow it draws none
  const [extras, goals, pending, flow] = await Promise.all([deptExtras(org), goalsByDept(org), listProposals(["pending"]).catch(() => null), edit ? null : loadFlow(f.palette).catch(() => null)]);
  const v = orgView(f, org, extras, goals, pending ? proposalsBySeat(org, pending) : {});
  if (edit) return (
    <OrgChart
      v={v}
      controls={controlsOn()}
      actions={{
        addDept: orgAddDepartment, renameDept: orgRenameDepartment, removeDept: orgRemoveDepartment, addSeat: orgAddSeat, editSeat: orgEditSeat, removeSeat: orgRemoveSeat, setHolder: orgSetHolder,
        setBudget: orgSetDeptBudget, setEmails: orgSetDeptEmails, addRule: orgAddDeptRule, editRule: orgEditDeptRule, forgetRule: orgForgetDeptRule, setLeadChecks: orgSetLeadChecks,
      }}
    />
  );
  return (
    <>
      {goals == null && <div className="card"><span className="sub">{GOALS_MISSING}</span></div>}
      {v.problems.length > 0 && <div className="card" style={{ borderLeft: "4px solid var(--red)", gap: 4 }}>{v.problems.map((p) => <span key={p} style={{ fontSize: 13 }}>{p}</span>)}</div>}
      <OrgCanvas d={canvasData(f, v, flow?.flow.chains ?? [])} />
      {v.offChart.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <span className="card-t">Not on the chart yet</span>
          <span className="ink2" style={{ fontSize: 13 }}>Put one in a seat with <Link href="/crew?view=edit">Edit chart</Link>, or from step 1 when you edit it.</span>
          <div className="crew-grid">{v.offChart.map((a) => <AgentCard key={a.id} a={a} />)}</div>
        </div>
      )}
    </>
  );
}

async function Schedule({ f }: { f: Awaited<ReturnType<typeof getFloor>> }) {
  const [d, org] = [await getCrewCanvas(f), f.chart];
  const members = f.crew.map((a) => ({ id: a.id, name: a.name, inOrg: a.inOrg !== false, perRun: a.perRun ?? null }));
  const plan = planOrgOn(members, d.flow.chains, f.now, f.tz);
  const day = orgDay({
    members: f.crew,
    enabled: Object.fromEntries(Object.values(f.agents).map((x) => [x.id, x.enabled])),
    budget: Object.fromEntries(Object.values(f.agents).map((x) => [x.id, x.daily_budget_usd])),
    grants: f.grants, org, now: f.now, tz: f.tz,
  });
  return (
    <>
      <OrgSwitch tz={f.tz} org={f.org} plan={plan} controls={controlsOn()} turnOn={turnOrgBackOn} turnOff={turnOffOrg} />
      <OrgDay day={day} controls={controlsOn()} orgOn={f.org.on} setTime={setAgentTime} setOn={setEnabled} />
      <details className="card" style={{ gap: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 14.5, fontWeight: 600 }}>Edit chains: hand-offs between agents</summary>
        <span className="ink2" style={{ fontSize: 13, lineHeight: 1.55 }}>
          For more than a time: one agent after another, checks on numbers, waits and hand-offs. Chains run only while the org is on, and a chain never turns an agent on.
          Every step still checks that its agent is on duty and under its daily budget; a skipped step stops the chain.
          The next agent only gets facts from the one before (its summary and numbers), never instructions, and nothing an email or web page says can choose what runs.
        </span>
        <CrewCanvas d={d} actions={{ save: saveCrewFlow, rollBack: rollBackFlow, runNow: runChainNow, preview: previewChain }} />
      </details>
    </>
  );
}
