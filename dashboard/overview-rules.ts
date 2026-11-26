// A department's Overview tab (docs/department-pages.md, overview slice 1): every count, sum and bar on it,
// worked out here from rows the page already read. Pure: no database, no network, no model, so
// `npm run check:overview` can test it.

/** A run as the Overview needs it. */
export interface OvRun { id: string; agent_id: string; trigger: string; started_at: string; status: string; cost_usd: number; summary: string | null; error: string | null }
/** An approval card as the drafts chart needs it. */
export interface OvCard { status: string; created_at: string }
/** A chain run row: which chain, which firing, which step, how it went. */
export interface OvChainRun { chain_key: string; chain_id: string; chain_step: number; status: string; started_at: string }
/** A Wait for my OK step of a chain firing. */
export interface OvChainOk { chain_id: string; step: number; status: string }

const DAY = 864e5;
/** Runs that are not work an agent did on its own: chat replies, tries, approved writes, report writing. */
export const NOT_WORK = new Set(["chat", "preview", "approval"]);
export const isWork = (r: Pick<OvRun, "trigger" | "status">) => !NOT_WORK.has(r.trigger) && r.status !== "skipped";

/** The calendar day of an instant in a time zone, as YYYY-MM-DD. */
export function dayKey(t: number | string | Date, tz: string): string {
  try { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t)); }
  catch { return new Date(t).toISOString().slice(0, 10); }
}

export interface DayBar { key: string; finished: number; failed: number }
/**
 * Runs per day for the last `days` days in the org's time zone, oldest first, today last. A run that is
 * still going counts as neither; a failed run is counted apart so it can be drawn in the warning colour.
 */
export function runsPerDay(runs: readonly OvRun[], now: number, tz: string, days = 14): DayBar[] {
  // count calendar days back from today's date, so a daylight-saving change can't fold or skip a day
  const today = Date.parse(`${dayKey(now, tz)}T12:00:00Z`);
  const keys = Array.from({ length: days }, (_, i) => dayKey(today - (days - 1 - i) * DAY, "UTC"));
  const bars = new Map(keys.map((k) => [k, { key: k, finished: 0, failed: 0 }]));
  for (const r of runs) {
    if (!isWork(r)) continue;
    const b = bars.get(dayKey(r.started_at, tz));
    if (!b) continue;
    if (r.status === "failed") b.failed++;
    else if (r.status === "ok") b.finished++;
  }
  return keys.map((k) => bars.get(k)!);
}

/** A bar's height as a share of the tallest day, never 0 for a day that has a run (so a single run shows). */
export function barPct(n: number, max: number): number {
  if (n <= 0 || max <= 0) return 0;
  return Math.max(4, Math.round((n / max) * 100));
}
/** The tallest day's total, at least 1. */
export const tallest = (bars: readonly DayBar[]) => Math.max(1, ...bars.map((b) => b.finished + b.failed));

export interface WeekCounts { runs: number; finished: number; failed: number; costUsd: number }
/** The last 7 days of work: runs, how they went, and what they cost OPERATOR (a run in Claude costs $0 here). */
export function lastWeek(runs: readonly OvRun[], now: number): WeekCounts {
  const since = now - 7 * DAY;
  const w = runs.filter((r) => Date.parse(r.started_at) >= since);
  const work = w.filter(isWork);
  return {
    runs: work.length,
    finished: work.filter((r) => r.status === "ok").length,
    failed: work.filter((r) => r.status === "failed").length,
    // every run's cost, chat and tries too: it's what the budget sees
    costUsd: round2(w.reduce((t, r) => t + (Number.isFinite(r.cost_usd) ? r.cost_usd : 0), 0)),
  };
}

export interface Drafts { asWritten: number; edited: number; rejected: number; waiting: number; total: number }
/**
 * Approval cards from the last 7 days by how they ended: approved as written, edited then approved, rejected
 * or sent back, and still waiting. Expired cards are left out (nobody decided them).
 */
export function draftOutcomes(cards: readonly OvCard[], now: number): Drafts {
  const since = now - 7 * DAY;
  const d: Drafts = { asWritten: 0, edited: 0, rejected: 0, waiting: 0, total: 0 };
  for (const c of cards) {
    if (Date.parse(c.created_at) < since) continue;
    if (c.status === "approved") d.asWritten++;
    else if (c.status === "edited") d.edited++;
    else if (c.status === "rejected" || c.status === "sent_back") d.rejected++;
    else if (c.status === "pending") d.waiting++;
    else continue;
    d.total++;
  }
  return d;
}

export interface SpendRow { id: string; usd: number; pct: number; claude: boolean }
/**
 * What each agent cost this month, most first, with its bar as a share of the most. An agent that runs in
 * Claude runs on the owner's Claude plan, so it costs OPERATOR nothing and says so.
 */
export function spendRows(ids: readonly string[], spend: Readonly<Record<string, number>>, claude: ReadonlySet<string>): SpendRow[] {
  const rows = ids.map((id) => ({ id, usd: round2(Math.max(0, spend[id] ?? 0)), claude: claude.has(id) }));
  const most = Math.max(0, ...rows.map((r) => r.usd));
  return rows.map((r) => ({ ...r, pct: most > 0 ? Math.round((r.usd / most) * 100) : 0 }))
    .sort((a, b) => b.usd - a.usd || Number(a.claude) - Number(b.claude));
}

/** Failed runs in the last `hours` hours, newest first, one per agent (the latest says it all). */
export function recentFailures(runs: readonly OvRun[], now: number, hours = 72): OvRun[] {
  const since = now - hours * 36e5;
  const seen = new Set<string>();
  const out: OvRun[] = [];
  for (const r of [...runs].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))) {
    if (Date.parse(r.started_at) < since || !isWork(r) || seen.has(r.agent_id)) continue;
    seen.add(r.agent_id);
    // an agent whose newest run went fine has recovered: its older failure isn't asking for anything
    if (r.status === "failed") out.push(r);
  }
  return out;
}

export type StepState = "done" | "failed" | "waiting" | "running" | "skipped" | "not_reached";
export interface ChainLast { chainId: string; at: string; steps: StepState[] }
/**
 * The newest firing of a chain and how each of its `steps` steps went: a run at that step says done, failed or
 * running; a Wait for my OK step says done when approved, waiting while pending, failed when rejected or
 * expired; a step nothing reached is not reached. Null when the chain hasn't fired in the rows given.
 */
export function chainLast(key: string, steps: number, runs: readonly OvChainRun[], oks: readonly OvChainOk[]): ChainLast | null {
  const mine = runs.filter((r) => r.chain_key === key);
  if (!mine.length) return null;
  const newest = mine.reduce((a, b) => (Date.parse(b.started_at) > Date.parse(a.started_at) ? b : a));
  const firing = mine.filter((r) => r.chain_id === newest.chain_id);
  const first = firing.reduce((a, b) => (Date.parse(b.started_at) < Date.parse(a.started_at) ? b : a));
  const out: StepState[] = [];
  for (let i = 0; i < steps; i++) {
    const run = firing.filter((r) => r.chain_step === i).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
    const ok = oks.find((o) => o.chain_id === newest.chain_id && o.step === i);
    if (run) out.push(run.status === "ok" ? "done" : run.status === "failed" ? "failed" : run.status === "running" ? "running" : "skipped");
    else if (ok) out.push(ok.status === "approved" ? "done" : ok.status === "pending" ? "waiting" : "failed");
    else out.push("not_reached");
  }
  return { chainId: newest.chain_id, at: first.started_at, steps: out };
}

export const STEP_WORD: Record<StepState, string> = { done: "done", failed: "failed", waiting: "waiting", running: "running", skipped: "skipped", not_reached: "not reached" };

const round2 = (n: number) => Math.round(n * 100) / 100;
/** Dollars for the Overview: $0, $0.04, $12.40. */
export const money = (n: number) => (n === 0 ? "$0" : `$${n.toFixed(2)}`);
