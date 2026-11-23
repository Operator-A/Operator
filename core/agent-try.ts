import "server-only";
// A try (builder step 5, and try_agent on OPERATOR's own MCP server): one real run of an agent's draft, or
// its live version when there is no draft, on today's data. Logged through withRun with trigger "preview"
// and its spec version, so it counts against the agent's daily budget like any run, and runs while the
// agent is off duty. It sends nothing, queues nothing and saves no output for other agents; afterwards
// code drafts or updates the routine (core/playbook.ts), which Go live approves in OPERATOR.
import { after } from "next/server";
import { db } from "@/core/db";
import { orgId, withOrg } from "@/core/tenancy";
import { withRun } from "@/core/runs";
import { draftOf, listSpecVersions } from "@/core/agent-spec";
import { runExplore, type PlaybookStep } from "@/core/runner";
import { activePlaybook, afterRun, listPlaybooks } from "@/core/playbook";
import { loadMemory } from "@/core/memory";

/** The version a try runs: the draft, else the live one. A string says why there is none. */
export async function tryTarget(agentId: string) {
  if (typeof agentId !== "string" || !/^[a-z0-9_]{1,60}$/.test(agentId)) return "Unknown agent.";
  const { data, error } = await db().from("agent_defs").select("version").eq("agent_id", agentId).limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) return "That agent wasn’t built in the app, so it can’t be tried here.";
  const versions = await listSpecVersions(agentId);
  const target = draftOf(versions) ?? versions.find((v) => v.active);
  if (!target) return "That agent has no saved version.";
  if (target.problems.length) return `v${target.version} asks for something code doesn’t offer: ${target.problems.join("; ")}.`;
  return target;
}
export type TryTarget = Exclude<Awaited<ReturnType<typeof tryTarget>>, string>;

/**
 * One try (trigger preview): sends nothing, queues nothing, saves no output for other agents; afterwards
 * code drafts or updates the routine. `started` is called once the run is logged.
 */
export async function tryOnce(agentId: string, target: TryTarget, fresh: boolean, started: () => void = () => {}) {
  let block = "";
  try { block = (await loadMemory(agentId)).block; } catch { /* a try without memory is fine */ }
  let playbook: { version: number; steps: PlaybookStep[] } | undefined;
  if (!fresh) { try { const a = activePlaybook(await listPlaybooks(agentId)); if (a) playbook = { version: a.version, steps: a.steps }; } catch { /* no playbook table yet: explore */ } }
  let got: Awaited<ReturnType<typeof runExplore>> | null = null;
  let rid: string | null = null;
  const res = await withRun(agentId, "preview", async (runId) => {
    rid = runId; started();
    const r = await runExplore(target.spec, { agentId, runId, memoryBlock: block, playbook, trying: true });
    got = r;
    return { status: r.status, summary: r.summary, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd, metrics: { ...r.metrics, spec_version: target.version } };
  });
  let note = "";
  if (got) { try { note = ` ${await afterRun(agentId, rid, got)}`; } catch (e) { note = ` (Routine not updated: ${e instanceof Error ? e.message : String(e)})`; } }
  return { res, note, rid: rid as string | null, version: target.version };
}

export type Started =
  | { started: true; runId: string | null; version: number }
  | { started: false; done: Awaited<ReturnType<typeof tryOnce>> };

/**
 * A try in the background: it answers once the run is logged (or, when it ends before that, with how it
 * ended), and keeps running after the answer. Throws when the try couldn't start.
 */
export async function startTry(agentId: string, target: TryTarget, fresh: boolean): Promise<Started> {
  let markStarted: () => void = () => {};
  let runId: string | null = null;
  const started = new Promise<null>((resolve) => { markStarted = () => resolve(null); });
  const org = await orgId();
  const run = withOrg(org, () => tryOnce(agentId, target, fresh, markStarted))
    .then((res) => { runId = res.rid; return { res }; }, (err: unknown) => { console.error(`[try] ${agentId} try failed`, err); return { err }; });
  after(run);
  const first = await Promise.race([started, run]);
  if (first === null) {
    // the run row exists now: read its id from the newest preview run of this agent
    const { data } = await db().from("agent_runs").select("id").eq("agent_id", agentId).eq("trigger", "preview").order("started_at", { ascending: false }).limit(1).maybeSingle();
    return { started: true, runId: runId ?? (data?.id as string | undefined) ?? null, version: target.version };
  }
  if ("err" in first) throw first.err;
  return { started: false, done: first.res };
}
