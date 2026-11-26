import "server-only";
// What a department's Overview tab reads beyond the roster (overview slice 1): where each agent runs, the
// department's approval cards from the last 7 days, and the newest firing of each of its chains. All through
// db(), so every read is this org's. The numbers are worked out in dashboard/overview-rules.ts.
import { db } from "@/core/db";
import type { Chain } from "@/core/flow-rules";
import { chainLast, type ChainLast, type OvCard, type OvChainOk, type OvChainRun } from "./overview-rules";

const DAY = 864e5;

/** The agents of these that run in Claude (runs_on = 'claude'); none before that migration. */
export async function inClaude(ids: readonly string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const { data, error } = await db().from("agents").select("id, runs_on").in("id", [...ids]);
  if (error) return new Set();
  return new Set((data ?? []).filter((a) => a.runs_on === "claude").map((a) => a.id as string));
}

/** The department's approval cards made in the last 7 days: how each ended. */
export async function deptCards(deptId: string, now: number): Promise<OvCard[]> {
  const { data, error } = await db().from("approvals").select("status, created_at").eq("department_id", deptId)
    .gte("created_at", new Date(now - 7 * DAY).toISOString()).limit(500);
  return error ? [] : ((data ?? []) as OvCard[]);
}

/** A chain is the department's when the department owns it, one of its agents owns it, or (no owner) one of its agents is a step. */
export function deptChains(chains: readonly Chain[], deptId: string, agentIds: readonly string[]): Chain[] {
  const mine = new Set(agentIds);
  return chains.filter((c) => {
    const o = c.owner;
    if (o && "dept" in o) return o.dept === deptId;
    if (o && "agent" in o) return mine.has(o.agent);
    return c.steps.some((s) => !!s.agent && mine.has(s.agent));
  });
}

export interface ChainRow { key: string; name: string; on: boolean; steps: string[]; last: ChainLast | null }
/** Each chain with the names of its steps and how its newest firing (last 30 days) went. */
export async function chainRows(chains: readonly Chain[], names: Record<string, string>, now: number): Promise<ChainRow[]> {
  if (!chains.length) return [];
  const keys = chains.map((c) => c.key);
  const { data: runData } = await db().from("agent_runs").select("chain_key, chain_id, chain_step, status, started_at")
    .in("chain_key", keys).gte("started_at", new Date(now - 30 * DAY).toISOString()).order("started_at", { ascending: false }).limit(800);
  const runs = ((runData ?? []) as OvChainRun[]).filter((r) => r.chain_id);
  const firings = [...new Set(runs.map((r) => r.chain_id))].slice(0, 200);
  const okRes = firings.length ? await db().from("chain_oks").select("chain_id, step, status").in("chain_id", firings).limit(800) : null;
  const oks = okRes && !okRes.error ? ((okRes.data ?? []) as OvChainOk[]) : [];
  return chains.map((c) => ({
    key: c.key, name: c.name, on: c.on,
    steps: c.steps.map((s) => (s.agent ? names[s.agent] ?? s.agent : s.ask ? "Ask a model" : s.image ? "Make an image" : "Your OK")),
    last: chainLast(c.key, c.steps.length, runs, oks),
  }));
}

/** The company's saved daily numbers from `fromDay` on (overview slice 3): revenue, orders and cash, a row per saved day. */
export async function snapshotsSince(fromDay: string): Promise<import("./company-overview-rules").Snap[] | null> {
  const { data, error } = await db().from("kpi_snapshots").select("date, revenue, orders, cash_usd").gte("date", fromDay).order("date", { ascending: true }).limit(120);
  if (error) return null;
  return (data ?? []).map((r) => ({ date: String(r.date), revenue: Number(r.revenue) || 0, orders: Number(r.orders) || 0, cash_usd: r.cash_usd == null ? null : Number(r.cash_usd) }));
}
