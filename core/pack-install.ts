import "server-only";
// Installing a pack into a business that already runs (docs/packs.md, packs slice 3). The rows are worked out in
// core/pack-install-rules.ts; this reads what's there, writes them in order and takes them back out if a write
// fails, so a half-installed department is never left behind. Everything starts switched off: agents off duty,
// playbooks proposed, chains off, no action granted unless the owner turned it on on the confirm sheet.
import { db } from "@/core/db";
import { loadCrew } from "@/agents/registry";
import { loadFlow, saveFlowVersion, type Flow } from "@/core/flow";
import { loadOrg, setHolder } from "@/core/org";
import { liveRows, livePlan, seatFlow, seatPlan, setupSteps, startWords, type LiveOrg, type SetupStep } from "@/core/pack-install-rules";
import { packById } from "@/core/packs";
import type { InstallRows } from "@/core/install-rules";

const ORDER: (keyof InstallRows)[] = ["departments", "agents", "agent_defs", "agent_playbooks", "seats", "goals"];
/** Before the agents.pack migration (20270115090000_agent_pack.sql) agents have no pack column. */
const noPack = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "pack")));
const noOverview = (rows: Record<string, unknown>[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "overview" && k !== "pack")));

async function insert(table: keyof InstallRows, rows: Record<string, unknown>[]) {
  let { error } = await db().from(table).insert(rows);
  if (error && table === "agents" && /pack/.test(error.message)) ({ error } = await db().from(table).insert(noPack(rows)));
  if (error && table === "departments" && /overview|pack/.test(error.message)) ({ error } = await db().from(table).insert(noOverview(rows)));
  if (error) throw new Error(error.message);
}

/** What's in the business now, as the plan needs it. */
async function liveOrg(): Promise<{ org: LiveOrg; chart: NonNullable<Awaited<ReturnType<typeof loadOrg>>>; flow: Flow; flowVersion: number }> {
  const [o, a, crew] = await Promise.all([loadOrg(), db().from("agents").select("id"), loadCrew()]);
  if (!o) throw new Error("The org chart tables aren’t up to date.");
  if (a.error) throw new Error(a.error.message);
  const f = await loadFlow(crew);
  return {
    org: {
      deptIds: o.departments.map((d) => d.id), deptNames: o.departments.map((d) => d.name),
      agentIds: (a.data ?? []).map((r) => String(r.id)), chainKeys: f.flow.chains.map((c) => c.key),
      seats: o.seats.length, topSort: Math.max(0, ...o.departments.map((d) => d.sort)),
    },
    chart: o, flow: f.flow, flowVersion: f.version,
  };
}

/** Takes back out what an install wrote, newest first. Best effort: the error that stopped it is what's shown. */
async function rollBack(depts: string[], agents: string[]) {
  const steps: [string, string, string[]][] = [
    ["goals", "department_id", depts], ["seats", "department_id", depts], ["agent_playbooks", "agent_id", agents],
    ["agent_defs", "agent_id", agents], ["agents", "id", agents], ["departments", "id", depts],
  ];
  for (const [t, col, ids] of steps) if (ids.length) await db().from(t).delete().in(col, ids).then(() => undefined, () => undefined);
}

/**
 * A built-in department pack into this business, beside what's there. Returns the new department's id and name.
 * The caller has checked the member is the owner.
 */
export async function installDepartmentPack(packId: string, by: string): Promise<{ deptId: string; name: string }> {
  const pack = packById(packId, "department");
  if (!pack) throw new Error(`There's no department pack ${packId}.`);
  const live = await liveOrg();
  const plan = livePlan(pack, live.org);
  const { rows, flow } = liveRows(pack, plan, live.flow.chains);
  const depts = Object.values(plan.depts), agents = Object.values(plan.agents);
  try {
    for (const t of ORDER) if (rows[t].length) await insert(t, rows[t]);
    if (plan.crew.flow.chains.length) await saveFlowVersion({ chains: flow } as Flow, `From the ${pack.id} pack`, by, live.flowVersion);
  } catch (e) {
    await rollBack(depts, agents);
    throw new Error(`The ${pack.name} pack wasn’t installed, and nothing it added was kept: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { deptId: depts[0], name: Object.values(plan.names)[0] };
}

/**
 * A built-in agent pack into an open seat: the agent off duty, its playbook proposed, the actions the owner turned
 * on (only ones the pack suggests), and its schedule as a chain that starts off. Returns the agent's id and name.
 * The caller has checked the member is the owner.
 */
export async function installAgentPack(packId: string, seatId: string, grants: readonly string[], name: string | undefined, by: string): Promise<{ agentId: string; name: string }> {
  const pack = packById(packId, "agent");
  if (!pack) throw new Error(`There's no agent pack ${packId}.`);
  const live = await liveOrg();
  const seat = live.chart.seats.find((s) => s.id === seatId);
  if (!seat || seat.departmentId == null) throw new Error("That seat isn’t on the chart any more.");
  const plan = seatPlan(pack, seat, new Set(live.org.agentIds), grants, name);
  const sched = seatFlow(live.flow, plan.agentId, String(plan.agent.name), plan.starts);
  if (sched && "refuse" in sched) throw new Error(sched.refuse);
  try {
    await insert("agents", [plan.agent]);
    await insert("agent_defs", [plan.def]);
    if (plan.playbook) await insert("agent_playbooks", [plan.playbook]);
    await setHolder(seatId, "agent", plan.agentId);
    if (sched) await saveFlowVersion(sched.flow, `${plan.agent.name}: from the ${pack.id} pack`, by, live.flowVersion);
  } catch (e) {
    await db().from("seats").update({ holder: "open", agent_id: null }).eq("agent_id", plan.agentId).then(() => undefined, () => undefined);
    await rollBack([], [plan.agentId]);
    throw new Error(`The ${pack.name} pack wasn’t installed, and nothing it added was kept: ${e instanceof Error ? e.message : String(e)}`);
  }
  return { agentId: plan.agentId, name: String(plan.agent.name) };
}

/**
 * What's left to turn on a department that came from a pack, worked out from its rows each time, never stored, with
 * the first agent each step is about (for its link). No steps once every playbook is approved, every agent is on duty
 * and every chain is on.
 */
export async function packSetup(deptId: string): Promise<{ steps: SetupStep[]; waiting: string | null; off: string | null }> {
  const none = { steps: [], waiting: null, off: null };
  const o = await loadOrg();
  const ids = (o?.seats ?? []).filter((s) => s.departmentId === deptId && s.agentId).map((s) => s.agentId!);
  if (!ids.length) return none;
  const [a, p, crew] = await Promise.all([
    db().from("agents").select("id, name, enabled").in("id", ids),
    db().from("agent_playbooks").select("agent_id, status").in("agent_id", ids),
    loadCrew(),
  ]);
  if (a.error || p.error) return none;
  const flow = await loadFlow(crew).catch(() => null);
  const name = new Map((a.data ?? []).map((r) => [String(r.id), String(r.name)]));
  const approved = new Set((p.data ?? []).filter((r) => r.status === "approved").map((r) => String(r.agent_id)));
  const waiting = [...new Set((p.data ?? []).filter((r) => r.status === "proposed").map((r) => String(r.agent_id)))].filter((id) => !approved.has(id));
  const off = (a.data ?? []).filter((r) => !r.enabled).map((r) => String(r.id));
  const mine = new Set(ids);
  const chainsOff = (flow?.flow.chains ?? []).filter((c) => !c.on && c.steps.some((s) => s.agent && mine.has(s.agent)));
  return {
    steps: setupSteps({
      playbooksWaiting: waiting.map((id) => name.get(id) ?? id),
      offDuty: off.map((id) => name.get(id) ?? id),
      chainsOff: chainsOff.map((c) => (c.start.type === "schedule" ? `${c.name} (${startWords(c.start)})` : c.name)),
    }),
    waiting: waiting[0] ?? null, off: off[0] ?? null,
  };
}
