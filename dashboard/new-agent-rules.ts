// New agent (card 420, docs/department-pages.md): building an agent by hand on a blank agent sheet. The form the
// sheet sends, read and checked here in plain code (no database), and turned into the same spec shape the builder
// and hire cards save. The server action checks the spec again against code (readSpec, model keys, what each
// action is open to) and creates the agent off duty as v1. Nothing here can put an agent on duty.
import { daysOf, type Days } from "@/core/flow-rules";
import { readRoutine } from "@/core/routine-rules";

/** The address value that opens the blank sheet (?agent=new). Agent ids never take it: they start with a letter and "b_" or a known id. */
export const NEW_AGENT = "new";

/** Where the new agent runs: on a model in OPERATOR, or as one of the owner's Claude routines (its trigger id and key, or left to connect later). */
export type NewRunsOn = { on: "operator"; model: string } | { on: "claude"; routine?: { routine: string; token: string } };
/** When it runs: only when asked (Run now), on days at a time, or after another agent finishes in that agent's chain. */
export type NewStart = { kind: "manual" } | { kind: "schedule"; days: Days; time: string } | { kind: "after"; agentId: string; passAlong: boolean };
/** Where it sits: a department and an open seat there, or a new seat under the head (seatId null); null for no department. */
export type NewPlace = { deptId: string; seatId: string | null } | null;

export interface NewAgentForm {
  name: string; role: string; job: string; good: string;
  runsOn: NewRunsOn;
  /** Read and action tool ids picked on the sheet; empty for a Claude routine. */
  tools: string[];
  start: NewStart;
  place: NewPlace;
  budget: number;
}

export const NEW_LIMITS = { name: 80, role: 60, job: 4000, good: 1000, tools: 40 } as const;
const TIME = /^([01]\d|2[0-3]):(00|15|30|45)$/;
const ID = /^[a-z0-9_]{1,60}$/;
const SLUG = /^[a-z][a-z0-9_]{1,39}$/;
const UUID = /^[0-9a-f-]{36}$/i;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+$/g, "").trim().slice(0, max) : "");

/**
 * The sheet's form, checked. Every problem is named in plain words, and one problem refuses the whole form, so
 * nothing half-made is created. `ceiling` is the daily budget ceiling in code (BUDGET_CEILING).
 */
export function readNewAgent(raw: unknown, ceiling: number): { form: NewAgentForm } | { problem: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = text(r.name, NEW_LIMITS.name), role = text(r.role, NEW_LIMITS.role), job = text(r.job, NEW_LIMITS.job), good = text(r.good, NEW_LIMITS.good);
  if (!name) return { problem: "Give it a name." };
  if (name.toLowerCase() === NEW_AGENT) return { problem: "Pick another name." };
  if (!job) return { problem: "Say what its job is, in your words." };

  const ro = (r.runsOn && typeof r.runsOn === "object" ? r.runsOn : {}) as Record<string, unknown>;
  let runsOn: NewRunsOn;
  if (ro.on === "claude") {
    const rt = (ro.routine && typeof ro.routine === "object" ? ro.routine : {}) as Record<string, unknown>;
    const id = typeof rt.routine === "string" ? rt.routine.trim() : "", key = typeof rt.token === "string" ? rt.token.trim() : "";
    if (!id && !key) runsOn = { on: "claude" };
    else {
      // both or neither: a trigger id without its key (or the other way) can't fire
      const r2 = readRoutine(id, key);
      if ("problem" in r2) return { problem: r2.problem };
      runsOn = { on: "claude", routine: r2 };
    }
  } else if (ro.on === "operator" && typeof ro.model === "string" && ro.model.trim()) runsOn = { on: "operator", model: ro.model.trim() };
  else return { problem: "Pick what it runs on." };

  const tools = Array.isArray(r.tools) ? [...new Set(r.tools.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 80))] : [];
  if (tools.length > NEW_LIMITS.tools) return { problem: `Pick at most ${NEW_LIMITS.tools} reads and actions.` };
  // a Claude routine has no OPERATOR tools: its connectors are set in Claude, never granted here
  if (runsOn.on === "claude" && tools.length) return { problem: "An agent that runs in Claude has no OPERATOR reads or actions. Its routine’s connectors are set in Claude." };
  if (runsOn.on === "operator" && !tools.length) return { problem: "Pick at least one thing it reads." };

  const s = (r.start && typeof r.start === "object" ? r.start : {}) as Record<string, unknown>;
  let start: NewStart;
  if (s.kind === "schedule") {
    const days = Array.isArray(s.days) ? daysOf(s.days.map(Number)) : null;
    if (!days) return { problem: "Pick at least one day it runs." };
    if (typeof s.time !== "string" || !TIME.test(s.time)) return { problem: "Pick a time on the quarter hour." };
    start = { kind: "schedule", days, time: s.time };
  } else if (s.kind === "after") {
    if (typeof s.agentId !== "string" || !ID.test(s.agentId)) return { problem: "Pick the agent it runs after." };
    start = { kind: "after", agentId: s.agentId, passAlong: s.passAlong === true };
  } else start = { kind: "manual" };

  let place: NewPlace = null;
  if (r.place && typeof r.place === "object") {
    const p = r.place as Record<string, unknown>;
    if (typeof p.deptId !== "string" || !SLUG.test(p.deptId)) return { problem: "That department isn’t on the chart." };
    if (p.seatId != null && (typeof p.seatId !== "string" || !UUID.test(p.seatId))) return { problem: "That seat isn’t on the chart." };
    place = { deptId: p.deptId, seatId: (p.seatId as string | null) ?? null };
  }

  const budget = Number(r.budget);
  if (!Number.isFinite(budget) || budget < 0 || budget > ceiling) return { problem: `Pick a daily budget from $0 to $${ceiling}.` };

  return { form: { name, role, job, good, runsOn, tools: runsOn.on === "claude" ? [] : tools, start, place, budget: Math.round(budget * 100) / 100 } };
}

/** The short job line the roster shows: the job's first sentence, at most 200 characters. */
export function jobLine(job: string): string {
  const first = job.split(/(?<=[.!?])\s|\n/)[0]?.trim() ?? "";
  return (first || job).slice(0, 200);
}

/**
 * The spec draft for v1, in the builder's shape (core/agent-spec.ts). `fallbackModel` is the model a Claude
 * routine keeps on file (it isn't used while it runs in Claude), so moving into OPERATOR later starts from it.
 */
export function newSpecDraft(f: NewAgentForm, fallbackModel: string, limits: { maxSteps: number; maxCostUsd: number }) {
  return {
    name: f.name, mandate: jobLine(f.job), directive: f.job, goodResult: f.good,
    model: f.runsOn.on === "operator" ? f.runsOn.model : fallbackModel, effort: "low",
    tools: f.tools, notionPages: [], limits, outputName: (f.role || "result").slice(0, 60), readsFrom: [], reportPage: null,
  };
}

/**
 * The can-do tools on a form that a new agent may not be given: any action whose gateway rule names its agents
 * (only "granted" actions are open to an agent that doesn't exist yet). `agentsOf` returns a tool's rule, or
 * undefined for a tool that isn't an action.
 */
export function closedActions(tools: readonly string[], agentsOf: (id: string) => "granted" | readonly string[] | null | undefined): string[] {
  return tools.filter((id) => { const a = agentsOf(id); return a !== undefined && a !== "granted"; });
}

/** What Create says back: what was made and where, then anything that didn't take, so nothing is hidden. */
export function createdWords(name: string, where: string | null, misses: readonly string[], tried: string | null): string {
  const base = `${name} is created, off duty, as v1${where ? ` ${where}` : ""}.`;
  const rest = misses.length ? ` ${misses.join(" ")}` : "";
  return `${base}${rest}${tried ? ` ${tried}` : " Try it once, then put it on duty."}`;
}
