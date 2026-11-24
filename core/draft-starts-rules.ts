// When an agent starts, as a draft (docs/operator-mcp.md, slice 4 part 2; decided 2026-11-23). Claude's
// update_agent may name a new schedule, by hand, a live event to start on, or another agent to run after.
// They are kept on that draft version (agent_defs.starts) and change nothing until the owner's Go live,
// which works out the new crew flow from today's flow plus these starts, checks it like any flow save
// (flowProblems) and lists each change on its confirm. Pure: no database, no network, so
// `npm run check:operator-mcp` can test it.
import { MAX_STEPS, isDays, dayWords, withAgentTime, type Chain, type Days, type Flow, type Start } from "@/core/flow-rules";
import { EVENTS, eventStartProblems, eventStartWords, isEventType, type EventStart } from "@/core/event-rules";

/** What a draft asks for. Each part left out keeps what the agent has today. */
export interface DraftStarts {
  /** Its own schedule, or "by_hand": only when someone presses Run now. */
  when?: { days: Days; time: string } | "by_hand";
  /** Also start on this live event, in a chain of its own; "none" drops that chain. */
  event?: EventStart | "none";
  /** Run after another agent finishes, as a step at the end of that agent's chain; "none" takes it out of every chain it doesn't start. */
  after?: { agent: string; when: "ok" | "any" } | "none";
}

export const EVENT_CHOICES = [...EVENTS.map((e) => e.type), "none"] as const;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_KEYS: Record<string, number> = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

/** "daily", "weekdays", "mondays" or day names like "mon, wed, fri", as a Days choice; null when it isn't one. */
export function readDays(raw: string): Days | null {
  const s = raw.trim().toLowerCase();
  if (s === "daily" || s === "every day") return "daily";
  if (s === "weekdays") return "weekdays";
  if (s === "mondays") return "mondays";
  const nums = s.split(/[\s,]+/).filter(Boolean).map((w) => DAY_KEYS[w.slice(0, 3)]);
  if (!nums.length || nums.some((n) => n === undefined)) return null;
  const u = [...new Set(nums)].sort((a, b) => a - b);
  const k = u.join("");
  const d = (k === "0123456" ? "daily" : k === "12345" ? "weekdays" : k === "1" ? "mondays" : `on:${k}`) as Days;
  return isDays(d) ? d : null;
}

/**
 * The starts a call asks for, from update_agent's arguments, or null when it names none. `agentOf`
 * finds another agent by id or name (null when there isn't exactly one).
 */
export function readStarts(args: Record<string, string | number>, self: string, agentOf: (ref: string) => string | null): { starts: DraftStarts | null } | { problem: string } {
  const out: DraftStarts = {};
  const byHand = args.by_hand === "yes";
  if (args.days != null || args.time != null) {
    if (byHand) return { problem: "by_hand can't go with days and time: pick one" };
    const days = readDays(String(args.days ?? ""));
    if (!days) return { problem: "days must be daily, weekdays, mondays or day names like mon, wed, fri" };
    const time = String(args.time ?? "");
    if (!TIME.test(time) || Number(time.slice(3)) % 15) return { problem: "time must be 24-hour on a quarter hour, like 08:00 or 14:45" };
    out.when = { days, time };
  } else if (byHand) out.when = "by_hand";
  if (args.start_on_event != null) {
    const e = String(args.start_on_event);
    if (e === "none") { if (args.min_total != null) return { problem: "min_total goes with an event, not none" }; out.event = "none"; }
    else {
      if (!isEventType(e)) return { problem: `start_on_event must be one of ${EVENT_CHOICES.join(", ")}` };
      const s: EventStart = { type: "event", event: e, ...(args.min_total != null ? { minTotal: Number(args.min_total) } : {}) };
      const p = eventStartProblems(s);
      if (p.length) return { problem: p.join(" ") };
      out.event = s;
    }
  } else if (args.min_total != null) return { problem: "min_total goes with start_on_event" };
  if (out.when === "by_hand" && out.event && out.event !== "none") return { problem: "an agent that runs only by hand can't also start on an event" };
  if (args.run_after != null) {
    const ref = String(args.run_after);
    if (ref.toLowerCase() === "none") { if (args.after_result != null) return { problem: "after_result goes with an agent, not none" }; out.after = "none"; }
    else {
      const id = agentOf(ref);
      if (!id) return { problem: `run_after: there isn't exactly one agent called ${ref.slice(0, 60)} (list_agents names them)` };
      if (id === self) return { problem: "an agent can't run after itself" };
      if (out.when === "by_hand") return { problem: "an agent that runs only by hand can't also run after another agent" };
      out.after = { agent: id, when: args.after_result === "any" ? "any" : "ok" };
    }
  } else if (args.after_result != null) return { problem: "after_result goes with run_after" };
  return { starts: Object.keys(out).length ? out : null };
}

/** The key of an agent's own event chain. */
export const eventKey = (agent: string) => `event-${agent}`.slice(0, 40);

const startOwn = (c: Chain) => c.start.type !== "button";

/**
 * The flow (and whether the agent runs only by hand) once `starts` apply to today's flow, or why it
 * can't be. The result still has to pass flowProblems; Go live checks it.
 */
export function flowWithStarts(flow: Flow, manualNow: boolean, agent: string, name: string, s: DraftStarts): { flow: Flow; manual: boolean } | { refuse: string } {
  let f: Flow = { chains: flow.chains.map((c) => ({ ...c, steps: [...c.steps] })) };
  let manual = manualNow;
  if (s.when) {
    const r = withAgentTime(f, agent, name, s.when === "by_hand" ? null : s.when);
    if ("refuse" in r) return r;
    f = r.flow;
    manual = s.when === "by_hand";
  }
  if (s.event) {
    const key = eventKey(agent);
    const rest = f.chains.filter((c) => c.key !== key);
    if (s.event === "none") f = { chains: rest };
    else {
      const chain: Chain = { key, name: `${name}: ${eventStartWords(s.event).toLowerCase()}`.slice(0, 60), on: true, start: s.event as Start, steps: [{ agent }] };
      const at = f.chains.findIndex((c) => c.key === key);
      f = { chains: at >= 0 ? f.chains.map((c, i) => (i === at ? chain : c)) : [...f.chains, chain] };
      manual = false;
    }
  }
  if (s.after) {
    // out of every chain it doesn't start, then (for an agent) onto the end of that agent's own chain
    f = { chains: f.chains.map((c) => { const k = c.steps.findIndex((x) => x.agent === agent); return k > 0 ? { ...c, steps: c.steps.filter((_, i) => i !== k) } : c; }) };
    if (s.after !== "none") {
      const other = s.after.agent;
      const theirs = f.chains.filter((c) => c.on && startOwn(c) && c.steps.at(-1)?.agent === other);
      const pick = theirs.find((c) => c.start.type === "schedule") ?? theirs[0];
      if (!pick) return { refuse: `${other} has no chain that starts on its own and ends with it, so ${name} has nothing to follow. Give ${other} a schedule or an event first` };
      if (pick.steps.length >= MAX_STEPS) return { refuse: `${pick.name} already has ${MAX_STEPS} agents, the most a chain holds` };
      if (pick.steps.some((x) => x.agent === agent)) return { refuse: `${name} is already in ${pick.name}` };
      f = { chains: f.chains.map((c) => (c === pick ? { ...c, steps: [...c.steps, { agent, when: s.after === "none" ? "ok" : (s.after as { when: "ok" | "any" }).when }] } : c)) };
      manual = false;
    }
  }
  return { flow: f, manual };
}

const timeWords = (d: Days, t: string) => `${dayWords(d)} at ${t}`;

/** Each change a draft's starts make, in words, for get_agent, the sheet and the Go live confirm. */
export function startsWords(s: DraftStarts, names: Record<string, string>): string[] {
  const out: string[] = [];
  if (s.when) out.push(s.when === "by_hand" ? "Runs only when someone presses Run now" : `Runs ${timeWords(s.when.days, s.when.time)}`);
  if (s.event) out.push(s.event === "none" ? "Stops starting on a live event" : `Also starts ${eventStartWords(s.event).replace(/^On /, "on each ")}`);
  if (s.after) out.push(s.after === "none" ? "Stops running after other agents" : `Runs after ${names[s.after.agent] ?? s.after.agent} finishes${s.after.when === "any" ? ", however it went" : " well"}`);
  return out;
}

/** How an agent starts today, from the flow, in words. */
export function startsToday(flow: Flow, agent: string, manual: boolean, names: Record<string, string>): string[] {
  const out: string[] = [];
  for (const c of flow.chains) {
    const k = c.steps.findIndex((x) => x.agent === agent);
    if (k < 0 || !c.on) continue;
    if (k > 0) { const b = c.steps[k - 1].agent; out.push(`After ${b ? names[b] ?? b : "Ask a model"} in ${c.name}`); continue; }
    if (c.start.type === "schedule") out.push(`${timeWords(c.start.days, c.start.time).replace(/^./, (m) => m.toUpperCase())}`);
    else if (c.start.type === "event") out.push(eventStartWords(c.start));
    else if (c.start.type === "approval") out.push(`When an approval is decided (${c.name})`);
    else out.push(`With the Run chain button (${c.name})`);
  }
  if (!out.length || manual) out.push("When someone presses Run now");
  return out;
}

/** A stored starts value, checked; null when there is none or it is malformed. */
export function readStored(raw: unknown): DraftStarts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: DraftStarts = {};
  const w = r.when as DraftStarts["when"] | undefined;
  if (w === "by_hand") out.when = "by_hand";
  else if (w && typeof w === "object" && isDays(w.days) && TIME.test(String(w.time))) out.when = { days: w.days, time: w.time };
  const e = r.event as DraftStarts["event"] | undefined;
  if (e === "none") out.event = "none";
  else if (e && typeof e === "object" && !eventStartProblems(e).length) out.event = { type: "event", event: e.event, ...(e.minTotal !== undefined ? { minTotal: e.minTotal } : {}) };
  const a = r.after as DraftStarts["after"] | undefined;
  if (a === "none") out.after = "none";
  else if (a && typeof a === "object" && /^[a-z0-9_]{1,60}$/.test(String(a.agent))) out.after = { agent: a.agent, when: a.when === "any" ? "any" : "ok" };
  return Object.keys(out).length ? out : null;
}
