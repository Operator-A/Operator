import "server-only";
// Setup step 3, "Your company" (card 153): the chart's data, from the templates, Avery's leaning, the
// connected tools and each agent's estimated cost. The rules are in core/company-rules.ts.
import { TEMPLATES } from "@/core/templates";
import { TOOLS } from "@/core/tools/catalog";
import { SETUP_TEMPLATE, type Leaning } from "@/core/setup-rules";
import { agentsOf, bespokeDept, companyDepts, type CompanyAgent, type CompanyDept } from "@/core/company-rules";
import { pickId, type Design } from "@/core/design-rules";
import { peopleOf, type DraftPerson } from "@/core/department-rules";
import { hireSpec } from "@/core/proposal-rules";
import type { TemplateTools } from "@/core/tools-step-rules";
import type { Template } from "@/core/template-rules";
import type { Billing, MonthCost } from "@/core/cost-rules";
import type { ToolTileId } from "@/core/tools-step-rules";
import { monthCostOf } from "./cost";
import { waitingByTemplate, waitingForTools } from "./toolsStep";

export const toolLabel = (id: string) => (TOOLS as Record<string, { label?: string }>)[id]?.label ?? id;

/** An agent's month on the template's schedule, from its estimate (none of them has run yet), for this billing. */
export const costsFor = (bill: Billing) => (t: Template, agentId: string, runsPerMonth: number): MonthCost => {
  const s = (t.specs as Record<string, { model?: string; effort?: string; tools?: string[]; limits?: { maxSteps?: number; maxCostUsd?: number } }>)[agentId] ?? {};
  return monthCostOf({ model: s.model ?? "", effort: s.effort, tools: s.tools ?? [], maxSteps: s.limits?.maxSteps, maxCostUsd: s.limits?.maxCostUsd }, null, runsPerMonth, bill);
};

export interface CompanyChartData { company: CompanyAgent[]; depts: CompanyDept[] }

/** The chart: the company seat (the Chief of Staff) and a branch per department template. */
export function companyChart(leaning: readonly Leaning[], designs: readonly Design[], connected: ReadonlySet<ToolTileId>, bill: Billing, waitNotes: Readonly<Record<string, string>> = {}, waitKinds: Readonly<Record<string, "guide" | "export">> = {}): CompanyChartData {
  const costOf = costsFor(bill);
  const setup = TEMPLATES.find((t) => t.id === SETUP_TEMPLATE);
  // a bespoke person's cost from the spec a hire gets (core/proposal-rules.ts hireSpec): by hand, so per run
  const personCost = (p: DraftPerson): MonthCost => { const s = hireSpec({ kind: "hire", ...p }); return monthCostOf({ model: s.model, effort: s.effort, tools: s.tools, maxSteps: s.limits.maxSteps, maxCostUsd: s.limits.maxCostUsd }, null, 0, bill); };
  const bespoke = designs.filter((d) => !d.kit).map((d) => bespokeDept(d, { toolLabel, costOf: personCost, waitsOn: waitingForTools(designTools(d), connected), waitNotes, waitKinds }));
  const templates = companyDepts(TEMPLATES, { leaning, designs, setupTemplate: SETUP_TEMPLATE, toolLabel, costOf, waitsOn: waitingByTemplate(connected), waitNotes, waitKinds });
  // Avery's sketch first, in her order; the rest of the list after it, to add by hand
  const order = designs.map(pickId);
  const all = [...bespoke, ...templates];
  return {
    company: setup ? agentsOf(setup, { toolLabel, costOf }) : [],
    depts: [...order.map((id) => all.find((d) => d.id === id)).filter((d): d is CompanyDept => !!d), ...all.filter((d) => !order.includes(d.id))],
  };
}

/** A bespoke department’s tools, read like a template’s. */
export const designTools = (d: Design): TemplateTools => ({ id: pickId(d), name: d.name, tools: d.draft ? [...new Set(peopleOf(d.draft).flatMap((p) => p.tools))] : [] });
