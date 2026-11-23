// The crew as the Control Room shows it, built from data (docs/agent-roster.md): each agent's row in
// `agents` (role, avatar, since, by hand only), its live saved version (name, job, tools, cost cap),
// its recent runs (what a run costs), its seat on the org chart (its role when the row has none) and
// Crew > Schedule (when it runs). No agent is written in code; a seat with no agent yet is an open
// seat on the org chart. Pure: no database, so `npm run check:roster` can test it.
import type { CrewMember, Schedule, Tier } from "./crew";
import type { Chain } from "@/core/flow-rules";
import { usd, type RunCost } from "@/core/cost-rules";

export interface RosterRow { id: string; name: string; role?: string | null; icon?: string | null; hue?: string | null; manual_only?: boolean | null; in_org?: boolean | null; created_at?: string | null }
export interface RosterSpec { name?: string; mandate?: string; goodResult?: string; tools: string[]; maxCostUsd?: number; model?: string }
export interface RosterTool { label: string; kind: string }

/** Avatar colours for an agent whose row has none, picked from its id so it never changes. */
export const HUES = ["#F2884B", "#6CC69A", "#F5D35C", "#F6B8C9", "#8FB8F2", "#C9A27A", "#B9A3F0", "#7FD1C7"] as const;
export const hueFor = (id: string) => HUES[[...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % HUES.length];

/** "About $0.003", "About $0.25 (estimate)", "$0", or the cap per run when its cost is unknown (core/cost-rules.ts). */
export function costLabel(c: RunCost, cap: number | undefined): string {
  if (c.perRun == null) return cap ? `Up to $${cap.toFixed(2)}` : "Unknown";
  if (c.perRun === 0) return "$0";
  return `About ${usd(c.perRun)}${c.basis === "estimate" ? " (estimate)" : ""}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Oct 29", in Chicago. */
export function sinceLabel(at: string | null | undefined): string | undefined {
  if (!at || Number.isNaN(Date.parse(at))) return undefined;
  const d = new Date(Date.parse(at) - 6 * 36e5);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** When an agent runs on its own: the first chain with a schedule it is a step of (one that is on first). */
export function scheduleOf(id: string, chains: readonly Chain[]): Schedule {
  const withIt = chains.filter((c) => c.start.type === "schedule" && c.steps.some((s) => s.agent === id));
  const c = withIt.find((x) => x.on) ?? withIt[0];
  if (!c || c.start.type !== "schedule") return { kind: "manual" };
  const step = c.steps.find((s) => s.agent === id)!;
  return { kind: step.days ?? c.start.days, time: step.notBefore ?? c.start.time, chain: c.name };
}

/**
 * One agent as the Control Room shows it. `role` falls back to its seat's title, then to "Built in
 * the app"; the tier is Draft when its live version has an action (an approval card), else Report.
 */
export function memberOf(row: RosterRow, spec: RosterSpec | null, o: { tools: Record<string, RosterTool>; cost: RunCost; seatTitle: string | null; chains: readonly Chain[] }): CrewMember {
  const tools = (spec?.tools ?? []).map((t) => o.tools[t]).filter(Boolean);
  const tier: Tier = tools.some((t) => t.kind === "action") ? "Draft" : "Report";
  const hands = tools.filter((t) => t.kind === "report").map((t) => t.label);
  const job = spec?.mandate?.trim() || "No job line yet";
  return {
    id: row.id,
    name: spec?.name?.trim() || row.name,
    role: row.role?.trim() || o.seatTitle || "Built in the app",
    icon: row.icon || "cpu",
    hue: row.hue || hueFor(row.id),
    tier, mandate: job, job,
    since: sinceLabel(row.created_at),
    estCostLabel: costLabel(o.cost, spec?.maxCostUsd),
    writes: hands.length ? hands.join(", ") : "its result, saved for other agents to read",
    schedule: scheduleOf(row.id, o.chains),
    manualOnly: row.manual_only !== false,
    inOrg: row.in_org !== false,
    perRun: o.cost.perRun,
    costBasis: o.cost.basis,
    capPerRun: spec?.maxCostUsd,
    model: spec?.model || undefined,
  };
}

/** Every agent with a live version, in the order given (oldest first), and the same by id. */
export function buildCrew(members: CrewMember[]): { crew: CrewMember[]; byId: Record<string, CrewMember> } {
  return { crew: members, byId: Object.fromEntries(members.map((m) => [m.id, m])) };
}
