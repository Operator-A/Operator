// The Packs page and a page per pack (docs/packs.md, packs slice 4, to the approved mockup): every pack this business
// can add, searchable and filtered by kind and by the tools it reads, and everything a pack adds before it's added.
// Worked out from the pack files in code, never by a model; a month's cost is the hire card's estimate (core/cost-rules
// through dashboard/cost.ts), handed in. Pure: no database, no network, so `npm run check:pack-install` can test it.
import type { AgentPack, DepartmentPack } from "@/core/pack-rules";
import { mergePacks } from "@/core/pack-rules";
import { agentCard, deptCard, type Conn, type Row } from "@/core/pack-card-rules";
import { livePlan, seatFits, type LiveOrg } from "@/core/pack-install-rules";
import { dayRuns, isDays, type Days } from "@/core/flow-rules";
import { TOOLS } from "@/core/tools/catalog";
import { modelLabel } from "@/core/chain-view";
import { measureOf } from "@/core/goal-rules";
import { SERIES_LABEL, WIDGET_LABEL, readLayout, type SeriesField, type Widget } from "@/core/widget-rules";
import type { ToolTileId } from "@/core/tools-step-rules";
import { usd } from "@/core/cost-rules";
import type { MarketCard, MarketFilter, PackCost } from "@/core/pack-market-view";
export { costWords, matchCards, noMatchWords, packHref, packsHref, type MarketCard, type MarketFilter, type PackCost, type PackKind } from "@/core/pack-market-view";

/** The parts of an agent the estimate reads. */
export interface CostAgent { model: string; effort?: string; tools: readonly string[]; maxSteps?: number; maxCostUsd?: number }
/** A month's estimate for one agent at this many runs a month: what it costs a run, and the most. */
export type CostOf = (a: CostAgent, runsPerMonth: number) => { perRun: number | null; month: number; atMost: number | null };


const lc = (s: string) => s.toLowerCase();
const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const specOf = (specs: unknown, id: string) => ((specs ?? {}) as Record<string, { model?: string; effort?: string; tools?: string[]; limits?: { maxSteps?: number; maxCostUsd?: number } }>)[id] ?? {};
const costAgent = (sp: ReturnType<typeof specOf>, model: string): CostAgent => ({ model: sp.model ?? model, effort: sp.effort, tools: sp.tools ?? [], maxSteps: sp.limits?.maxSteps, maxCostUsd: sp.limits?.maxCostUsd });
const runsOf = (start: unknown) => {
  const st = (start ?? {}) as { type?: string; days?: unknown };
  return st.type === "schedule" && isDays(st.days) ? dayRuns(st.days as Days) : 0;
};
/** Sums a pack's agents: each at the runs a month its scheduled chains give it. */
function sum(items: { a: CostAgent; runs: number }[], cost: CostOf): PackCost {
  const xs = items.map((i) => cost(i.a, i.runs));
  const byHand = items.every((i) => !i.runs);
  return {
    month: xs.reduce((t, x) => t + x.month, 0),
    perRun: xs.reduce((t, x) => t + (x.perRun ?? 0), 0),
    atMost: items.reduce((t, i, k) => t + (i.runs ? xs[k].atMost ?? 0 : 0), 0),
    byHand, unknown: xs.some((x) => x.perRun == null),
  };
}

/** A department pack's month once on duty: each agent at the runs its pack's scheduled chains give it. */
export function deptCost(p: DepartmentPack, cost: CostOf): PackCost {
  const crew = mergePacks([p]);
  const chains = crew.flow.chains as { start: unknown; steps: { agent?: string }[] }[];
  return sum(crew.agents.map((a) => ({
    a: costAgent(specOf(crew.specs, a.id), a.model),
    runs: chains.filter((c) => c.steps.some((x) => x.agent === a.id)).reduce((t, c) => t + runsOf(c.start), 0),
  })), cost);
}
/** An agent pack's month on the schedule it suggests (by hand when it suggests none). */
export const agentCost = (p: AgentPack, cost: CostOf): PackCost =>
  sum([{ a: costAgent((p.spec ?? {}) as ReturnType<typeof specOf>, p.agent.model), runs: p.starts ? runsOf({ type: "schedule", ...p.starts }) : 0 }], cost);

/** The line under it on a pack's page. */
export function costNote(c: PackCost, who: string): string {
  const est = c.byHand ? `It runs when you press Run until you give it a schedule. Estimated from ${who}’s model and limits` : `Estimated from ${who}’s model, limits and schedule, at most ${usd(c.atMost)} a month`;
  return `${est}. Nothing costs anything while it’s off.`;
}

const words = (...xs: (string | null | undefined)[]) => lc(xs.filter(Boolean).join(" "));

/** The Packs page's cards: department packs (but the setup-only one), then agent packs. */
export function marketCards(o: { depts: readonly DepartmentPack[]; agents: readonly AgentPack[]; connected: ReadonlySet<ToolTileId>; have: readonly string[]; seats: readonly { holder: string; title: string; sub: string; departmentId: string | null }[]; cost: CostOf }): MarketCard[] {
  const open = o.seats.filter((x) => x.holder === "open" && x.departmentId != null);
  const dept = o.depts.map((p): MarketCard => {
    const c = deptCard(p, o.connected, o.have);
    return {
      id: p.id, kind: "department", name: p.name, about: p.about, letter: c.letter, hue: c.hue, tags: c.tags.filter((t) => !/ · v\d+$/.test(t.text)),
      tiles: c.conns.map((x) => x.tile), cost: deptCost(p, o.cost),
      words: words(p.name, p.about, ...p.agents.map((a) => `${a.name} ${a.role}`), ...p.seats.map((x) => x.title)),
    };
  });
  const agent = o.agents.map((p): MarketCard => {
    const c = agentCard(p, o.connected);
    const fits = open.filter((x) => seatFits(p, x)).length;
    return {
      id: p.id, kind: "agent", name: p.name, about: p.about, letter: c.letter, hue: c.hue,
      tags: [{ text: fits ? `Fits ${s(fits, "open seat")}` : "No open seat fits yet", tone: "" }, ...c.tags.slice(1).filter((t) => !/ · v\d+$/.test(t.text))],
      tiles: c.conns.map((x) => x.tile),
      cost: agentCost(p, o.cost), words: words(p.name, p.about, p.agent.name, p.agent.role, p.seat?.title),
    };
  });
  return [...dept, ...agent];
}

/** The Works with chips: every connection a listed pack reads, connected first. */
export function tileChips(cards: readonly MarketCard[], all: readonly { id: ToolTileId; name: string }[], connected: ReadonlySet<ToolTileId>): { id: ToolTileId; name: string; connected: boolean }[] {
  const used = new Set(cards.flatMap((c) => c.tiles));
  const xs = all.filter((t) => used.has(t.id)).map((t) => ({ id: t.id, name: t.name, connected: connected.has(t.id) }));
  return [...xs.filter((x) => x.connected), ...xs.filter((x) => !x.connected)];
}

/** A widget's name on a pack's page: "Revenue this month", "Revenue per day, 30 days". */
export function widgetName(w: Widget): string {
  if (w.w === "measure_tile") return w.label ?? measureOf(w.measure ?? "")?.label ?? WIDGET_LABEL.measure_tile;
  if (w.w === "series_chart") return `${SERIES_LABEL[(w.field ?? "revenue") as SeriesField]}, ${w.days ?? 30} days`;
  if (w.w === "run_metric") return w.label ?? WIDGET_LABEL.run_metric;
  return WIDGET_LABEL[w.w];
}
const BIG: ReadonlySet<string> = new Set(["report", "series_chart", "goal_chart", "runs_chart", "spend"]);
/** The pack's Overview drawn small: rows of named cells with their spans, or null for the default page. */
export function layoutCells(raw: unknown): { name: string; span: 1 | 2 | 3; big: boolean }[][] | null {
  const lay = readLayout(raw);
  if (!lay) return null;
  return lay.map((row) => row.map((w) => ({ name: widgetName(w), span: (w.span ?? (row.length === 1 ? 3 : 1)) as 1 | 2 | 3, big: BIG.has(w.w) })));
}

/** One agent on a pack's page. */
export interface PageAgent { name: string; role: string; sub: string }
export interface DeptPage {
  kind: "department"; id: string; name: string; about: string; letter: string; hue: string; version: number; author: string; license: string;
  agents: PageAgent[]; seats: Row[]; chains: Row[]; goals: Row[]; conns: Conn[]; cells: ReturnType<typeof layoutCells>;
  cost: PackCost; costWho: string;
  /** "You have Store analytics. Adding it again makes Store analytics 2." */
  have: string | null;
  /** Why it can't be added here (its checks, or the second install the gateway refuses); null when it can. */
  cant: string | null;
}
export interface AgentPage {
  kind: "agent"; id: string; name: string; about: string; letter: string; hue: string; version: number; author: string; license: string;
  agent: PageAgent; suggests: string[]; conns: Conn[]; cost: PackCost;
  fits: { seatId: string; title: string; dept: string; deptId: string; head: string | null }[];
  cant: string | null;
}

const readTools = (tools: readonly string[]) => tools.filter((t) => TOOLS[t]?.kind !== "action");

/** A department pack's page. `org` is what's in this business, for the second-install check. */
export function deptPage(p: DepartmentPack, o: { connected: ReadonlySet<ToolTileId>; have: readonly string[]; org: LiveOrg | null; cost: CostOf }): DeptPage {
  const c = deptCard(p, o.connected, o.have);
  const crew = mergePacks([p]);
  let cant: string | null = c.problems.length ? `This pack can’t be added: ${c.problems.join("; ")}.` : null;
  let have: string | null = null;
  if (!cant && o.org) {
    try {
      const plan = livePlan(p, o.org);
      const named = Object.values(plan.names)[0];
      if (named && named !== p.name) have = `You have ${p.name}. Adding it again makes ${named}, with its own agents.`;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      cant = /gateway lets only/.test(msg) ? `You have ${p.name}, and a second can’t be added: ${msg.replace(/^This pack can't be installed here: /, "")}.` : msg;
    }
  }
  return {
    kind: "department", id: p.id, name: p.name, about: p.about, letter: c.letter, hue: c.hue, version: p.version, author: p.author, license: p.license,
    agents: crew.agents.map((a) => {
      const sp = specOf(crew.specs, a.id), tools = sp.tools ?? [];
      const acts = tools.filter((t) => TOOLS[t]?.kind === "action");
      return { name: a.name, role: a.role, sub: `${modelLabel(sp.model ?? a.model)}${sp.effort ? `, ${sp.effort} effort` : ""} · at most $${a.daily_budget_usd.toFixed(2)} a day · reads ${s(readTools(tools).length, "tool")} · ${acts.length ? `asks for ${s(acts.length, "action")}` : "asks for no actions"}` };
    }),
    seats: c.adds.filter((r) => r.rest === ", open seat"),
    chains: c.adds.filter((r) => r.rest === " chain").map((r) => ({ ...r, off: "Starts off" })),
    goals: c.adds.filter((r) => r.rest === " goal"),
    conns: c.conns, cells: layoutCells(crew.departments[0]?.overview),
    cost: deptCost(p, o.cost), costWho: crew.agents.length === 1 ? crew.agents[0].name : "its agents",
    have, cant,
  };
}

/** An agent pack's page: the open seats in this business it fits. */
export function agentPage(p: AgentPack, o: { connected: ReadonlySet<ToolTileId>; seats: readonly { id: string; holder: string; title: string; sub: string; departmentId: string | null }[]; deptName: (id: string) => string; head: (seatId: string) => string | null; cost: CostOf }): AgentPage {
  const c = agentCard(p, o.connected);
  const sp = (p.spec ?? {}) as ReturnType<typeof specOf>, tools = sp.tools ?? [];
  return {
    kind: "agent", id: p.id, name: p.name, about: p.about, letter: c.letter, hue: c.hue, version: p.version, author: p.author, license: p.license,
    agent: { name: p.agent.name, role: p.agent.role, sub: `${modelLabel(sp.model ?? p.agent.model)}${sp.effort ? `, ${sp.effort} effort` : ""} · at most $${p.agent.daily_budget_usd.toFixed(2)} a day · reads ${s(readTools(tools).length, "tool")} · ${c.starts ? `${c.starts}, starts off` : "runs by hand"}` },
    suggests: c.suggests.map((x) => x.label), conns: c.conns, cost: agentCost(p, o.cost),
    fits: o.seats.filter((x) => x.holder === "open" && x.departmentId != null && seatFits(p, x)).map((x) => ({ seatId: x.id, title: x.title, dept: o.deptName(x.departmentId!), deptId: x.departmentId!, head: o.head(x.id) })),
    cant: c.problems.length ? `This pack can’t be added: ${c.problems.join("; ")}.` : null,
  };
}

/** The Works with filter and kind from the address. */
export function readFilter(sp: { kind?: string; tool?: string; q?: string }, tiles: readonly string[]): MarketFilter {
  return {
    q: typeof sp.q === "string" ? sp.q.slice(0, 80) : "",
    kind: sp.kind === "department" || sp.kind === "agent" ? sp.kind : "all",
    tile: typeof sp.tool === "string" && tiles.includes(sp.tool) ? sp.tool : null,
  };
}
