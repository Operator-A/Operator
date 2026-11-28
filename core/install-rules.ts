// What installing picked department packs into an org writes (core/install.ts, docs/packs.md),
// worked out in code with no database, so check:install can test it. Always switched off: every
// agent off duty, every chain off, every playbook proposed for the owner to approve, goals with no
// due date. Specs pick only from code (readSpec), so a template can never give an agent a new ability.
import { randomUUID } from "node:crypto";
import { BUDGET_CEILING, readSpec, type AgentSpec } from "@/core/agent-spec";
import { isCustomToolId } from "@/core/custom-mcp-rules";
import { isDays, readFlow, type Flow } from "@/core/flow-rules";
import { measureOf } from "@/core/goal-rules";
import { MAX_HIRE_CAN } from "@/core/proposal-rules";
import { TOOLS } from "@/core/tools/catalog";
import type { AgentPack, Crew } from "@/core/pack-rules";

const ID = /^[a-z0-9_]{1,60}$/;
const ICON = /^[a-z0-9-]{1,40}$/, HUE = /^#[0-9A-Fa-f]{6}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const granted = (t: string) => TOOLS[t]?.kind === "action" && TOOLS[t]?.agents === "granted";

/**
 * What a pack's spec may not hold because it names one business's own things: Notion pages, a report page,
 * a custom server's tools, or another agent's output outside the pack (`crewIds`).
 */
function orgIdProblems(spec: AgentSpec, who: string, crewIds: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (spec.notionPages.length || spec.reportPage) out.push(`${who}: a pack names no Notion pages; the owner picks them after install`);
  for (const r of spec.readsFrom) if (!crewIds.has(r.agentId)) out.push(`${who}: reads ${r.agentId}, which isn't in the pack`);
  for (const t of spec.tools) if (isCustomToolId(t)) out.push(`${who}: ${t} is one business's custom tool`);
  return out;
}

/** Everything wrong with a crew. An install refuses a crew with any problem. */
export function crewProblems(crew: Crew): string[] {
  const out: string[] = [];
  const depts = new Set(crew.departments.map((d) => d.id));
  const agents = new Set(crew.agents.map((a) => a.id));
  if (depts.size !== crew.departments.length) out.push("a department id is used twice");
  if (agents.size !== crew.agents.length) out.push("an agent id is used twice");
  for (const d of crew.departments) if (!/^[a-z][a-z0-9_]{1,39}$/.test(d.id) || !d.name.trim() || d.name.length > 60) out.push(`department ${d.id}: needs an id and a name of at most 60 characters`);
  for (const a of crew.agents) {
    if (!ID.test(a.id)) out.push(`agent ${a.id}: bad id`);
    if (a.role.length > 60 || (a.icon !== null && !ICON.test(a.icon)) || (a.hue !== null && !HUE.test(a.hue))) out.push(`agent ${a.id}: role, icon or colour isn't allowed`);
    if (!(a.daily_budget_usd > 0 && a.daily_budget_usd <= BUDGET_CEILING)) out.push(`agent ${a.id}: daily budget must be over $0 and at most $${BUDGET_CEILING}`);
    const { spec, problems } = readSpec(crew.specs[a.id], a.id);
    if (!crew.specs[a.id]) out.push(`agent ${a.id}: no spec`);
    for (const p of problems) out.push(`agent ${a.id}: ${p}`);
    // a granted action is given only by an approver on the Tools step, never by a pack (card 250)
    for (const t of spec.tools) if (granted(t)) out.push(`agent ${a.id}: ${TOOLS[t].label} is given only by an approver on the agent's Can do toggles`);
    out.push(...orgIdProblems(spec, `agent ${a.id}`, agents));
    if (crew.specs[a.id] && spec.model !== a.model) out.push(`agent ${a.id}: its spec's model isn't the agent's`);
    for (const s of crew.playbooks[a.id] ?? []) {
      if (!TOOLS[s.tool]) out.push(`agent ${a.id}: playbook step ${s.tool} isn't a tool`);
      else if (!spec.tools.includes(s.tool)) out.push(`agent ${a.id}: playbook step ${s.tool} isn't one of its tools`);
      if (!s.input || typeof s.input !== "object" || Array.isArray(s.input)) out.push(`agent ${a.id}: playbook step ${s.tool} needs an input object`);
    }
  }
  for (const id of Object.keys(crew.specs)) if (!agents.has(id)) out.push(`spec ${id}: no such agent`);
  for (const id of Object.keys(crew.playbooks)) if (!agents.has(id)) out.push(`playbook ${id}: no such agent`);
  const keys = new Set(crew.seats.map((s) => s.key));
  if (keys.size !== crew.seats.length) out.push("a seat key is used twice");
  for (const s of crew.seats) {
    if (s.parent !== null && !keys.has(s.parent)) out.push(`seat ${s.key}: no parent ${s.parent}`);
    if (s.department !== null && !depts.has(s.department)) out.push(`seat ${s.key}: no department ${s.department}`);
    if ((s.holder === "agent") !== (s.agent !== null)) out.push(`seat ${s.key}: an agent seat names its agent, and only it does`);
    if (s.agent !== null && !/^[a-z][a-z0-9_]{1,62}$/.test(s.agent)) out.push(`seat ${s.key}: bad agent id`);
    if (!s.title.trim() || s.title.length > 60 || s.sub.length > 120) out.push(`seat ${s.key}: title 1 to 60 characters, note at most 120`);
    if (s.department === null && s.parent !== null) out.push(`seat ${s.key}: a seat outside the departments has no parent`);
  }
  // a seat's parents never loop back to it
  const parent = new Map(crew.seats.map((s) => [s.key, s.parent]));
  for (const s of crew.seats) {
    let at = s.parent, hops = 0;
    while (at !== null && at !== undefined && hops++ <= crew.seats.length) at = parent.get(at) ?? null;
    if (hops > crew.seats.length) out.push(`seat ${s.key}: its parents loop`);
  }
  const crewIds = { ids: [...agents], manualOnly: new Set(crew.agents.filter((a) => a.manual_only).map((a) => a.id)) };
  const raw = (crew.flow as Flow)?.chains;
  const { flow, problems } = readFlow(crew.flow, crewIds);
  for (const p of problems) out.push(`flow: ${p}`);
  if (!Array.isArray(raw) || flow.chains.length !== raw.length) out.push("flow: a chain would be dropped");
  for (const g of crew.goals) {
    if (!depts.has(g.department)) out.push(`goal ${g.title}: no department ${g.department}`);
    if (g.title.trim().length < 3 || g.title.length > 120) out.push(`goal ${g.title}: title must be 3 to 120 characters`);
    if (g.measure !== null && !measureOf(g.measure)) out.push(`goal ${g.title}: no measure ${g.measure}`);
    if (g.target !== null && !(g.target > 0)) out.push(`goal ${g.title}: target must be above 0`);
  }
  return out;
}

/**
 * Everything wrong with an agent pack's contents (its shape is packProblems'). An install refuses a pack with
 * any problem. Like a department pack, it picks only from code and never grants an action: actions it could
 * use go in `suggests`, shown as Can do toggles that start off.
 */
export function agentPackProblems(p: AgentPack): string[] {
  const out: string[] = [];
  const a = p.agent;
  if (a.role.length > 60 || (a.icon !== null && !ICON.test(a.icon)) || (a.hue !== null && !HUE.test(a.hue))) out.push("agent: role, icon or colour isn't allowed");
  if (!(a.daily_budget_usd > 0 && a.daily_budget_usd <= BUDGET_CEILING)) out.push(`agent: daily budget must be over $0 and at most $${BUDGET_CEILING}`);
  const { spec, problems } = readSpec(p.spec, "pack");
  for (const x of problems) out.push(`spec: ${x}`);
  if (spec.model !== a.model) out.push("spec: its model isn't the agent's");
  for (const t of spec.tools) if (granted(t)) out.push(`spec: ${TOOLS[t].label} is given only by an approver; list it in suggests`);
  out.push(...orgIdProblems(spec, "spec", new Set()));
  if (p.suggests.length > MAX_HIRE_CAN) out.push(`suggests: at most ${MAX_HIRE_CAN} actions`);
  if (new Set(p.suggests).size !== p.suggests.length) out.push("suggests: an action is listed twice");
  for (const t of p.suggests) if (!granted(t)) out.push(`suggests: ${t} isn't an action an approver can give`);
  for (const s of p.playbook) {
    const tool = String(s?.tool);
    if (!TOOLS[tool]) out.push(`playbook step ${tool}: isn't a tool`);
    else if (!spec.tools.includes(tool)) out.push(`playbook step ${tool}: isn't one of its tools`);
    if (!s?.input || typeof s.input !== "object" || Array.isArray(s.input)) out.push(`playbook step ${tool}: needs an input object`);
  }
  if (p.starts !== null && (!isDays(p.starts.days) || typeof p.starts.time !== "string" || !TIME.test(p.starts.time))) out.push("starts: days and a 24 hour time like 08:00");
  return out;
}

export interface InstallRows {
  departments: Record<string, unknown>[];
  agents: Record<string, unknown>[];
  agent_defs: Record<string, unknown>[];
  agent_playbooks: Record<string, unknown>[];
  /** Parents before children, so each insert's parent is already there. */
  seats: Record<string, unknown>[];
  crew_flow: Record<string, unknown>[];
  goals: Record<string, unknown>[];
}

/** The rows an install writes, in the order it writes them. Throws on a crew with problems. */
export function installRows(from: string, crew: Crew, makeId: () => string = randomUUID): InstallRows {
  const problems = crewProblems(crew);
  if (problems.length) throw new Error(`These packs can't be installed: ${problems.join("; ")}`);
  const by = `pack:${from}`;
  const ids = new Map(crew.seats.map((s) => [s.key, makeId()]));
  const placed = new Set<string>(), seats: Record<string, unknown>[] = [];
  while (placed.size < crew.seats.length) {
    for (const s of crew.seats) {
      if (placed.has(s.key) || (s.parent !== null && !placed.has(s.parent))) continue;
      seats.push({ id: ids.get(s.key), parent_id: s.parent === null ? null : ids.get(s.parent), department_id: s.department, title: s.title, sub: s.sub, holder: s.holder, agent_id: s.agent, sort: s.sort });
      placed.add(s.key);
    }
  }
  const flow = crew.flow as Flow;
  return {
    departments: crew.departments.map((d) => ({ id: d.id, name: d.name, sort: d.sort, lead_checks_drafts: d.lead_checks_drafts })),
    agents: crew.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, model: a.model, icon: a.icon, hue: a.hue, daily_budget_usd: a.daily_budget_usd, manual_only: a.manual_only, enabled: false, in_org: true })),
    agent_defs: crew.agents.map((a) => ({ agent_id: a.id, version: 1, spec: readSpec(crew.specs[a.id], a.id).spec, note: `From the ${from} pack`, created_by: by, active: true })),
    agent_playbooks: Object.entries(crew.playbooks).map(([agentId, steps]) => ({ agent_id: agentId, version: 1, steps, status: "proposed", changes: `From the ${from} pack`, auto: false })),
    seats,
    crew_flow: [{ version: 1, flow: { chains: flow.chains.map((c) => ({ ...c, on: false })) }, note: `From the ${from} pack`, created_by: by, active: true }],
    goals: crew.goals.map((g) => ({ department_id: g.department, title: g.title, measure: g.measure, target: g.target, start_value: null, due_on: null, state: "active" })),
  };
}

/**
 * The rows for installing departments onto a business that setup started (card 151): it already holds
 * the Chief of Staff template, so her agent, spec, playbook and seat are left as they are, and the
 * chains (merged with hers) go in as the next version of the org's flow.
 */
export function ontoSetup(rows: InstallRows, keep: { agent: string; flowVersion: number }): InstallRows {
  const mine = (r: Record<string, unknown>) => r.agent_id === keep.agent || r.id === keep.agent;
  return {
    ...rows,
    agents: rows.agents.filter((r) => !mine(r)),
    agent_defs: rows.agent_defs.filter((r) => !mine(r)),
    agent_playbooks: rows.agent_playbooks.filter((r) => !mine(r)),
    seats: rows.seats.filter((r) => r.agent_id !== keep.agent),
    crew_flow: rows.crew_flow.map((f) => ({ ...f, version: keep.flowVersion + 1 })),
  };
}
