import "server-only";
import { hireHref } from "@/dashboard/dept-rules";
// The org chart as Crew draws it (docs/org-chart.md): each seat with who sits there, that agent's
// state and last run, and the agents that aren't on the chart yet. Plain data for
// components/OrgChart.tsx.
import { loadCaps } from "@/core/gateway";
import { CAPS } from "@/core/gateway/policy";
import { departmentRules } from "@/core/memory";
import { agentNames, companySeat, deptSpent, headOf, childrenOf, liveAgentIds, monthSpendByAgent, orgProblems, reportsTo, seatOf, seatPath, seatTeam, type Org, type Seat } from "@/core/org";
import type { MapOrg } from "./agentMap";
import type { Floor } from "./data";
import { hm, md, when } from "./format";
import { handoffsOf, type CanvasData, type CanvasSeat, type CanvasState } from "./org-canvas";
import { isLive, stateLook, stateOf, type AgentState, type Look } from "./status";
import type { Chain } from "@/core/flow-rules";

export interface SeatAgent {
  id: string;
  name: string;
  role: string;
  href: string;
  icon: string;
  hue: string | null;
  look: Look;
  last: string;
  state: AgentState;
  /** What it does, what a real run hands you, and its last run that did something. */
  job: string; writes: string | null;
  summary: string | null; lastRunId: string | null;
}
export interface SeatView {
  id: string;
  title: string;
  sub: string;
  holder: Seat["holder"];
  agent: SeatAgent | null;
  /** Seats under this one, in order. */
  kids: SeatView[];
  /** Proposals waiting on the owner about this seat: a hire for it (or under it), a retirement (company mode slice 3). */
  proposals: { id: string; text: string }[];
}
export interface DeptView {
  id: string; name: string; head: SeatView; seats: number; filled: number; open: number;
  /** Monthly AI budget (null: none) and what its agents spent this Chicago month, added up in code. */
  budget: number | null; spent: number;
  /** Its email cap (null: the company cap) and the company cap it sits under. */
  emails: number | null; companyEmails: number;
  /** Department rules, loaded by every agent seated in it. */
  rules: { id: string; text: string }[];
  /** Drafts from its agents wait for the agent above them first (slice 4). */
  leadChecks: boolean;
}
/** What the department cards need besides the chart: spend this month per agent, department rules, the company email cap. */
export interface DeptExtras { spend: Record<string, number>; rules: { id: string; departmentId: string; text: string }[]; companyEmails: number }
export interface OrgView {
  company: SeatView | null;
  departments: DeptView[];
  /** Agents not in any seat: they can be put in one with Edit chart, or from step 1 of the builder. */
  offChart: SeatAgent[];
  /** Every agent a seat can hold, for the picker. */
  choices: { id: string; label: string; seat: string | null }[];
  problems: string[];
}

const OFF_LOOK: Look = { label: "Off duty", dot: "var(--mut)", bg: "var(--soft)", fg: "var(--ink2)" };

/** Every agent the chart knows: each agent with a live version (dashboard/roster.ts). */
function agentsOf(f: Floor): SeatAgent[] {
  return f.crew.map((a): SeatAgent => {
    const st = stateOf(a, f.agents[a.id], f.runs, f.spentToday[a.id] ?? 0);
    const last = f.runs.find((r) => r.agent_id === a.id && r.status !== "skipped");
    return { id: a.id, name: a.name, role: a.role, href: `/agents/${a.id}`, icon: a.icon, hue: a.hue ?? null, look: stateLook(st, f.org.on), last: last ? `Last ran ${when(last.started_at, f.tz)}` : "Never run",
      state: st, job: a.job, writes: a.writes ?? null, summary: last?.summary ?? null, lastRunId: last?.id ?? null };
  });
}

export function orgView(f: Floor, org: Org, x: DeptExtras, proposals: Record<string, { id: string; text: string }[]> = {}): OrgView {
  const all = agentsOf(f);
  const byId = new Map(all.map((a) => [a.id, a]));
  const view = (s: Seat, depth: number): SeatView => ({
    id: s.id, title: s.title, sub: s.sub, holder: s.holder,
    agent: s.holder === "agent" && s.agentId ? byId.get(s.agentId) ?? { id: s.agentId, name: s.agentId, role: "Not found", href: "/crew", icon: "cpu", hue: null, look: OFF_LOOK, last: "", state: "missing", job: "", writes: null, summary: null, lastRunId: null } : null,
    kids: depth > 6 ? [] : childrenOf(org, s.id).map((c) => view(c, depth + 1)),
    proposals: proposals[s.id] ?? [],
  });
  const count = (v: SeatView): SeatView[] => [v, ...v.kids.flatMap(count)];
  const departments = org.departments.flatMap((d): DeptView[] => {
    const h = headOf(org, d.id);
    if (!h) return [];
    const head = view(h, 1);
    const seats = count(head);
    return [{
      id: d.id, name: d.name, head, seats: seats.length, filled: seats.filter((s) => s.holder !== "open").length, open: seats.filter((s) => s.holder === "open").length,
      budget: d.monthlyBudgetUsd, spent: deptSpent(org, d.id, x.spend), emails: d.maxEmailsPerDay, companyEmails: x.companyEmails,
      rules: x.rules.filter((r) => r.departmentId === d.id).map((r) => ({ id: r.id, text: r.text })),
      leadChecks: d.leadChecksDrafts,
    }];
  });
  const top = companySeat(org);
  return {
    company: top ? view(top, 0) : null,
    departments,
    offChart: all.filter((a) => !seatOf(org, a.id)),
    choices: all.map((a) => { const s = seatOf(org, a.id); return { id: a.id, label: a.name, seat: s ? seatPath(org, s) : null }; }),
    problems: orgProblems(org),
  };
}

const CANVAS_STATE: Record<AgentState, CanvasState> = { running: "run", active: "on", manual: "call", paused: "off", over: "over", missing: "missing" };
const clip = (t: string, n = 160) => (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);

/**
 * The living canvas's data (docs/crew-canvas.md): the chart as flat seats, hand-offs from the chains
 * that are on, and today's runs. Everything on the canvas is drawn from this and nothing else.
 */
export function canvasData(f: Floor, v: OrgView, chains: readonly Chain[]): CanvasData {
  const flat = (s: SeatView, parent: string | null, depth: number, dept: string | null): CanvasSeat[] => [{
    id: s.id, title: s.title, sub: s.sub, holder: s.holder, parent, depth,
    agent: s.agent ? {
      id: s.agent.id, name: s.agent.name, role: s.agent.role, href: s.agent.href, state: CANVAS_STATE[s.agent.state], label: s.agent.look.label, last: s.agent.last,
      summary: s.agent.summary ? clip(s.agent.summary) : null, lastRunHref: s.agent.lastRunId ? `/runs/${s.agent.lastRunId}` : null, job: s.agent.job, writes: s.agent.writes,
    } : null,
    href: s.holder === "open" ? (s.proposals.length ? `/proposals/${s.proposals[0].id}` : dept ? hireHref(dept, s) : null) : null,
    proposal: s.proposals[0]?.text ?? null,
  }, ...s.kids.flatMap((k) => flat(k, s.id, depth + 1, dept))];
  const depts = v.departments.map((d) => ({ id: d.id, name: d.name, seats: flat(d.head, null, 0, d.id), spent: d.spent, budget: d.budget }));
  const company = v.company ? flat({ ...v.company, kids: [] }, null, 0, null)[0] : null;
  const seatOfAgent: Record<string, string> = {}, nameOf: Record<string, string> = {};
  for (const s of [...(company ? [company] : []), ...depts.flatMap((d) => d.seats)]) if (s.agent) { seatOfAgent[s.agent.id] = s.id; nameOf[s.agent.id] = s.agent.name; }
  const today = md(f.now, f.tz);
  const runs = f.runs
    .filter((r) => r.status !== "skipped" && (r.status !== "running" || isLive(r, f.now)) && seatOfAgent[r.agent_id] && md(r.started_at, f.tz) === today)
    .slice(0, 40)
    .map((r) => ({
      id: r.id, seat: seatOfAgent[r.agent_id], who: nameOf[r.agent_id], at: hm(r.started_at, f.tz), href: `/runs/${r.id}`,
      status: r.status === "failed" ? "failed" as const : r.status === "running" ? "running" as const : "ok" as const,
      text: clip(r.summary ?? (r.status === "failed" ? r.error ?? "The run failed." : r.status === "running" ? "Working now." : "Ran."), 140),
    }));
  return { company, depts, handoffs: handoffsOf(chains, seatOfAgent), runs };
}

/** Spend this month, department rules and the company email cap for the department cards. Each part reads as empty when it can't be loaded. */
export async function deptExtras(org: Org): Promise<DeptExtras> {
  const ids = [...new Set(org.seats.filter((s) => s.holder === "agent" && s.agentId && s.departmentId).map((s) => s.agentId as string))];
  const [spend, rules, caps] = await Promise.all([
    monthSpendByAgent(ids).catch(() => ({} as Record<string, number>)),
    departmentRules(org.departments.map((d) => d.id)),
    loadCaps().catch(() => null),
  ]);
  return {
    spend,
    rules: rules.map((r) => ({ id: r.id, departmentId: r.department_id as string, text: r.text })),
    companyEmails: caps?.max_emails_per_day.value ?? CAPS.max_emails_per_day.start,
  };
}

/** An agent's place for its map: who its result goes up to, and the live agents under it. Null before the org chart migration. */
export async function mapOrgOf(org: Org | null, agentId: string): Promise<MapOrg | null> {
  if (!org) return null;
  const seat = seatOf(org, agentId);
  if (!seat) return { reportsTo: null, team: [] };
  const live = await liveAgentIds().catch(() => new Set<string>());
  const team = seatTeam(org, seat, live).agents;
  const up = reportsTo(org, seat);
  const names = await agentNames([...team, ...(up?.agentId ? [up.agentId] : [])]).catch(() => ({} as Record<string, string>));
  const name = (id: string) => names[id] ?? id;
  const box: MapOrg["reportsTo"] = !up
    ? { title: "You", sub: "The company seat reports to you, in the morning brief", agentId: null, open: false }
    : up.holder === "agent" && up.agentId ? { title: name(up.agentId), sub: seatPath(org, up), agentId: up.agentId, open: false }
    : up.holder === "owner" ? { title: "You", sub: seatPath(org, up), agentId: null, open: false }
    : { title: up.title, sub: "No one sits here yet, so its result waits", agentId: null, open: true };
  return { reportsTo: box, team: team.map((id) => ({ id, name: name(id) })) };
}
