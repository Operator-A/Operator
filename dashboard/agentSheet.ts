import "server-only";
// One agent's sheet (docs/department-pages.md, slice 4): what the Runs and Edit tabs show, read in one round.
// Runs come from the same reader as the department chat (checklists from run_steps). Edit shows the version
// being worked on (a draft, else the live one), what code offers it, and its latest try.
import { db } from "@/core/db";
import { daySet } from "@/core/flow-rules";
import { headOf, reportsTo, seatOf } from "@/core/org";
import { TOOLS } from "@/core/tools/catalog";
import { builderMenu, builderModelKeys, customMenuFor, getBuilder } from "@/dashboard/builder";
import { getRoster, getTz } from "@/dashboard/data";
import { deptRuns } from "@/dashboard/deptFeed";
import type { FeedRun } from "@/dashboard/dept-feed";
import { when } from "@/dashboard/format";
import { nextRuns } from "@/dashboard/schedule";
import { BUDGET_CEILING, RUN_LIMITS, type AgentSpec } from "@/core/agent-spec";

export interface SheetChoice { id: string; label: string; on: boolean; ready: boolean; why?: string }
export interface SheetData {
  id: string; name: string; role: string; deptId: string | null; deptName: string | null;
  enabled: boolean; next: string | null; model: string | null;
  runs: FeedRun[];
  /** Null for an agent with no saved version (it can't be edited here). */
  spec: AgentSpec | null;
  /** The version being worked on, and whether it is a draft waiting on a try and Go live. */
  version: number; draft: boolean; live: number | null;
  tried: { clean: boolean; why: string | null; at: string; runId: string } | null;
  days: number[]; time: string; manual: boolean;
  reads: SheetChoice[]; can: SheetChoice[]; models: SheetChoice[];
  budget: number; ceiling: number; monthAtPace: number;
  boss: string | null;
  /** The head of its department, whom the owner can also ask in the chat. */
  head: string | null;
  remembers: { id: string; text: string; shared: boolean }[];
  /** Lessons proposed from your rejections, waiting for Keep or Discard. */
  lessons: { id: string; text: string }[];
  versions: { version: number; note: string; when: string; active: boolean }[];
  /** More detail (slice 6): other agents whose latest result it may read, the report tools it may have, and the run limits in code. */
  others: { id: string; name: string; outputName: string }[];
  reports: SheetChoice[];
  limits: { maxSteps: { min: number; max: number }; maxCostUsd: { min: number; max: number } };
}

const READ_KINDS = new Set(["read", "calculate"]);

export async function agentSheet(id: string): Promise<SheetData | null> {
  if (!/^[a-z0-9_]{1,60}$/.test(id)) return null;
  const [roster, tz] = await Promise.all([getRoster(), getTz()]);
  const a = roster.byId[id];
  if (!a) return null;
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const month = new Date(Date.now() - 30 * 864e5).toISOString();
  const [b, custom, keys, runs, spend, proposed] = await Promise.all([
    getBuilder(id), customMenuFor(), builderModelKeys(), deptRuns([id], roster.byId, since, 20),
    db().from("agent_runs").select("cost_usd").eq("agent_id", id).gte("started_at", month),
    db().from("agent_memory").select("id, text").eq("agent_id", id).eq("state", "proposed").order("created_at", { ascending: false }).limit(20),
  ]);
  const menu = builderMenu(roster.crew, undefined, custom, keys);
  const working = b?.draft ?? b?.active ?? null;
  const spec = working?.spec ?? null;
  const has = new Set(spec?.tools ?? []);
  const chart = roster.chart;
  const seat = chart ? seatOf(chart, id) : null;
  const dept = seat?.departmentId && chart ? chart.departments.find((d) => d.id === seat.departmentId) ?? null : null;
  const boss = chart && seat ? reportsTo(chart, seat) : null;
  const hs = chart && dept ? headOf(chart, dept.id) : null;
  const head = hs?.holder === "agent" && hs.agentId && hs.agentId !== id ? roster.byId[hs.agentId]?.name ?? null : null;
  const bossName = boss ? (boss.holder === "agent" && boss.agentId ? roster.byId[boss.agentId]?.name ?? boss.title : boss.holder === "owner" ? "You" : `${boss.title} (open)`) : null;
  const s = a.schedule;
  const next = nextRuns(s, roster.now, 1, tz)[0];
  const tools = menu.tools;
  const reads = tools.filter((t) => READ_KINDS.has(t.kind) && (t.connected || has.has(t.id)))
    .map((t) => ({ id: t.id, label: t.label, on: has.has(t.id), ready: t.connected, why: t.connected ? undefined : "Not connected" }));
  // can do: the actions an approver may grant here (code names the agents of every other action)
  const can = tools.filter((t) => t.kind === "action" && (t.agents === "granted" || has.has(t.id)))
    .map((t) => ({ id: t.id, label: TOOLS[t.id]?.label ?? t.label, on: has.has(t.id), ready: t.connected && t.agents === "granted", why: !t.connected ? "Not connected" : t.agents !== "granted" ? "Set in code" : undefined }));
  const spent30 = (spend.data ?? []).reduce((n, r) => n + Number(r.cost_usd ?? 0), 0);
  return {
    id, name: a.name, role: a.role, deptId: dept?.id ?? null, deptName: dept?.name ?? null,
    enabled: b?.enabled ?? !!roster.agents[id]?.enabled, next: next ? when(next, tz) : null,
    model: menu.models.find((m) => m.id === spec?.model)?.label ?? null,
    runs: runs.reverse(),
    spec, version: working?.version ?? 0, draft: !!b?.draft, live: b?.active?.version ?? null,
    tried: b?.tried ? { clean: b.tried.clean, why: b.tried.why, at: b.tried.at, runId: b.tried.runId } : null,
    days: s && s.kind !== "manual" ? daySet(s.kind) : [1, 2, 3, 4, 5], time: s && s.kind !== "manual" && s.time ? s.time : "09:00", manual: !s || s.kind === "manual" || !s.time,
    reads, can,
    models: menu.models.map((m) => ({ id: m.id, label: m.label, on: m.id === spec?.model, ready: m.ready, why: m.ready ? undefined : `Add a ${m.providerName} key on Connections` })),
    budget: b?.budget ?? 0, ceiling: BUDGET_CEILING, monthAtPace: Math.round(spent30 * 100) / 100,
    boss: bossName ? (dept && boss?.departmentId === dept.id ? `${bossName} (${dept.name})` : bossName) : null,
    head,
    remembers: (b?.standards ?? []).map((x) => ({ id: x.id, text: x.text, shared: x.grp !== "standing_order" })),
    lessons: (proposed.data ?? []).map((r) => ({ id: r.id as string, text: String(r.text) })),
    versions: (b?.versions ?? []).slice(0, 8).map((v) => ({ version: v.version, note: v.note ?? "", when: when(v.createdAt, tz), active: v.active })),
    others: (b?.others ?? []).filter((o) => o.id !== id).map((o) => ({ id: o.id, name: o.name, outputName: o.outputName })),
    reports: tools.filter((t) => t.kind === "report" && t.grantable && (t.connected || has.has(t.id)))
      .map((t) => ({ id: t.id, label: t.label, on: has.has(t.id), ready: t.connected, why: t.connected ? undefined : "Not connected" })),
    limits: { maxSteps: { min: RUN_LIMITS.maxSteps.min, max: RUN_LIMITS.maxSteps.max }, maxCostUsd: { min: RUN_LIMITS.maxCostUsd.min, max: RUN_LIMITS.maxCostUsd.max } },
  };
}
