// Setup step 4, "First job" (card 154, docs/setup.md): which agent starts first, what the other
// departments wait on, and what the Desk shows over time. Picked in code from the installed templates,
// the connected tools and the playbooks waiting for approval; the model never chooses. Pure, so
// check:first-job can test it.
import type { Template } from "@/core/template-rules";
import { NEED_TILE, TOOL_TILES, type ToolTileId } from "@/core/tools-step-rules";

export interface FirstJob {
  agentId: string;
  name: string;
  role: string;
  templateId: string;
  dept: string;
  /** The template's mandate: the job it does. */
  job: string;
  /** Its job ends in an approval card (it has an action tool). */
  proposes: boolean;
}

export interface DeptWait {
  templateId: string;
  dept: string;
  /** Tool names it still waits on; empty when it is ready. */
  waitsOn: string[];
}

export interface PickInput {
  setupTemplate: string;
  /** Agent ids installed in this business. */
  installed: ReadonlySet<string>;
  /** Agents with a proposed playbook waiting for approval. */
  pending: ReadonlySet<string>;
  connected: ReadonlySet<ToolTileId>;
  /** A tool's `needs` settings (core/tools/catalog.ts). */
  needsOf: (toolId: string) => readonly string[];
  /** A tool's kind (core/tools/catalog.ts): "action" tools end in an approval card. */
  kindOf: (toolId: string) => string | undefined;
}

type Spec = { mandate?: string; tools?: string[] };
const specOf = (t: Template, id: string): Spec => ((t.specs as Record<string, Spec>)[id] ?? {});

/** The tiles a list of tools needs that aren't connected, in tile order. */
export function missingTiles(tools: readonly string[], needsOf: PickInput["needsOf"], connected: ReadonlySet<ToolTileId>): ToolTileId[] {
  const want = new Set(tools.flatMap((id) => needsOf(id).map((n) => NEED_TILE[n]).filter(Boolean)));
  return TOOL_TILES.map((x) => x.id).filter((id) => want.has(id) && !connected.has(id));
}

/**
 * The first job: an installed department agent (never the Chief of Staff) with a first playbook waiting
 * and every tool it needs connected. Ranked: a job that ends in an approval card first, then templates in
 * order, workers before heads, then seat order. Null when no agent is ready.
 */
export function pickFirstJob(templates: readonly Template[], p: PickInput): FirstJob | null {
  const cands: { j: FirstJob; rank: number[] }[] = [];
  templates.forEach((t, ti) => {
    if (t.id === p.setupTemplate) return;
    const dept = t.departments[0]?.name ?? t.name;
    t.seats.forEach((s, si) => {
      if (s.holder !== "agent" || !s.agent || !p.installed.has(s.agent) || !p.pending.has(s.agent)) return;
      const a = t.agents.find((x) => x.id === s.agent);
      if (!a) return;
      const spec = specOf(t, a.id);
      const tools = spec.tools ?? [];
      if (missingTiles(tools, p.needsOf, p.connected).length) return;
      const proposes = tools.some((id) => p.kindOf(id) === "action");
      cands.push({
        j: { agentId: a.id, name: a.name, role: a.role || s.title, templateId: t.id, dept, job: spec.mandate?.trim() || s.sub || s.title, proposes },
        rank: [proposes ? 0 : 1, ti, s.parent == null ? 1 : 0, si],
      });
    });
  });
  cands.sort((x, y) => x.rank.reduce((d, v, i) => d || v - y.rank[i], 0));
  return cands[0]?.j ?? null;
}

/** Every installed department but the first job's, with the tools it still waits on. */
export function deptWaits(templates: readonly Template[], p: Pick<PickInput, "setupTemplate" | "installed" | "connected" | "needsOf">, skip: string | null): DeptWait[] {
  return templates.filter((t) => t.id !== p.setupTemplate && t.id !== skip && t.agents.some((a) => p.installed.has(a.id))).map((t) => {
    const tools = t.agents.filter((a) => p.installed.has(a.id)).flatMap((a) => specOf(t, a.id).tools ?? []);
    const waitsOn = missingTiles(tools, p.needsOf, p.connected).map((id) => TOOL_TILES.find((x) => x.id === id)!.name);
    return { templateId: t.id, dept: t.departments[0]?.name ?? t.name, waitsOn };
  });
}

/** How long the Desk keeps the first job's result up after its run ends. */
export const DONE_FOR_MS = 24 * 3600e3;

export interface JobRun { agent_id: string; trigger: string; started_at: string; ended_at: string | null; status: string }
export type FirstJobPhase<R extends JobRun = JobRun> =
  | { phase: "offer" }
  | { phase: "running"; run: R | null }
  | { phase: "done"; run: R }
  | null;

/**
 * What the Desk shows: the offer until the first job starts, then its run while it goes, then its
 * result for a day. Null for a business that wasn't offered one (started empty, or never went through setup).
 */
export function firstJobPhase<R extends JobRun>(s: { offer: boolean; firstJob: { agentId: string; at: string } | null }, runs: readonly R[], now: number): FirstJobPhase<R> {
  if (!s.offer) return null;
  if (!s.firstJob) return { phase: "offer" };
  const since = Date.parse(s.firstJob.at) - 60e3;
  const run = runs.filter((r) => r.agent_id === s.firstJob!.agentId && r.trigger !== "preview" && Date.parse(r.started_at) >= since)
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at))[0] ?? null;
  if (!run || run.status === "running") return now - Date.parse(s.firstJob.at) < DONE_FOR_MS ? { phase: "running", run } : null;
  const ended = Date.parse(run.ended_at ?? run.started_at);
  return now - ended < DONE_FOR_MS ? { phase: "done", run } : null;
}

/** The tapped agent, checked against the pick made in code now. */
export function readFirstJobTap(agentId: unknown, s: { offer: boolean; firstJob: unknown }, pick: FirstJob | null): { agentId: string } | { problem: string } {
  if (!s.offer) return { problem: "This business wasn’t set up with a first job. Approve playbooks on Crew instead." };
  if (s.firstJob) return { problem: "The first job already started." };
  if (!pick) return { problem: "No agent is ready yet: connect the tool its department needs first." };
  if (String(agentId ?? "") !== pick.agentId) return { problem: "The first job changed (a tool was connected or a playbook approved). Reload the Desk and tap again." };
  return { agentId: pick.agentId };
}

/**
 * The chains the first job turns on: every chain with a step for one of `ids` (the first job and Avery).
 * Steps of agents still off duty are skipped at $0 by withRun, so a shared chain like the morning one
 * still reaches Avery when its step runs on "any". A chain with none of them stays as it is.
 */
export function firstJobChains<C extends { key: string; on: boolean; steps: readonly { agent: string }[] }>(chains: readonly C[], ids: readonly string[]): { chains: C[]; on: string[] } {
  const next = chains.map((c) => (c.on || !c.steps.some((s) => ids.includes(s.agent)) ? c : { ...c, on: true }));
  return { chains: next, on: next.filter((c, i) => c.on && !chains[i].on).map((c) => c.key) };
}
