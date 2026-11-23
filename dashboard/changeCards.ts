import "server-only";
// The change cards in a department's chat (docs/department-pages.md, slice 6): changes the head filed (to an
// agent in the department, or to one of its goals) that wait on the owner, and ones decided in the last
// week, so the chat keeps its history. An approved change that saved a draft keeps Try it and Go live until
// that draft goes live. Read in one round with the chat; the lines come from dashboard/change-rules.ts.
import { db } from "@/core/db";
import { draftOf, readSpec } from "@/core/agent-spec";
import { headOf, reportsTo, seatOf, seatTitleFor, type Org, type Seat } from "@/core/org";
import { changesSpec } from "@/core/proposal-rules";
import type { Proposal } from "@/core/proposals";
import { TOOLS } from "@/core/tools/catalog";
import { lastTry } from "@/dashboard/builder";
import type { Roster } from "@/dashboard/data";
import { CHANGE_KEEP_DAYS, changeRows, changeStage, goalRows, goalTitle, keepDecided, moveRows, savedVersionOf, type AgentNow, type ChangeCardView, type Place } from "@/dashboard/change-rules";

const label = (id: string) => TOOLS[id]?.label ?? id;
type Row = Pick<Proposal, "id" | "kind" | "payload" | "state" | "outcome" | "created_at" | "decided_at">;
/** The proposals a department's chat shows as change cards: agent changes, goal changes and (card 370) moves into it. */
const CARD_KINDS = ["change_agent", "goal", "move_agent"];

/** Card 370: where an agent sits on the chart, in words, for a move card's Now side. */
function placeOf(chart: Org, seat: Seat | null, nameOf: (id: string) => string): Place {
  if (!seat?.departmentId) return { dept: null, seat: null, boss: null };
  const boss = reportsTo(chart, seat);
  return {
    dept: chart.departments.find((d) => d.id === seat.departmentId)?.name ?? null,
    seat: seat.title,
    boss: !boss ? null : boss.holder === "agent" && boss.agentId ? nameOf(boss.agentId) : boss.holder === "owner" ? "You" : `${boss.title} (open)`,
  };
}

/** The department's change cards, oldest first, and the agents whose tries post in the chat (a draft a change saved). */
export async function deptChanges(deptId: string, roster: Roster): Promise<{ cards: ChangeCardView[]; trying: Set<string> }> {
  const chart = roster.chart;
  if (!chart) return { cards: [], trying: new Set() };
  const since = new Date(roster.now - CHANGE_KEEP_DAYS * 86_400_000).toISOString();
  const cols = "id, kind, payload, state, outcome, created_at, decided_at";
  const [waiting, decided] = await Promise.all([
    db().from("proposals").select(cols).eq("state", "pending").in("kind", CARD_KINDS).eq("department_id", deptId).order("created_at").limit(20),
    db().from("proposals").select(cols).in("state", ["accepted", "declined"]).in("kind", CARD_KINDS).eq("department_id", deptId).gte("decided_at", since).order("created_at").limit(20),
  ]);
  const rows = [...(waiting.data ?? []), ...(decided.data ?? []).filter((r) => keepDecided(r.outcome as string | null))] as Row[];
  if (!rows.length) return { cards: [], trying: new Set() };

  const agentIds = [...new Set(rows.map((r) => (r.payload.kind === "change_agent" ? r.payload.agentId : null)).filter((x): x is string => !!x))];
  const goalIds = [...new Set(rows.map((r) => (r.payload.kind === "goal" ? r.payload.goalId : null)).filter((x): x is string => !!x))];
  const [defs, goals] = await Promise.all([
    agentIds.length ? db().from("agent_defs").select("agent_id, version, spec, active").in("agent_id", agentIds).order("version", { ascending: false }).limit(200) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    goalIds.length ? db().from("goals").select("id, title, measure, target, due_on, state").in("id", goalIds) : Promise.resolve({ data: [] as Record<string, unknown>[] }),
  ]);
  const byAgent = new Map<string, { version: number; spec: unknown; active: boolean }[]>();
  for (const d of (defs.data ?? []) as { agent_id: string; version: number; spec: unknown; active: boolean }[]) byAgent.set(d.agent_id, [...(byAgent.get(d.agent_id) ?? []), d]);
  const goalById = new Map(((goals.data ?? []) as { id: string; title: string; measure: string | null; target: number | null; due_on: string | null; state: string }[]).map((g) => [g.id, g]));

  const nowOf = (agentId: string): AgentNow | null => {
    const live = byAgent.get(agentId)?.find((v) => v.active);
    if (!live) return null;
    const spec = readSpec(live.spec, agentId).spec;
    const s = roster.crew.find((c) => c.id === agentId)?.schedule;
    const days = s && s.kind !== "manual" && s.time ? s.kind : null;
    return { days, time: days ? s!.time ?? null : null, budget: Number(roster.agents[agentId]?.daily_budget_usd ?? 0), job: spec.directive, goodResult: spec.goodResult, tools: spec.tools, costCap: spec.limits.maxCostUsd };
  };

  // the latest try of each draft an approved change saved (and still not live)
  const drafts = rows.map((r) => {
    const p = r.payload;
    if (r.state !== "accepted" || p.kind !== "change_agent" || !p.agentId || !changesSpec(p)) return null;
    const saved = savedVersionOf(r.outcome);
    const draft = draftOf(byAgent.get(p.agentId) ?? []);
    return saved != null && draft?.version === saved ? { agentId: p.agentId, version: saved } : null;
  });
  const tries = await Promise.all(drafts.map((d) => (d ? lastTry(d.agentId, d.version).catch(() => null) : Promise.resolve(null))));
  const trying = new Set(drafts.filter((d): d is NonNullable<typeof d> => !!d).map((d) => d.agentId));

  const nameOf = (id: string) => roster.byId[id]?.name ?? id;
  const cards: ChangeCardView[] = rows.map((r, i) => {
    const p = r.payload;
    if (p.kind === "move_agent") {
      // card 370: a move into this department, filed by Avery or Claude; Approve places it through placeAgent
      const name = roster.byId[p.agentId ?? ""]?.name ?? p.agent;
      const head = headOf(chart, deptId);
      const open = p.seatId ? chart.seats.find((x) => x.id === p.seatId) ?? null : null;
      const to: Place = {
        dept: chart.departments.find((d) => d.id === deptId)?.name ?? p.department,
        seat: open ? `${open.title} (open seat)` : `${seatTitleFor({ name, role: roster.byId[p.agentId ?? ""]?.role })} (new seat)`,
        boss: open ? placeOf(chart, open, nameOf).boss : head ? (head.holder === "agent" && head.agentId ? nameOf(head.agentId) : head.holder === "owner" ? "You" : `${head.title} (open)`) : null,
      };
      const pending = r.state === "pending";
      const fromDept = p.fromDeptId ? chart.departments.find((d) => d.id === p.fromDeptId)?.name ?? "Another department" : null;
      return {
        key: `c:${r.id}`, proposalId: r.id, kind: "move", agentId: p.agentId ?? null,
        kicker: pending ? `Move ${name} · needs your OK` : `Move ${name}`,
        title: `${name} to ${to.dept}`,
        rows: pending ? moveRows(to, placeOf(chart, p.agentId ? seatOf(chart, p.agentId) : null, nameOf)) : moveRows({ dept: to.dept, seat: null, boss: null }, { dept: fromDept, seat: null, boss: null }),
        spec: false, stage: pending ? "proposed" : "done", version: null, why: null, done: pending ? null : r.outcome, at: r.created_at,
      };
    }
    const d = drafts[i], t = tries[i];
    if (p.kind === "change_agent") {
      const name = roster.byId[p.agentId ?? ""]?.name ?? p.agent;
      const seat = p.agentId ? seatOf(chart, p.agentId) : null;
      const spec = changesSpec(p);
      const stage = changeStage({ state: r.state, spec, draftVersion: d?.version ?? null, savedVersion: savedVersionOf(r.outcome), tryOf: t });
      return {
        key: `c:${r.id}`, proposalId: r.id, kind: "agent", agentId: p.agentId ?? null,
        kicker: stage === "proposed" ? `Change to ${name} · needs your OK` : `Change to ${name}`,
        title: `${name}${seat ? `, ${seat.title}` : ""}`, rows: changeRows(p, label, p.agentId ? nowOf(p.agentId) : null),
        spec, stage, version: d?.version ?? null, why: t && !t.clean ? t.why : null, done: r.state === "pending" ? null : r.outcome, at: r.created_at,
      };
    }
    const g = p.kind === "goal" && p.goalId ? goalById.get(p.goalId) : null;
    const plan = p as Extract<typeof p, { kind: "goal" }>;
    return {
      key: `c:${r.id}`, proposalId: r.id, kind: "goal", agentId: null,
      kicker: r.state === "pending" ? "Goal change · needs your OK" : "Goal change",
      title: goalTitle(plan), rows: goalRows(plan, g ? { title: g.title, measure: g.measure, target: g.target == null ? null : Number(g.target), dueOn: g.due_on, state: g.state } : null),
      spec: false, stage: r.state === "pending" ? "proposed" : "done", version: null, why: null, done: r.state === "pending" ? null : r.outcome, at: r.created_at,
    };
  });
  return { cards: cards.sort((x, y) => x.at.localeCompare(y.at)), trying };
}

/** Agents with a draft an approved change saved and that isn't live yet: their tries post in the chat (for the live poll). */
export async function changeTrying(deptId: string, roster: Roster): Promise<Set<string>> {
  const since = new Date(roster.now - CHANGE_KEEP_DAYS * 86_400_000).toISOString();
  const { data } = await db().from("proposals").select("payload, outcome").eq("state", "accepted").eq("kind", "change_agent").eq("department_id", deptId).gte("decided_at", since).limit(20);
  const saved = ((data ?? []) as Pick<Proposal, "payload" | "outcome">[])
    .map((r) => ({ agentId: r.payload.kind === "change_agent" ? r.payload.agentId ?? null : null, v: savedVersionOf(r.outcome) }))
    .filter((x): x is { agentId: string; v: number } => !!x.agentId && x.v != null);
  if (!saved.length) return new Set();
  const { data: defs } = await db().from("agent_defs").select("agent_id, version, active").in("agent_id", [...new Set(saved.map((x) => x.agentId))]).order("version", { ascending: false }).limit(200);
  const rows = (defs ?? []) as { agent_id: string; version: number; active: boolean }[];
  return new Set(saved.filter((x) => draftOf(rows.filter((d) => d.agent_id === x.agentId))?.version === x.v).map((x) => x.agentId));
}
