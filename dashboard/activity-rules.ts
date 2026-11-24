// Activity (docs/department-pages.md, slice 12): Runs and Status on one page. The filters in its address,
// which department each run belongs to, the day groups, and the totals line. Pure: no database, no network,
// so `npm run check:activity` can test it.
import { seatOf, type Org } from "@/core/org-rules";
import { dayLabel } from "./dept-feed";

export const ACTIVITY_HREF = "/activity";

export const RESULTS = ["ok", "failed", "skipped"] as const;
export const STARTS = ["cron", "manual", "chain"] as const;
export const RESULT_LABEL: Record<(typeof RESULTS)[number] | "all", string> = { all: "Any", ok: "OK", failed: "Failed", skipped: "Skipped" };
export const START_LABEL: Record<(typeof STARTS)[number] | "all", string> = { all: "Any start", cron: "Schedule", manual: "By hand", chain: "Chain" };

/** "company" is every agent in no department (the chief of staff, test agents). */
export interface ActivityQ { dept: string; result: string; start: string; q: string }
type RawQ = { dept?: string; status?: string; trigger?: string; q?: string };

/** The filters from the address. Old Runs links (`status`, `trigger`) keep working; anything unknown is "all". */
export function activityQ(sp: RawQ, deptIds: readonly string[]): ActivityQ {
  return {
    dept: sp.dept === "company" || deptIds.includes(sp.dept ?? "") ? sp.dept! : "all",
    result: (RESULTS as readonly string[]).includes(sp.status ?? "") ? sp.status! : "all",
    start: (STARTS as readonly string[]).includes(sp.trigger ?? "") ? sp.trigger! : "all",
    q: (sp.q ?? "").trim().slice(0, 100),
  };
}

/** The address for these filters with `patch` applied; filters left at "all" stay out of it. */
export function activityHref(cur: ActivityQ, patch: Partial<ActivityQ> = {}): string {
  const next = { ...cur, ...patch };
  const p = new URLSearchParams();
  if (next.dept !== "all") p.set("dept", next.dept);
  if (next.result !== "all") p.set("status", next.result);
  if (next.start !== "all") p.set("trigger", next.start);
  if (next.q) p.set("q", next.q);
  const s = p.toString();
  return s ? `${ACTIVITY_HREF}?${s}` : ACTIVITY_HREF;
}

export const filtered = (q: ActivityQ) => q.dept !== "all" || q.result !== "all" || q.start !== "all" || !!q.q;

/** Each agent's department id, or "company" when it sits in none. */
export function deptOfAgents(org: Org | null, agentIds: readonly string[]): Record<string, string> {
  return Object.fromEntries(agentIds.map((id) => [id, (org && seatOf(org, id)?.departmentId) || "company"]));
}

export interface RunIn { id: string; agent_id: string; trigger: string; status: string; started_at: string; summary: string | null; error: string | null; cost_usd: number }

/** The runs that match. Approval runs count as "By hand" only under Any start, so the start filter stays three choices. */
export function matchRuns<R extends RunIn>(runs: readonly R[], q: ActivityQ, deptOf: Record<string, string>): R[] {
  const needle = q.q.toLowerCase();
  return runs.filter((r) =>
    (q.dept === "all" || (deptOf[r.agent_id] ?? "company") === q.dept)
    && (q.result === "all" || r.status === q.result)
    && (q.start === "all" || r.trigger === q.start)
    && (!needle || `${r.summary ?? ""} ${r.error ?? ""}`.toLowerCase().includes(needle)));
}

/** Runs grouped under Today, Yesterday or the date, newest first, keeping the order they came in. */
export function byDay<R extends RunIn>(runs: readonly R[], tz: string, now: number): { day: string; runs: R[] }[] {
  const out: { day: string; runs: R[] }[] = [];
  for (const r of runs) {
    const day = dayLabel(r.started_at, tz, now);
    const last = out[out.length - 1];
    if (last && last.day === day) last.runs.push(r); else out.push({ day, runs: [r] });
  }
  return out;
}

/** The line under the runs: "8 runs · 5 OK · 1 failed · 1 skipped". Money is added by the page (m4). */
export function totalsLine(runs: readonly RunIn[]): string {
  const n = (s: string) => runs.filter((r) => r.status === s).length;
  return `${runs.length} run${runs.length === 1 ? "" : "s"} · ${n("ok")} OK · ${n("failed")} failed · ${n("skipped")} skipped`;
}

/** The health strip's title: "All clear", "1 needs a look", or "2 to know" when only warnings remain. */
export function healthWord(problems: readonly { level: "alert" | "warn" }[]): { text: string; clear: boolean; red: boolean } {
  const alerts = problems.filter((p) => p.level === "alert").length;
  if (!problems.length) return { text: "All clear", clear: true, red: false };
  if (alerts) return { text: `${alerts} need${alerts === 1 ? "s" : ""} a look`, clear: false, red: true };
  return { text: `${problems.length} to know`, clear: false, red: false };
}
