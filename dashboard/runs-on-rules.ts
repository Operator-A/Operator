// Where an agent runs (card 405, the Runs on picker): the pure rules behind the picker on the agent sheet and the
// New agent sheet. One choice: a model OPERATOR runs (Claude, OpenAI, Gemini or Grok, on the business's own keys),
// or a Claude routine in the owner's own Claude account. No database, no network, so `npm run check:runs-on`
// tests it. The server action (dashboard/actions.ts setRunsOn) reads the choice with readRunsOn and checks the
// owner's role; switching sides always takes the agent off duty.
//
// Only Claude has a routine OPERATOR can start from outside and get the result back from (checked 2026-11-24:
// OpenAI workspace agents can be started but their answer can't be read back; Gemini's scheduled tasks and Grok's
// automations live only in their apps). Decided 2026-11-24: other makers' models run inside OPERATOR.
import { CLAUDE_TOOLS, readClaudeTools } from "@/core/routine-rules";

/** What the picker holds: a model in OPERATOR, or a Claude routine with the connectors it names (labels only). */
export type RunsOnChoice = { on: "operator"; model: string } | { on: "claude"; tools: string[] };

/** The model makers the picker groups by, in its order, from a model's provider id (integrations/models.ts). */
export const MAKERS = [
  { id: "anthropic", name: "Claude", mark: "C" },
  { id: "openai", name: "OpenAI", mark: "O" },
  { id: "google", name: "Gemini", mark: "G" },
  { id: "xai", name: "Grok", mark: "X" },
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
 * so an agent whose key went away can still be saved), or a Claude routine with valid connector labels.
 */
export function readRunsOn(raw: unknown, models: readonly PickModel[], current: string | null = null): RunsOnChoice | { problem: string } {
  const r = (raw ?? {}) as { on?: unknown; model?: unknown; tools?: unknown };
  if (r.on === "operator") {
    const m = models.find((x) => x.id === r.model);
    if (!m) return { problem: "That model isn’t one OPERATOR runs." };
    if (!m.ready && m.id !== current) return { problem: `${m.label} needs your ${makerOf(m.provider)?.name ?? m.provider} key on Connections first.` };
    return { on: "operator", model: m.id };
  }
  if (r.on === "claude") {
    const t = readClaudeTools(r.tools);
    if ("problem" in t) return { problem: t.problem.replace(/^./, (c) => c.toUpperCase()) + "." };
    return { on: "claude", tools: t.tools };
  }
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

/** "Uses in Claude", filled in from the tools behind its reads (connection names, no duplicates, within the limits). */
export function fillClaudeTools(connNames: readonly string[]): string[] {
  const out: string[] = [];
  for (const n of connNames) {
    const t = n.trim();
    if (!t || out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    if (!("tools" in readClaudeTools([t]))) continue;
    out.push(t);
    if (out.length === CLAUDE_TOOLS.max) break;
  }
  return out;
}

export interface ConnLite { id: string; name: string; connected: boolean }
export type MatchState = "ok" | "warn" | "none";
export interface ToolMatch { label: string; state: MatchState; conn: string | null; what: string }

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** The words that name a service ("Google Calendar" and "Calendar" match; "Google" alone matches nothing). */
const words = (s: string) => norm(s).split(" ").filter((w) => w.length > 2 && w !== "google" && w !== "online" && w !== "ads" && w !== "the");

/**
 * Each Claude connector label matched to one of OPERATOR's connections by name: works here (connected), can
 * be connected here, or none here. A label never grants anything; this only tells the owner what moving loses.
 */
export function matchClaudeTools(labels: readonly string[], conns: readonly ConnLite[]): ToolMatch[] {
  return labels.map((label) => {
    const l = norm(label), lw = words(label);
    const hit = conns.find((c) => norm(c.name) === l)
      ?? conns.find((c) => { const cw = words(c.name); return cw.length > 0 && lw.length > 0 && (cw.every((w) => lw.includes(w)) || lw.every((w) => cw.includes(w))); });
    if (!hit) return { label, state: "none" as const, conn: null, what: "No OPERATOR tool for this yet. Look for one on Connections, under Find a tool." };
    return hit.connected
      ? { label, state: "ok" as const, conn: hit.id, what: `Connected in OPERATOR: give it ${hit.name} reads below.` }
      : { label, state: "warn" as const, conn: hit.id, what: `Not connected here yet: connect ${hit.name} on Connections.` };
  });
}

export const MATCH_WORD: Record<MatchState, string> = { ok: "Works here", warn: "Connect first", none: "None here" };
