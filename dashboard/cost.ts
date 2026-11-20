import "server-only";
// What an agent costs, for the Control Room (card 155): the rules in core/cost-rules.ts fed with the
// price list and the business's billing. Every screen that shows a cost reads it from here.
import { estimateRun, monthCost, runCost, type Billing, type Effort, type MonthCost, type RealCost, type RunCost } from "@/core/cost-rules";
import { modelDef } from "@/integrations/models";
import { DAY_RUNS } from "@/core/flow-rules";
import { BRAINS, HIRE_STEPS, type Brain } from "@/core/proposal-rules";
import { billingNow } from "@/integrations/anthropic";

/**
 * Who pays for this business's runs: its own Claude key, or managed credits on the hosted edition
 * when it has none (card 128 slice 4). A page reads it once and hands it to every cost it shows.
 */
export const billing = (): Promise<Billing> => billingNow().catch(() => "own_key" as const);

/** The parts of a spec the estimate reads, as saved (unknown fields fall back to safe defaults). */
export interface CostSpec { model: string; effort?: string; tools: readonly string[]; maxSteps?: number; maxCostUsd?: number }

const effortOf = (e: unknown): Effort => (e === "low" || e === "high" ? e : "medium");

/** One run's estimate from the model's price, or null for a model with no price. */
export function estimateOf(s: CostSpec): number | null {
  const m = modelDef(s.model);
  return estimateRun({ effort: effortOf(s.effort), tools: s.tools, limits: { maxSteps: s.maxSteps ?? 12, maxCostUsd: s.maxCostUsd ?? Infinity } }, m ? { in: m.in, out: m.out } : null);
}

/** A run's cost: real runs when there are enough, else the estimate. */
export const runCostOf = (s: CostSpec, real: RealCost | null): RunCost => runCost(real, estimateOf(s));

/** A month's cost at this many runs a month (0 by hand). */
export const monthCostOf = (s: CostSpec, real: RealCost | null, runsPerMonth: number, bill: Billing): MonthCost =>
  monthCost({ run: runCostOf(s, real), cap: s.maxCostUsd ?? null, runsPerMonth, billing: bill });

/** What a proposed hire would cost (card 155): its brain, its tools and the hire step limit. A new agent runs only by hand until it's scheduled. */
export function hireCost(p: { brain: Brain; tools: readonly string[] }, bill: Billing): { byHand: MonthCost; daily: MonthCost } {
  const b = BRAINS[p.brain];
  const spec: CostSpec = { model: b.model, effort: b.effort, tools: p.tools, maxSteps: HIRE_STEPS, maxCostUsd: b.maxCostUsd };
  return { byHand: monthCostOf(spec, null, 0, bill), daily: monthCostOf(spec, null, DAY_RUNS.daily, bill) };
}
