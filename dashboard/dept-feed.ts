// A department's chat feed (docs/department-pages.md, slice 3): the conversation with the head and every
// run of the department's agents, in time order. A run shows as a checklist built only from its logged
// steps (run_steps: which tool ran and whether it worked), never from what the model wrote, then its
// result, then its drafts as approval cards. Pure: no database, no network, so `npm run check:dept` can test it.

/** One logged step, as run_steps keeps it. */
export interface StepRow { kind: string; tool: string | null; ok: boolean }
export type CheckState = "done" | "failed" | "now";
export interface CheckLine { label: string; state: CheckState }
export type RunStatus = "running" | "ok" | "failed" | "skipped";

/** Runs that post into a department's chat: not the chat replies themselves, tries (except a new agent's first, slice 5), or approved changes being written. */
export const FEED_SKIPS = ["chat", "preview", "approval"] as const;
export const inFeed = (trigger: string) => !(FEED_SKIPS as readonly string[]).includes(trigger);

/**
 * The checklist: one line per tool the run used, in order, labelled by code (the tool's own label), with
 * repeats of the same tool folded into one line ("· 3 times"). A failed call marks its line failed; a stop
 * adds "Stopped". While the run is going, one more line says it is still working.
 */
export function checklist(steps: readonly StepRow[], label: (tool: string) => string, running: boolean): CheckLine[] {
  const out: (CheckLine & { tool: string; n: number })[] = [];
  for (const s of steps) {
    if (s.kind === "stop") { out.push({ tool: "", n: 1, label: "Stopped before it finished", state: "failed" }); continue; }
    if (s.kind !== "tool" || !s.tool) continue;
    const last = out.at(-1);
    if (last && last.tool === s.tool) { last.n++; if (!s.ok) last.state = "failed"; continue; }
    out.push({ tool: s.tool, n: 1, label: label(s.tool), state: s.ok ? "done" : "failed" });
  }
  const lines: CheckLine[] = out.map((l) => ({ label: l.n > 1 ? `${l.label} · ${l.n} times` : l.label, state: l.state }));
  if (running) lines.push({ label: lines.length ? "Working on the next step" : "Starting", state: "now" });
  return lines;
}

/** What the run card is called, from how it started. */
export function runTitle(trigger: string, version: number | null = null): string {
  return trigger === "manual" ? "Run now" : trigger === "preview" ? (version && version > 1 ? `Try of v${version}` : "First try") : trigger === "chain" || trigger === "schedule" ? "Scheduled run" : trigger === "event" ? "Started by an event" : "Run";
}

/** The status pill on a run card. */
export function runState(status: string): { word: string; look: "live" | "ok" | "bad" | "quiet" } {
  return status === "running" ? { word: "Working", look: "live" } : status === "ok" ? { word: "Done", look: "ok" } : status === "failed" ? { word: "Failed", look: "bad" } : { word: "Skipped", look: "quiet" };
}

/** The line under a run: steps, how long, what it cost. Every number from the run log. */
export function runFoot(steps: number, startedAt: string, endedAt: string | null, costUsd: number): string {
  const secs = endedAt ? Math.max(0, Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000)) : null;
  const time = secs == null ? null : secs < 60 ? `${secs} second${secs === 1 ? "" : "s"}` : `${Math.round(secs / 60)} min`;
  return [`${steps} step${steps === 1 ? "" : "s"}`, time, `$${costUsd.toFixed(2)}`].filter(Boolean).join(" · ");
}

/** A result for the chat: the run's summary without the runner's leading tag ("[runner, spec v2]"). */
export function resultText(summary: string | null, error: string | null, status: string): string {
  const raw = (status === "failed" ? error ?? summary : summary ?? error) ?? "";
  return raw.replace(/^\s*\[[^\]]{0,80}\]\s*/, "").trim().slice(0, 1500);
}

/** Two initials for an avatar. */
export const initialsOf = (name: string) => name.replace(/[^A-Za-z ]/g, "").trim().slice(0, 2).toUpperCase() || "··";

export interface FeedRun {
  id: string; agentId: string; name: string; role: string; at: string; endedAt: string | null; trigger: string; status: RunStatus;
  lines: CheckLine[]; steps: number; costUsd: number; result: string; drafts: string[];
  /** The version a try ran (a change card's draft shows "Try of v4"). */
  version?: number | null;
}
export interface FeedTalk { id: string; role: "owner" | "head"; text: string; notes: string[]; runId: string | null; at: string }
export type FeedItem = ({ kind: "talk" } & FeedTalk) | ({ kind: "run" } & FeedRun);

/** The conversation and the runs in time order, oldest first; a run seen twice (a live update) keeps the newest copy. */
export function mergeFeed(talk: readonly FeedTalk[], runs: readonly FeedRun[]): FeedItem[] {
  const byRun = new Map<string, FeedRun>();
  for (const r of runs) byRun.set(r.id, r);
  return [...talk.map((t) => ({ kind: "talk" as const, ...t })), ...[...byRun.values()].map((r) => ({ kind: "run" as const, ...r }))]
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

const ymd = (ms: number, tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
/** The divider above a day's messages: Today, Yesterday, or the date. */
export function dayLabel(at: string, tz: string, now: number): string {
  const d = ymd(Date.parse(at), tz);
  if (d === ymd(now, tz)) return "Today";
  if (d === ymd(now - 864e5, tz)) return "Yesterday";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(Date.parse(at));
}
/** "7:30 AM" in the business's time zone. */
export const clock = (at: string, tz: string) => new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(Date.parse(at));

/** A goal's line split for its card: the number large, the rest small ("212", "of 226 this month"). */
export function goalNumber(line: string): { big: string; small: string } {
  const m = line.match(/^\s*([$€£]?[\d.,]+%?)\s*(.*)$/);
  return m ? { big: m[1], small: m[2] } : { big: line, small: "" };
}
