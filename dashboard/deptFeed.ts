import "server-only";
// The runs in a department's chat (docs/department-pages.md, slice 3): each run of an agent seated in the
// department, its checklist from run_steps, and the drafts it staged that wait on an approver.
import { db } from "@/core/db";
import { TOOLS } from "@/core/tools/catalog";
import type { CrewMember } from "@/dashboard/crew";
import { checklist, inFeed, resultText, type FeedRun, type RunStatus } from "@/dashboard/dept-feed";
import { tryInFeed } from "@/dashboard/hire-rules";

const label = (tool: string) => TOOLS[tool]?.label ?? "Used a connected tool";

/**
 * The department's runs since `since` (default: the last 7 days), plus any still going, oldest first.
 * `fresh`: agents with a hire card, whose tries post too (their first try, slice 5).
 */
export async function deptRuns(agentIds: string[], byId: Record<string, CrewMember>, since?: string, limit = 25, fresh: ReadonlySet<string> = new Set()): Promise<FeedRun[]> {
  if (!agentIds.length) return [];
  const from = since ?? new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: runs, error } = await db().from("agent_runs").select("id, agent_id, trigger, status, started_at, ended_at, summary, error, cost_usd")
    .in("agent_id", agentIds).gte("started_at", from).order("started_at", { ascending: false }).limit(limit * 2);
  if (error) return [];
  const mine = (runs ?? []).filter((r) => inFeed(String(r.trigger)) || tryInFeed(String(r.trigger), String(r.agent_id), fresh)).slice(0, limit);
  if (!mine.length) return [];
  const ids = mine.map((r) => r.id as string);
  const [steps, actions] = await Promise.all([
    db().from("run_steps").select("run_id, idx, kind, tool, ok").in("run_id", ids).order("idx"),
    db().from("agent_actions").select("id, run_id").in("run_id", ids),
  ]);
  const actionRun = new Map((actions.data ?? []).map((a) => [a.id as string, a.run_id as string]));
  const { data: cards } = actionRun.size ? await db().from("approvals").select("id, action_id").eq("status", "pending").in("action_id", [...actionRun.keys()]) : { data: [] };
  const drafts = new Map<string, string[]>();
  for (const c of cards ?? []) { const run = actionRun.get(c.action_id as string); if (run) drafts.set(run, [...(drafts.get(run) ?? []), c.id as string]); }
  return mine.reverse().map((r) => {
    const own = (steps.data ?? []).filter((s) => s.run_id === r.id).map((s) => ({ kind: String(s.kind), tool: (s.tool as string | null) ?? null, ok: !!s.ok }));
    const a = byId[r.agent_id as string];
    const status = (["running", "ok", "failed", "skipped"].includes(r.status) ? r.status : "failed") as RunStatus;
    return {
      id: r.id, agentId: r.agent_id, name: a?.name ?? r.agent_id, role: a?.role ?? "", at: r.started_at, endedAt: r.ended_at ?? null, trigger: String(r.trigger), status,
      lines: checklist(own, label, status === "running"), steps: own.filter((s) => s.kind === "tool").length, costUsd: Number(r.cost_usd ?? 0),
      result: status === "running" ? "" : resultText(r.summary ?? null, r.error ?? null, status), drafts: drafts.get(r.id) ?? [],
    };
  });
}
