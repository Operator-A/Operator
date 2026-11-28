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
import { readSpec, saveSpecVersion } from "@/core/agent-spec";
import { packUpdate, readTag, type LiveAgent, type PackUpdate } from "@/core/pack-update-rules";
import type { DepartmentPack } from "@/core/pack-rules";
import type { Layout } from "@/core/widget-rules";
import { packLayoutHere } from "@/core/layout-edit-rules";

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

/** What's in the business now, for a pack's page to say whether a second install can go in. */
export const liveOrgNow = async (): Promise<LiveOrg> => (await liveOrg()).org;

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

/** A newer version of the pack a department came from, with what it would change; null when there is none. */
export async function packOffer(deptId: string): Promise<PackUpdate | null> {
  const d = await db().from("departments").select("overview, pack").eq("id", deptId).maybeSingle();
  if (d.error || !d.data) return null;
  const tag = readTag(d.data.pack);
  const pack = tag ? packById(tag.id, "department") : null;
  if (!tag || !pack || !(pack.version > tag.version)) return null;
  const [live, edit] = await Promise.all([
    liveFromPack(deptId, pack),
    db().from("audit_log").select("at").eq("action", "edit_layout").eq("target", deptId).order("at", { ascending: false }).limit(1).then((r) => r.data?.[0]?.at as string | undefined, () => undefined),
  ]);
  const edited = edit ? new Date(edit).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null;
  return packUpdate(pack, tag.version, d.data.overview, live, edited);
}

/** The department's agents that came from `pack`, each with the name its first spec had, so the pack's agent it was. */
async function liveFromPack(deptId: string, pack: DepartmentPack): Promise<LiveAgent[]> {
  const o = await loadOrg();
  const ids = (o?.seats ?? []).filter((s) => s.departmentId === deptId && s.agentId).map((s) => s.agentId!);
  if (!ids.length) return [];
  const [a, defs] = await Promise.all([
    db().from("agents").select("id, name, pack").in("id", ids),
    db().from("agent_defs").select("agent_id, version, spec, active, created_by, created_at").in("agent_id", ids).order("version"),
  ]);
  if (a.error) throw new Error(a.error.message);
  if (defs.error) throw new Error(defs.error.message);
  // only agents that came from this pack; before the agents.pack migration, every agent whose first spec it wrote
  const rows = (defs.data ?? []) as { agent_id: string; version: number; spec: unknown; active: boolean; created_by: string; created_at: string }[];
  const live: LiveAgent[] = [];
  for (const r of a.data ?? []) {
    const mine = rows.filter((x) => x.agent_id === r.id);
    const first = mine.find((x) => x.version === 1), active = mine.find((x) => x.active);
    const t = readTag((r as { pack?: unknown }).pack);
    if (!first || !active || (t ? t.id !== pack.id : !String(first.created_by).startsWith(`pack:`))) continue;
    const edits = mine.filter((x) => x.version > 1 && !String(x.created_by).startsWith("pack:"));
    const last = edits[edits.length - 1];
    live.push({
      id: String(r.id), name: String(r.name), firstName: readSpec(first.spec, String(r.id)).spec.name, spec: active.spec,
      edited: last ? new Date(last.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : null,
    });
  }
  return live;
}

/**
 * The layout Reset goes back to in the layout editor (packs slice 5): the department's pack's layout, its agent
 * numbers pointed at this department's agents from that pack. Null for a department not from a pack, or a pack
 * with no layout: Reset then goes back to the usual Overview.
 */
export async function packResetLayout(deptId: string): Promise<{ name: string; version: number; layout: Layout } | null> {
  const d = await db().from("departments").select("pack").eq("id", deptId).maybeSingle();
  const tag = d.error || !d.data ? null : readTag(d.data.pack);
  const pack = tag ? packById(tag.id, "department") : null;
  if (!tag || !pack || !pack.departments[0]?.overview) return null;
  const ids = new Map<string, string>();
  for (const live of await liveFromPack(deptId, pack)) {
    const pa = pack.agents.find((x) => x.name === live.firstName);
    if (pa && !ids.has(pa.id)) ids.set(pa.id, live.id);
  }
  const layout = packLayoutHere(pack.departments[0].overview, ids);
  return layout ? { name: pack.name, version: pack.version, layout } : null;
}

/**
 * Saves a newer pack version as drafts: each changed agent's spec as a draft version (Try it and Go live as for any
 * change), and the Overview layout. The department and its agents then say they came from the new version. The
 * caller has checked the member is the owner.
 */
export async function savePackUpdate(deptId: string): Promise<{ drafts: number; to: number; name: string }> {
  const u = await packOffer(deptId);
  if (!u) throw new Error("There’s no newer version of this department’s pack.");
  const d = await db().from("departments").select("pack").eq("id", deptId).maybeSingle();
  const id = readTag(d.data?.pack)!.id;
  for (const x of u.drafts) await saveSpecVersion(x.agentId, x.spec, `From the ${id} pack, version ${u.to}`, `pack:${id}`);
  const tag = `${id}@${u.to}`;
  const up = await db().from("departments").update(u.overview ? { overview: u.overview, pack: tag } : { pack: tag }).eq("id", deptId);
  if (up.error) throw new Error(up.error.message);
  if (u.drafts.length) await db().from("agents").update({ pack: tag }).in("id", u.drafts.map((x) => x.agentId)).then(() => undefined, () => undefined);
  return { drafts: u.drafts.length, to: u.to, name: u.name };
}
