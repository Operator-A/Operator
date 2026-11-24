// The org chart on Company > Departments (department pages slice 11; was Crew's Canvas and Edit chart). Chart is the
// living canvas (docs/crew-canvas.md), read only; Edit is the structured chart for seats and who sits where (docs/org-chart.md).
import type { Floor } from "@/dashboard/data";
import { canvasData, deptExtras, orgView, placeDepts } from "@/dashboard/org";
import { listProposals, proposalsBySeat } from "@/core/proposals";
import { orgAddDepartment, orgAddSeat, orgEditSeat, orgPlaceAgent, orgRemoveSeat, orgSetHolder } from "@/dashboard/orgActions";
import { loadFlow } from "@/core/flow";
import { NotInDepartment } from "./placeAgent";
import { OrgCanvas } from "./OrgCanvas";
import { OrgChart } from "./OrgChart";

const NO_ORG = "The org chart tables aren’t up to date: apply the org chart migrations (20261115090000_org_chart.sql, 20261116090000_department_budgets.sql).";

export async function OrgChartPane({ f, edit }: { f: Floor; edit: boolean }) {
  const org = f.chart; // read once with the floor (card 302)
  if (!org) return <div className="card"><span className="sub">{NO_ORG}</span></div>;
  // the canvas also draws hand-offs, from the chains that are on; without the flow it draws none
  const [extras, pending, flow] = await Promise.all([deptExtras(org), listProposals(["pending"]).catch(() => null), edit ? null : loadFlow(f.palette).catch(() => null)]);
  const v = orgView(f, org, extras, pending ? proposalsBySeat(org, pending) : {});
  if (edit) return (
    <OrgChart
      v={v}
      actions={{
        addDept: orgAddDepartment, addSeat: orgAddSeat, editSeat: orgEditSeat, removeSeat: orgRemoveSeat, setHolder: orgSetHolder,
      }}
      notInDept={<NotInDepartment agents={v.offChart} depts={placeDepts(org)} place={orgPlaceAgent} />}
    />
  );
  return (
    <>
      {v.problems.length > 0 && <div className="card" style={{ borderLeft: "4px solid var(--red)", gap: 4 }}>{v.problems.map((p) => <span key={p} style={{ fontSize: 13 }}>{p}</span>)}</div>}
      <OrgCanvas d={canvasData(f, v, flow?.flow.chains ?? [])} />
      <NotInDepartment agents={v.offChart} depts={placeDepts(org)} place={orgPlaceAgent} />
    </>
  );
}
