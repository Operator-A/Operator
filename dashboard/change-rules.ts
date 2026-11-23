// Changing agents and goals by asking (docs/department-pages.md, slice 6): what a change card shows and
// which of its buttons are live. Pure: no database, no network, so `npm run check:dept` can test it.
//
// A card comes from a change the head filed with its File a proposal tool: a change to an agent in its
// department (when it runs, budget, job, good result, reads, cost cap) or a goal change. It is words until
// the owner's Approve. A change that makes a new version then shows Try it and, after a clean try, Go live,
// like the agent sheet.
import type { Days } from "@/core/flow-rules";
import type { ProposalPlan } from "@/core/proposal-rules";
import { hireWhenWords } from "@/dashboard/hire-rules";

type AgentChange = Extract<ProposalPlan, { kind: "change_agent" }>;
type GoalChange = Extract<ProposalPlan, { kind: "goal" }>;

export type ChangeStage =
  /** waiting for the owner's Approve */
  | "proposed"
  /** approved, saved as a draft version, no try yet */
  | "draft"
  /** its latest try is going */
  | "trying"
  /** the draft's latest try worked: Go live is live */
  | "clean"
  /** the draft's latest try had a problem: Try again */
  | "failed"
  /** decided: approved and done (or live), or left as it is */
  | "done";

/** One line on the card: what changes, from what (null when there is nothing to compare, like a new goal) to what. */
export interface ChangeRow { k: string; from: string | null; to: string }

export interface ChangeCardView {
  /** "c:<proposal id>". */
  key: string;
  proposalId: string;
  kind: "agent" | "goal" | "move";
  agentId: string | null;
  /** "Change to Quinn · needs your OK" */
  kicker: string;
  /** "Quinn, Bookkeeper" or the goal as it would read. */
  title: string;
  rows: ChangeRow[];
  /** A new version that needs a clean try before it runs. */
  spec: boolean;
  stage: ChangeStage;
  /** The version the change saved, while it isn't live. */
  version: number | null;
  /** Why the latest try wasn't clean, as the end of "the latest try …". */
  why: string | null;
  /** The outcome line once decided. */
  done: string | null;
  at: string;
}

/** What the agent is now, for the Now side of each line. */
export interface AgentNow { days: Days | null; time: string | null; budget: number; job: string; goodResult: string; tools: string[]; costCap: number }

const dollars = (n: number) => `$${n.toFixed(2)}`;
const cut = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The lines of an agent change: each thing it changes, Now → New. Without `now`, only the New side. */
export function changeRows(p: AgentChange, labelOf: (id: string) => string, now: AgentNow | null = null): ChangeRow[] {
  const rows: ChangeRow[] = [];
  if (p.when) rows.push({ k: "When", from: now ? hireWhenWords(now.days, now.time) : null, to: hireWhenWords(p.when.days, p.when.time) });
  if (p.budget != null) rows.push({ k: "Daily budget", from: now ? dollars(now.budget) : null, to: dollars(p.budget) });
  if (p.job) rows.push({ k: "Job", from: now ? cut(now.job) : null, to: cut(p.job, 400) });
  if (p.goodResult) rows.push({ k: "Good result", from: now?.goodResult ? cut(now.goodResult) : null, to: cut(p.goodResult, 400) });
  if (p.add.length || p.drop.length) {
    const words = [...p.add.map((t) => `+ ${labelOf(t)}`), ...p.drop.map((t) => `− ${labelOf(t)}`)].join(", ");
    rows.push({ k: "Reads", from: null, to: words });
  }
  if (p.costCap != null) rows.push({ k: "Cost cap a run", from: now ? dollars(now.costCap) : null, to: dollars(p.costCap) });
  return rows;
}

/** Card 370: where an agent sits, as a move card shows it. Null parts read as none. */
export interface Place { dept: string | null; seat: string | null; boss: string | null }

/** The lines of a move card (move_agent): department, seat and who it reports to, Now → New. Without `now`, only the New side. */
export function moveRows(to: Place, now: Place | null): ChangeRow[] {
  const none = (v: string | null, w: string) => v ?? w;
  return [
    { k: "Department", from: now ? none(now.dept, "None") : null, to: none(to.dept, "None") },
    ...(to.seat ? [{ k: "Seat", from: now ? none(now.seat, "None") : null, to: to.seat }] : []),
    ...(to.boss ? [{ k: "Reports to", from: now ? none(now.boss, "Nobody yet") : null, to: to.boss }] : []),
  ];
}

/** What the goal is now, for the Now side. */
export interface GoalNow { title: string; measure: string | null; target: number | null; dueOn: string | null; state: string }

/** The lines of a goal change. */
export function goalRows(p: GoalChange, now: GoalNow | null): ChangeRow[] {
  if (p.change === "new") return [
    { k: "Goal", from: null, to: p.title ?? "" },
    ...(p.measure && p.measure !== "none" ? [{ k: "Counted", from: null, to: `In code: ${p.measure}` }] : []),
    ...(p.target ? [{ k: "Target", from: null, to: p.target }] : []),
    ...(p.dueOn ? [{ k: "By", from: null, to: p.dueOn }] : []),
  ];
  if (p.change !== "change") {
    const to = { drop: "Dropped", pause: "Paused", resume: "Back on", done: "Done" }[p.change];
    return [{ k: "Goal", from: null, to: now?.title ?? p.goal ?? "" }, { k: "State", from: now ? (now.state === "paused" ? "Paused" : "Running") : null, to }];
  }
  const rows: ChangeRow[] = [];
  if (p.title) rows.push({ k: "Goal", from: now?.title ?? p.goal, to: p.title });
  if (p.measure) rows.push({ k: "Counted", from: now ? now.measure ?? "Words only" : null, to: p.measure === "none" ? "Words only" : `In code: ${p.measure}` });
  if (p.target) rows.push({ k: "Target", from: now?.target != null ? String(now.target) : null, to: p.target });
  if (p.dueOn) rows.push({ k: "By", from: now?.dueOn ?? null, to: p.dueOn });
  return rows;
}

/** The card's title line for a goal change. */
export const goalTitle = (p: GoalChange): string => (p.change === "new" ? p.title ?? "New goal" : p.change === "change" ? p.title ?? p.goal ?? "Goal" : p.goal ?? "Goal");

/** Where an approved change is: waiting, a draft and its latest try, or done. */
export function changeStage(a: { state: string; spec: boolean; draftVersion: number | null; savedVersion: number | null; tryOf: { clean: boolean; status: string } | null }): ChangeStage {
  if (a.state === "pending") return "proposed";
  if (a.state !== "accepted" || !a.spec || a.savedVersion == null || a.draftVersion !== a.savedVersion) return "done";
  if (!a.tryOf) return "draft";
  if (a.tryOf.status === "running") return "trying";
  return a.tryOf.clean ? "clean" : "failed";
}

/** The version number a change saved, from its outcome ("Draft v4 changes …"). */
export const savedVersionOf = (outcome: string | null): number | null => {
  const m = /^Draft v(\d+) /.exec(outcome ?? "");
  return m ? Number(m[1]) : null;
};

/** A decided card stays in the chat this long, so the chat keeps its history; a replaced one doesn't. */
export const CHANGE_KEEP_DAYS = 7;
export const keepDecided = (outcome: string | null): boolean => !/^Replaced by a newer draft/.test(outcome ?? "");
