// Hiring in a department's chat (docs/department-pages.md, slice 5): what a hire card shows and which of
// its buttons are live. Pure: no database, no network, so `npm run check:dept` can test it.
//
// A card comes from a hire waiting on the owner (a proposal the head filed) or from an agent seated in the
// department that has never been put on duty (made by a hire, or drafted from Claude through the Operator
// connector). Numbers on it come from code: the runs a month from the schedule, the cost from cost-rules.
import { dayRuns, dayWords, type Days } from "@/core/flow-rules";
import { usd, type MonthCost } from "@/core/cost-rules";

export interface HireChoice { id: string; label: string; ready: boolean; why?: string }
export type HireStage =
  /** a hire waiting for the owner's yes */
  | "proposed"
  /** created, off duty, no try yet */
  | "hired"
  /** its latest try is going */
  | "trying"
  /** the latest try worked: Put on duty is live */
  | "clean"
  /** the latest try had a problem: Try again */
  | "failed";

export interface HireCardView {
  /** "p:<proposal id>" or "a:<agent id>". */
  key: string;
  proposalId: string | null;
  agentId: string | null;
  name: string; seat: string; job: string;
  reportsTo: string | null;
  reads: string[];
  /** On a proposal: the actions it suggests, as toggles that start off. On an agent: the actions it has. */
  can: HireChoice[];
  when: string;
  cost: { big: string; small: string };
  stage: HireStage;
  /** Why the latest try wasn't clean, as the end of "the latest try …". */
  why: string | null;
  version: number | null;
  /** Claude (or another connected app) drafted it, rather than the head. */
  fromApp: boolean;
  /**
   * It runs in Claude (docs/live-events.md, slice 2): there is no try in OPERATOR, so the card offers
   * connecting its routine, then Put on duty. Null for an agent that runs in OPERATOR, and for a hire.
   */
  claude: LinkedCard | null;
  at: string;
}

/** Runs a month for a hire's schedule: none when it runs only when asked. */
export const hireRuns = (days: Days | null | undefined): number => (days ? dayRuns(days) : 0);

/** "Weekdays at 08:00" or "Only when you ask". */
export const hireWhenWords = (days: Days | null | undefined, time: string | null | undefined): string =>
  days && time ? `${dayWords(days).replace(/^on /, "").replace(/^./, (c) => c.toUpperCase())} at ${time}` : "Only when you ask";

/** The cost line, as in the mockup: "$1.80" and "a month · about $0.08 a run, 22 runs. Inside Finance’s $30." */
export function hireCostLine(c: MonthCost, dept: { name: string; budget: number | null } | null): { big: string; small: string } {
  if (c.perRun == null) return { big: "Cost unknown", small: "its model has no price in code yet" };
  const whole = (v: number) => (Number.isInteger(v) ? `$${v}` : usd(v));
  const inside = dept?.budget != null ? (c.month <= dept.budget ? ` Inside ${dept.name}’s ${whole(dept.budget)}.` : ` Over ${dept.name}’s ${whole(dept.budget)} a month.`) : "";
  if (!c.runsPerMonth) return { big: usd(c.perRun), small: `a run · it runs only when you ask, so $0 a month until then.${inside}` };
  return { big: usd(c.month), small: `a month · about ${usd(c.perRun)} a run, ${c.runsPerMonth} runs.${inside}` };
}

/** Where an agent that runs in Claude is on its card: its routine has to be connected before it goes on duty. */
export type LinkedStep = "connect" | "paused" | "ready";
export interface LinkedCard {
  step: LinkedStep; paused: string | null;
  /** Its sheet in this department's chat (?agent=), where the routine is connected; set by dashboard/hireCards.ts. */
  sheet?: string;
}

/** The card's step from the routine as integrations/mcp.ts routineState reads it (null: it couldn't be read). */
export function linkedStep(r: { connected: boolean; paused: string | null } | null): LinkedCard {
  if (!r || !r.connected) return { step: "connect", paused: null };
  if (r.paused) return { step: "paused", paused: r.paused };
  return { step: "ready", paused: null };
}

/** An agent that runs in Claude has no OPERATOR cost a run: each run starts the owner's Claude routine. */
export const linkedCostLine = (): { big: string; small: string } =>
  ({ big: "In Claude", small: "each run starts your Claude routine, so OPERATOR adds no model cost. It counts toward your Claude plan." });

/** What it reads, on its card: whatever its routine's own connectors reach, set in Claude (never granted in OPERATOR). */
export const LINKED_READS: readonly string[] = ["Its routine’s connectors, set in Claude"];

/** Where a created, off-duty agent is: from its latest try of the version it would go live with. */
export function hireStage(t: { clean: boolean; status: string } | null): HireStage {
  if (!t) return "hired";
  if (t.status === "running") return "trying";
  return t.clean ? "clean" : "failed";
}

/** An agent that gets a card: seated in the department, off duty, never put on duty (no approved routine), with a saved version. */
export const newAgent = (a: { enabled: boolean; approvedRoutine: boolean; hasSpec: boolean }): boolean => !a.enabled && !a.approvedRoutine && a.hasSpec;

/** The grants a Hire tap may carry: only actions the hire suggested and code lets an approver give. */
export const allowedGrants = (asked: readonly string[], suggested: readonly string[], granted: (id: string) => boolean): string[] =>
  [...new Set(asked)].filter((g) => suggested.includes(g) && granted(g));

/** A try (trigger "preview") posts in the department chat only for an agent that still has a hire card: its first try. */
export const tryInFeed = (trigger: string, agentId: string, fresh: ReadonlySet<string>): boolean => trigger === "preview" && fresh.has(agentId);
