// Trust levels (card 7, docs/trust.md): trust is earned per agent and per write tool, never for an
// agent as a whole. Three levels: Draft (an approval card an approver taps), Act with undo (the action
// waits the undo window, then applies by itself unless an approver cancels it), Act (applies on the
// next scheduler round, logged). Pure: no database and no clock, so `npm run check:trust` tests it.
//
// Hard rules (CLAUDE.md): every action type starts at Draft; it moves up only after 28 of its last 30
// approvals went through unedited and an approver confirms the promotion card; a "wrong" rejection,
// complaint, unsubscribe spike, cap breach or breaker trip drops it back to Draft. A first email to a
// person who has never heard from the business, and a payment to a new payee, are never promoted.

export const LEVELS = ["draft", "act_undo", "act"] as const;
export type Level = (typeof LEVELS)[number];
export const isLevel = (v: unknown): v is Level => (LEVELS as readonly unknown[]).includes(v);

/** The record a promotion needs: NEEDED clean outcomes in the last WINDOW, after the level last changed. */
export const TRUST = { window: 30, needed: 28, cooldown: 10 } as const;

/** Why an approver rejected an approval, or cancelled a scheduled action. Wrong and policy drop the type back to Draft. */
export const REJECT_KINDS = ["wrong", "policy", "not_now", "other"] as const;
export type RejectKind = (typeof REJECT_KINDS)[number];
export const isRejectKind = (v: unknown): v is RejectKind => (REJECT_KINDS as readonly unknown[]).includes(v);
export const REJECT_WORDS: Record<RejectKind, string> = {
  wrong: "It got this wrong",
  policy: "Against the rules",
  not_now: "Not now",
  other: "Something else",
};
/** A rejection or cancel of this kind drops the action type back to Draft. */
export const demotes = (k: RejectKind | null | undefined) => k === "wrong" || k === "policy";

/**
 * One decided item since the level last changed, newest first. At Draft: an approval approved (clean
 * unless edited) or rejected. At Act with undo: a scheduled action that ran (clean) or was cancelled.
 * Expired and sent-back items don't count either way.
 */
export interface Outcome { clean: boolean; kind: RejectKind | null }

export const nextLevel = (l: Level): Level | null => (l === "draft" ? "act_undo" : l === "act_undo" ? "act" : null);

/** The level an action really runs at: a tool that can never be promoted is Draft whatever the table says. */
export const effectiveLevel = (stored: Level | null | undefined, promotable: boolean): Level => (promotable && isLevel(stored) ? stored : "draft");

export type Standing =
  | { kind: "never" }
  | { kind: "top" }
  | { kind: "offer"; to: Level; clean: number }
  | { kind: "progress"; clean: number; decided: number; blocked: boolean };

/**
 * Where an agent's tool stands on the way up. An offer needs WINDOW decided outcomes since the level
 * last changed, at least NEEDED of the last WINDOW clean, and none of them a wrong or policy rejection.
 * After a "Not yet", it waits for COOLDOWN more outcomes before it offers again.
 */
export function standing(o: { level: Level; promotable: boolean; outcomes: readonly Outcome[]; sinceDecline?: number | null }): Standing {
  if (!o.promotable) return { kind: "never" };
  const to = nextLevel(o.level);
  if (!to) return { kind: "top" };
  const last = o.outcomes.slice(0, TRUST.window);
  const clean = last.filter((x) => x.clean).length;
  const blocked = last.some((x) => demotes(x.kind));
  const cooling = o.sinceDecline != null && o.sinceDecline < TRUST.cooldown;
  if (last.length >= TRUST.window && clean >= TRUST.needed && !blocked && !cooling) return { kind: "offer", to, clean };
  return { kind: "progress", clean, decided: last.length, blocked };
}

/** When a scheduled action may apply: the undo window after it was proposed. */
export const executeAfter = (proposedAt: number, undoMinutes: number) => new Date(proposedAt + Math.max(1, Math.round(undoMinutes)) * 60_000).toISOString();
export const isDue = (executeAfterIso: string | null, now: number) => !!executeAfterIso && Date.parse(executeAfterIso) <= now;

export const LEVEL_WORDS: Record<Level, string> = { draft: "Draft", act_undo: "Act with undo", act: "Act" };
export const LEVEL_ABOUT: Record<Level, string> = {
  draft: "Every one waits for your approval.",
  act_undo: "Runs by itself after the undo window unless you cancel it.",
  act: "Runs by itself on the next round, logged.",
};

/** The promotion card's question, in plain words. */
export function offerWords(o: { agent: string; what: string; clean: number; to: Level; undoMinutes: number }): string {
  const record = `${o.clean} of the last ${TRUST.window} approved unedited`;
  return o.to === "act_undo"
    ? `${o.agent}’s ${o.what}: ${record}. Let these run by themselves after a ${o.undoMinutes}-minute undo window?`
    : `${o.agent}’s ${o.what}: ${o.clean} of the last ${TRUST.window} ran without a cancel. Let these run by themselves right away, without the undo window?`;
}

/** One line on the agent's page: its level and how far it is from the next. */
export function standingWords(level: Level, s: Standing): string {
  switch (s.kind) {
    case "never": return "Always waits for your approval: this kind is never promoted.";
    case "top": return LEVEL_ABOUT.act;
    case "offer": return `${LEVEL_ABOUT[level]} Earned a promotion: see Approvals.`;
    case "progress": return `${LEVEL_ABOUT[level]} ${s.clean} of ${TRUST.window} clean so far${s.blocked ? " (a recent “wrong” or “against the rules” holds it back)" : ""}.`;
  }
}
