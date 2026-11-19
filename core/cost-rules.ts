// What an agent costs, worked out in code (card 155, docs/usage.md "What an agent costs"): a run's
// cost from its real runs once it has a few, from an estimate before that, and a month's cost from
// its schedule. Every proposal, setup's company chart, the org's day, the org switch and the builder
// read it from here. Pure: no database, so `npm run check:cost` can test it. Never a model's number.

export type Effort = "low" | "medium" | "high";
/** Dollars a token in and out (integrations/models.ts). */
export interface Price { in: number; out: number }

/** Output tokens a turn, by effort. */
export const OUT_TOKENS: Record<Effort, number> = { low: 500, medium: 900, high: 1500 };

/**
 * A rough guide to one run before it has any real runs: a turn per tool call plus a wrap-up, each
 * turn re-reading what came before, never more than its cap. Null for a model with no price.
 */
export function estimateRun(spec: { effort: Effort; tools: readonly string[]; limits: { maxSteps: number; maxCostUsd: number } }, price: Price | null): number | null {
  if (!price) return null;
  const turns = Math.min(spec.limits.maxSteps, Math.max(1, spec.tools.length)) + 1;
  let usd = 0;
  for (let i = 0; i < turns; i++) usd += (2500 + 1200 * i) * price.in + (OUT_TOKENS[spec.effort] ?? OUT_TOKENS.medium) * price.out;
  return Math.min(usd, spec.limits.maxCostUsd);
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Real runs it takes before their average replaces the estimate, and how many recent ones count. */
export const MIN_REAL_RUNS = 3;
export const REAL_RUNS = 20;

export interface RealCost { count: number; avg: number }

/**
 * The average of an agent's last REAL_RUNS real runs (finished, not a try), newest first as given.
 * Null until it has MIN_REAL_RUNS of them.
 */
export function realCost(runs: readonly { agent_id: string; status: string; trigger: string; cost_usd: number }[], id: string): RealCost | null {
  const real = runs.filter((r) => r.agent_id === id && r.status === "ok" && r.trigger !== "preview").slice(0, REAL_RUNS);
  if (real.length < MIN_REAL_RUNS) return null;
  return { count: real.length, avg: r6(real.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0) / real.length) };
}

export type CostBasis = "real" | "estimate" | "unknown";
export interface RunCost { perRun: number | null; basis: CostBasis; runs: number }

/** A run's cost: its real average when it has one, else the estimate, else unknown. */
export function runCost(real: RealCost | null, estimate: number | null): RunCost {
  if (real) return { perRun: real.avg, basis: "real", runs: real.count };
  if (estimate != null) return { perRun: estimate, basis: "estimate", runs: 0 };
  return { perRun: null, basis: "unknown", runs: 0 };
}

/** Who pays: the business's own Claude key, or OPERATOR credits (card 128, slice 4) at cost plus the margin. */
export type Billing = "own_key" | "credits";
export const CREDITS_MARGIN = 1.2;
export const BILLING_WORDS: Record<Billing, string> = { own_key: "billed by Anthropic to your key", credits: "on your OPERATOR credits" };

export interface MonthCost {
  /** What the founder pays a run (margin included on credits); null when unknown. */
  perRun: number | null;
  /** The most a run can cost: its cap, margin included on credits. */
  atMostPerRun: number | null;
  runsPerMonth: number;
  /** perRun × runs a month; 0 by hand or when unknown. */
  month: number;
  /** atMostPerRun × runs a month. */
  atMost: number | null;
  basis: CostBasis;
  /** Real runs behind the number (0 for an estimate). */
  runs: number;
  billing: Billing;
}

/** A month's cost on a schedule (runsPerMonth from core/flow-rules.ts DAY_RUNS, 0 by hand). */
export function monthCost(o: { run: RunCost; cap: number | null; runsPerMonth: number; billing: Billing }): MonthCost {
  const k = o.billing === "credits" ? CREDITS_MARGIN : 1;
  const perRun = o.run.perRun == null ? null : r6(o.run.perRun * k);
  const atMostPerRun = o.cap == null ? null : r6(o.cap * k);
  const n = Math.max(0, Math.floor(o.runsPerMonth));
  return {
    perRun, atMostPerRun, runsPerMonth: n,
    month: perRun == null ? 0 : r6(perRun * n),
    atMost: atMostPerRun == null ? null : r6(atMostPerRun * n),
    basis: o.run.basis, runs: o.run.runs, billing: o.billing,
  };
}

/** "$0.18", "$0.006", "under $0.001". */
export function usd(v: number): string {
  if (v > 0 && v < 0.001) return "under $0.001";
  return v < 0.01 && v > 0 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`;
}

export const basisWords = (c: Pick<MonthCost, "basis" | "runs">): string =>
  c.basis === "real" ? `from ${c.runs} real runs` : c.basis === "estimate" ? "estimate, no runs yet" : "its model has no price";

/** The headline: "About $0.18 a month" or "$0 a month: by hand, about $0.92 each time". */
export function monthWords(c: MonthCost): string {
  if (c.perRun == null) return "Cost unknown";
  if (!c.runsPerMonth) return `$0 a month: runs only when you press Run, about ${usd(c.perRun)} each time`;
  return `About ${usd(c.month)} a month`;
}

/** The detail under it: "at most $22.50 · from 6 real runs · billed by Anthropic to your key". */
export function costDetail(c: MonthCost): string {
  const most = c.runsPerMonth ? c.atMost : c.atMostPerRun;
  return [most != null ? `at most ${usd(most)}${c.runsPerMonth ? "" : " a run"}` : null, basisWords(c), BILLING_WORDS[c.billing]].filter(Boolean).join(" · ");
}

/** Sums for a chart or a plan: the month, the most, and who has no known cost. */
export function totalCost(items: readonly { name: string; cost: MonthCost }[]): { month: number; atMost: number; unknown: string[] } {
  return {
    month: r6(items.reduce((s, i) => s + i.cost.month, 0)),
    atMost: r6(items.reduce((s, i) => s + (i.cost.atMost ?? 0), 0)),
    unknown: items.filter((i) => i.cost.perRun == null && i.cost.runsPerMonth > 0).map((i) => i.name),
  };
}
