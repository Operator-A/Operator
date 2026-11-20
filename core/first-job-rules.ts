// Setup step 4, "First job" (card 154, docs/setup.md): which agent starts first, what the other
// departments wait on, and what the Desk shows over time. Picked in code from the installed templates,
// the connected tools and the playbooks waiting for approval; the model never chooses. Pure, so
// check:first-job can test it.
import type { Template } from "@/core/template-rules";
import { NEED_TILE, TOOL_TILES, type ToolTileId } from "@/core/tools-step-rules";

export interface FirstJob {
  /** playbook: approve its first playbook and put it on duty (a template's agent). try: one try that reads only,
   * sends nothing and drafts its routine, while it stays off duty (an agent Avery designed, card 194). */
  kind: "playbook" | "try";
  agentId: string;
  name: string;
  role: string;
  /** The template id, or a designed department's pick id (core/design-rules.ts pickId). */
  templateId: string;
  dept: string;
  /** The template's mandate (or the designed person's job): the job it does. */
  job: string;
  /** Its job ends in an approval card (it has an action tool whose tool is connected). */
  proposes: boolean;
  /** The first playbook's steps that can run now (indices): the tap approves only these (card 189). */
  keep: number[];
  /** Tools the rest of its playbook and actions wait on, by name: it starts without them. */
  later: string[];
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
  /** Agents with a proposed playbook waiting for approval, and that playbook's step tools in order. */
  pending: ReadonlyMap<string, readonly string[]>;
  connected: ReadonlySet<ToolTileId>;
  /** A tool's `needs` settings (core/tools/catalog.ts). */
  needsOf: (toolId: string) => readonly string[];
  /** A tool's kind (core/tools/catalog.ts): "action" tools end in an approval card. */
  kindOf: (toolId: string) => string | undefined;
  /** Agents of designed departments with no playbook yet (builtCandidates, then filtered by the caller). */
  built?: readonly BuiltCandidate[];
}

/** A person of a department Avery designed, installed as an agent (card 194). */
export interface BuiltCandidate { agentId: string; name: string; role: string; job: string; tools: readonly string[]; head: boolean; deptId: string; dept: string; order: number }

/**
 * The installed people of the designed departments in the sketch, in sketch and seat order (head first).
 * Each is found by name among the installed agents: names are unique across the sketch (core/design-rules.ts).
 */
export function builtCandidates(designs: readonly { key: string; name: string; kit: string | null; draft: { head: DraftPersonLike | null; agents: readonly DraftPersonLike[] } | null }[], agents: readonly { id: string; name: string }[]): BuiltCandidate[] {
  const out: BuiltCandidate[] = [];
  designs.forEach((d) => {
    if (d.kit || !d.draft) return;
    const people = [...(d.draft.head ? [{ p: d.draft.head, head: true }] : []), ...d.draft.agents.map((p) => ({ p, head: false }))];
    for (const { p, head } of people) {
      const a = agents.find((x) => x.name === p.name);
      if (a) out.push({ agentId: a.id, name: p.name, role: p.seat || (head ? "Head" : "Agent"), job: p.job, tools: [...p.tools], head, deptId: `design:${d.key}`, dept: d.name, order: out.length });
    }
  });
  return out;
}
type DraftPersonLike = { name: string; seat: string; job: string; tools: readonly string[] };

type Spec = { mandate?: string; tools?: string[] };
const specOf = (t: Template, id: string): Spec => ((t.specs as Record<string, Spec>)[id] ?? {});

/**
 * The steps of a playbook that can run now (indices): every tile the step's tool needs is connected.
 * A step needing only the app's own data, or nothing, always can. A step that can't would fail and put
 * the agent on hold, so a first playbook is approved with only these (card 189).
 */
export function runnableSteps(stepTools: readonly string[], needsOf: PickInput["needsOf"], connected: ReadonlySet<ToolTileId>): number[] {
  return stepTools.flatMap((id, i) => (missingTiles([id], needsOf, connected).length ? [] : [i]));
}

/** The tiles a list of tools needs that aren't connected, in tile order. */
export function missingTiles(tools: readonly string[], needsOf: PickInput["needsOf"], connected: ReadonlySet<ToolTileId>): ToolTileId[] {
  const want = new Set(tools.flatMap((id) => needsOf(id).map((n) => NEED_TILE[n]).filter(Boolean)));
  return TOOL_TILES.map((x) => x.id).filter((id) => want.has(id) && !connected.has(id));
}

/**
 * The first job: an installed department agent (never the Chief of Staff) with a first playbook waiting
 * and at least one of its steps able to run now (card 189: one tool, or none, is enough; it starts
 * without the rest). Ranked: a job that ends in an approval card first (its action's tool connected),
 * then workers before heads, then an agent with every tool over one missing some, then templates in
 * order, then seat order. Null when no agent has a step that can run.
 *
 * Card 194: an agent of a department Avery designed has no playbook yet, so its first job is a try that
 * drafts one. It ranks before every template's agent (it answers the founder's own words), workers
 * before heads, every tool connected first, then sketch order. It can start when at least one of its
 * tools needs nothing that isn't connected.
 */
export function pickFirstJob(templates: readonly Template[], p: PickInput): FirstJob | null {
  const cands: { j: FirstJob; rank: number[] }[] = [];
  for (const b of p.built ?? []) {
    if (!b.tools.some((id) => !missingTiles([id], p.needsOf, p.connected).length)) continue;
    const later = missingTiles(b.tools, p.needsOf, p.connected).map((id) => TOOL_TILES.find((x) => x.id === id)!.name);
    cands.push({ j: { kind: "try", agentId: b.agentId, name: b.name, role: b.role, templateId: b.deptId, dept: b.dept, job: b.job, proposes: false, keep: [], later }, rank: [-1, b.head ? 1 : 0, later.length ? 1 : 0, b.order, 0] });
  }
  templates.forEach((t, ti) => {
    if (t.id === p.setupTemplate) return;
    const dept = t.departments[0]?.name ?? t.name;
    t.seats.forEach((s, si) => {
      const steps = s.agent ? p.pending.get(s.agent) : undefined;
      if (s.holder !== "agent" || !s.agent || !p.installed.has(s.agent) || !steps) return;
      const a = t.agents.find((x) => x.id === s.agent);
      if (!a) return;
      const keep = runnableSteps(steps, p.needsOf, p.connected);
      if (!keep.length) return;
      const spec = specOf(t, a.id);
      const tools = spec.tools ?? [];
      const actions = tools.filter((id) => p.kindOf(id) === "action");
      const proposes = actions.some((id) => !missingTiles([id], p.needsOf, p.connected).length);
      const later = missingTiles([...steps, ...actions], p.needsOf, p.connected).map((id) => TOOL_TILES.find((x) => x.id === id)!.name);
      cands.push({
        j: { kind: "playbook", agentId: a.id, name: a.name, role: a.role || s.title, templateId: t.id, dept, job: spec.mandate?.trim() || s.sub || s.title, proposes, keep, later },
        rank: [proposes ? 0 : 1, s.parent == null ? 1 : 0, later.length ? 1 : 0, ti, si],
      });
    });
  });
  cands.sort((x, y) => x.rank.reduce((d, v, i) => d || v - y.rank[i], 0));
  return cands[0]?.j ?? null;
}

/** "Starts without Shopify and Gmail." for a first job that waits on nothing it needs now. */
export const laterWords = (later: readonly string[]) => (later.length ? `It starts without ${later.join(" and ")}; connect ${later.length === 1 ? "it" : "them"} later to add what ${later.length === 1 ? "it reads" : "they read"}.` : "");

/** Every installed department but the first job's, with the tools it still waits on: designed ones first (card 194). */
export function deptWaits(templates: readonly Template[], p: Pick<PickInput, "setupTemplate" | "installed" | "connected" | "needsOf" | "built">, skip: string | null): DeptWait[] {
  const designed = [...new Set((p.built ?? []).map((b) => b.deptId))].filter((id) => id !== skip).map((id) => {
    const people = (p.built ?? []).filter((b) => b.deptId === id);
    return { templateId: id, dept: people[0].dept, waitsOn: missingTiles(people.flatMap((b) => b.tools), p.needsOf, p.connected).map((t) => TOOL_TILES.find((x) => x.id === t)!.name) };
  });
  return [...designed, ...templates.filter((t) => t.id !== p.setupTemplate && t.id !== skip && t.agents.some((a) => p.installed.has(a.id))).map((t) => {
    const tools = t.agents.filter((a) => p.installed.has(a.id)).flatMap((a) => specOf(t, a.id).tools ?? []);
    const waitsOn = missingTiles(tools, p.needsOf, p.connected).map((id) => TOOL_TILES.find((x) => x.id === id)!.name);
    return { templateId: t.id, dept: t.departments[0]?.name ?? t.name, waitsOn };
  })];
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
 * result for a day. A first try (card 194) follows its try, which is a preview run; a first playbook job
 * never counts a preview. Null for a business that wasn't offered one (started empty, or never went through setup).
 */
export function firstJobPhase<R extends JobRun>(s: { offer: boolean; firstJob: { agentId: string; at: string; kind?: "playbook" | "try" } | null }, runs: readonly R[], now: number): FirstJobPhase<R> {
  if (!s.offer) return null;
  if (!s.firstJob) return { phase: "offer" };
  const since = Date.parse(s.firstJob.at) - 60e3;
  const run = runs.filter((r) => r.agent_id === s.firstJob!.agentId && (r.trigger === "preview") === (s.firstJob!.kind === "try") && Date.parse(r.started_at) >= since)
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
