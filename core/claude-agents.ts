import "server-only";
// Agents that run in Claude (docs/live-events.md, slice 2): the server side. A linked agent is an agent row
// with runs_on "claude". Its runs still go through withRun (on duty, budget, the run log); instead of the
// runner, the run fires the agent's Claude routine with a note written in code, saves the session it started
// on the run, and later takes the session's result through finish_run on OPERATOR's own MCP server.
// The fire is integrations/mcp.ts fireRoutine, the only code that opens the routine's token.
import { db } from "@/core/db";
import { env } from "@/core/env";
import { loadSpec } from "@/core/agent-spec";
import { fireRoutine, removeRoutine } from "@/integrations/mcp";
import { fireFits, fireNote, fireStart, finishable, FINISH, NO_RESULT, ROUTINE_CAPS, type RunsOn } from "@/core/routine-rules";
import { readChainPayload, type ChainCtx } from "@/core/job-rules";
import type { RunResult } from "@/core/runs";
import type { Handoff } from "@/core/chain";

export interface ClaudeSession {
  id: string; url: string; fired_at: string; finished_at?: string | null; result?: string | null; status?: "ok" | "failed" | null;
  /** The chain step this run is (card 405): the chain waits for the session's result, then goes on from here. */
  chain?: ChainCtx | null;
}

/** Where an agent runs. An agent row before the migration runs in OPERATOR. */
export async function runsOn(agentId: string): Promise<{ on: RunsOn }> {
  const { data, error } = await db().from("agents").select("runs_on").eq("id", agentId).maybeSingle();
  if (error || !data) return { on: "operator" };
  return { on: data.runs_on === "claude" ? "claude" : "operator" };
}

/** Fires in the last hour, for this agent and for the whole business. */
async function firesLastHour(agentId: string): Promise<{ agent: number; org: number }> {
  const since = new Date(Date.now() - 3600_000).toISOString();
  const count = async (one: boolean) => {
    let q = db().from("agent_runs").select("id", { count: "exact", head: true }).not("claude_session", "is", null).gte("started_at", since);
    if (one) q = q.eq("agent_id", agentId);
    const { count: n, error } = await q;
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  const [agent, org] = await Promise.all([count(true), count(false)]);
  return { agent, org };
}

/**
 * One run of a linked agent, inside withRun: fires its routine and saves the session on the run. The run ends
 * "ok" once the session started; its result arrives when the session calls finish_run.
 */
export async function fireLinked(agentId: string, runId: string | undefined, handoff: Handoff | null | undefined, origin = env.dashboardUrl ?? "", chain: ChainCtx | null = null): Promise<RunResult> {
  if (!runId) return { status: "skipped", summary: "A linked agent runs only as a logged run." };
  const n = await firesLastHour(agentId);
  if (!fireFits(n.agent, n.org)) return { status: "skipped", summary: `Not fired: OPERATOR fires Claude routines at most ${ROUTINE_CAPS.perAgentHour} times an hour per agent and ${ROUTINE_CAPS.perOrgHour} per business.` };
  const [{ data: run }, spec, { data: agent }] = await Promise.all([
    db().from("agent_runs").select("trigger").eq("id", runId).maybeSingle(),
    loadSpec(agentId),
    db().from("agents").select("name").eq("id", agentId).maybeSingle(),
  ]);
  const text = fireNote({
    agentName: (agent?.name as string | undefined) ?? spec?.spec.name ?? agentId, agentId, runId,
    start: fireStart(String(run?.trigger ?? "cron"), handoff?.kind),
    job: spec?.spec.directive || spec?.spec.mandate || "Do the job you were set up for.",
    handoff: handoff ? { from: handoff.from, summary: handoff.summary, metrics: handoff.metrics } : null,
    origin,
  });
  const got = await fireRoutine(agentId, text);
  if ("problem" in got) {
    if (got.mayHaveStarted) return { status: "ok", summary: `[Claude] ${got.problem}` };
    throw new Error(got.problem);
  }
  const session: ClaudeSession = { id: got.session.id, url: got.session.url, fired_at: new Date().toISOString(), finished_at: null, result: null, status: null, ...(chain ? { chain } : {}) };
  const { error } = await db().from("agent_runs").update({ claude_session: session }).eq("id", runId);
  if (error) console.error("[claude-agents] session", error.message);
  return { status: "ok", summary: `[Claude] Started in Claude: ${got.session.url}. Its result shows here when the session calls finish_run.${chain ? " The chain goes on once it does." : ""}` };
}

/**
 * Takes a Claude session's result onto its run (finish_run). Only a run of a linked agent that started a
 * session, once, within FINISH.withinHours. The result is the session's words: data, labelled as such.
 */
export async function finishRun(runId: string, status: "ok" | "failed", result: string, numbers: Record<string, number> = {}): Promise<{ agentId: string; chain: ChainCtx | null } | { problem: string }> {
  const { data, error } = await db().from("agent_runs").select("id, agent_id, claude_session, metrics").eq("id", runId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return { problem: "There is no run with that id in this business." };
  // the session's own numbers (overview slice 4) join the run's metrics, so charts, reports and the next chain step see them
  const metrics = Object.keys(numbers).length ? { ...((data.metrics as Record<string, unknown> | null) ?? {}), ...numbers } : null;
  const s = data.claude_session as ClaudeSession | null;
  const why = finishable(s);
  if (why) return { problem: why };
  const at = new Date().toISOString();
  const next: ClaudeSession = { ...s!, finished_at: at, result, status };
  const { data: done, error: e2 } = await db().from("agent_runs").update({
    claude_session: next, status, summary: `[Claude, written by the session] ${result}`, ...(status === "failed" ? { error: result.slice(0, 500) } : {}),
    ...(metrics ? { metrics } : {}),
  }).eq("id", runId).is("claude_session->>finished_at", null).select("id");
  if (e2) throw new Error(e2.message);
  if (!done?.length) return { problem: "That run already has its result." };
  return { agentId: data.agent_id as string, chain: readChainPayload(s!.chain) };
}

/**
 * Runs in Claude whose session posted nothing within FINISH.withinHours: each is finished as failed, once, so it
 * stops showing as running (2026-11-27; until then only chain steps were). Chain steps (card 405) are returned so
 * the scheduler can go on with their chain. At most `limit` a call.
 */
export async function expireWaits(now = Date.now(), limit = 20): Promise<{ runId: string; chain: ChainCtx }[]> {
  const before = new Date(now - FINISH.withinHours * 3600_000).toISOString();
  const { data, error } = await db().from("agent_runs").select("id, claude_session")
    .not("claude_session->>fired_at", "is", null).is("claude_session->>finished_at", null).lt("started_at", before).limit(limit);
  if (error) throw new Error(error.message);
  const out: { runId: string; chain: ChainCtx }[] = [];
  for (const r of data ?? []) {
    const s = r.claude_session as ClaudeSession;
    const chain = readChainPayload(s.chain);
    const next: ClaudeSession = { ...s, finished_at: new Date(now).toISOString(), status: "failed", result: null };
    const { data: done, error: e2 } = await db().from("agent_runs").update({ claude_session: next, status: "failed", error: NO_RESULT, summary: `[Claude] ${NO_RESULT}` })
      .eq("id", r.id).is("claude_session->>finished_at", null).select("id");
    if (e2) throw new Error(e2.message);
    if (done?.length && chain) out.push({ runId: r.id as string, chain });
  }
  return out;
}

/** Whether this run is a chain step in Claude still waiting on its session (the chain goes on from finish_run). */
export async function waitsOnClaude(runId: string): Promise<boolean> {
  const { data } = await db().from("agent_runs").select("claude_session").eq("id", runId).maybeSingle();
  return !!(data?.claude_session as ClaudeSession | null)?.chain;
}

/**
 * A linked agent: it runs as the owner's Claude routine. Its routine id and token are all OPERATOR needs; the routine's
 * own connectors are set on claude.ai and never named or granted here (decided 2026-11-24). Clears the old labels.
 */
export async function markLinked(agentId: string): Promise<void> {
  const { error } = await db().from("agents").update({ runs_on: "claude", claude_tools: [] }).eq("id", agentId);
  if (error) throw new Error(error.message);
}

/**
 * Move into OPERATOR: the same agent runs on the runner from now on, keeping its runs and history. Its routine
 * token is forgotten. It still needs an approved routine and the reads its job uses, set on its sheet.
 */
export async function moveIntoOperator(agentId: string): Promise<void> {
  const { error } = await db().from("agents").update({ runs_on: "operator", claude_tools: [] }).eq("id", agentId).eq("runs_on", "claude");
  if (error) throw new Error(error.message);
  await removeRoutine(agentId);
}
