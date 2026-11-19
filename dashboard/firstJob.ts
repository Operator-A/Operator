import "server-only";
// The Desk's first job (card 154, docs/setup.md): what the card shows, read for the current business.
// The pick and the phases are in core/first-job-rules.ts; this reads the setup row, the installed
// agents, the playbooks waiting and the connected tools.
import { db } from "@/core/db";
import { TEMPLATES } from "@/core/templates";
import { TOOLS } from "@/core/tools/catalog";
import { setupState } from "@/core/setup";
import { SETUP_AGENT, SETUP_TEMPLATE } from "@/core/setup-rules";
import { agentsOf } from "@/core/company-rules";
import { deptWaits, firstJobPhase, pickFirstJob, type DeptWait, type FirstJob } from "@/core/first-job-rules";
import type { MonthCost } from "@/core/cost-rules";
import { activePlaybook, listPlaybooks, pendingPlaybook } from "@/core/playbook";
import { costOf, toolLabel } from "./company";
import { connectedTiles } from "./toolsStep";
import type { Floor, Run } from "./data";

const needsOf = (id: string): readonly string[] => (TOOLS as Record<string, { needs?: readonly string[] }>)[id]?.needs ?? [];
const kindOf = (id: string) => (TOOLS as Record<string, { kind?: string }>)[id]?.kind;

export interface FirstJobOffer {
  phase: "offer";
  /** Null when no agent is ready: every department waits on a tool. */
  job: (FirstJob & { steps: string[]; cost: MonthCost | null; playbookId: number }) | null;
  waits: DeptWait[];
  /** Avery's first playbook waits too: the tap approves it, so her 7:00 summary starts. */
  averyWaits: boolean;
}
export interface FirstJobRunning { phase: "running" | "done"; agentId: string; name: string; steps: string[]; run: Run | null; approvalsPending: number | null; waits: DeptWait[] }
export type FirstJobView = FirstJobOffer | FirstJobRunning;

/** The pick for the current business now, with what the tap needs. Also used by the action to check the tap. */
export async function currentPick(f: Floor): Promise<{ job: FirstJob | null; waits: DeptWait[]; pending: Set<string> }> {
  const { data, error } = await db().from("agent_playbooks").select("agent_id").eq("status", "proposed");
  if (error) throw new Error(`Playbooks: ${error.message}`);
  const pending = new Set((data ?? []).map((r) => String(r.agent_id)));
  const installed = new Set(Object.keys(f.agents));
  const connected = await connectedTiles(f.health);
  const base = { setupTemplate: SETUP_TEMPLATE, installed, connected, needsOf };
  const job = pickFirstJob(TEMPLATES, { ...base, pending, kindOf });
  return { job, waits: deptWaits(TEMPLATES, base, job?.templateId ?? null), pending };
}

const stepLabels = (steps: readonly { tool: string }[]) => steps.map((s) => toolLabel(s.tool));

export async function firstJobView(f: Floor): Promise<FirstJobView | null> {
  const st = await setupState();
  const ph = firstJobPhase(st, f.runs, f.now);
  if (!ph) return null;
  if (ph.phase === "offer") {
    const { job, waits, pending } = await currentPick(f);
    if (!job) return { phase: "offer", job: null, waits, averyWaits: pending.has(SETUP_AGENT) };
    const pb = pendingPlaybook(await listPlaybooks(job.agentId));
    const t = TEMPLATES.find((x) => x.id === job.templateId)!;
    const cost = agentsOf(t, { toolLabel, costOf }).find((a) => a.id === job.agentId)?.cost ?? null;
    return { phase: "offer", job: pb ? { ...job, steps: stepLabels(pb.steps), cost, playbookId: pb.id } : null, waits, averyWaits: pending.has(SETUP_AGENT) };
  }
  const agentId = st.firstJob!.agentId;
  const [all, connected] = await Promise.all([listPlaybooks(agentId), connectedTiles(f.health)]);
  const templateId = TEMPLATES.find((t) => t.agents.some((a) => a.id === agentId))?.id ?? null;
  return {
    phase: ph.phase, agentId, name: f.agents[agentId]?.name ?? agentId,
    steps: stepLabels(activePlaybook(all)?.steps ?? []), run: ph.run, approvalsPending: f.approvalsPending,
    waits: deptWaits(TEMPLATES, { setupTemplate: SETUP_TEMPLATE, installed: new Set(Object.keys(f.agents)), connected, needsOf }, templateId),
  };
}
