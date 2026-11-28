// What the Add a department sheet and the Fill from a pack sheet show (packs slice 3, to the approved mockup): each
// pack's card, what it adds and the connections it reads, checked against this business's. Worked out from the pack
// file in code, never by a model. Pure: no database, no network, so `npm run check:pack-install` can test it.
import type { AgentPack, DepartmentPack } from "@/core/pack-rules";
import { crewProblems, agentPackProblems } from "@/core/install-rules";
import { mergePacks } from "@/core/pack-rules";
import { TOOLS } from "@/core/tools/catalog";
import { NEED_TILE, TOOL_TILES, type ToolTileId } from "@/core/tools-step-rules";
import { measureOf, fmt } from "@/core/goal-rules";
import { SERIES_LABEL, readLayout, type SeriesField } from "@/core/widget-rules";
import { modelLabel } from "@/core/chain-view";
import { startWords } from "@/core/pack-install-rules";

export interface Tag { text: string; tone: "" | "ok" | "warn" | "acc" }
/** A line of what a pack adds: "**Iris**, Head of store analytics", "**Week in numbers** chain". */
export interface Row { title: string; rest: string; sub: string; off?: string }
export interface Conn { tile: ToolTileId; name: string; gives: string; connected: boolean; needed: boolean; sub: string }
export interface DeptCard {
  id: string; name: string; about: string; letter: string; hue: string; tags: Tag[];
  /** Screen 2: the pack's own line, what it adds and the connections it reads. */
  by: string; adds: Row[]; conns: Conn[]; offNote: string; problems: string[];
}
export interface AgentCard {
  id: string; name: string; about: string; letter: string; hue: string; tags: Tag[];
  suggests: { id: string; label: string }[]; starts: string | null; problems: string[];
  /** The connections it reads (the Packs page lists them). */
  conns: Conn[];
}

const needsOf = (id: string): readonly string[] => (TOOLS as Record<string, { needs?: readonly string[] }>)[id]?.needs ?? [];
const tilesOf = (tools: readonly string[]) => {
  const want = new Set(tools.flatMap((t) => needsOf(t).map((n) => NEED_TILE[n]).filter(Boolean)));
  return TOOL_TILES.filter((x) => want.has(x.id));
};
const list = (xs: readonly string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const s = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const usd = (n: number) => `$${n.toFixed(2)}`;
/** Connections a pack's tools read. A tile is needed when its first playbook steps can't run without it, else optional. */
function conns(tools: readonly string[], playbookTools: readonly string[], connected: ReadonlySet<ToolTileId>, who: string): Conn[] {
  const needed = new Set(tilesOf(playbookTools).map((t) => t.id));
  return tilesOf(tools).map((t) => {
    const on = connected.has(t.id), need = needed.has(t.id);
    return { tile: t.id, name: t.name, gives: t.gives.toLowerCase(), connected: on, needed: need, sub: on ? "Connected" : need ? `Not connected. ${who} can’t run without it.` : `Not connected. ${who} works without it and says so in the report.` };
  });
}
const connTags = (cs: Conn[], missing: "not connected" | "needed"): Tag[] =>
  cs.map((c) => (c.connected ? { text: `${c.name} connected`, tone: "ok" as const } : c.needed ? { text: `${c.name} ${missing}`, tone: "warn" as const } : { text: `${c.name} optional`, tone: "warn" as const }));

/** Its Overview in words, from its layout: "revenue, orders, sessions and the weekly report". */
function overviewWords(raw: unknown): string {
  const lay = readLayout(raw);
  if (!lay) return "Its Overview shows the report, runs and spend, like every department’s";
  const words: string[] = [];
  for (const w of lay.flat()) {
    const t = w.w === "measure_tile" ? (w.label ?? measureOf(w.measure)?.label) : w.w === "series_chart" ? SERIES_LABEL[(w.field ?? "revenue") as SeriesField] : w.w === "run_metric" ? w.label : w.w === "report" ? "the report" : null;
    // "Revenue this month", "Revenue per day" and "Sessions, last 7 days" read as revenue and sessions
    const word = t?.toLowerCase().replace(/,.*$/, "").replace(/ (this month|per day|this week)$/, "").trim();
    if (word && !words.includes(word)) words.push(word);
  }
  return words.length ? `Its Overview shows ${list(words.slice(0, 5))}` : "Its Overview is laid out by the pack";
}

/** A department pack's card and confirm sheet. `have` is the department names already in this business. */
export function deptCard(p: DepartmentPack, connected: ReadonlySet<ToolTileId>, have: readonly string[]): DeptCard {
  const crew = mergePacks([p]);
  const problems = crewProblems(crew);
  const head = crew.agents[0];
  const name = (id: string | null) => crew.agents.find((a) => a.id === id)?.name ?? "an agent";
  const specs = crew.specs as Record<string, { tools?: string[] }>;
  const tools = Object.values(specs).flatMap((x) => x.tools ?? []);
  const firstSteps = Object.values(crew.playbooks).flatMap((steps) => steps.map((x) => x.tool));
  const who = crew.agents.length === 1 ? head?.name ?? "The agent" : "Its agents";
  const cs = conns(tools, firstSteps, connected, who);
  const open = crew.seats.filter((x) => x.holder === "open");
  const there = have.some((n) => n.toLowerCase() === p.name.toLowerCase());
  const tags: Tag[] = [
    { text: `${s(crew.agents.length, "agent")}${open.length ? ` · ${s(open.length, "open seat")}` : ""}`, tone: "" },
    ...(there ? [{ text: `You have ${p.name}`, tone: "acc" as const }] : connTags(cs, "not connected")),
    { text: `${p.author} · v${p.version}`, tone: "" },
  ];
  const adds: Row[] = [
    ...crew.departments.map((d) => ({ title: d.name, rest: " department", sub: overviewWords(d.overview) })),
    ...crew.agents.map((a) => {
      const t = specs[a.id]?.tools ?? [];
      return { title: a.name, rest: `, ${a.role}`, sub: `${modelLabel(a.model)} · at most ${usd(a.daily_budget_usd)} a day · ${s(t.filter((x) => TOOLS[x]?.kind !== "action").length, "read tool")}, no actions`, off: "Off duty" };
    }),
    ...open.map((x) => ({ title: x.title, rest: ", open seat", sub: "Hire for it later, or fill it from an agent pack" })),
    ...(crew.flow.chains as { name: string; start: unknown; steps: { agent?: string }[] }[]).map((c) => ({ title: c.name, rest: " chain", sub: `${startWords(c.start)}: ${list(c.steps.map((x) => name(x.agent ?? null)))}`, off: "Off" })),
    ...crew.goals.map((g) => { const m = measureOf(g.measure); return { title: g.title, rest: " goal", sub: g.target == null ? "No target or due date until you set them" : `Target ${m ? fmt(g.target, m.unit) : g.target}, no due date until you set one` }; }),
  ];
  const names = list(crew.agents.map((a) => a.name));
  const chainsOff = crew.flow.chains.length ? `, and ${crew.flow.chains.length === 1 ? "the chain is" : "the chains are"} off` : "";
  return {
    id: p.id, name: p.name, about: p.about, letter: p.name[0]?.toUpperCase() ?? "?", hue: head?.hue ?? "#C9C9D0", tags,
    by: `From the ${p.name} pack, version ${p.version}, by ${p.author}`, adds, conns: cs,
    offNote: `${names} ${crew.agents.length === 1 ? "is" : "are"} off duty, ${crew.agents.length === 1 ? "the" : "each"} playbook waits for your OK${chainsOff}. Nothing runs or costs anything until you turn it on.`,
    problems,
  };
}

/** An agent pack's card for an open seat: its Can do toggles are the actions it suggests, each starting off. */
export function agentCard(p: AgentPack, connected: ReadonlySet<ToolTileId>): AgentCard {
  const problems = agentPackProblems(p);
  const tools = ((p.spec ?? {}) as { tools?: string[] }).tools ?? [];
  const cs = conns(tools, p.playbook.map((x) => x.tool), connected, p.agent.name);
  return {
    id: p.id, name: p.name, about: p.about, letter: p.agent.name[0]?.toUpperCase() ?? "?", hue: p.agent.hue ?? "#C9C9D0",
    tags: [{ text: `${modelLabel(p.agent.model)} · ${usd(p.agent.daily_budget_usd)} a day`, tone: "" }, ...connTags(cs, "needed"), { text: `${p.author} · v${p.version}`, tone: "" }],
    suggests: p.suggests.map((id) => ({ id, label: TOOLS[id]?.label ?? id })),
    starts: p.starts ? startWords({ type: "schedule", ...p.starts }) : null,
    problems, conns: cs,
  };
}
