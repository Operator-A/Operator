// Wait for my OK, a quick chain step (chains slice 3, docs/chains.md). Pure: when a hold is due, which department's
// Approvals tab shows it, what the card says, and whether a decision still applies. No database, no network, so
// `npm run check:ok` tests it; core/chain-ok.ts keeps the rows and goes on with the chain.
//
// The step runs nothing and costs nothing. It shows the step before's result (data, cut in code) to an approver and
// holds the chain: approve goes on to the next step, which gets the step before's result as if the OK weren't there;
// reject stops the chain; no answer within OK.days stops it too. Only a person's tap moves it: never a model, a
// run's output or another chain.
import { chainOwner, OK, stepName, type Chain } from "@/core/flow-rules";

export type OkStatus = "pending" | "approved" | "rejected" | "expired";
export type OkDecision = "approve" | "reject";

/** What the card shows of the step before: who, how it ended, its words and numbers. Data, never instructions. */
export interface OkFacts { from: string; status: string; summary: string; metrics: Record<string, number> }

/** When a hold made at `now` stops waiting. */
export const okDue = (now: number) => now + OK.days * 864e5;

/** The facts kept on the row, cut in code: at most 1,500 characters of summary and 12 numbers. */
export function keepFacts(f: OkFacts | null): OkFacts {
  if (!f) return { from: "", status: "", summary: "", metrics: {} };
  const metrics = Object.fromEntries(Object.entries(f.metrics ?? {}).filter(([, v]) => typeof v === "number" && Number.isFinite(v)).slice(0, 12).map(([k, v]) => [k.slice(0, 40), v]));
  return { from: String(f.from ?? "").slice(0, 80), status: String(f.status ?? "").slice(0, 20), summary: String(f.summary ?? "").slice(0, 1500), metrics };
}

/** The department whose Approvals tab shows a hold: the chain's own, or its owner agent's (null: the company's). */
export function okDept(c: Chain, deptOfAgent: (agent: string) => string | null): string | null {
  const o = chainOwner(c);
  if (!o) return null;
  return "dept" in o ? o.dept : deptOfAgent(o.agent);
}

/**
 * Whether a decision still applies to the saved chain: the chain is still there and the held step is still a Wait for
 * my OK. A chain edited since may have moved its steps, so a stale hold never starts the wrong step.
 */
export function okStillHolds(c: Chain | undefined, step: number): string | null {
  if (!c) return "That chain isn’t saved any more, so nothing ran.";
  if (!c.steps[step]?.ok) return `${c.name} changed since this card was made, so nothing ran. Run the chain again to get a fresh card.`;
  return null;
}

/** One hold as the Approvals tab shows it. */
export interface OkCard {
  id: string; chain: string; chainName: string; step: number; steps: number; note: string | null;
  facts: OkFacts; fromName: string; next: string | null; dept: string | null; createdAt: string; dueAt: string;
  /** A short signed link to the picture the step before made (a Make an image step, chains slice 4), when it made one. */
  image?: string | null;
}

/** The card for a pending row, from the saved chain (null when the chain or the step is gone, so it isn't shown as live). */
export function okCard(row: { id: string; chain_key: string; step: number; facts: unknown; department_id: string | null; created_at: string; due_at: string }, c: Chain | undefined, nameOf: (agent: string) => string): OkCard | null {
  if (okStillHolds(c, row.step)) return null;
  const st = c!.steps[row.step], before = c!.steps[row.step - 1], nx = c!.steps[row.step + 1];
  const facts = keepFacts(row.facts as OkFacts);
  const label = (s: typeof st) => (s.agent ? nameOf(s.agent) : stepName(s));
  return {
    id: row.id, chain: c!.key, chainName: c!.name, step: row.step, steps: c!.steps.length, note: st.ok?.note?.trim() || null,
    facts, fromName: before ? label(before) : facts.from, next: nx ? label(nx) : null, dept: row.department_id, createdAt: row.created_at, dueAt: row.due_at,
  };
}

/** Where the card's chain is edited: its department's Chains tab, or Settings > Schedule for a company chain. */
export const okChainHref = (c: Pick<OkCard, "chain" | "dept">) =>
  c.dept ? `/dept/${encodeURIComponent(c.dept)}?tab=chains&chain=${encodeURIComponent(c.chain)}` : `/settings/schedule?chain=${encodeURIComponent(c.chain)}#chains`;

/** What the approver is told after a tap. */
export function okDoneWords(d: OkDecision, chainName: string, then: string | null): string {
  return d === "approve" ? `Approved. ${then ?? `${chainName} goes on.`}` : `Rejected. ${chainName} stops here.`;
}

/** "in 2 days", "in 5 hours", "in 20 minutes": how long a card has left. */
export function leftWords(dueAt: string, now = Date.now()): string {
  const ms = Date.parse(dueAt) - now;
  if (!(ms > 0)) return "now";
  const h = ms / 36e5;
  if (h >= 48) return `in ${Math.floor(h / 24)} days`;
  if (h >= 2) return `in ${Math.floor(h)} hours`;
  const m = Math.max(1, Math.round(ms / 6e4));
  return m >= 60 ? "in 1 hour" : `in ${m} minute${m === 1 ? "" : "s"}`;
}
