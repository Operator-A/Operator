// The top bar (docs/department-pages.md, slice 9): one working pill in place of an icon per agent, the
// bell's drop-down of what needs you, and your initial's menu. Which runs are live, where each opens,
// and what the bell lists. Pure: no database, no network, so `npm run check:header` can test it.
import { seatOf, type Org } from "@/core/org-rules";
import { agentHref, deptHue, tabHref } from "./dept-rules";

/** What the pill says: "2 working" while runs are live, "All quiet" otherwise. */
export const workingWord = (n: number) => (n > 0 ? `${n} working` : "All quiet");

/** A run as the top bar needs it (the floor's Run has more). */
export interface LiveRunIn { id: string; agent_id: string; status: string; started_at: string }
export interface LiveRow { id: string; name: string; role: string; dept: string | null; hue: string | null; mins: number; href: string }

/** A run counts as working while it says running and started under 6 minutes ago (the same rule as isLive). */
export const LIVE_MS = 6 * 6e4;

/**
 * Each live run, newest first: who, their department and its colour, how many minutes in, and where it
 * opens: the department's chat (where the run posts its checklist), or the agent's sheet when it has no department.
 */
export function liveRows(runs: readonly LiveRunIn[], byId: Record<string, { name: string; role: string } | undefined>, org: Org | null, now: number): LiveRow[] {
  return runs
    .filter((r) => r.status === "running" && now - Date.parse(r.started_at) < LIVE_MS && byId[r.agent_id])
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .map((r) => {
      const a = byId[r.agent_id]!;
      const deptId = org ? seatOf(org, r.agent_id)?.departmentId ?? null : null;
      const i = deptId && org ? org.departments.findIndex((d) => d.id === deptId) : -1;
      const dept = i >= 0 ? org!.departments[i] : null;
      return {
        id: r.id, name: a.name, role: a.role, dept: dept?.name ?? null, hue: dept ? deptHue(i) : null,
        mins: Math.max(0, Math.floor((now - Date.parse(r.started_at)) / 6e4)),
        href: dept ? tabHref(dept.id, "chat") : agentHref(org, r.agent_id),
      };
    });
}

/** "just now", "3 min", "1 hr". */
export const minsWord = (m: number) => (m < 1 ? "just now" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} hr`);

/** A thing that wants the owner, as the bell needs it (the full Need has more). */
export interface NeedIn { title: string; sub: string; href: string; interrupt: string | null; source: { from: string } }
export interface BellRow { title: string; sub: string; href: string; red: boolean }

/** How many rows the bell shows before "and N more". */
export const BELL_MAX = 6;

/**
 * The bell's list: everything that may put a red mark on the frame (not "connect a tool", which is setup,
 * card 189), the kinds that interrupt first and marked red, at most BELL_MAX, and how many more wait.
 */
export function bellRows(list: readonly NeedIn[]): { rows: BellRow[]; more: number } {
  const all = list.filter((x) => x.source.from !== "connection");
  const sorted = [...all.filter((x) => x.interrupt), ...all.filter((x) => !x.interrupt)];
  return { rows: sorted.slice(0, BELL_MAX).map((x) => ({ title: x.title, sub: x.sub, href: x.href, red: !!x.interrupt })), more: Math.max(0, sorted.length - BELL_MAX) };
}
