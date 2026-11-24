import "server-only";
// The hire cards in a department's chat (docs/department-pages.md, slice 5): hires the head filed that wait
// on the owner, and agents seated here that were never put on duty (hired, or drafted from Claude). Read in
// one round with the chat; every number on a card comes from code (dashboard/hire-rules.ts).
import { db } from "@/core/db";
import { readSpec, type AgentSpec } from "@/core/agent-spec";
import { headOf, reportsTo, seatOf } from "@/core/org";
import { hireSpec } from "@/core/proposal-rules";
import type { Proposal } from "@/core/proposals";
import { TOOLS } from "@/core/tools/catalog";
import { billing, monthCostOf } from "@/dashboard/cost";
import { builderMenu, builderModelKeys, customMenuFor, lastTry } from "@/dashboard/builder";
import type { Roster } from "@/dashboard/data";
import { deptAgentIds, sheetHref } from "@/dashboard/dept-rules";
import { hireCostLine, hireRuns, hireStage, hireWhenWords, linkedCostLine, linkedReads, linkedStep, newAgent, type HireCardView, type HireChoice, type LinkedCard } from "@/dashboard/hire-rules";
import { routineState } from "@/integrations/mcp";
import { schedWords } from "@/dashboard/schedule";

const label = (id: string) => TOOLS[id]?.label ?? id;
const readsOf = (tools: readonly string[]) => tools.filter((t) => TOOLS[t]?.kind === "read" || TOOLS[t]?.kind === "calculate").map(label);
const costOf = (s: AgentSpec) => ({ model: s.model, effort: s.effort, tools: s.tools, maxSteps: s.limits.maxSteps, maxCostUsd: s.limits.maxCostUsd });

/** Agents seated in the department that were never put on duty: off duty, no approved routine. Their tries post in the chat. */
export async function freshAgents(deptId: string, roster: Roster): Promise<Set<string>> {
  const seated = roster.chart ? deptAgentIds(roster.chart, deptId).filter((a) => roster.byId[a] && !roster.agents[a]?.enabled) : [];
  if (!seated.length) return new Set();
  const { data, error } = await db().from("agent_playbooks").select("agent_id").eq("status", "approved").in("agent_id", seated);
  if (error) return new Set();
  const approved = new Set((data ?? []).map((b) => b.agent_id as string));
  return new Set(seated.filter((a) => newAgent({ enabled: false, approvedRoutine: approved.has(a), hasSpec: true })));
}

/** The department's hire cards, oldest first, and the agents among them whose tries post in the chat. */
export async function deptHires(deptId: string, roster: Roster): Promise<{ cards: HireCardView[]; fresh: Set<string> }> {
  const chart = roster.chart;
  if (!chart) return { cards: [], fresh: new Set() };
  const dept = chart.departments.find((d) => d.id === deptId);
  if (!dept) return { cards: [], fresh: new Set() };
  const seated = deptAgentIds(chart, deptId).filter((a) => roster.byId[a] && !roster.agents[a]?.enabled);
  const [props, defs, books, where, custom, keys, bill] = await Promise.all([
    db().from("proposals").select("id, from_agent, payload, created_at, source").eq("state", "pending").eq("kind", "hire").eq("department_id", deptId).order("created_at").limit(10),
    seated.length ? db().from("agent_defs").select("agent_id, version, spec, created_by, created_at").eq("active", true).in("agent_id", seated) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    seated.length ? db().from("agent_playbooks").select("agent_id").eq("status", "approved").in("agent_id", seated) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    // agents that run in Claude (live events slice 2): no try here, their routine instead
    seated.length ? db().from("agents").select("id, runs_on, claude_tools").in("id", seated) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    customMenuFor(), builderModelKeys(), billing(),
  ]);
  const menu = builderMenu(roster.crew, undefined, custom, keys);
  const tool = new Map(menu.tools.map((t) => [t.id, t]));
  const budget = { name: dept.name, budget: dept.monthlyBudgetUsd };
  const headSeat = headOf(chart, deptId);
  const headName = headSeat?.holder === "agent" && headSeat.agentId ? roster.byId[headSeat.agentId]?.name ?? headSeat.title : headSeat?.holder === "owner" ? "You" : null;
  const choice = (id: string): HireChoice => {
    const t = tool.get(id);
    return { id, label: label(id), ready: !!t?.connected, why: t?.connected ? undefined : "Not connected" };
  };

  const cards: HireCardView[] = [];
  for (const r of (props.data ?? []) as Pick<Proposal, "id" | "from_agent" | "payload" | "created_at" | "source">[]) {
    const p = r.payload;
    if (p.kind !== "hire") continue;
    const spec = readSpec(hireSpec(p)).spec;
    const under = p.seatId ? chart.seats.find((s) => s.id === p.seatId) : chart.seats.find((s) => s.id === p.parentSeatId);
    const boss = under ? (p.seatId ? reportsTo(chart, under) : under) : null;
    cards.push({
      key: `p:${r.id}`, proposalId: r.id, agentId: null, name: p.name, seat: p.seat, job: p.job,
      reportsTo: boss ? (boss.holder === "agent" && boss.agentId ? `${roster.byId[boss.agentId]?.name ?? boss.title} (${dept.name})` : boss.holder === "owner" ? "You" : boss.title) : headName,
      reads: readsOf(spec.tools), can: (p.can ?? []).map(choice), when: hireWhenWords(p.days, p.time),
      cost: hireCostLine(monthCostOf(costOf(spec), null, hireRuns(p.days), bill), budget),
      stage: "proposed", why: null, version: null, fromApp: r.source !== "agent", claude: null, at: r.created_at,
    });
  }

  const approved = new Set((books.data ?? []).map((b) => b.agent_id as string));
  const fresh = new Set<string>();
  const defRows = (defs.data ?? []) as { agent_id: string; version: number; spec: unknown; created_by: string | null; created_at: string }[];
  const inClaude = new Map(((where.data ?? []) as { id: string; runs_on?: string | null; claude_tools?: string[] | null }[])
    .filter((a) => a.runs_on === "claude").map((a) => [a.id, a.claude_tools ?? []]));
  const [tries, routines] = await Promise.all([
    Promise.all(defRows.map((d) => (inClaude.has(d.agent_id) ? null : lastTry(d.agent_id, d.version).catch(() => null)))),
    Promise.all(defRows.map((d): Promise<LinkedCard | null> => (inClaude.has(d.agent_id) ? routineState(d.agent_id).then(linkedStep, () => linkedStep(null)).then((l) => ({ ...l, sheet: sheetHref(deptId, "chat", d.agent_id) })) : Promise.resolve(null)))),
  ]);
  defRows.forEach((d, i) => {
    const a = roster.agents[d.agent_id];
    if (!newAgent({ enabled: !!a?.enabled, approvedRoutine: approved.has(d.agent_id), hasSpec: true })) return;
    fresh.add(d.agent_id);
    const spec = readSpec(d.spec, d.agent_id).spec;
    const seat = seatOf(chart, d.agent_id);
    const boss = seat ? reportsTo(chart, seat) : null;
    const crew = roster.byId[d.agent_id];
    const t = tries[i];
    const linked = routines[i];
    cards.push({
      key: `a:${d.agent_id}`, proposalId: null, agentId: d.agent_id, name: spec.name, seat: seat?.title ?? crew?.role ?? "", job: spec.mandate,
      reportsTo: boss ? (boss.holder === "agent" && boss.agentId ? `${roster.byId[boss.agentId]?.name ?? boss.title} (${dept.name})` : boss.holder === "owner" ? "You" : boss.title) : headName,
      reads: linked ? linkedReads(inClaude.get(d.agent_id) ?? []) : readsOf(spec.tools), can: spec.tools.filter((x) => TOOLS[x]?.kind === "action").map(choice),
      when: crew?.schedule && crew.schedule.kind !== "manual" ? schedWords(crew.schedule) : "Only when you ask",
      cost: linked ? linkedCostLine() : hireCostLine(monthCostOf(costOf(spec), null, crew?.schedule && crew.schedule.kind !== "manual" ? hireRuns(crew.schedule.kind) : 0, bill), budget),
      stage: linked ? "hired" : hireStage(t), why: t && !t.clean ? t.why : null, version: d.version,
      fromApp: /\(via /.test(d.created_by ?? ""), claude: linked, at: d.created_at,
    });
  });
  return { cards: cards.sort((x, y) => x.at.localeCompare(y.at)), fresh };
}
