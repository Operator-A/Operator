import "server-only";
// A department's settings on its page (docs/department-pages.md, slice 7): reads the department and binds the
// same owner-only actions Crew's department editor used, so every check stays where it was.
import { DEPT_BUDGET_CEILING, LEAD_REVIEW_HOURS, deptSpent, headOf, type Org } from "@/core/org-rules";
import { deptExtras } from "@/dashboard/org";
import { orgAddDeptRule, orgForgetDeptRule, orgRemoveDepartment, orgRenameDepartment, orgSetDeptBudget, orgSetDeptEmails, orgSetLeadChecks } from "@/dashboard/orgActions";
import { DeptSettings } from "./deptSettings";
import { packOffer } from "@/core/pack-install";
import { savePackDrafts } from "@/dashboard/packActions";

export async function DeptSettingsFor({ chart, id, closeHref, names }: { chart: Org; id: string; closeHref: string; names: Record<string, string> }) {
  const dept = chart.departments.find((d) => d.id === id);
  if (!dept) return null;
  const [x, offer] = await Promise.all([deptExtras(chart), packOffer(id).catch(() => null)]);
  const seats = chart.seats.filter((s) => s.departmentId === id);
  const head = headOf(chart, id);
  const agents = seats.filter((s) => s.holder === "agent" && s.agentId).map((s) => names[s.agentId as string] ?? (s.agentId as string));
  return (
    <DeptSettings key={id} closeHref={closeHref} d={{
      id, name: dept.name, head: head?.holder === "agent" && head.agentId ? names[head.agentId] ?? null : null,
      budget: dept.monthlyBudgetUsd, spent: deptSpent(chart, id, x.spend), ceiling: DEPT_BUDGET_CEILING,
      emails: dept.maxEmailsPerDay, companyEmails: x.companyEmails, leadChecks: dept.leadChecksDrafts, reviewHours: LEAD_REVIEW_HOURS,
      rules: x.rules.filter((r) => r.departmentId === id).map((r) => ({ id: r.id, text: r.text })),
      removable: seats.every((s) => s.holder === "open"), agents,
      offer: offer && { to: offer.to, name: offer.name, lines: offer.lines, warns: offer.warns, drafts: offer.drafts.length },
    }} act={{
      rename: orgRenameDepartment.bind(null, id), budget: orgSetDeptBudget.bind(null, id), emails: orgSetDeptEmails.bind(null, id),
      leadChecks: orgSetLeadChecks.bind(null, id), addRule: orgAddDeptRule.bind(null, id), forgetRule: orgForgetDeptRule, remove: orgRemoveDepartment.bind(null, id), savePack: savePackDrafts.bind(null, id),
    }} />
  );
}
