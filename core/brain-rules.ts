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
  /** Every gateway action type in code (core/gateway/policy.ts TOOLS): anything else is dropped. */
  actionTypes: readonly string[];
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
  };
}

const TOOL_RX = /^[a-z]{2,12}:[a-z0-9_]{2,30}$/;
const DEPT_RX = /^[a-z][a-z0-9_]{1,39}$/;
const TYPE_RX = /^[a-z0-9_.]{2,60}$/;
const count = (n: unknown, max: number) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= max;

/**
 * Every field against its list, the same limits brain_snapshots checks: a snapshot that holds anything
 * else is never saved. Returns what is wrong, or null.
 */
export function snapshotProblem(s: Snapshot): string | null {
  const keys = Object.keys(s).sort().join(",");
  if (keys !== "actions,age_band,bespoke,departments,kind,levels,on_duty,revenue_band,taken_on,tools") return `unexpected fields: ${keys}`;
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
  return null;
}
