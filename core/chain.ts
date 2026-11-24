import "server-only";
// Running chains (core/flow.ts): each step is a job (core/jobs.ts, docs/tenancy.md slice 3), run by
// a worker request as the job's org, with its own time limit and through withRun like any other run.
// A job only names a chain and a step of the SAVED flow; the worker reads the flow for the agent, so
// nothing outside the flow (an inbound email, a web page, a run's output) can choose what runs.
import { orgTz } from "@/core/tz";
import { loadCrew, resolveAgent } from "@/agents/registry";
import { db } from "@/core/db";
import { MAX_HOPS, afterStep, followersOf, loadFlow, type Chain, type Ended, type Flow } from "@/core/flow";
import { chainDedupe, chainPayload, type ChainCtx } from "@/core/job-rules";
import { enqueue, kick } from "@/core/jobs";
import { orgOn } from "@/core/org-switch";
import { withRun } from "@/core/runs";
import { eventSummary, isEventType, type EventFacts } from "@/core/event-rules";
import { waitsOnClaude } from "@/core/claude-agents";

export type { ChainCtx } from "@/core/job-rules";

/**
 * Starts one step: enqueues it as a job of the current org and, unless it waits for a time,
 * kicks a worker for it. Resolves in seconds; the run itself happens in the worker.
 */
export async function startStep(origin: string, c: Chain, ctx: ChainCtx, runAfter?: number): Promise<void> {
  if (!c.steps[ctx.step]) return;
  const id = await enqueue("chain_step", chainPayload(ctx), chainDedupe(ctx), runAfter);
  if (id && !runAfter) await kick(origin, id);
}

/**
 * After a chain run ends: start the next step now, enqueue it for its "not before" time (the
 * scheduler kicks it then), or stop. Returns what happened, in words, for the log.
 */
export async function continueChain(origin: string, c: Chain, ctx: ChainCtx, runId: string, ended: Ended, flow?: Flow): Promise<string> {
  const next = afterStep(c, ctx.step, ended, await orgTz());
  if (!next.go) {
    // the chain's last step ended: start the chains saved to start after it (chains slice 1)
    if (!c.steps[ctx.step + 1] && flow) { const more = await startFollowers(origin, flow, c, ctx, runId, ended.status); if (more) return `${next.why} ${more}`; }
    return next.why;
  }
  const nctx: ChainCtx = { chainId: ctx.chainId, key: ctx.key, step: next.step, parent: runId, manual: ctx.manual, ...(ctx.hops ? { hops: ctx.hops } : {}) };
  await startStep(origin, c, nctx, next.at ?? undefined);
  return next.at ? `Step ${next.step + 1} waits until ${new Date(next.at).toISOString()}.` : `Step ${next.step + 1} started.`;
}

/**
 * After chain `c` finished: start each chain that is on and saved to start after it, while the org is on, its first
 * step getting `runId` as the step before (so "pass along" hands it the last step's summary). At most MAX_HOPS chains
 * in a row from one start, so a mistake can't loop; the saved flow refuses circles too.
 */
async function startFollowers(origin: string, flow: Flow, c: Chain, ctx: ChainCtx, runId: string, ended: Ended["status"]): Promise<string> {
  const next = followersOf(flow, c.key, ended);
  if (!next.length) return "";
  const hops = (ctx.hops ?? 0) + 1;
  if (hops > MAX_HOPS) return `It didn’t start ${next.map((x) => x.name).join(", ")}: ${MAX_HOPS} chains in a row is the most.`;
  if (!(await orgOn())) return "The org is off, so the chains after it didn’t start.";
  for (const f of next) await startStep(origin, f, { chainId: crypto.randomUUID(), key: f.key, step: 0, parent: runId, hops });
  return `Started ${next.map((x) => x.name).join(", ")}.`;
}

/**
 * Runs one chain step for the worker, as the current org. The chain and agent come from the saved
 * flow. A chain that is off, or any chain while the org is off, runs only when it was started with
 * the Run chain button. Returns what happened, and the run when there was one.
 */
export async function runChainStep(origin: string, ctx: ChainCtx): Promise<{ outcome: string; runId?: string; failed?: boolean }> {
  const flow = await loadFlow(await loadCrew());
  const c = flow.flow.chains.find((x) => x.key === ctx.key);
  const step = c?.steps[ctx.step];
  if (!c || !step) return { outcome: "Skipped: that step isn't in the saved crew flow." };
  if (!ctx.manual && !c.on) return { outcome: `Skipped: the ${c.name} chain is off.` };
  if (!ctx.manual && !(await orgOn())) return { outcome: "Skipped: the org is off." };
  const found = await resolveAgent(step.agent);
  if (!found) return { outcome: `Skipped: ${step.agent} isn't an agent.` };
  // a manual-only agent runs in a chain only when the owner pressed Run chain
  if (found.manualOnly && !ctx.manual) return { outcome: "Skipped: this agent runs only by hand; start its chain with Run chain." };
  // the first step of a chain an event started reads that event (docs/live-events.md); later steps read the step before
  const handoff = ctx.event && ctx.step === 0 ? await eventHandoff(ctx.event, ctx.held ?? 0) : step.passAlong ? await handoffFrom(ctx.parent) : null;
  const log = (w: string) => console.log(`[chain ${c.key}] ${w}`);
  try {
    const res = await withRun(found.id, "chain", (runId, memory) => found.job({ runId, memory, handoff, chain: ctx }), { chain: { chainId: ctx.chainId, key: ctx.key, step: ctx.step, parent: ctx.parent } });
    // a step in Claude (card 405): the chain goes on when its session posts a result (finish_run), or fails after 24 hours
    if (await waitsOnClaude(res.runId)) {
      log(`step ${ctx.step + 1} waits for its Claude session`);
      return { outcome: `Run ${res.status}. Started in Claude: the chain goes on when its session posts a result.`, runId: res.runId };
    }
    const then = await continueChain(origin, c, ctx, res.runId, { status: res.status, metrics: res.metrics }, flow.flow).catch((e) => `The next step couldn't start: ${e instanceof Error ? e.message : e}`);
    log(then);
    return { outcome: `Run ${res.status}. ${then}`, runId: res.runId };
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    console.error(`[chain ${c.key}] step ${ctx.step + 1}`, why);
    // a failed step can still lead somewhere (a step with when "failed" or "any")
    const { data } = await db().from("agent_runs").select("id").eq("chain_id", ctx.chainId).eq("chain_step", ctx.step).order("started_at", { ascending: false }).limit(1).maybeSingle();
    let then = "";
    if (data) then = await continueChain(origin, c, ctx, data.id as string, { status: "failed" }, flow.flow).catch((x) => `The next step couldn't start: ${x instanceof Error ? x.message : x}`);
    if (then) log(then);
    return { outcome: `Run failed: ${why} ${then}`.trim(), runId: data?.id as string | undefined, failed: true };
  }
}

/**
 * Goes on with a chain after a step in Claude ended (card 405): its session posted a result with finish_run, or
 * none came within 24 hours (failed). The chain is read from the saved flow again; the step's own ctx keeps how
 * the chain was started (Run chain or not), so the next step meets the same checks it would have.
 */
export async function resumeChain(origin: string, ctx: ChainCtx, runId: string, status: "ok" | "failed"): Promise<string> {
  const flow = await loadFlow(await loadCrew());
  const c = flow.flow.chains.find((x) => x.key === ctx.key);
  if (!c) return "The chain isn't in the saved crew flow any more.";
  const then = await continueChain(origin, c, ctx, runId, { status }, flow.flow);
  console.log(`[chain ${c.key}] after Claude: ${then}`);
  return then;
}

/** Claims a scheduled firing; false when another call already started it. */
export async function claimFiring(key: string, at: number, chainId: string): Promise<boolean> {
  const { error } = await db().from("chain_fires").insert({ chain_key: key, fire_at: new Date(at).toISOString(), chain_id: chainId });
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new Error(error.message);
}

/** The run before, handed to the next agent as facts: who it was, how it ended, its summary and numbers. */
/**
 * The event that started a chain, handed to its first step as facts (docs/live-events.md): its label, the
 * words written in code from its named fields, and its numbers. Null when the row is gone (kept 30 days).
 */
export async function eventHandoff(id: string, held: number): Promise<Handoff | null> {
  const { data } = await db().from("inbound_events").select("event_type, facts, received_at").eq("id", id).maybeSingle();
  if (!data || !isEventType(data.event_type)) return null;
  const f = data.facts as EventFacts;
  return { from: f.label, status: "ok", summary: eventSummary(f, held).slice(0, 1500), metrics: f.numbers ?? {}, endedAt: data.received_at as string, kind: "event" };
}

/** What one step hands the next, or (kind "event") what started the chain. Data, never instructions. */
export interface Handoff { from: string; status: string; summary: string; metrics: Record<string, number>; endedAt: string | null; kind?: "event" }

export async function handoffFrom(parent: string | undefined): Promise<Handoff | null> {
  if (!parent) return null;
  const { data } = await db().from("agent_runs").select("agent_id, status, summary, error, metrics, ended_at").eq("id", parent).maybeSingle();
  if (!data) return null;
  return { from: data.agent_id as string, status: data.status as string, summary: ((data.summary ?? data.error ?? "") as string).slice(0, 1500), metrics: (data.metrics ?? {}) as Record<string, number>, endedAt: data.ended_at as string | null };
}

/**
 * An approval was decided in the Control Room: while the org is on, start every chain that is on and starts on this
 * kind of approval. At most once a minute per chain, so approving twenty receipts at once starts
 * a chain once.
 */
export async function approvalDecided(origin: string, flow: { chains: Chain[] }, tool: string, decision: "approve" | "reject"): Promise<string[]> {
  const started: string[] = [];
  // while the org is off nothing starts on its own, an approval start included
  if (!(await orgOn())) return started;
  const minute = Math.floor(Date.now() / 6e4) * 6e4;
  for (const c of flow.chains) {
    if (!c.on || c.start.type !== "approval" || c.start.tool !== tool || (c.start.decision !== "any" && c.start.decision !== decision)) continue;
    const chainId = crypto.randomUUID();
    if (!(await claimFiring(c.key, minute, chainId))) continue;
    started.push(c.name);
    await startStep(origin, c, { chainId, key: c.key, step: 0 });
  }
  return started;
}
