import "server-only";
// One chain run as the run view (chains slice 5, docs/chains.md), read for the run page (dashboard/data.ts
// getChainRuns) and for OPERATOR's MCP server (get_chain_run, docs/operator-mcp.md): the chain as saved now, this
// chain run's agent_runs and chain_oks rows, and the labels the timeline needs. core/run-view-rules.ts does the rest.
import { db } from "@/core/db";
import { loadCrew } from "@/agents/registry";
import { loadFlow, type Step } from "@/core/flow";
import { agentNames } from "@/core/org";
import { imageLink } from "@/core/image-step";
import { MODEL_LIST } from "@/integrations/models";
import { timeline as buildTimeline, type RunStatus, type Timeline, type TimelineOk, type TimelineRun } from "@/core/run-view-rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const modelLabel = (id: string) => MODEL_LIST.find((m) => m.id === id)?.label ?? id;

export interface ChainRunView { chainId: string; key: string; name: string; timeline: Timeline }

/** The run view of the chain run `runId` belongs to; null when it isn't a run in a chain of this business. */
export async function chainRunView(runId: string, when: (iso: string) => string): Promise<ChainRunView | null> {
  if (!UUID.test(runId)) return null;
  const { data: me, error } = await db().from("agent_runs").select("chain_id, chain_key").eq("id", runId).maybeSingle();
  if (error || !me?.chain_id) return null;
  const [{ data }, oks, agents, crew] = await Promise.all([
    db().from("agent_runs").select("id, agent_id, chain_step, status, started_at, ended_at, cost_usd, summary, error").eq("chain_id", me.chain_id).order("chain_step").order("started_at"),
    // the Wait for my OK holds of this chain run; none when that table isn't there yet
    db().from("chain_oks").select("step, status, decided_by, decided_at, created_at, due_at").eq("chain_id", me.chain_id).then((x) => x.data ?? [], () => []),
    db().from("agents").select("id, runs_on, model").then((x) => x.data ?? [], () => []),
    loadCrew(),
  ]);
  let name = me.chain_key as string, steps: Step[] = [];
  try {
    const c = (await loadFlow(crew)).flow.chains.find((x) => x.key === me.chain_key);
    if (c) { name = c.name; steps = c.steps; }
  } catch { /* the flow can't be read: show the runs alone */ }
  const runs: TimelineRun[] = (data ?? []).map((x) => ({ id: x.id, step: Number(x.chain_step ?? 0), agentId: x.agent_id, status: x.status as RunStatus, startedAt: x.started_at, endedAt: x.ended_at, costUsd: Number(x.cost_usd ?? 0), summary: (x.summary ?? x.error ?? null) as string | null }));
  const rows = new Map((agents as { id: string; runs_on: string | null; model: string | null }[]).map((a) => [a.id, a]));
  const names = await agentNames([...new Set([...runs.map((r) => r.agentId), ...steps.flatMap((s) => (s.agent ? [s.agent] : []))])]);
  const holds = (oks as { step: number; status: TimelineOk["status"]; decided_by: string | null; decided_at: string | null; created_at: string; due_at: string }[])
    .map((o) => ({ step: o.step, status: o.status, decidedBy: o.decided_by, decidedAt: o.decided_at, createdAt: o.created_at, dueAt: o.due_at }));
  const timeline = buildTimeline(steps, runs, holds, {
    agent: (id) => names[id] ?? id,
    claude: (id) => rows.get(id)?.runs_on === "claude",
    agentModel: (id) => { const m = rows.get(id)?.model; return m ? modelLabel(m) : null; },
    model: modelLabel,
  }, when);
  return { chainId: me.chain_id as string, key: me.chain_key as string, name, timeline };
}

/** A short signed link to each picture a Make an image step of this chain run kept (slice 4). */
export async function chainRunImages(t: Timeline): Promise<Record<string, string>> {
  const made = t.items.filter((i) => i.kind === "image" && i.runId && i.state === "ok");
  const links = await Promise.all(made.map((i) => imageLink(i.runId!).catch(() => null)));
  return Object.fromEntries(made.flatMap((i, k) => (links[k] ? [[i.runId!, links[k]!]] : [])));
}
