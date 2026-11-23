// A department by talking to Avery (card 156, docs/company-mode.md "New department"). The founder tells
// Avery they want a department; she interviews them and fills in a draft, one part at a time, with the
// chat tool Update the department draft. Code checks every part here: names, limits, goals and their
// measures, sources and their states, the people and their tools (read tools only, never an action,
// never a server's tools), and it never takes an address. Pure, so check:department can test it.
import type { Brain } from "@/core/proposal-rules";
import { checkServiceName } from "@/core/connector-rules";

export const MAX_TRACKS = 6, MAX_DEPT_GOALS = 3, MAX_SOURCES = 5, MAX_AGENTS = 2, MAX_PERSON_TOOLS = 8;
export const MAX_DRAFT_PARTS = 12;

export interface DraftGoal { title: string; measure: string | null; target: number | null }
export interface DraftSource { service: string; what: string }
export interface DraftPerson { name: string; seat: string; job: string; eachRun: string; goodResult: string; tools: string[]; brain: Brain }
export interface DeptDraft {
  name: string;
  purpose: string;
  tracks: string[];
  goals: DraftGoal[];
  sources: DraftSource[];
  head: DraftPerson | null;
  agents: DraftPerson[];
  updatedAt: string;
}
export const EMPTY_DRAFT: DeptDraft = { name: "", purpose: "", tracks: [], goals: [], sources: [], head: null, agents: [], updatedAt: "" };

/** What the checks read: the tool list, the goal picker's measures and the departments and agents there now. */
export interface DraftCtx {
  tools: Readonly<Record<string, { kind: string; label: string }>>;
  /** A tool id on a server the founder added (core/custom-mcp-rules.ts isCustomToolId). */
  isCustom: (id: string) => boolean;
  measures: Readonly<Record<string, { label: string }>>;
  departments: readonly string[];
  agentNames: readonly string[];
}

const one = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const many = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const LINK = /https?:\/\/|www\.|\.[a-z]{2,6}\/|[a-z0-9-]+\.(com|io|net|org|dev|app|ai|co)\b/i;
const NAME = /^[A-Z][a-zA-Z'-]{1,29}$/;
const DEPT = /^[A-Za-z][A-Za-z0-9 &'-]{1,39}$/;

/** "a; b\nc" into short lines, without repeats or links. */
export function lines(v: unknown, max: number, each = 80): string[] {
  const out: string[] = [];
  for (const raw of String(v ?? "").split(/[;\n]+/)) {
    const s = one(raw, each);
    if (s.length < 2 || LINK.test(s) || out.some((x) => same(x, s))) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

const toolList = (v: unknown) => [...new Set(String(v ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];

/** One person's fields, checked like a hire: read tools from the tool list only. */
export function checkPerson(input: Record<string, unknown>, ctx: DraftCtx, role: "head" | "agent"): { person: DraftPerson } | { problem: string } {
  const name = one(input.name, 30);
  if (!NAME.test(name)) return { problem: "name must be a short first name, starting with a capital" };
  if (ctx.agentNames.some((n) => same(n, name))) return { problem: `there is already an agent called ${name}` };
  const seat = one(input.seat, 60) || (role === "head" ? "Head" : "");
  if (seat.length < 2) return { problem: "seat must name the seat's title, like Cover watcher" };
  if (LINK.test(seat)) return { problem: "a seat's title can't hold a link" };
  const job = one(input.job, 200);
  if (job.length < 10) return { problem: "job must say what it does, in a sentence" };
  const eachRun = many(input.each_run, 1500);
  if (eachRun.length < 20) return { problem: "each_run must say what it does on each run" };
  const goodResult = many(input.good_result, 400);
  if (goodResult.length < 10) return { problem: "good_result must say what a good result looks like" };
  if (LINK.test(job) || LINK.test(eachRun) || LINK.test(goodResult)) return { problem: "a person's words can't hold a link or an address" };
  const tools = toolList(input.tools);
  if (!tools.length) return { problem: "tools must list at least one read tool id" };
  if (tools.length > MAX_PERSON_TOOLS) return { problem: `at most ${MAX_PERSON_TOOLS} tools` };
  for (const id of tools) {
    const t = ctx.tools[id];
    if (!t && ctx.isCustom(id)) return { problem: `${id} is on a server the founder added: they grant it in the agent's sheet after the department is approved` };
    if (!t) return { problem: `${id} isn't on the tool list` };
    if (t.kind === "action") return { problem: `${t.label} is an action: a proposal can't hand out actions, only code can` };
    if (t.kind === "report") return { problem: `${t.label} is a report: name the read tools it uses` };
  }
  const brain: Brain = input.brain === "thinking" ? "thinking" : "quick";
  return { person: { name, seat, job, eachRun, goodResult, tools, brain } };
}

/** A goal: words, and a measure from the picker's list (or none, words only). The target is the founder's number. */
export function checkGoal(input: Record<string, unknown>, ctx: DraftCtx): { goal: DraftGoal } | { problem: string } {
  const title = one(input.title, 120);
  if (title.length < 3) return { problem: "say what the goal is, like Keep 21+ days of green cover" };
  if (LINK.test(title)) return { problem: "a goal can't hold a link" };
  const m = one(input.measure, 40);
  const measure = !m || /^(none|no|null|-)$/i.test(m) ? null : m;
  if (measure && !ctx.measures[measure]) return { problem: `${measure} isn't a measure on the goal picker: name one from Goal progress's list, or none` };
  const t = one(input.target, 20).replace(/[$,%\s]/g, "");
  const target = t === "" ? null : Number(t);
  if (target != null && (!Number.isFinite(target) || Math.abs(target) > 1e9)) return { problem: "target must be a plain number, the one the founder said" };
  if (target != null && !measure) return { problem: "a target needs a measure; without one the goal stays in words" };
  return { goal: { title, measure, target } };
}

/** A source: a service by name and what the department reads there. Never an address. */
export function checkSource(input: Record<string, unknown>): { source: DraftSource } | { problem: string } {
  const raw = one(input.service, 60);
  if (LINK.test(raw)) return { problem: "name the service, never an address: only the founder adds a server, on Connections" };
  const n = checkServiceName(raw);
  if ("problem" in n) return { problem: n.problem };
  const what = one(input.what, 200);
  if (what.length < 5) return { problem: "what must say what the department reads there" };
  if (LINK.test(what)) return { problem: "what can't hold a link or an address" };
  return { source: { service: n.name, what } };
}

export const DRAFT_PARTS = ["about", "goal", "source", "head", "agent", "remove"] as const;
export type DraftPart = (typeof DRAFT_PARTS)[number];

/**
 * One update from Avery's chat tool applied to the draft. Each call changes one part: about (name,
 * purpose, tracks), a goal, a source, the head, a narrow agent, or removes a goal, source or agent by
 * its title or name. A part with the same title or name replaces the old one.
 */
export function applyPart(d: DeptDraft, input: Record<string, unknown>, ctx: DraftCtx, now: string): { draft: DeptDraft; note: string } | { problem: string } {
  const part = String(input.part ?? "") as DraftPart;
  if (!DRAFT_PARTS.includes(part)) return { problem: "part must be about, goal, source, head, agent or remove" };
  const next: DeptDraft = { ...d, tracks: [...d.tracks], goals: [...d.goals], sources: [...d.sources], agents: [...d.agents], updatedAt: now };
  if (part === "about") {
    const changed: string[] = [];
    if (input.name != null && String(input.name).trim()) {
      const name = one(input.name, 40);
      if (!DEPT.test(name)) return { problem: "the department's name is 2 to 40 letters, digits or spaces" };
      if (ctx.departments.some((x) => same(x, name))) return { problem: `there is already a ${name} department` };
      next.name = name; changed.push("name");
    }
    if (input.purpose != null && String(input.purpose).trim()) {
      const purpose = one(input.purpose, 200);
      if (LINK.test(purpose)) return { problem: "the purpose can't hold a link" };
      next.purpose = purpose; changed.push("purpose");
    }
    if (input.tracks != null && String(input.tracks).trim()) {
      next.tracks = lines(input.tracks, MAX_TRACKS);
      changed.push(`${next.tracks.length} thing${next.tracks.length === 1 ? "" : "s"} to track`);
    }
    if (!changed.length) return { problem: "about needs a name, a purpose or what it tracks" };
    return { draft: next, note: changed.join(", ") };
  }
  if (part === "goal") {
    const g = checkGoal(input, ctx);
    if ("problem" in g) return g;
    const at = next.goals.findIndex((x) => same(x.title, g.goal.title));
    if (at < 0 && next.goals.length >= MAX_DEPT_GOALS) return { problem: `at most ${MAX_DEPT_GOALS} goals: remove one first` };
    if (at >= 0) next.goals[at] = g.goal; else next.goals.push(g.goal);
    return { draft: next, note: `goal “${g.goal.title}”${g.goal.measure ? ", measured in code" : ", words only"}` };
  }
  if (part === "source") {
    const s = checkSource(input);
    if ("problem" in s) return s;
    const at = next.sources.findIndex((x) => same(x.service, s.source.service));
    if (at < 0 && next.sources.length >= MAX_SOURCES) return { problem: `at most ${MAX_SOURCES} sources: remove one first` };
    if (at >= 0) next.sources[at] = s.source; else next.sources.push(s.source);
    return { draft: next, note: `source ${s.source.service}` };
  }
  if (part === "head" || part === "agent") {
    const others = [...(part === "head" ? next.agents : [next.head, ...next.agents.filter((a) => !same(a.name, one(input.name, 30)))]).filter((x): x is DraftPerson => !!x)];
    const p = checkPerson(input, { ...ctx, agentNames: [...ctx.agentNames, ...others.map((x) => x.name)] }, part);
    if ("problem" in p) return p;
    if (part === "head") { next.head = p.person; return { draft: next, note: `head ${p.person.name}` }; }
    const at = next.agents.findIndex((x) => same(x.name, p.person.name));
    if (at < 0 && next.agents.length >= MAX_AGENTS) return { problem: `at most ${MAX_AGENTS} narrow agents to start: remove one first` };
    if (at >= 0) next.agents[at] = p.person; else next.agents.push(p.person);
    return { draft: next, note: `agent ${p.person.name}` };
  }
  // remove
  const what = one(input.title ?? input.name ?? input.service, 120);
  if (!what) return { problem: "remove needs the goal's title, the source's service or the agent's name" };
  const g = next.goals.findIndex((x) => same(x.title, what));
  if (g >= 0) { next.goals.splice(g, 1); return { draft: next, note: `removed goal “${what}”` }; }
  const s = next.sources.findIndex((x) => same(x.service, what));
  if (s >= 0) { next.sources.splice(s, 1); return { draft: next, note: `removed source ${what}` }; }
  const a = next.agents.findIndex((x) => same(x.name, what));
  if (a >= 0) { next.agents.splice(a, 1); return { draft: next, note: `removed ${what}` }; }
  if (next.head && same(next.head.name, what)) { next.head = null; return { draft: next, note: `removed head ${what}` }; }
  return { problem: `nothing in the draft is called ${what}` };
}

/** Reads a stored draft back, keeping only well-shaped parts. Null when there is none. */
export function readDraft(raw: unknown): DeptDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Partial<DeptDraft>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  const person = (p: unknown): DraftPerson | null => {
    if (!p || typeof p !== "object") return null;
    const x = p as Partial<DraftPerson>;
    if (typeof x.name !== "string" || !Array.isArray(x.tools)) return null;
    return { name: str(x.name, 30), seat: str(x.seat, 60), job: str(x.job, 200), eachRun: str(x.eachRun, 1500), goodResult: str(x.goodResult, 400), tools: x.tools.filter((t): t is string => typeof t === "string").slice(0, MAX_PERSON_TOOLS), brain: x.brain === "thinking" ? "thinking" : "quick" };
  };
  const d: DeptDraft = {
    name: str(r.name, 40), purpose: str(r.purpose, 200),
    tracks: Array.isArray(r.tracks) ? r.tracks.filter((t): t is string => typeof t === "string").slice(0, MAX_TRACKS) : [],
    goals: Array.isArray(r.goals) ? r.goals.filter((g): g is DraftGoal => !!g && typeof g.title === "string").slice(0, MAX_DEPT_GOALS).map((g) => ({ title: str(g.title, 120), measure: typeof g.measure === "string" ? g.measure : null, target: typeof g.target === "number" && Number.isFinite(g.target) ? g.target : null })) : [],
    sources: Array.isArray(r.sources) ? r.sources.filter((s): s is DraftSource => !!s && typeof s.service === "string").slice(0, MAX_SOURCES).map((s) => ({ service: str(s.service, 60), what: str(s.what, 200) })) : [],
    head: person(r.head), agents: Array.isArray(r.agents) ? r.agents.map(person).filter((p): p is DraftPerson => !!p).slice(0, MAX_AGENTS) : [],
    updatedAt: str(r.updatedAt, 40),
  };
  return d.name || d.purpose || d.tracks.length || d.goals.length || d.sources.length || d.head || d.agents.length ? d : null;
}

/** What still stops the draft from being proposed; [] when it can be. */
export function draftGaps(d: DeptDraft): string[] {
  const out: string[] = [];
  if (!d.name) out.push("a name");
  if (!d.purpose) out.push("what it is for");
  if (!d.head) out.push("a head");
  if (!d.goals.length) out.push("at least one goal");
  return out;
}

export type SourceState =
  | { state: "connected"; how: "tile" | "server"; label: string }
  | { state: "add"; label: string; href: string }
  | { state: "ask" };

/**
 * Where a source stands now, worked out in code: a connected tool or a server the founder added; a
 * known server to add on Connections; or a connection request when the department is approved.
 */
export function sourceState(service: string, w: { tiles: readonly { name: string; connected: boolean }[]; servers: readonly string[]; known: readonly { key: string; name: string }[]; keyOf: (name: string) => string }): SourceState {
  const key = w.keyOf(service);
  const tile = w.tiles.find((t) => w.keyOf(t.name) === key);
  if (tile?.connected) return { state: "connected", how: "tile", label: tile.name };
  const server = w.servers.find((s) => w.keyOf(s) === key || w.keyOf(s).includes(key) || key.includes(w.keyOf(s)));
  if (server) return { state: "connected", how: "server", label: server };
  if (tile) return { state: "add", label: tile.name, href: "/connections" };
  const known = w.known.find((k) => k.key === key || w.keyOf(k.name) === key);
  if (known) return { state: "add", label: known.name, href: "/connections/find" };
  return { state: "ask" };
}

/** The proposal's title: "New department: Operations". */
export const departmentTitle = (d: Pick<DeptDraft, "name">) => `New department: ${d.name}`;

/** Every person the department would create, head first. */
export const peopleOf = (d: Pick<DeptDraft, "head" | "agents">): DraftPerson[] => [...(d.head ? [d.head] : []), ...d.agents];
