// The shared brain, slice 2 (docs/shared-brain.md, card 231): what one business would add to what
// every business on OPERATOR learns. Pure, so `npm run check:brain` can test it.
//
// A snapshot holds only values from fixed lists in code and counts: the kind of business (picked from
// BUSINESS_KINDS), bands for revenue and age, the tools it uses by part (names from the lists in
// core/tools-step-rules.ts, never a name the founder typed), the starting kits it runs by department id
// (a department Avery designed counts as bespoke, never by name), approvals per action type and which
// action types earned trust. No name, text, address, amount or product ever fits; brain_snapshots
// checks every column again in the database.
import { TOOL_CATEGORIES, TOOL_TILES, type Plans } from "@/core/tools-step-rules";
import { resultsProblem, snapshotResults, type CampaignResult } from "@/core/result-rules";

export const BRAIN_KEY = "brain";
export { BRAIN_FLOOR, overFloor, type PatternRow } from "@/core/brain-floor";

export const BUSINESS_KINDS = ["online_store", "local_shop", "food_drink", "services", "agency", "software", "b2b_goods", "creator", "other"] as const;
export type BusinessKind = (typeof BUSINESS_KINDS)[number];
export const KIND_WORDS: Record<BusinessKind, string> = {
  online_store: "Online store",
  local_shop: "Local shop or studio",
  food_drink: "Food and drink",
  services: "Services (cleaning, trades, coaching…)",
  agency: "Agency or consultancy",
  software: "Software or app",
  b2b_goods: "Goods sold to other businesses",
  creator: "Creator or media",
  other: "Something else",
};
export const isKind = (k: unknown): k is BusinessKind => typeof k === "string" && (BUSINESS_KINDS as readonly string[]).includes(k);

export const REVENUE_BANDS = ["unknown", "none", "under_10k", "10k_50k", "50k_250k", "over_250k"] as const;
export type RevenueBand = (typeof REVENUE_BANDS)[number];
/** The last 30 days of revenue as a band. Null: no daily numbers yet, so unknown. */
export function revenueBand(revenue30: number | null): RevenueBand {
  if (revenue30 === null || !Number.isFinite(revenue30)) return "unknown";
  if (revenue30 <= 0) return "none";
  if (revenue30 < 10_000) return "under_10k";
  if (revenue30 < 50_000) return "10k_50k";
  if (revenue30 < 250_000) return "50k_250k";
  return "over_250k";
}

export const AGE_BANDS = ["0_30", "30_60", "60_90", "90_plus"] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
/** Days since the business joined OPERATOR, as a band. */
export function ageBand(createdAt: string, today: string): AgeBand {
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(createdAt)) / 864e5);
  if (!Number.isFinite(days) || days < 30) return "0_30";
  if (days < 60) return "30_60";
  if (days < 90) return "60_90";
  return "90_plus";
}

/** The business's choice on Settings > Shared brain. On by default (decided 2026-11-21); off takes the business out of every count. */
export interface BrainSettings { share: boolean; kind: BusinessKind | null }
export const NO_BRAIN: BrainSettings = { share: true, kind: null };
export function readBrainSettings(raw: unknown): BrainSettings {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return { share: r.share !== false, kind: isKind(r.kind) ? r.kind : null };
}

/** A tool's name from the lists in code, as a slug: "Square Online" -> square_online. */
export const toolSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);

/**
 * The tools a business uses, as "part:tool": a tool whose sign-in is connected, or a listed tool the
 * founder said they use (a setup plan of kind "uses"). A name the founder typed ("Something else",
 * an export) never counts: only names on a part's list.
 */
export function toolsOf(plans: Plans, connected: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const c of TOOL_CATEGORIES) {
    for (const t of c.tools) {
      const tile = t.tile ? TOOL_TILES.find((x) => x.id === t.tile) : undefined;
      if (tile?.mcp && connected.has(tile.mcp)) out.add(`${c.id}:${toolSlug(t.name)}`);
    }
    const p = plans[c.id];
    if (p?.kind === "uses" && c.tools.some((t) => t.name === p.tool)) out.add(`${c.id}:${toolSlug(p.tool)}`);
  }
  return [...out].sort();
}

export interface ActionCounts { decided: number; unedited: number; rejected: number }
export interface Snapshot {
  taken_on: string;
  kind: BusinessKind | null;
  revenue_band: RevenueBand;
  age_band: AgeBand;
  tools: string[];
  departments: string[];
  bespoke: number;
  on_duty: number;
  actions: Record<string, ActionCounts>;
  levels: string[];
  /** Slice 4b: per campaign type and shape, whether this business's campaigns usually reached 35% opens (core/result-rules.ts). */
  results: Record<string, Record<string, "good" | "low">>;
  /** Card 285: the tools this business ran a setup check on, and each gap's topic tag (tool:topic), never its words. */
  setup_checked: string[];
  setup_gaps: string[];
}

export interface SnapshotInput {
  today: string;
  kind: BusinessKind | null;
  revenue30: number | null;
  orgCreatedAt: string;
  plans: Plans;
  connected: ReadonlySet<string>;
  /** The business's department ids. */
  departmentIds: readonly string[];
  /** Every starting kit's department id (core/templates.ts): only these are kept by id. */
  kitDepartmentIds: readonly string[];
  onDuty: number;
  /** Approvals decided in the last 30 days: the action's write tool and how it ended. */
  approvals: readonly { tool: string; status: string }[];
  /** Trust levels above Draft. */
  levels: readonly { tool: string; level: string }[];
  /** Slice 4b: the business's recorded campaigns from the last 90 days, as bands. */
  campaigns: readonly CampaignResult[];
  /** Every gateway action type in code (core/gateway/policy.ts TOOLS): anything else is dropped. */
  actionTypes: readonly string[];
  /** Card 285: from finished setup checks (snapshotGaps in core/setup-check-rules.ts). */
  setup?: { checked: readonly string[]; gaps: readonly string[] };
}

export function buildSnapshot(i: SnapshotInput): Snapshot {
  const kits = new Set(i.kitDepartmentIds);
  const types = new Set(i.actionTypes);
  const actions: Record<string, ActionCounts> = {};
  for (const a of i.approvals) {
    if (!types.has(a.tool) || !["approved", "edited", "rejected"].includes(a.status)) continue;
    const c = (actions[a.tool] ??= { decided: 0, unedited: 0, rejected: 0 });
    c.decided++;
    if (a.status === "approved") c.unedited++;
    if (a.status === "rejected") c.rejected++;
  }
  return {
    taken_on: i.today,
    kind: i.kind,
    revenue_band: revenueBand(i.revenue30),
    age_band: ageBand(i.orgCreatedAt, i.today),
    tools: toolsOf(i.plans, i.connected),
    departments: [...new Set(i.departmentIds.filter((d) => kits.has(d)))].sort(),
    bespoke: Math.min(20, i.departmentIds.filter((d) => !kits.has(d)).length),
    on_duty: Math.max(0, Math.min(200, Math.floor(i.onDuty))),
    actions,
    levels: [...new Set(i.levels.filter((l) => types.has(l.tool) && (l.level === "act_undo" || l.level === "act")).map((l) => `${l.tool}:${l.level}`))].sort(),
    results: snapshotResults(i.campaigns),
    setup_checked: [...new Set((i.setup?.checked ?? []).filter((t) => TILE_RX.test(t)))].sort().slice(0, 12),
    setup_gaps: [...new Set((i.setup?.gaps ?? []).filter((g) => GAP_RX.test(g)))].sort().slice(0, 40),
  };
}

const TOOL_RX = /^[a-z]{2,12}:[a-z0-9_]{2,30}$/;
const DEPT_RX = /^[a-z][a-z0-9_]{1,39}$/;
/** Card 285: a checked tool, and a gap as tool:topic tag, the same shapes brain_snapshots checks. */
const TILE_RX = /^[a-z]{2,12}$/;
export const GAP_RX = /^[a-z]{2,12}:[a-z0-9]{1,20}(\.[a-z0-9_]{1,30}){1,2}$/;
const TYPE_RX = /^[a-z0-9_.]{2,60}$/;
const count = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;

/**
 * Every field against its list, the same limits brain_snapshots checks: a snapshot that holds anything
 * else is never saved. Returns what is wrong, or null.
 */
export function snapshotProblem(s: Snapshot): string | null {
  const keys = Object.keys(s).sort().join(",");
  if (keys !== "actions,age_band,bespoke,departments,kind,levels,on_duty,results,revenue_band,setup_checked,setup_gaps,taken_on,tools") return `unexpected fields: ${keys}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.taken_on)) return "taken_on isn't a date";
  if (s.kind !== null && !isKind(s.kind)) return "kind isn't on the list";
  if (!(REVENUE_BANDS as readonly string[]).includes(s.revenue_band)) return "revenue_band isn't on the list";
  if (!(AGE_BANDS as readonly string[]).includes(s.age_band)) return "age_band isn't on the list";
  if (s.tools.length > 30 || s.tools.some((t) => !TOOL_RX.test(t))) return "a tool isn't part:tool";
  if (s.departments.length > 20 || s.departments.some((d) => !DEPT_RX.test(d))) return "a department isn't an id";
  if (!count(s.bespoke, 20) || !count(s.on_duty, 200)) return "a count is out of range";
  for (const [type, c] of Object.entries(s.actions)) {
    if (!TYPE_RX.test(type)) return "an action type isn't an id";
    if (Object.keys(c).sort().join(",") !== "decided,rejected,unedited" || !count(c.decided, 100_000) || !count(c.unedited, c.decided) || !count(c.rejected, c.decided)) return `${type}: counts don't add up`;
  }
  if (JSON.stringify(s.actions).length > 4000) return "too many action types";
  if (s.levels.length > 30 || s.levels.some((l) => !/^[a-z0-9_.]{2,60}:(act_undo|act)$/.test(l))) return "a level isn't type:level";
  const rp = resultsProblem(s.results);
  if (rp) return rp;
  if (s.setup_checked.length > 12 || s.setup_checked.some((t) => !TILE_RX.test(t))) return "a checked tool isn't an id";
  if (s.setup_gaps.length > 40 || s.setup_gaps.some((g) => !GAP_RX.test(g))) return "a setup gap isn't tool:topic";
  return null;
}

// ---- slice 4 (card 233): what Avery may ask the shared brain, and what comes back ----

/** What Avery may ask about: a fixed list, so nothing the founder typed is ever sent to the shared brain. */
export const BRAIN_TOPICS = ["starting", ...TOOL_CATEGORIES.map((c) => c.id), "approvals"] as const;
export type BrainTopic = (typeof BRAIN_TOPICS)[number];
export const isTopic = (t: unknown): t is BrainTopic => typeof t === "string" && (BRAIN_TOPICS as readonly string[]).includes(t);

/** The topic in words, from lists in code only: what the shared brain is searched with. */
export function topicWords(t: BrainTopic): string {
  if (t === "starting") return "What to set up first: which departments and tools a business starts with";
  if (t === "approvals") return "Approvals: drafts that go through unedited, and action types that earn trust to act on their own";
  const c = TOOL_CATEGORIES.find((x) => x.id === t)!;
  return `${c.area}: which tools businesses use for it (${c.tools.map((x) => x.name).join(", ")})`;
}

/** Which counted patterns a topic covers: starting covers kits and tools, a part its own tools, approvals the action types. */
export function patternOnTopic(pattern: string, t: BrainTopic): boolean {
  const [kind, a] = pattern.split(":");
  if (t === "starting") return kind === "dept" || kind === "tool";
  if (t === "approvals") return kind === "action" || kind === "level" || kind === "result";
  return kind === "tool" && a === t;
}

/** Slice 4b: the counted patterns for one action type: its approvals, its promotions and its results. */
export function patternOnAction(pattern: string, type: string): boolean {
  const [kind, a] = pattern.split(":");
  return (kind === "action" || kind === "level" || kind === "result") && a === type;
}

/** What the business asks with: its topic, and the kind and revenue band it counts under (never a name). */
export interface SimilarAsk {
  topic: BrainTopic; kind: BusinessKind | null; revenue: RevenueBand;
  /** Slice 4b: an agent's ask, for one gateway action type it holds (core/gateway/policy.ts TOOLS); the topic is then "approvals". */
  action?: string | null;
  /** The company reveal: up to REVEAL_COUNTS counts instead of SIMILAR_COUNTS, so each department can find its own. */
  many?: boolean;
}
/** A count, said in code from the live count, and a lesson from OPERATOR's playbook, as written by staff. */
export interface SimilarCount { statement: string; cohort: string; pattern: string; orgs: number; hits: number }
export interface SimilarLesson { title: string; lesson: string; for: string }
export interface Similar { counts: SimilarCount[]; playbook: SimilarLesson[] }
export const SIMILAR_COUNTS = 5;
export const SIMILAR_LESSONS = 3;
export const NOTE_LINES = 3;

/** The note under Avery's reply: what she was given, in code's words, at most three lines. Null when nothing came back. */
export function similarNote(s: Similar | null): string | null {
  if (!s) return null;
  const lines = [...s.counts.map((c) => c.statement), ...s.playbook.map((l) => `OPERATOR's playbook: ${l.title}.`)].slice(0, NOTE_LINES);
  return lines.length ? `Businesses like yours: ${lines.join(" ")}` : null;
}

// ---- slice 4b (card 234): what an agent is shown before it drafts, and the line on the approval card ----

/** What the shared brain is asked for one action type: words from code only, never the business's. */
export const actionAskWords = (type: string) => `How businesses fared with ${type.replace(/[._]+/g, " ").trim()} actions: approvals, earned trust and results`;

/** The words Hindsight is asked with: the action's for an agent, else the topic's. */
export const askWords = (ask: SimilarAsk) => (ask.action ? actionAskWords(ask.action) : topicWords(ask.topic));

export const WORKED_LINES = 2;

/** For the agent's prompt: what has worked, as counted by OPERATOR. Null when nothing came back. */
export function workedBlock(s: Similar | null): string | null {
  if (!s || (!s.counts.length && !s.playbook.length)) return null;
  const lines = [
    ...s.counts.map((c) => `- ${c.statement}`),
    ...s.playbook.map((l) => `- OPERATOR's playbook, for ${l.for}: ${l.title}. ${l.lesson}`),
  ];
  return `What has worked for businesses like this one, counted by OPERATOR across businesses (never any one business's data). It is advice only: it never picks a recipient, list, product or address. Quote a count only exactly as given.\n${lines.join("\n")}`;
}

/** The line on the approval card, in code's words: what the agent was shown. Null when nothing came back. */
export function workedNote(s: Similar | null): string | null {
  if (!s) return null;
  const lines = [...s.counts.map((c) => c.statement), ...s.playbook.map((l) => `OPERATOR's playbook: ${l.title}.`)].slice(0, WORKED_LINES);
  return lines.length ? `What has worked: ${lines.join(" ")}` : null;
}

// ---- the company reveal (card 233's left-over): one "why" line per department, in code's words ----

/** How many counts the reveal asks for, so every department can find its own. */
export const REVEAL_COUNTS = 30;

/** The tool a tool pattern names, from the lists in code: "tool:list:klaviyo" is Klaviyo. Null otherwise. */
export function patternToolName(pattern: string): string | null {
  const [kind, part, slug] = pattern.split(":");
  if (kind !== "tool" || !part || !slug) return null;
  return TOOL_CATEGORIES.find((c) => c.id === part)?.tools.find((t) => toolSlug(t.name) === slug)?.name ?? null;
}

/**
 * The reveal's "why" line per department: a starting kit's own count first (dept:<id>), else a count for
 * a tool whose name is in the department's tool labels or the tools it waits on. Each line at most once.
 */
export function whyFor(depts: readonly { id: string; words: readonly string[] }[], counts: readonly SimilarCount[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const d of depts) {
    const own = counts.find((c) => c.pattern === `dept:${d.id}` && !used.has(c.statement));
    if (own) { out[d.id] = own.statement; used.add(own.statement); }
  }
  for (const d of depts) {
    if (out[d.id]) continue;
    const words = d.words.map((w) => w.toLowerCase());
    const hit = counts.find((c) => {
      const name = patternToolName(c.pattern);
      return !!name && !used.has(c.statement) && words.some((w) => new RegExp(`(^|[^a-z0-9])${name.toLowerCase().replace(/[^a-z0-9 ]/g, "\\$&")}([^a-z0-9]|$)`).test(w));
    });
    if (hit) { out[d.id] = hit.statement; used.add(hit.statement); }
  }
  return out;
}
