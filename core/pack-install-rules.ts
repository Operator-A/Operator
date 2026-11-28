// Installing a pack into a business that already runs (docs/packs.md, packs slice 3, decided 2026-11-28): a
// department pack beside the departments already there, or an agent pack into one open seat. Worked out here with
// no database, so `npm run check:pack-install` can test it. A pack's ids are names inside the file: every
// department, agent, seat and chain gets an id that's free in this business, so installing the same pack twice
// gives two separate departments. Everything starts switched off, as at first-run setup (core/install-rules.ts).
import { readSpec, type AgentSpec } from "@/core/agent-spec";
import { installRows, crewProblems, agentPackProblems, type InstallRows } from "@/core/install-rules";
import { mergePacks, type AgentPack, type Crew, type DepartmentPack } from "@/core/pack-rules";
import { MAX_DEPARTMENTS, MAX_SEATS } from "@/core/org-rules";
import { TOOLS } from "@/core/tools/catalog";
import { daySet, isDays, withAgentTime, type Days, type Flow } from "@/core/flow-rules";

const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const t12 = (s: string) => { const [h, m] = s.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

/** What's in the business already, as far as ids and names go. `topSort` is the last department's place on the chart. */
export interface LiveOrg { deptIds: readonly string[]; deptNames: readonly string[]; agentIds: readonly string[]; chainKeys: readonly string[]; seats: number; topSort: number }

/** An agent id from its name, as the builder makes them (core/agent-spec.ts newAgentId): "b_" and words, never one taken. */
export function agentIdFor(name: string, taken: ReadonlySet<string>): string {
  const words = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const base = `b_${words || "agent"}`.slice(0, 40).replace(/_+$/, "");
  if (!taken.has(base)) return base;
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}_${i}`)) return `${base}_${i}`;
  throw new Error("Too many agents with that name.");
}

const remapAgent = (x: unknown, ids: ReadonlyMap<string, string>): unknown => {
  if (!x || typeof x !== "object" || Array.isArray(x)) return x;
  const o = x as Record<string, unknown>;
  return typeof o.agent === "string" && ids.has(o.agent) ? { ...o, agent: ids.get(o.agent) } : o;
};

export interface LivePlan {
  crew: Crew;
  /** The pack's names to this business's ids. */
  depts: Record<string, string>; agents: Record<string, string>; chains: Record<string, string>;
  /** "Store analytics", or "Store analytics 2" when the name is taken. */
  names: Record<string, string>;
}

/**
 * The pack's crew with every id free in this business. Department ids and names get the same number when either
 * is taken ("store_analytics_2", "Store analytics 2"); an agent keeps its id when free, else gets a builder id from its
 * name; chains get a number
 * on their key. Throws on a pack with problems, or one that wouldn't fit the chart's limits.
 */
export function livePlan(pack: DepartmentPack, org: LiveOrg): LivePlan {
  const base = mergePacks([pack]);
  const problems = crewProblems(base);
  if (problems.length) throw new Error(`This pack can't be installed: ${problems.join("; ")}`);
  if (org.deptIds.length + base.departments.length > MAX_DEPARTMENTS) throw new Error(`A chart holds ${MAX_DEPARTMENTS} departments at most.`);
  if (org.seats + base.seats.length > MAX_SEATS) throw new Error(`A chart holds ${MAX_SEATS} seats at most.`);
  const takenIds = new Set(org.deptIds), takenNames = new Set(org.deptNames.map((n) => n.toLowerCase()));
  const clash = (n: number) => base.departments.some((d) => takenIds.has(n === 1 ? d.id : `${d.id.slice(0, 36)}_${n}`) || takenNames.has((n === 1 ? d.name : `${d.name.slice(0, 56)} ${n}`).toLowerCase()));
  let n = 1;
  while (clash(n)) n++;
  const depts = Object.fromEntries(base.departments.map((d) => [d.id, n === 1 ? d.id : `${d.id.slice(0, 36)}_${n}`]));
  const names = Object.fromEntries(base.departments.map((d) => [d.id, n === 1 ? d.name : `${d.name.slice(0, 56)} ${n}`]));
  const takenAgents = new Set(org.agentIds);
  const agents: Record<string, string> = {};
  // an agent keeps the pack's id when it's free (the gateway names some actions' agents by id, core/gateway); a taken
  // one gets a builder id from its name
  for (const a of base.agents) { const id = takenAgents.has(a.id) ? agentIdFor(a.name, takenAgents) : a.id; agents[a.id] = id; takenAgents.add(id); }
  const takenChains = new Set(org.chainKeys);
  const chains: Record<string, string> = {};
  for (const raw of base.flow.chains) {
    const key = String((raw as { key: string }).key);
    let k = key;
    for (let i = 2; takenChains.has(k); i++) k = `${key.slice(0, 36)}-${i}`;
    chains[key] = k; takenChains.add(k);
  }
  const am = new Map(Object.entries(agents)), dm = (id: string | null) => (id == null ? null : depts[id] ?? id);
  const crew: Crew = {
    departments: base.departments.map((d, i) => ({
      ...d, id: depts[d.id], name: names[d.id], sort: org.topSort + 1 + i,
      overview: Array.isArray(d.overview) ? d.overview.map((row) => (Array.isArray(row) ? row.map((w) => remapAgent(w, am)) : row)) : d.overview,
    })),
    agents: base.agents.map((a) => ({ ...a, id: agents[a.id] })),
    specs: Object.fromEntries(Object.entries(base.specs).map(([id, s]) => {
      const spec = s as { readsFrom?: { agentId: string; label: string }[] };
      return [agents[id], { ...spec, ...(spec.readsFrom ? { readsFrom: spec.readsFrom.map((r) => ({ ...r, agentId: agents[r.agentId] ?? r.agentId })) } : {}) }];
    })),
    playbooks: Object.fromEntries(Object.entries(base.playbooks).map(([id, p]) => [agents[id], p])),
    seats: base.seats.map((s) => ({ ...s, department: dm(s.department), agent: s.agent ? agents[s.agent] : null })),
    flow: {
      chains: base.flow.chains.map((raw) => {
        const c = raw as { key: string; steps: unknown[]; owner?: Record<string, string> };
        const owner = c.owner && "dept" in c.owner ? { dept: dm(c.owner.dept) } : c.owner && "agent" in c.owner ? { agent: agents[c.owner.agent] ?? c.owner.agent } : c.owner;
        return { ...c, key: chains[c.key], steps: c.steps.map((s) => remapAgent(s, am)), on: false, ...(owner ? { owner } : {}) };
      }),
    },
    goals: base.goals.map((g) => ({ ...g, department: depts[g.department] ?? g.department })),
  };
  // the same checks again with this business's ids: an action the gateway gives only to named agents refuses a new id
  const again = crewProblems(crew);
  if (again.length) throw new Error(`This pack can't be installed here: ${again.join("; ")}`);
  return { crew, depts, agents, chains, names };
}

/**
 * The rows a live install writes: the crew's rows as at setup (installRows, every agent off duty, every playbook
 * proposed), each agent tagged with the pack it came from, and the active flow with the pack's chains added, off.
 * `flow` is the active flow's chains as saved; the result's `flow` is the next version.
 */
export function liveRows(pack: DepartmentPack, plan: LivePlan, flow: readonly unknown[], makeId?: () => string): { rows: InstallRows; flow: unknown[] } {
  const rows = installRows(pack.id, plan.crew, makeId);
  const tag = `${pack.id}@${pack.version}`;
  return {
    rows: { ...rows, agents: rows.agents.map((a) => ({ ...a, pack: tag })), crew_flow: [] },
    flow: [...flow, ...plan.crew.flow.chains],
  };
}

/** Does an agent pack fit an open seat? One of its words is in the seat's title or line. */
export function seatFits(pack: AgentPack, seat: { title: string; sub: string }): boolean {
  const t = `${seat.title} ${seat.sub}`.toLowerCase();
  return pack.seat.matches.some((m) => t.includes(m.toLowerCase()));
}

export interface SeatPlan {
  agentId: string; spec: AgentSpec;
  agent: Record<string, unknown>; def: Record<string, unknown>; playbook: Record<string, unknown> | null;
  starts: { days: string; time: string } | null; grants: string[];
}

/**
 * An agent pack into an open seat: an agent off duty with the pack's spec as version 1, its playbook proposed,
 * and the actions the owner turned on on the confirm sheet, only ones the pack suggests and an approver may give
 * (as a hire card does, core/proposals.ts hireDraft). `name` is the agent's name, the pack's unless the owner
 * changed it. Throws with what's wrong.
 */
export function seatPlan(pack: AgentPack, seat: { holder: string; title: string; sub: string }, takenAgents: ReadonlySet<string>, grants: readonly string[], name = pack.agent.name): SeatPlan {
  const problems = agentPackProblems(pack);
  if (problems.length) throw new Error(`This pack can't be installed: ${problems.join("; ")}`);
  if (seat.holder !== "open") throw new Error("That seat isn't open any more.");
  const ok = [...new Set(grants)].filter((g) => pack.suggests.includes(g) && TOOLS[g]?.kind === "action" && TOOLS[g]?.agents === "granted");
  const clean = name.trim().slice(0, 40) || pack.agent.name;
  const base = readSpec(pack.spec, "pack").spec;
  const { spec, problems: sp } = readSpec({ ...base, name: clean, tools: [...base.tools, ...ok] });
  if (sp.length) throw new Error(`This pack can't be installed: ${sp.join("; ")}`);
  const agentId = agentIdFor(clean, takenAgents);
  const a = pack.agent;
  return {
    agentId, spec, grants: ok, starts: pack.starts,
    agent: { id: agentId, name: clean, role: a.role, model: a.model, icon: a.icon, hue: a.hue, daily_budget_usd: a.daily_budget_usd, manual_only: pack.starts === null, enabled: false, in_org: true, pack: `${pack.id}@${pack.version}` },
    def: { agent_id: agentId, version: 1, spec, note: `From the ${pack.id} pack`, created_by: `pack:${pack.id}`, active: true },
    playbook: pack.playbook.length ? { agent_id: agentId, version: 1, steps: pack.playbook, status: "proposed", changes: `From the ${pack.id} pack`, auto: false } : null,
  };
}

/**
 * The flow with an agent pack's schedule added as its own chain, switched off (the pack's `starts`). Null when
 * the pack runs only by hand; a refusal when the time isn't one the schedule takes.
 */
export function seatFlow(flow: Flow, agentId: string, name: string, starts: SeatPlan["starts"]): { flow: Flow } | { refuse: string } | null {
  if (!starts) return null;
  const r = withAgentTime(flow, agentId, name, { days: starts.days as Days, time: starts.time });
  if ("refuse" in r) return r;
  const before = new Set(flow.chains.map((c) => c.key));
  return { flow: { chains: r.flow.chains.map((c) => (before.has(c.key) ? c : { ...c, on: false })) } };
}

/** "Mondays at 8:00 AM", "Every day at 7:00 AM", or what starts it. */
export function startWords(start: unknown): string {
  const st = (start ?? {}) as { type?: string; days?: string; time?: string };
  if (st.type === "schedule" && st.days && st.time) {
    const d = st.days === "daily" ? "Every day" : st.days === "weekdays" ? "Weekdays" : st.days === "mondays" ? "Mondays" : isDays(st.days) ? daySet(st.days).map((i) => SHORT[i]).join(", ") : "On a schedule";
    return `${d} at ${t12(st.time)}`;
  }
  if (st.type === "event") return "When an outside event comes in";
  if (st.type === "after") return "After another chain";
  return "By hand";
}

/** What's left to turn on a department installed from a pack, worked out from its rows, never stored. */
export interface SetupState { playbooksWaiting: string[]; offDuty: string[]; chainsOff: string[] }
export interface SetupStep { key: "playbook" | "duty" | "chain"; text: string }
export function setupSteps(s: SetupState): SetupStep[] {
  const list = (xs: readonly string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
  const out: SetupStep[] = [];
  if (s.playbooksWaiting.length) out.push({ key: "playbook", text: `Approve ${list(s.playbooksWaiting.map((n) => `${n}’s`))} playbook${s.playbooksWaiting.length === 1 ? "" : "s"}.` });
  if (s.offDuty.length) out.push({ key: "duty", text: `Try ${list(s.offDuty)} once, then put ${s.offDuty.length === 1 ? "them" : "each"} on duty.` });
  if (s.chainsOff.length) out.push({ key: "chain", text: `Turn on ${list(s.chainsOff)}.` });
  return out;
}
