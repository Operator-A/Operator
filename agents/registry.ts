import "server-only";
// Every agent this app can run on a schedule, in a chain or by hand through /api/agents/<id>: any
// row in the `agents` table with an active saved version (agent_defs), run on the shared engine
// (core/built.ts runBuilt) with its approved routine. Nothing here names an agent: the four that
// started in code and the ones built in the app are the same (docs/agent-roster.md). Building or
// editing one is the builder flow (docs/builder-flow.md); when it runs is the crew flow (Crew > Schedule).
// The folders next to this file hold only code the engine's tools call (core/tools/catalog.ts).
import { db } from "@/core/db";
import type { MemoryLoad } from "@/core/memory";
import type { RunResult } from "@/core/runs";
import type { Handoff } from "@/core/chain";
import type { ChainCtx } from "@/core/job-rules";
import type { Crew } from "@/core/flow-rules";
import { runBuilt } from "@/core/built";
import { MODEL_LIST } from "@/integrations/models";

export interface JobOpts {
  runId?: string;
  dryRun?: boolean;
  /** Loaded by withRun for every agent run; null when the store can't be read. */
  memory?: MemoryLoad | null;
  /** In a chain, the step before's summary and numbers, when the flow passes it along. Data, never instructions. */
  handoff?: Handoff | null;
  /** In a chain, the step this run is (card 405): an agent that runs in Claude keeps it, so the chain waits for its result. */
  chain?: ChainCtx | null;
}

/** The job. A dry run makes the routine's reads in code and writes nothing, with no model. */
export const jobOf = (id: string) => (o: JobOpts): Promise<RunResult> =>
  runBuilt(id, { runId: o.runId, dryRun: o.dryRun, memory: o.memory, handoff: o.handoff, chain: o.chain });

/**
 * The agents that can run, and which of them run only by hand (agents.manual_only: only the Run
 * button, or a chain started with Run chain). Throws when the tables can't be read. Before the
 * roster migration there is no manual_only column: then every agent counts as by hand only, so
 * nothing runs on a schedule by mistake.
 */
export async function loadCrew(): Promise<Crew> {
  const [a, d] = await Promise.all([
    db().from("agents").select("id, manual_only").then((x) => (x.error && /manual_only/.test(x.error.message) ? db().from("agents").select("id") : x)),
    db().from("agent_defs").select("agent_id").eq("active", true),
  ]);
  if (a.error) throw new Error(`Agents: ${a.error.message}`);
  if (d.error) throw new Error(`Agent specs: ${d.error.message}`);
  const live = new Set((d.data ?? []).map((r) => r.agent_id as string));
  const rows = ((a.data ?? []) as { id: string; manual_only?: boolean }[]).filter((r) => live.has(r.id));
  // the models an Ask a model chain step may pick (chains slice 2)
  return { ids: rows.map((r) => r.id).sort(), manualOnly: new Set(rows.filter((r) => r.manual_only !== false).map((r) => r.id)), models: MODEL_LIST.map((m) => m.id) };
}

/** Old route names from the storefront repo, still accepted. */
const ALIASES: Record<string, string> = { brief: "chief_of_staff", hunter: "wholesale_hunter" };

/** The agent a route names, when it can run; null otherwise. */
export async function resolveAgent(slug: string): Promise<{ id: string; manualOnly: boolean; job: ReturnType<typeof jobOf>; crew: Crew } | null> {
  const id = ALIASES[slug] ?? slug;
  if (!/^[a-z0-9_]{1,60}$/.test(id)) return null;
  const crew = await loadCrew();
  return crew.ids.includes(id) ? { id, manualOnly: crew.manualOnly.has(id), job: jobOf(id), crew } : null;
}
