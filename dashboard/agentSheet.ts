import "server-only";
// One agent's sheet (docs/department-pages.md, slice 4): what the Runs and Edit tabs show, read in one round.
// Runs come from the same reader as the department chat (checklists from run_steps). Edit shows the version
// being worked on (a draft, else the live one), what code offers it, and its latest try.
import { db } from "@/core/db";
import { daySet } from "@/core/flow-rules";
import { headOf, placeSpots, reportsTo, seatOf, type PlaceSpot } from "@/core/org";
import { TOOLS } from "@/core/tools/catalog";
import { builderMenu, builderModelKeys, customMenuFor, getBuilder } from "@/dashboard/builder";
import { getRoster, getTz } from "@/dashboard/data";
import { deptRuns } from "@/dashboard/deptFeed";
import type { FeedRun } from "@/dashboard/dept-feed";
import { when } from "@/dashboard/format";
import { nextRuns, schedWords } from "@/dashboard/schedule";
import { BUDGET_CEILING, RUN_LIMITS, specLooser, versionStarts, type AgentSpec } from "@/core/agent-spec";
import { readStored, startsWords } from "@/core/draft-starts-rules";
import { runsOn } from "@/core/claude-agents";
import { chainHref, newChainHref } from "@/dashboard/chain-rules";
import { routineState, type RoutineState } from "@/integrations/mcp";
import { CONNECTIONS } from "@/dashboard/connections";
import { agentHref } from "@/dashboard/dept-rules";
import { canGroups, chainsOf, fillQuery, headRows, upTo, type CanChoice, type CanGroup, type HandChain, type HeadRow, type UpTo } from "@/dashboard/handoff-rules";

export interface SheetChoice { id: string; label: string; on: boolean; ready: boolean; why?: string }
/** A model on the Runs on picker (card 405): a SheetChoice with its maker. */
export interface SheetModel extends SheetChoice { provider: string }
export interface SheetData {
  id: string; name: string; role: string; deptId: string | null; deptName: string | null;
  enabled: boolean; next: string | null; model: string | null;
  runs: FeedRun[];
  /** Null for an agent with no saved version (it can't be edited here). */
  spec: AgentSpec | null;
  /** The version being worked on, and whether it is a draft waiting on a try and Go live. */
  version: number; draft: boolean; live: number | null;
  tried: { clean: boolean; why: string | null; at: string; runId: string } | null;
  /** What going live with the draft changes beyond its words: actions and limits it adds, and when it starts (a draft from Claude). */
  atGoLive: string[];
  days: number[]; time: string; manual: boolean;
  reads: SheetChoice[]; can: CanChoice[]; models: SheetModel[];
  /** Can do by tool (card 400): connected tools as cards, the rest folded into one line. */
  canBy: { shown: CanGroup[]; later: CanGroup[] };
  /** Hand-offs (card 400): the multi-agent chains it is a step of, each head's report if it reads Department reports, and where a head's report goes. */
  chains: HandChain[];
  /** "+ New chain starting with" this agent (chains slice 1). */
  newChain: string;
  heads: (HeadRow & { href: string | null })[] | null; upTo: UpTo | null;
  /** Agents it may run after (on the sheet's "After another agent finishes"), with their schedule. */
  follow: { id: string; name: string; when: string | null }[];
  budget: number; ceiling: number; monthAtPace: number;
  boss: string | null;
  /**
   * Where it can move (card 385): each department and its places, the same as Crew's picker. In its own department
   * only open seats (a new seat there is Edit chart's job). Null for the company seat's agent or with no chart.
   */
  places: { id: string; name: string; spots: PlaceSpot[] }[] | null;
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
  /** An agent that runs in Claude (docs/live-events.md, slice 2): its routine (the sheet draws the line to paste from its name). */
  claude: { routine: RoutineState } | null;
}

const READ_KINDS = new Set(["read", "calculate"]);

export async function agentSheet(id: string): Promise<SheetData | null> {
  if (!/^[a-z0-9_]{1,60}$/.test(id)) return null;
  const [roster, tz] = await Promise.all([getRoster(), getTz()]);
  const a = roster.byId[id];
  if (!a) return null;
  const since = new Date(Date.now() - 60 * 864e5).toISOString();
  const month = new Date(Date.now() - 30 * 864e5).toISOString();
  const [b, custom, keys, runs, spend, proposed, where] = await Promise.all([
    getBuilder(id), customMenuFor(), builderModelKeys(), deptRuns([id], roster.byId, since, 20),
    db().from("agent_runs").select("cost_usd").eq("agent_id", id).gte("started_at", month),
    db().from("agent_memory").select("id, text").eq("agent_id", id).eq("state", "proposed").order("created_at", { ascending: false }).limit(20),
    runsOn(id),
  ]);
  const claude = where.on === "claude"
    ? { routine: await routineState(id).catch(() => ({ connected: false, routine: null, paused: "Can’t be read right now.", connectedAt: null })) }
    : null;
  const menu = builderMenu(roster.crew, undefined, custom, keys);
  const working = b?.draft ?? b?.active ?? null;
  const spec = working?.spec ?? null;
  const has = new Set(spec?.tools ?? []);
  const chart = roster.chart;
  const seat = chart ? seatOf(chart, id) : null;
  const deptOf = Object.fromEntries(roster.palette.ids.map((x) => [x, chart ? seatOf(chart, x)?.departmentId ?? null : null]));
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
    .map((t) => ({ id: t.id, label: TOOLS[t.id]?.label ?? t.label, on: has.has(t.id), ready: t.connected && t.agents === "granted", why: !t.connected ? "Not connected" : t.agents !== "granted" ? "Set in code" : undefined, conn: String(t.conn) }));
  const connName = (c: string) => CONNECTIONS.find((x) => x.id === c)?.name ?? custom.conns.find((x) => x.id === c)?.name ?? c;
  // hand-offs: names and schedules of the live crew, from the chains read with the roster
  const names = Object.fromEntries(roster.crew.map((x) => [x.id, x.name]));
  const schedules = Object.fromEntries(roster.crew.map((x) => [x.id, x.schedule ?? { kind: "manual" as const }]));
  const mine = s ?? { kind: "manual" as const };
  const heads = chart && has.has("department_reports") ? headRows(chart, mine, schedules, names).map((h) => ({ ...h, href: h.head ? `${agentHref(chart, h.head.id, true)}${h.fill ? fillQuery(h.fill) : ""}` : null })) : null;
  const up = chart ? upTo(chart, id, mine, schedules, names, (x) => (roster.grants[x] ?? []).includes("department_reports")) : null;
  const spent30 = (spend.data ?? []).reduce((n, r) => n + Number(r.cost_usd ?? 0), 0);
  const drafted = b?.draft ? readStored(await versionStarts(id, b.draft.version).catch(() => null)) : null;
  const atGoLive = b?.draft ? [
    ...specLooser(b.active?.spec ?? null, b.draft.spec).map((l) => l.replace(/^./, (m) => m.toUpperCase())),
    ...(drafted ? startsWords(drafted, Object.fromEntries(Object.values(roster.byId).map((x) => [x.id, x.name]))) : []),
  ] : [];
  return {
    id, name: a.name, role: a.role, deptId: dept?.id ?? null, deptName: dept?.name ?? null,
    enabled: b?.enabled ?? !!roster.agents[id]?.enabled, next: next ? when(next, tz) : null,
    model: menu.models.find((m) => m.id === spec?.model)?.label ?? null,
    runs: runs.reverse(),
    spec, version: working?.version ?? 0, draft: !!b?.draft, live: b?.active?.version ?? null,
    tried: b?.tried ? { clean: b.tried.clean, why: b.tried.why, at: b.tried.at, runId: b.tried.runId } : null,
    atGoLive,
    days: s && s.kind !== "manual" ? daySet(s.kind) : [1, 2, 3, 4, 5], time: s && s.kind !== "manual" && s.time ? s.time : "09:00", manual: !s || s.kind === "manual" || !s.time,
    reads, can, canBy: canGroups(can, connName),
    chains: chainsOf(id, roster.chains, names, (c) => chainHref(c, deptOf)), newChain: newChainHref(id, dept?.id ?? null), heads, upTo: up,
    follow: roster.crew.filter((x) => x.id !== id).map((x) => ({ id: x.id, name: x.name, when: x.schedule && x.schedule.kind !== "manual" && x.schedule.time ? schedWords(x.schedule) : null })),
    models: menu.models.map((m) => ({ id: m.id, label: m.label, provider: m.provider, on: m.id === spec?.model, ready: m.ready, why: m.ready ? undefined : `Add a ${m.providerName} key on Connections` })),
    budget: b?.budget ?? 0, ceiling: BUDGET_CEILING, monthAtPace: Math.round(spent30 * 100) / 100,
    places: chart && !(seat && seat.departmentId == null)
      ? chart.departments.map((x) => ({ id: x.id, name: x.name, spots: placeSpots(chart, x.id).filter((p) => x.id !== dept?.id || p.seatId) }))
      : null,
    boss: bossName ? (dept && boss?.departmentId === dept.id ? `${bossName} (${dept.name})` : bossName) : null,
    head,
    remembers: (b?.standards ?? []).map((x) => ({ id: x.id, text: x.text, shared: x.grp !== "standing_order" })),
    lessons: (proposed.data ?? []).map((r) => ({ id: r.id as string, text: String(r.text) })),
    versions: (b?.versions ?? []).slice(0, 8).map((v) => ({ version: v.version, note: v.note ?? "", when: when(v.createdAt, tz), active: v.active })),
    others: (b?.others ?? []).filter((o) => o.id !== id).map((o) => ({ id: o.id, name: o.name, outputName: o.outputName })),
    reports: tools.filter((t) => t.kind === "report" && t.grantable && (t.connected || has.has(t.id)))
      .map((t) => ({ id: t.id, label: t.label, on: has.has(t.id), ready: t.connected, why: t.connected ? undefined : "Not connected" })),
    limits: { maxSteps: { min: RUN_LIMITS.maxSteps.min, max: RUN_LIMITS.maxSteps.max }, maxCostUsd: { min: RUN_LIMITS.maxCostUsd.min, max: RUN_LIMITS.maxCostUsd.max } },
    claude,
  };
}

/** The blank sheet (card 420): what a new agent may be given, read the same way as an agent's Edit tab. */
export interface NewSheetData {
  /** The department the button was pressed in, preset on the form; null on Company. */
  deptId: string | null;
  models: (SheetChoice & { provider: string })[];
  reads: SheetChoice[];
  canBy: { shown: CanGroup[]; later: CanGroup[] };
  follow: { id: string; name: string; when: string | null }[];
  /** Every department and its places; empty with no chart. */
  places: { id: string; name: string; head: string | null; spots: PlaceSpot[] }[];
  budget: number; ceiling: number;
}

/** Null when the department named isn't on the chart. */
export async function newAgentSheet(deptId: string | null): Promise<NewSheetData | null> {
  const [roster, custom, keys] = await Promise.all([getRoster(), customMenuFor(), builderModelKeys()]);
  const chart = roster.chart;
  if (deptId && !chart?.departments.some((x) => x.id === deptId)) return null;
  const menu = builderMenu(roster.crew, undefined, custom, keys);
  const connName = (c: string) => CONNECTIONS.find((x) => x.id === c)?.name ?? custom.conns.find((x) => x.id === c)?.name ?? c;
  // an agent that doesn't exist yet may be given only actions open to any agent an approver grants
  const can = menu.tools.filter((t) => t.kind === "action" && t.agents === "granted")
    .map((t) => ({ id: t.id, label: TOOLS[t.id]?.label ?? t.label, on: false, ready: t.connected, why: t.connected ? undefined : "Not connected", conn: String(t.conn) }));
  const headName = (id: string) => { const h = chart ? headOf(chart, id) : null; return h?.holder === "agent" && h.agentId ? roster.byId[h.agentId]?.name ?? null : h?.holder === "owner" ? "You" : null; };
  return {
    deptId,
    models: menu.models.map((m) => ({ id: m.id, label: m.label, provider: m.provider, on: false, ready: m.ready, why: m.ready ? undefined : `Add a ${m.providerName} key on Connections` })),
    reads: menu.tools.filter((t) => READ_KINDS.has(t.kind) && t.connected && t.grantable && !t.seat && !TOOLS[t.id]?.codeOnly && t.id !== "agent_output" && t.id !== "notion_read_page")
      .map((t) => ({ id: t.id, label: t.label, on: false, ready: true })),
    canBy: canGroups(can, connName),
    follow: roster.crew.map((x) => ({ id: x.id, name: x.name, when: x.schedule && x.schedule.kind !== "manual" && x.schedule.time ? schedWords(x.schedule) : null })),
    places: chart ? chart.departments.map((x) => ({ id: x.id, name: x.name, head: headName(x.id), spots: placeSpots(chart, x.id) })) : [],
    budget: 1, ceiling: BUDGET_CEILING,
  };
}
