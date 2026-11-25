// Where an agent runs (card 405, the Runs on picker): the pure rules behind the picker on the agent sheet and the
// New agent sheet. One choice: a model OPERATOR runs (Claude, OpenAI, Gemini or Grok, on the business's own keys),
// or a Claude routine in the owner's own Claude account. No database, no network, so `npm run check:runs-on`
// tests it. The server action (dashboard/actions.ts setRunsOn) reads the choice with readRunsOn and checks the
// owner's role; switching sides always takes the agent off duty.
//
// Only Claude has a routine OPERATOR can start from outside and get the result back from (checked 2026-11-24:
// OpenAI workspace agents can be started but their answer can't be read back; Gemini's scheduled tasks and Grok's
// automations live only in their apps). Decided 2026-11-24: other makers' models run inside OPERATOR.

/**
 * What the picker holds: a model in OPERATOR, or a Claude routine. A routine needs only its trigger and token
 * (connected on the sheet); its own connectors are set in Claude and never named here (decided 2026-11-24).
 */
export type RunsOnChoice = { on: "operator"; model: string } | { on: "claude" };

/** The model makers the picker groups by, in its order, from a model's provider id (integrations/models.ts). */
export const MAKERS = [
  { id: "anthropic", name: "Claude", mark: "C" },
  { id: "openai", name: "OpenAI", mark: "O" },
  { id: "google", name: "Gemini", mark: "G" },
  { id: "xai", name: "Grok", mark: "X" },
  // other makers' models through the AI Gateway key (conductor ticket 1b)
  { id: "gateway", name: "Other makers (AI Gateway)", mark: "V" },
] as const;
export type MakerId = (typeof MAKERS)[number]["id"];
export const makerOf = (provider: string) => MAKERS.find((m) => m.id === provider) ?? null;

/** A model as the picker shows it: ready when its maker's key is connected (Claude always is). */
export interface PickModel { id: string; label: string; provider: string; ready: boolean; why?: string }

/** The picker's groups: each maker with its models, makers with none left out. */
export function modelGroups(models: readonly PickModel[]): { maker: (typeof MAKERS)[number]; models: PickModel[]; noKey: boolean }[] {
  return MAKERS.map((maker) => {
    const ms = models.filter((m) => m.provider === maker.id);
    return { maker, models: ms, noKey: ms.length > 0 && ms.every((m) => !m.ready) };
  }).filter((g) => g.models.length > 0);
}

/**
 * The choice sent from the browser, checked: a listed model that is ready (or the one the agent already runs on,
 * so an agent whose key went away can still be saved), or a Claude routine.
 */
export function readRunsOn(raw: unknown, models: readonly PickModel[], current: string | null = null): RunsOnChoice | { problem: string } {
  const r = (raw ?? {}) as { on?: unknown; model?: unknown };
  if (r.on === "operator") {
    const m = models.find((x) => x.id === r.model);
    if (!m) return { problem: "That model isn’t one OPERATOR runs." };
    if (!m.ready && m.id !== current) return { problem: `${m.label} needs your ${makerOf(m.provider)?.name ?? m.provider} key on Connections first.` };
    return { on: "operator", model: m.id };
  }
  if (r.on === "claude") return { on: "claude" };
  return { problem: "Pick where it runs." };
}

export type SwitchKind = "same" | "model" | "to_claude" | "to_operator";

/** What saving this choice does, from where the agent runs now and the model it is on. */
export function switchKind(now: { on: "operator" | "claude"; model: string | null }, to: RunsOnChoice): SwitchKind {
  if (now.on === "claude") return to.on === "claude" ? "same" : "to_operator";
  if (to.on === "claude") return "to_claude";
  return to.model === now.model ? "same" : "model";
}

/** The lines the switch box shows (Keeps, Stops, Then), in the sheet's words. */
export function switchWords(kind: SwitchKind, name: string, modelLabel?: string): { title: string; keeps: string; stops: string; then: string } | null {
  if (kind === "to_claude") return {
    title: `Moving ${name} to a Claude routine`,
    keeps: "Its job, schedule, chains, runs and history.",
    stops: "OPERATOR’s reads and Can do. What it does with Claude’s connectors happens in Claude, outside approval cards and caps. Its prompt asks it to send anything outward back here as a proposal.",
    then: "Off duty until you connect its routine. The steps and token fields show after Save.",
  };
  if (kind === "to_operator") return {
    title: `Moving ${name} into OPERATOR${modelLabel ? ` on ${modelLabel}` : ""}`,
    keeps: "Its job, schedule, chains, runs and history.",
    stops: "Its Claude routine. OPERATOR forgets the token (delete it on claude.ai too).",
    then: "Off duty. Check its reads below, try it, and go live.",
  };
  return null;
}

/** The confirm a switch asks for once, before Save goes through (the sheet's "Confirm first" pattern). */
export function switchConfirm(kind: SwitchKind, name: string): string | null {
  if (kind === "to_claude") return `Confirm first: ${name} goes off duty and runs in Claude once its routine is connected.`;
  if (kind === "to_operator") return `Confirm first: ${name} goes off duty and runs in OPERATOR once you try it and go live.`;
  return null;
}
