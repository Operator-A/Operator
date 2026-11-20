import "server-only";
// The Desk's first job (card 154, docs/setup.md): what the card shows, read for the current business.
// The pick and the phases are in core/first-job-rules.ts; this reads the setup row, the installed
// agents, the playbooks waiting and the connected tools.
import { orgTz } from "@/core/tz";
import { db } from "@/core/db";
import { TEMPLATES } from "@/core/templates";
import { TOOLS } from "@/core/tools/catalog";
import { setupState } from "@/core/setup";
import { SETUP_AGENT, SETUP_TEMPLATE } from "@/core/setup-rules";
import { agentsOf } from "@/core/company-rules";
import { builtCandidates, deptWaits, firstJobPhase, pickFirstJob, type BuiltCandidate, type DeptWait, type FirstJob } from "@/core/first-job-rules";
import { hireSpec } from "@/core/proposal-rules";
import type { MonthCost } from "@/core/cost-rules";
import { activePlaybook, listPlaybooks, pendingPlaybook } from "@/core/playbook";
import { costsFor, toolLabel } from "./company";
import { billing, monthCostOf } from "./cost";
import { connectedTiles } from "./toolsStep";
import type { ToolTileId } from "@/core/tools-step-rules";
import { RUN_COLS, type Floor, type Run } from "./data";

export const needsOf = (id: string): readonly string[] => (TOOLS as Record<string, { needs?: readonly string[] }>)[id]?.needs ?? [];
const kindOf = (id: string) => (TOOLS as Record<string, { kind?: string }>)[id]?.kind;

export interface FirstJobOffer {
  phase: "offer";
  /** Null when no agent is ready: every department waits on a tool. For a try, steps are the tools it may read. */
  job: (FirstJob & { steps: string[]; cost: MonthCost | null; playbookId: number }) | null;
  waits: DeptWait[];
  /** Avery's first playbook waits too: the tap approves it, so her 7:00 summary starts. */
  averyWaits: boolean;
}
export interface FirstJobRunning { phase: "running" | "done"; kind: "playbook" | "try"; agentId: string; name: string; steps: string[]; run: Run | null; approvalsPending: number | null; waits: DeptWait[]; tz: string }
export type FirstJobView = FirstJobOffer | FirstJobRunning;

/** The pick for the current business now, with what the tap needs. Also used by the action to check the tap. */
/** What the first job reads from the floor. The Desk passes its floor; setup reads this much only (jobFloor), never getFloor. */
export type JobFloor = Pick<Floor, "now" | "tz" | "agents" | "runs" | "health" | "approvalsPending">;

/** A small floor for setup's wrap-up (card 186): the agents, the last two days of runs and the approvals waiting. */
export async function jobFloor(health: Floor["health"]): Promise<JobFloor> {
  const now = Date.now();
  const [a, r, ap, tz] = await Promise.all([
    db().from("agents").select("id, name, model, enabled, daily_budget_usd"),
    db().from("agent_runs").select(RUN_COLS).gte("started_at", new Date(now - 2 * 86400e3).toISOString()).order("started_at", { ascending: false }).limit(200),
    db().from("approvals").select("id", { count: "exact", head: true }).eq("status", "pending"),
    orgTz(),
  ]);
  if (a.error) throw new Error(`Agents: ${a.error.message}`);
  const agents = Object.fromEntries(((a.data ?? []) as Floor["agents"][string][]).map((x) => [x.id, x]));
  return { now, tz, agents, runs: r.error ? [] : (r.data ?? []) as Run[], health, approvalsPending: ap.error ? null : ap.count ?? 0 };
}

export async function currentPick(f: Pick<JobFloor, "agents" | "health">): Promise<{ job: FirstJob | null; waits: DeptWait[]; pending: Map<string, string[]>; connected: Set<ToolTileId>; built: BuiltCandidate[] }> {
  const [pb, st] = await Promise.all([
    db().from("agent_playbooks").select("agent_id, steps, status").order("version", { ascending: false }),
    setupState(),
  ]);
  if (pb.error) throw new Error(`Playbooks: ${pb.error.message}`);
  // each agent's newest proposed playbook, as its step tools in order; and every agent with any playbook
  const pending = new Map<string, string[]>(), hasOne = new Set<string>();
  for (const r of pb.data ?? []) {
    const id = String(r.agent_id);
    hasOne.add(id);
    if (r.status === "proposed" && !pending.has(id)) pending.set(id, (Array.isArray(r.steps) ? r.steps : []).map((x: { tool?: unknown }) => String(x?.tool ?? "")));
  }
  const installed = new Set(Object.keys(f.agents));
  const connected = await connectedTiles(f.health);
  // card 194: the people of Avery's designed departments that have no playbook yet: their first job is a try
  const built = builtCandidates(st.designs, Object.values(f.agents)).filter((b) => !hasOne.has(b.agentId));
  const base = { setupTemplate: SETUP_TEMPLATE, installed, connected, needsOf, built };
  const job = pickFirstJob(TEMPLATES, { ...base, pending, kindOf });
  return { job, waits: deptWaits(TEMPLATES, base, job?.templateId ?? null), pending, connected, built };
}

/** A designed person's cost for one try, from the spec a hire gets (by hand, so per run). */
async function tryCost(b: BuiltCandidate | undefined, st: Awaited<ReturnType<typeof setupState>>): Promise<MonthCost | null> {
  const p = b && st.designs.flatMap((d) => (d.draft ? [d.draft.head, ...d.draft.agents] : [])).find((x) => x?.name === b.name);
  if (!p) return null;
  const s = hireSpec({ kind: "hire", ...p });
  return monthCostOf({ model: s.model, effort: s.effort, tools: s.tools, maxSteps: s.limits.maxSteps, maxCostUsd: s.limits.maxCostUsd }, null, 0, await billing());
}

const stepLabels = (steps: readonly { tool: string }[]) => steps.map((s) => toolLabel(s.tool));

export async function firstJobView(f: JobFloor): Promise<FirstJobView | null> {
  const st = await setupState();
  const ph = firstJobPhase(st, f.runs, f.now);
  if (!ph) return null;
  if (ph.phase === "offer") {
    const { job, waits, pending, built } = await currentPick(f);
    if (!job) return { phase: "offer", job: null, waits, averyWaits: pending.has(SETUP_AGENT) };
    if (job.kind === "try") {
      const b = built.find((x) => x.agentId === job.agentId);
      return { phase: "offer", job: { ...job, steps: [...new Set((b?.tools ?? []).map(toolLabel))], cost: await tryCost(b, st), playbookId: 0 }, waits, averyWaits: pending.has(SETUP_AGENT) };
    }
    const pb = pendingPlaybook(await listPlaybooks(job.agentId));
    const t = TEMPLATES.find((x) => x.id === job.templateId)!;
    const cost = agentsOf(t, { toolLabel, costOf: costsFor(await billing()) }).find((a) => a.id === job.agentId)?.cost ?? null;
    return { phase: "offer", job: pb ? { ...job, steps: stepLabels(pb.steps.filter((_, i) => job.keep.includes(i))), cost, playbookId: pb.id } : null, waits, averyWaits: pending.has(SETUP_AGENT) };
  }
  const agentId = st.firstJob!.agentId, kind = st.firstJob!.kind;
  const [all, connected] = await Promise.all([listPlaybooks(agentId), connectedTiles(f.health)]);
  const built = builtCandidates(st.designs, Object.values(f.agents));
  const templateId = TEMPLATES.find((t) => t.agents.some((a) => a.id === agentId))?.id ?? built.find((b) => b.agentId === agentId)?.deptId ?? null;
  // a try is a preview run, which the Desk's floor leaves out: read it here (card 194)
  let run = ph.phase === "running" || ph.phase === "done" ? ph.run : null;
  if (kind === "try" && !run) {
    const { data } = await db().from("agent_runs").select(RUN_COLS).eq("agent_id", agentId).eq("trigger", "preview").gte("started_at", new Date(Date.parse(st.firstJob!.at) - 60e3).toISOString()).order("started_at", { ascending: true }).limit(1);
    run = ((data ?? []) as Run[])[0] ?? null;
  }
  const done = !!run && run.status !== "running";
  return {
    phase: done ? "done" : "running", kind, agentId, name: f.agents[agentId]?.name ?? agentId,
    steps: kind === "try" ? stepLabels(pendingPlaybook(all)?.steps ?? []) : stepLabels(activePlaybook(all)?.steps ?? []), run, approvalsPending: f.approvalsPending, tz: f.tz,
    waits: deptWaits(TEMPLATES, { setupTemplate: SETUP_TEMPLATE, installed: new Set(Object.keys(f.agents)), connected, needsOf, built }, templateId),
  };
}
