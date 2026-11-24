// Chains drafted from Claude (card 435, docs/chains.md): what a draft from OPERATOR's MCP server (draft_chain) may
// hold, what it changes against the saved chain, and when it is too old to use. Pure: no database, no network, so
// `npm run check:mcp-chains` tests it. core/chain-drafts.ts keeps drafts; the owner uses one in OPERATOR through the
// Chains tab's own Save (saveChain), with its checks and its confirm, or discards it.
//
// A draft changes nothing by itself. It never turns a chain on: a new chain is drafted off, and a changed chain keeps
// whether it is on as saved. It is checked by the same rules as the Save button (core/chain-save.ts chainInFlow).
import type { Chain, Step } from "@/core/flow-rules";
import { stepWords, type ChainNames } from "@/core/chain-view-rules";
import { startWords } from "@/dashboard/chain-rules";

export const CHAIN_DRAFT = {
  /** Days a draft waits to be used before the scheduler deletes it. */
  keepDays: 14,
  /** The chain as JSON text, as Claude sends it. */
  chainChars: 16_000,
  noteMax: 300,
  /** Drafts a business may have waiting at once. */
  maxWaiting: 10,
} as const;

/** Claude's chain, read: whether it is new, and the chain as it would be saved (on as saved, or off when new). */
export function readDraftChain(text: string, saved: readonly Chain[]): { chain: Chain; base: Chain | null } | { problem: string } {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { problem: "chain must be one chain as JSON, as list_chains gives it under saved." }; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { problem: "chain must be one chain (an object), as list_chains gives it under saved." };
  const c = raw as Partial<Chain>;
  if (typeof c.key !== "string" || !c.key.trim()) return { problem: "the chain needs a key: an existing chain's key to change it, or a new short key (lowercase letters, digits and dashes) for a new one." };
  if (!Array.isArray(c.steps) || !c.steps.length) return { problem: "the chain needs at least one step." };
  const base = saved.find((x) => x.key === c.key) ?? null;
  // turning a chain on is a person's tap in OPERATOR: a draft keeps it as it is
  return { chain: { ...(c as Chain), on: base ? base.on : false }, base };
}

/** Whether the saved chain changed since the draft was made from it (or a new chain's key was taken meanwhile). */
export function draftStale(base: Chain | null, now: Chain | null): boolean {
  return JSON.stringify(base) !== JSON.stringify(now);
}

const stepLine = (s: Step, n: ChainNames) => { const w = stepWords(s, n); return w.kind === "agent" || w.kind === "claude" ? `${w.what} (${w.runs})` : w.what; };

/** What a draft changes, line by line, for the owner to read before using it. */
export function draftChanges(base: Chain | null, next: Chain, n: ChainNames): string[] {
  const start = (c: Chain) => startWords(c.start, n);
  if (!base) {
    return [`New chain “${next.name}”, saved off: it runs only with Run chain until you turn it on`, `Starts: ${start(next)}`, ...next.steps.map((s, k) => `Step ${k + 1}: ${stepLine(s, n)}`)];
  }
  const out: string[] = [];
  if (base.name !== next.name) out.push(`Name: “${base.name}” → “${next.name}”`);
  if (start(base) !== start(next)) out.push(`Start: ${start(base)} → ${start(next)}`);
  if (JSON.stringify(base.owner ?? null) !== JSON.stringify(next.owner ?? null)) out.push("Owner changes");
  const len = Math.max(base.steps.length, next.steps.length);
  for (let k = 0; k < len; k++) {
    const a = base.steps[k], b = next.steps[k];
    if (a && !b) out.push(`Step ${k + 1} removed: ${stepLine(a, n)}`);
    else if (!a && b) out.push(`Step ${k + 1} added: ${stepLine(b, n)}`);
    else if (JSON.stringify(a) !== JSON.stringify(b)) out.push(stepLine(a!, n) === stepLine(b!, n) ? `Step ${k + 1}: ${stepLine(b!, n)}, its conditions or settings change` : `Step ${k + 1}: ${stepLine(a!, n)} → ${stepLine(b!, n)}`);
  }
  return out.length ? out : ["Nothing changes from the saved chain"];
}
