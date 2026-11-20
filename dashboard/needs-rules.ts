// What interrupts the founder (card 158, docs/company-mode.md "What interrupts you"). Pure, so
// `npm run check:interrupts` can test it.
//
// Four things reach Needs you, and nothing else: an agent doing a kind of action for the first time,
// anything that spends money, a new agent, and a change to a goal. Everything else waits for the
// chief of staff's summary, still one tap away. `interruptKind` is the only place that decides.

export type Interrupt = "first_time" | "money" | "new_agent" | "goal";
/** In the order Needs you shows them. */
export const INTERRUPTS: readonly Interrupt[] = ["money", "first_time", "new_agent", "goal"];
export const INTERRUPT_WORDS: Record<Interrupt, string> = { first_time: "First time", money: "Spends money", new_agent: "New agent", goal: "Goal change" };

/**
 * Gateway tools that move money. None is built (CLAUDE.md: no send, payment or publish action type),
 * so the slot is empty; a purchase tool goes here the day it exists, and its cards land in Spends money.
 */
export const MONEY_TOOLS: ReadonlySet<string> = new Set<string>();

/** Where an item that wants the owner comes from. */
export type Source =
  /** An approval card. `promoted` is true once its action type has earned trust (card 7; none has yet). */
  | { from: "approval"; tool: string; promoted?: boolean }
  | { from: "proposal"; kind: string }
  | { from: "run_failed" | "run_stuck" | "budget" | "database" | "connection" | "lesson" | "photos" | "job" };

/** Which of the four it is, or null: it waits for the summary. */
export function interruptKind(s: Source, money: ReadonlySet<string> = MONEY_TOOLS): Interrupt | null {
  if (s.from === "approval") {
    // money first: a purchase asks every time, however much trust its action type has earned
    if (money.has(s.tool)) return "money";
    return s.promoted ? null : "first_time";
  }
  if (s.from === "proposal") {
    if (s.kind === "hire" || s.kind === "department") return "new_agent";
    if (s.kind === "goal") return "goal";
    // grant a read tool, a new tool, retire: decided on Proposals, after the summary
    return null;
  }
  return null;
}

/** Counts of the four, for the greeting line and the menu badge. */
export function interruptCounts(sources: readonly Source[], money: ReadonlySet<string> = MONEY_TOOLS): Record<Interrupt, number> {
  const out: Record<Interrupt, number> = { first_time: 0, money: 0, new_agent: 0, goal: 0 };
  for (const s of sources) { const k = interruptKind(s, money); if (k) out[k]++; }
  return out;
}

export const totalOf = (c: Record<Interrupt, number>) => INTERRUPTS.reduce((n, k) => n + c[k], 0);
