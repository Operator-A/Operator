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
/** Runs that are not work an agent did on its own: chat replies, tries, approved writes, report writing (slice 2). */
export const NOT_WORK = new Set(["chat", "preview", "approval", "report"]);
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

// ---- The written report (overview slice 2): what the report card shows, from the saved report row.

export interface OvChip { label: string; href: string; failed: boolean }
export interface OvLine { text: string; chips: OvChip[] }
export interface OvReport {
  heading: string; sub: string | null; empty: string | null;
  sections: { title: string; lines: OvLine[]; todo?: boolean }[]; coming: { text: string; href: string }[];
  dayHref: string; weekHref: string; week: boolean; note: string; allHref: string | null; allLabel: string;
}
/** A saved report as the card reads it (core/reports.ts Report): a department's lines, or the company's (slice 3). */
export interface RepIn {
  day: string; runCount: number; dropped: number; costUsd: number; writtenAt: string; writerRun: string | null;
  lines: { section: string; text: string; runs: { id: string; agent: string; at: string; failed: boolean; dept?: string }[] }[];
}
export interface RepOpts {
  week: boolean; name: string; today: string; tz: string; coming: { agent: string; at: number }[];
  agentsHref: string; dayHref: string; weekHref: string; allHref: string | null;
  /** The company's report (slice 3): written from department reports, with action items. */
  company?: boolean;
}
const fmt = (t: number | string, tz: string, o: Intl.DateTimeFormatOptions) => {
  try { return new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(new Date(t)); }
  catch { return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...o }).format(new Date(t)); }
};
const dayTime = (t: number | string, tz: string) => fmt(t, tz, { weekday: "short", hour: "numeric", minute: "2-digit" });
const SECTIONS = { dept: [["happened", "What happened"], ["look", "Worth a look"]], company: [["short", "The short version"], ["todo", "Action items"]] } as const;

/**
 * The report card: its heading, the line under it (when it was written, from how many runs or department reports,
 * what the model call cost, how many lines the checker left out), the lines with a chip per cited run, and what runs
 * next. A day report from an earlier day says which day; no report yet says when one comes.
 */
export function reportView(r: RepIn | null, o: RepOpts): OvReport {
  const where = o.company ? "at the company" : `in ${o.name}`;
  const heading = o.week ? `Last 7 days ${where}` : !r || r.day === o.today ? `Today ${where}` : `${fmt(`${r.day}T12:00:00Z`, "UTC", { weekday: "long", month: "short", day: "numeric" })} ${where}`;
  const chips = (runs: RepIn["lines"][number]["runs"]): OvChip[] => runs.map((c) => {
    const when = o.week || o.company ? fmt(c.at, o.tz, { weekday: "short" }) : fmt(c.at, o.tz, { hour: "numeric", minute: "2-digit" });
    return { label: `${c.dept ? `${c.dept} · ` : ""}${c.agent} ${o.company ? "" : "· "}${when}${c.failed ? ", failed" : ""}`.replace("  ", " "), href: `/runs/${c.id}`, failed: c.failed };
  });
  const sections = SECTIONS[o.company ? "company" : "dept"].map(([key, title]) => ({
    title, todo: key === "todo", lines: (r?.lines ?? []).filter((l) => l.section === key).map((l) => ({ text: l.text, chips: chips(l.runs) })),
  })).filter((x) => x.lines.length > 0);
  const cost = r && r.costUsd > 0 && r.costUsd < 0.01 ? "under $0.01" : money(r?.costUsd ?? 0);
  const from = o.company ? `${r?.runCount} department report${r?.runCount === 1 ? "" : "s"}` : `${r?.runCount} run${r?.runCount === 1 ? "" : "s"}`;
  const call = r && r.runCount > 0 && r.writerRun ? ` · 1 model call, ${cost}` : "";
  const sub = r ? `Written ${dayTime(r.writtenAt, o.tz)} from ${from}${call}${r.dropped ? ` · ${r.dropped} line${r.dropped === 1 ? "" : "s"} left out` : ""}` : null;
  const empty = !r
    ? (o.company ? "No company report yet. It’s written once every department has its report, by 1 PM at the latest." : `No report yet. ${o.name}’s report is written after its morning runs, by noon at the latest.`)
    : r.runCount === 0 ? (o.company ? "No department had report lines for this period, so there was nothing to write." : o.week ? `No runs in ${o.name} in the last 7 days, so there was nothing to write.` : `No runs in ${o.name} yet today, so there was nothing to write.`)
    : !r.lines.length ? `None of the model’s lines cited ${o.company ? "a department line" : "a run"} with the numbers it gave, so none are shown.` : null;
  const horizon = o.week ? 7 : 1;
  const coming = [...o.coming].sort((a, b) => a.at - b.at).filter((c) => c.at <= Date.parse(`${o.today}T12:00:00Z`) + (horizon + 1) * DAY).slice(0, 3)
    .map((c) => ({ text: `${c.agent} runs ${dayTime(c.at, o.tz)}.`, href: o.agentsHref }));
  return {
    heading, sub, empty, sections, coming, dayHref: o.dayHref, weekHref: o.weekHref, week: o.week,
    note: o.company ? "Your assistant in Claude can read this report and its action items through the OPERATOR connector." : "Each line links to the run it came from; a line that cites no run is left out.",
    allHref: o.allHref, allLabel: !o.company && r?.runCount ? `All ${r.runCount} run${r.runCount === 1 ? "" : "s"}` : "All runs",
  };
}
