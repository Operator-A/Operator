import "server-only";
// Setup step 3, "Your company" (card 153): the chart's data, from the templates, Avery's leaning, the
// connected tools and each agent's estimated cost. The rules are in core/company-rules.ts.
import { TEMPLATES } from "@/core/templates";
import { TOOLS } from "@/core/tools/catalog";
import { SETUP_TEMPLATE, type Leaning } from "@/core/setup-rules";
import { agentsOf, companyDepts, type CompanyAgent, type CompanyDept } from "@/core/company-rules";
import type { Template } from "@/core/template-rules";
import type { MonthCost } from "@/core/cost-rules";
import type { ToolTileId } from "@/core/tools-step-rules";
import { monthCostOf } from "./cost";
import { waitingByTemplate } from "./toolsStep";

export const toolLabel = (id: string) => (TOOLS as Record<string, { label?: string }>)[id]?.label ?? id;

/** An agent's month on the template's schedule, from its estimate: none of them has run yet. */
export function costOf(t: Template, agentId: string, runsPerMonth: number): MonthCost {
  const s = (t.specs as Record<string, { model?: string; effort?: string; tools?: string[]; limits?: { maxSteps?: number; maxCostUsd?: number } }>)[agentId] ?? {};
  return monthCostOf({ model: s.model ?? "", effort: s.effort, tools: s.tools ?? [], maxSteps: s.limits?.maxSteps, maxCostUsd: s.limits?.maxCostUsd }, null, runsPerMonth);
}

export interface CompanyChartData { company: CompanyAgent[]; depts: CompanyDept[] }

/** The chart: the company seat (the Chief of Staff) and a branch per department template. */
export function companyChart(leaning: readonly Leaning[], connected: ReadonlySet<ToolTileId>): CompanyChartData {
  const setup = TEMPLATES.find((t) => t.id === SETUP_TEMPLATE);
  return {
    company: setup ? agentsOf(setup, { toolLabel, costOf }) : [],
    depts: companyDepts(TEMPLATES, { leaning, setupTemplate: SETUP_TEMPLATE, toolLabel, costOf, waitsOn: waitingByTemplate(connected) }),
  };
}
