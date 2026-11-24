// The crew flow rules (docs/agent-setup.md, slice 5), with no database access so the Crew canvas
// can check a draft in the browser; core/flow.ts adds loading and saving.
//
// The crew flow: which agents run when, and which agent starts
// after another. A flow is a list of chains. Each chain has one start (a schedule, the Run
// button, an approval being decided, a signed outside event, or another chain finishing) and one
// to eight steps (an agent, or from chains slice 2 an Ask a model step), and an owner: an agent, a department or the company. A step after the first
// can wait for the step before it to finish OK or failed (or either), only go on if a number
// the code computed passes a check, only run on some days, wait until a time, and pass the
// earlier step's summary along as facts.
//
// A flow is choices from the palette below, never authority. Every run it starts goes through
// withRun (on duty, daily budget), a skipped run stops the chain, and nothing here can turn an
// agent on. Inbound email and web pages never choose what runs next: only the saved flow does.
import { localAt, localDate, nextDay } from "@/core/time";
import { eventStartProblems, type EventStart } from "@/core/event-rules";

export const MAX_STEPS = 8;
/** How many chains in a row "after another chain finishes" may start from one run, so a mistake can't loop. */
export const MAX_HOPS = 5;
// room for a one-step chain per agent (an agent's own schedule, docs/org-schedule.md) plus shared chains
export const MAX_CHAINS = 30;
/** Named days, or a set of weekdays ("on:135" is Monday, Wednesday and Friday; 0 is Sunday), from the agent sheet's day buttons. */
export type Days = "daily" | "weekdays" | "mondays" | `on:${string}`;
/** The named choices, in the order the dashboard offers them. Heads plan on Mondays. */
export const DAYS: readonly Days[] = ["daily", "weekdays", "mondays"];
const SET = /^on:[0-6]{1,7}$/;
/** The weekdays a choice runs on, 0 (Sunday) to 6, in order. */
export function daySet(d: Days): number[] {
  if (d === "daily") return [0, 1, 2, 3, 4, 5, 6];
  if (d === "weekdays") return [1, 2, 3, 4, 5];
  if (d === "mondays") return [1];
  return [...new Set(d.slice(3).split("").map(Number))].sort((a, b) => a - b);
}
/** A set of weekdays as a choice: the named one when it matches, else "on:..."; null for no days. */
export function daysOf(set: readonly number[]): Days | null {
  const u = [...new Set(set.filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b);
  const k = u.join("");
  if (!u.length) return null;
  return k === "0123456" ? "daily" : k === "12345" ? "weekdays" : k === "1" ? "mondays" : (`on:${k}` as Days);
}
export const isDays = (d: unknown): d is Days => typeof d === "string" && (DAYS.includes(d as Days) || (SET.test(d) && new Set(d.slice(3)).size === d.length - 3 && d.slice(3) === [...d.slice(3)].sort().join("")));
/** Runs in 30 days, for the monthly cost: 30 daily, 22 on weekdays, 4 on Mondays, about 30/7 a week-day otherwise. */
export function dayRuns(d: Days): number {
  return d === "daily" ? 30 : d === "weekdays" ? 22 : d === "mondays" ? 4 : Math.round((daySet(d).length * 30) / 7);
}
const DAY_NAME = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
/** How a sentence says the days: "every day", "on weekdays", "on Mondays", "on Mondays, Wednesdays and Fridays". */
export function dayWords(d: Days): string {
  if (d === "daily") return "every day";
  if (d === "weekdays") return "on weekdays";
  const n = daySet(d).map((i) => DAY_NAME[i]);
  return `on ${n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n.at(-1)}` : n[0]}`;
}
/** Kept for the named choices' callers. */
export const DAY_RUNS = { daily: 30, weekdays: 22, mondays: 4 } as const;
export type When = "ok" | "failed" | "any";
export type Op = ">=" | ">" | "<=" | "<" | "=";

export type Start =
  | { type: "schedule"; days: Days; time: string }
  | { type: "button" }
  | { type: "approval"; tool: string; decision: "approve" | "reject" | "any" }
  /** A signed event from an outside service (docs/live-events.md): only chains saved with it start. */
  | EventStart
  /** Another chain of the flow finished its last step (chains slice 1): "ok" only when that step worked, or "any". */
  | { type: "after"; chain: string; when?: "ok" | "any" };

/**
 * Ask a model (chains slice 2): a quick step, not an agent. One instruction to one model on the list, the step
 * before's result as facts when passed along, text back. No tools, no reads, no memory, so it can reach nothing;
 * capped at `maxUsd` a run and billed to the chain owner's agent (billedBy in core/chain-bill-rules.ts).
 */
export interface Ask { model: string; prompt: string; maxUsd: number }
/** The limits of an Ask a model step, in code. `maxUsd` is the most a step's cap may be set to. */
export const ASK = { promptMax: 2000, maxUsd: 1, defaultUsd: 0.1, outMax: 4000 } as const;
const MODEL_ID = /^[a-z0-9][a-z0-9.-]{1,59}$/;

/** A step: one of the crew (`agent`), or an Ask a model step (`ask`), never both. */
export type Step = StepIf & ({ agent: string; ask?: undefined } | { ask: Ask; agent?: undefined });
/** What a step is called in sentences: its agent, or "Ask a model". */
export const stepName = (s: Step) => s.agent ?? "Ask a model";

export interface StepIf {
  /** How the step before must have ended. Ignored on the first step. */
  when?: When;
  /** Only go on when this number, computed in code by the step before, passes. */
  check?: { metric: string; op: Op; value: number };
  /** Only on these days (Chicago). */
  days?: Days;
  /** Wait until this Chicago time ("HH:MM") if the step before finished earlier. */
  notBefore?: string;
  /** Hand the step before's summary and numbers to this agent as facts. */
  passAlong?: boolean;
}

/** Whose chain it is (chains slice 1): an agent's, a department's, or (no owner) the company's. Where it is shown and edited; never authority. */
export type Owner = { agent: string } | { dept: string };
export interface Chain { key: string; name: string; on: boolean; start: Start; steps: Step[]; owner?: Owner }
export interface Flow { chains: Chain[] }

// ---- The palette: everything a flow may pick. Code, on purpose.

/** Numbers an agent's run reports (RunResult.metrics), which a check may test. */
export const METRICS: Record<string, { key: string; label: string }[]> = {
  cfo: [{ key: "orders", label: "Orders yesterday" }],
};
/**
 * The agents a flow may pick: every agent that can run (agents/registry.ts loadCrew), and those that
 * run only by hand (agents.manual_only), which may only be in a chain started with the Run chain
 * button. Every agent on the engine can read a hand-off from the step before.
 */
export interface Crew { ids: readonly string[]; manualOnly: ReadonlySet<string>; models?: readonly string[] }
/** Gateway action types an approval start may name (core/gateway/policy.ts TOOLS). */
export const APPROVAL_TOOLS = ["mercury.annotate_transaction"];
export const APPROVAL_LABELS: Record<string, string> = { "mercury.annotate_transaction": "Quinn’s receipt, category and memo changes" };
const OPS: Op[] = [">=", ">", "<=", "<", "="];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Why a flow can't be saved, one line per problem; [] when it is fine. `crew` is the agents the
 * app can run (agents/registry.ts loadCrew).
 */
export function flowProblems(f: unknown, crew: Crew): string[] {
  const x = (f ?? {}) as { chains?: unknown };
  if (!Array.isArray(x.chains)) return ["The flow has no chain list."];
  const out: string[] = [];
  if (x.chains.length > MAX_CHAINS) out.push(`At most ${MAX_CHAINS} chains.`);
  const keys = new Set<string>();
  const all = new Set(x.chains.map((c: Chain) => c?.key));
  x.chains.forEach((c: Chain, i: number) => {
    out.push(...chainProblems(c, i, crew, all));
    if (c && typeof c.key === "string" && /^[a-z0-9_-]{1,40}$/.test(c.key)) {
      if (keys.has(c.key)) out.push(`Chain ${i + 1}: two chains share the key ${c.key}.`); else keys.add(c.key);
    }
  });
  const loop = afterLoop(x.chains as Chain[]);
  if (loop) out.push(`${loop.join(" starts ")} starts ${loop[0]} again. A chain can’t start itself, even through others.`);
  return out;
}

/** The chains that start each other in a circle through "after another chain finishes", by name; null when none do. */
function afterLoop(chains: readonly Chain[]): string[] | null {
  const by = new Map(chains.filter((c) => c && typeof c === "object").map((c) => [c.key, c]));
  for (const c of by.values()) {
    const path: string[] = [];
    let at: Chain | undefined = c;
    while (at && at.start?.type === "after") {
      if (path.includes(at.key)) return path.slice(path.indexOf(at.key)).map((k) => by.get(k)?.name ?? k);
      path.push(at.key);
      at = by.get(at.start.chain);
    }
  }
  return null;
}

/** Why one chain can't be saved; `keys` is every chain key in the flow, for an "after" start. */
function chainProblems(c: Chain, i: number, crew: Crew, keys: ReadonlySet<unknown>): string[] {
  const out: string[] = [];
  const at = `Chain ${i + 1}${typeof c?.name === "string" && c.name ? ` (${c.name})` : ""}`;
  if (!c || typeof c !== "object") return [`${at} is not a chain.`];
  if (typeof c.key !== "string" || !/^[a-z0-9_-]{1,40}$/.test(c.key)) out.push(`${at} has no key.`);
  if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 60) out.push(`${at} needs a name of up to 60 characters.`);
  if (typeof c.on !== "boolean") out.push(`${at}: on must be true or false.`);
  if (c.owner !== undefined) {
    const o = c.owner as Record<string, unknown>;
    const agent = typeof o?.agent === "string" ? o.agent : null, dept = typeof o?.dept === "string" ? o.dept : null;
    if (Object.keys(o ?? {}).length !== 1 || (agent === null && dept === null)) out.push(`${at}: the owner is an agent or a department.`);
    else if (agent !== null && !crew.ids.includes(agent)) out.push(`${at}: the owner ${agent} isn’t an agent.`);
    else if (dept !== null && !/^[A-Za-z0-9_-]{1,80}$/.test(dept)) out.push(`${at}: that department can’t own a chain.`);
  }
  const s = c.start as Start;
  if (s?.type === "schedule") {
    if (!isDays(s.days)) out.push(`${at}: the schedule runs on at least one day of the week.`);
    if (typeof s.time !== "string" || !TIME.test(s.time)) out.push(`${at}: the schedule time must be HH:MM.`);
    else if (Number(s.time.slice(3)) % 15) out.push(`${at}: the dispatcher runs every 15 minutes, so pick :00, :15, :30 or :45.`);
  } else if (s?.type === "approval") {
    if (!APPROVAL_TOOLS.includes(s.tool)) out.push(`${at}: unknown approval type ${String(s.tool)}.`);
    if (!["approve", "reject", "any"].includes(s.decision)) out.push(`${at}: the approval start needs approve, reject or any.`);
  } else if (s?.type === "event") {
    for (const p of eventStartProblems(s)) out.push(`${at}: ${p}`);
  } else if (s?.type === "after") {
    if (typeof s.chain !== "string" || !keys.has(s.chain)) out.push(`${at}: it starts after a chain that isn’t in the flow.`);
    else if (s.chain === c.key) out.push(`${at} can’t start after itself.`);
    if (s.when !== undefined && s.when !== "ok" && s.when !== "any") out.push(`${at}: after another chain starts when it worked, or either way.`);
  } else if (s?.type !== "button") out.push(`${at}: the start must be a schedule, the Run button, an approval, an event or another chain.`);
  if (!Array.isArray(c.steps) || !c.steps.length) { out.push(`${at} has no agents.`); return out; }
  if (c.steps.length > MAX_STEPS) out.push(`${at}: at most ${MAX_STEPS} steps in a chain.`);
  const seen = new Set<string>();
  c.steps.forEach((st: Step, k: number) => {
    const sat = `${at}, step ${k + 1}`;
    if (!st || typeof st !== "object") { out.push(`${sat}: unknown agent.`); return; }
    if (st.ask !== undefined) {
      if (st.agent !== undefined) { out.push(`${sat}: a step is an agent or Ask a model, not both.`); return; }
      out.push(...askProblems(st.ask, crew).map((p) => `${sat}: ${p}`));
    } else {
      if (!crew.ids.includes(st.agent)) { out.push(`${sat}: unknown agent.`); return; }
      if (seen.has(st.agent)) out.push(`${sat}: ${st.agent} is already in this chain. No loops.`); seen.add(st.agent);
    }
    if (st.agent !== undefined && crew.manualOnly.has(st.agent) && s?.type !== "button") out.push(`${sat}: ${st.agent} runs only by hand, so it can only be in a chain started with the Run chain button.`);
    if (st.when !== undefined && !["ok", "failed", "any"].includes(st.when)) out.push(`${sat}: when must be ok, failed or any.`);
    if (st.days !== undefined && !isDays(st.days)) out.push(`${sat}: days must be at least one day of the week.`);
    if (st.notBefore !== undefined && (typeof st.notBefore !== "string" || !TIME.test(st.notBefore) || Number(st.notBefore.slice(3)) % 15)) out.push(`${sat}: not before must be HH:MM on a quarter hour.`);
    if (st.passAlong !== undefined && typeof st.passAlong !== "boolean") out.push(`${sat}: pass along must be true or false.`);
    if (st.check !== undefined) {
      const prev = k > 0 ? c.steps[k - 1]?.agent : undefined;
      if (k === 0) out.push(`${sat}: the first step has nothing before it to check.`);
      else if (!prev || !METRICS[prev]?.some((m) => m.key === st.check!.metric)) out.push(`${sat}: ${prev ?? "Ask a model"} doesn't report ${String(st.check.metric)}.`);
      if (!OPS.includes(st.check.op) || typeof st.check.value !== "number" || !Number.isFinite(st.check.value)) out.push(`${sat}: the check needs a comparison and a number.`);
    }
  });
  return out;
}

/** Why an Ask a model step can't be saved; [] when it is fine. `crew.models` is the model list, when known. */
export function askProblems(a: unknown, crew: Pick<Crew, "models">): string[] {
  if (!a || typeof a !== "object") return ["Ask a model needs a model, an instruction and a cap."];
  const x = a as Partial<Ask>;
  const out: string[] = [];
  if (typeof x.model !== "string" || !MODEL_ID.test(x.model) || (crew.models && !crew.models.includes(x.model))) out.push("pick a model OPERATOR runs.");
  if (typeof x.prompt !== "string" || !x.prompt.trim()) out.push("say what to ask the model.");
  else if (x.prompt.length > ASK.promptMax) out.push(`the instruction is at most ${ASK.promptMax} characters.`);
  if (typeof x.maxUsd !== "number" || !Number.isFinite(x.maxUsd) || x.maxUsd < 0.01 || x.maxUsd > ASK.maxUsd) out.push(`the cap is between $0.01 and $${ASK.maxUsd.toFixed(2)} a run.`);
  const extra = Object.keys(x).filter((k) => !["model", "prompt", "maxUsd"].includes(k));
  if (extra.length) out.push(`Ask a model takes a model, an instruction and a cap only (not ${extra.join(", ")}).`);
  return out;
}

/**
 * A flow from the database, with anything malformed dropped (and said so) rather than run. A chain that starts
 * after a dropped chain is dropped too, and so is a circle of chains starting each other.
 */
export function readFlow(raw: unknown, crew: Crew): { flow: Flow; problems: string[] } {
  const chains = Array.isArray((raw as Flow)?.chains) ? (raw as Flow).chains : [];
  const problems: string[] = [];
  const keys = new Set(chains.map((c) => c?.key));
  let ok: Chain[] = [];
  chains.forEach((c, i) => { const p = chainProblems(c, i, crew, keys); if (p.length) problems.push(...p); else ok.push(c); });
  for (let changed = true; changed;) {
    const have = new Set(ok.map((c) => c.key));
    const next = ok.filter((c) => c.start.type !== "after" || have.has(c.start.chain));
    changed = next.length !== ok.length;
    for (const c of ok) if (!next.includes(c)) problems.push(`${c.name} starts after a chain that was dropped.`);
    ok = next;
  }
  const loop = afterLoop(ok);
  if (loop) { problems.push(`${loop.join(", ")} start each other in a circle, so none of them run.`); ok = ok.filter((c) => !loop.includes(c.name)); }
  return { flow: { chains: ok }, problems };
}

/** The chains that start when `key` finishes (chains slice 1), on, with how its last step ended. */
export function followersOf(flow: Flow, key: string, ended: Ended["status"]): Chain[] {
  return flow.chains.filter((c) => c.on && c.start.type === "after" && c.start.chain === key && (c.start.when === "any" ? ended !== "skipped" : ended === "ok"));
}

/** Who owns a chain: its saved owner, else an agent's own one-step chain (soloKey) is that agent's, else the company's (null). */
export function chainOwner(c: Chain): Owner | null {
  if (c.owner) return c.owner;
  const only = c.steps.length === 1 ? c.steps[0].agent : undefined;
  if (c.key.startsWith("solo-") && only) return { agent: only };
  return null;
}

// ---- Time: schedules and waits are wall-clock times in the business's own time zone (card 187).

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();
export const onDay = (days: Days | undefined, date: string) => !days || daySet(days).includes(weekday(date));

/**
 * The scheduled firings of a chain that fall in (from, to]. The dispatcher asks about the last
 * hour every 15 minutes; chain_fires makes sure each firing starts once.
 */
export function firingsBetween(c: Chain, from: number, to: number, tz: string): number[] {
  if (c.start.type !== "schedule") return [];
  const out: number[] = [];
  let d = localDate(tz, 0, new Date(from));
  for (let i = 0; i < 3; i++, d = nextDay(d)) {
    if (!onDay(c.start.days, d)) continue;
    const t = localAt(d, c.start.time, tz);
    if (t > from && t <= to) out.push(t);
  }
  return out;
}

/** The next firings of a chain from `now`, for the canvas. */
export function nextFirings(c: Chain, now: number, n: number, tz: string): number[] {
  if (c.start.type !== "schedule") return [];
  const out: number[] = [];
  let d = localDate(tz, 0, new Date(now));
  for (let i = 0; i < 14 && out.length < n; i++, d = nextDay(d)) {
    if (!onDay(c.start.days, d)) continue;
    const t = localAt(d, c.start.time, tz);
    if (t > now) out.push(t);
  }
  return out;
}

/** Runs per 30 days of a chain's first step, for the monthly cost (DAY_RUNS), 0 for other starts. */
export const runsPerMonth = (c: Chain) => (c.start.type !== "schedule" ? 0 : dayRuns(c.start.days));

// ---- Going on after a step

export interface Ended { status: "ok" | "skipped" | "failed"; metrics?: Record<string, number> }

const pass = (op: Op, a: number, b: number) => (op === ">=" ? a >= b : op === ">" ? a > b : op === "<=" ? a <= b : op === "<" ? a < b : a === b);

/**
 * What happens after step `k` of a chain ended: stop (with why), start step k+1 now, or wait
 * until a time. A skipped step always stops the chain: the agent was off duty or over budget.
 */
export function afterStep(c: Chain, k: number, ended: Ended, tz: string, now = Date.now()): { go: false; why: string } | { go: true; step: number; at: number | null } {
  const next = c.steps[k + 1];
  if (!next) return { go: false, why: "That was the last step." };
  if (ended.status === "skipped") return { go: false, why: "The step was skipped (off duty or over budget), so the chain stops." };
  const when = next.when ?? "ok";
  if (when === "ok" && ended.status !== "ok") return { go: false, why: `${stepName(next)} only runs when the step before worked.` };
  if (when === "failed" && ended.status !== "failed") return { go: false, why: `${stepName(next)} only runs when the step before failed.` };
  if (next.check) {
    const v = ended.metrics?.[next.check.metric];
    if (v === undefined) return { go: false, why: `The step before didn't report ${next.check.metric}, so the check can't pass.` };
    if (!pass(next.check.op, v, next.check.value)) return { go: false, why: `${next.check.metric} was ${v}, not ${next.check.op} ${next.check.value}.` };
  }
  const today = localDate(tz, 0, new Date(now));
  if (!onDay(next.days, today)) return { go: false, why: `${stepName(next)} only runs ${dayWords(next.days!)}.` };
  const at = next.notBefore ? localAt(today, next.notBefore, tz) : null;
  return { go: true, step: k + 1, at: at && at > now ? at : null };
}

/**
 * Why `next` is looser than `now`: a chain that starts running on its own (turned on, or new and
 * on), or a chain that is on and gains an agent. That needs a confirm and DASHBOARD_CONTROLS=on.
 * Turning a chain off, or dropping a step, never does.
 */
export function flowLooser(now: Flow, next: Flow): string[] {
  const out: string[] = [];
  for (const c of next.chains) {
    if (!c.on) continue;
    const was = now.chains.find((x) => x.key === c.key);
    if (!was || !was.on) out.push(`${c.name} starts running on its own`);
    else {
      const added = c.steps.flatMap((s) => (s.agent && !was.steps.some((w) => w.agent === s.agent) ? [s.agent] : []));
      if (added.length) out.push(`${c.name} now also runs ${added.join(", ")}`);
      // Ask a model steps spend on their own: a higher total cap a run is looser (chains slice 2)
      const capOf = (x: Chain) => x.steps.reduce((t, s) => t + (s.ask?.maxUsd ?? 0), 0);
      if (capOf(c) > capOf(was) + 1e-9) out.push(`${c.name} may now spend up to $${capOf(c).toFixed(2)} a run on Ask a model (was $${capOf(was).toFixed(2)})`);
      if (c.start.type !== was.start.type || JSON.stringify(c.start) !== JSON.stringify(was.start)) out.push(`${c.name} starts at a different time or on a different event`);
    }
  }
  return out;
}

// ---- An agent's own schedule (docs/org-schedule.md, slice 2). Crew > Schedule sets when one agent
// runs, or makes it run only by hand, as an edit of the flow: its step in the scheduled chain it is
// in (the chain's start for a first step, "not before" for a later one), or a one-step chain of its
// own. The result is checked with flowProblems and saved like any other flow.

export interface AgentTime { days: Days; time: string }

/** The key of an agent's own one-step chain. */
export const soloKey = (agent: string) => `solo-${agent}`.slice(0, 40);

/** Takes one step out of a chain. A new first step takes the chain's start, at its own days and time. */
function dropStep(c: Chain, agent: string): Chain | null {
  const k = c.steps.findIndex((s) => s.agent === agent);
  if (k < 0) return c;
  const steps = c.steps.filter((_, i) => i !== k);
  if (!steps.length) return null;
  if (k > 0) return { ...c, steps };
  const [first, ...rest] = steps;
  const start: Start = c.start.type === "schedule" ? { type: "schedule", days: first.days ?? c.start.days, time: first.notBefore ?? c.start.time } : c.start;
  return { ...c, start, steps: [first.ask ? { ask: first.ask } : { agent: first.agent }, ...rest] };
}

/**
 * The flow with `agent` on `t` (days and a quarter-hour time), or by hand (`t` null): out of every
 * chain that starts on its own (a schedule or an approval), since an agent that runs by hand may only
 * be in a chain started with Run chain. Returns the flow, or why it can't be done.
 */
export function withAgentTime(flow: Flow, agent: string, name: string, t: AgentTime | null): { flow: Flow } | { refuse: string } {
  if (t === null) {
    const chains = flow.chains.map((c) => (c.start.type === "button" ? c : dropStep(c, agent))).filter((c): c is Chain => c !== null);
    return { flow: { chains } };
  }
  if (!isDays(t.days)) return { refuse: "Pick at least one day." };
  if (!TIME.test(t.time) || Number(t.time.slice(3)) % 15) return { refuse: "Pick a time on a quarter hour." };
  const sched = flow.chains.filter((c) => c.start.type === "schedule" && c.steps.some((s) => s.agent === agent));
  const own = sched.find((c) => c.on) ?? sched[0];
  if (!own) {
    if (flow.chains.length >= MAX_CHAINS) return { refuse: `The flow holds ${MAX_CHAINS} chains at most.` };
    let key = soloKey(agent);
    for (let i = 2; flow.chains.some((c) => c.key === key); i++) key = `${soloKey(agent).slice(0, 36)}-${i}`;
    return { flow: { chains: [...flow.chains, { key, name: name.slice(0, 60) || agent, on: true, owner: { agent }, start: { type: "schedule", days: t.days, time: t.time }, steps: [{ agent }] }] } };
  }
  const k = own.steps.findIndex((s) => s.agent === agent);
  const start = own.start as Extract<Start, { type: "schedule" }>;
  const chains = flow.chains.map((c) => {
    if (c !== own) return c;
    if (k === 0) return { ...c, start: { type: "schedule" as const, days: t.days, time: t.time } };
    return { ...c, steps: c.steps.map((s, i) => (i === k ? { ...s, notBefore: t.time, days: t.days === start.days ? undefined : t.days } : s)) };
  });
  if (k > 0 && t.time < start.time) return { refuse: `${name} runs after ${stepName(own.steps[k - 1])} in ${own.name}, which starts at ${start.time}, so pick ${start.time} or later, or change it on the chain.` };
  return { flow: { chains } };
}

/**
 * The flow with `agent` running after `after` (card 400, the agent sheet's "After another agent finishes"): the
 * next step of the scheduled chain `after` ends, passing `after`'s summary along when asked. `agent`'s own
 * one-step schedule comes out, so it doesn't run twice. Refused when `after` runs on no schedule, isn't the
 * last step of its chain, or that chain is full, or `agent` is already in it. Check the result with
 * flowProblems and save it like any other flow.
 */
export function withAgentAfter(flow: Flow, agent: string, name: string, after: string, afterName: string, passAlong: boolean): { flow: Flow; chain: string } | { refuse: string } {
  if (agent === after) return { refuse: `${name} can’t run after itself.` };
  const sched = flow.chains.filter((c) => c.start.type === "schedule" && c.steps.some((s) => s.agent === after));
  const own = sched.find((c) => c.on) ?? sched[0];
  if (!own) return { refuse: `${afterName} doesn’t run on a schedule yet. Give ${afterName} a time first, then add ${name} after it.` };
  if (own.steps.some((s) => s.agent === agent)) return { refuse: `${name} is already in ${own.name}. Change it in Settings > Schedule.` };
  if (own.steps[own.steps.length - 1].agent !== after) return { refuse: `${afterName} isn’t the last agent in ${own.name}. Change it in Settings > Schedule.` };
  if (own.steps.length >= MAX_STEPS) return { refuse: `${own.name} already has ${MAX_STEPS} agents, the most a chain can hold.` };
  const step: Step = passAlong ? { agent, when: "ok", passAlong: true } : { agent, when: "ok" };
  const chains = flow.chains
    .filter((c) => !(c !== own && c.start.type === "schedule" && c.steps.length === 1 && c.steps[0].agent === agent))
    .map((c) => (c === own ? { ...c, steps: [...c.steps, step] } : c));
  return { flow: { chains }, chain: own.name };
}
