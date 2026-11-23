// Department pages (docs/department-pages.md): which tab is open, what needs the owner in each
// department, and who works there. Pure: no database, no network, so `npm run check:dept` can test it.
import { below, headOf, type Org } from "@/core/org-rules";

/** The tabs a department page has so far. Chat joins in slice 2. */
export const DEPT_TABS = ["agents", "goals", "approvals"] as const;
export type DeptTab = (typeof DEPT_TABS)[number];
export const TAB_LABEL: Record<DeptTab, string> = { agents: "Agents", goals: "Goals", approvals: "Approvals" };

/** The tab in the address, or Agents. */
export const deptTab = (raw: unknown): DeptTab => (DEPT_TABS as readonly string[]).includes(String(raw)) ? (raw as DeptTab) : "agents";

/**
 * The red count on each department: approvals waiting on the owner, by the department stamped on
 * the card when it was made (the same field the Approvals page filters on, so the two always agree).
 * `none` is cards from no department; `gone` is cards from a department no longer on the chart.
 * Every waiting card is counted exactly once: the parts add up to the total.
 */
export function needsByDept(deptIds: readonly string[], approvalDepts: readonly (string | null)[]): { byDept: Record<string, number>; none: number; gone: number } {
  const byDept: Record<string, number> = Object.fromEntries(deptIds.map((d) => [d, 0]));
  let none = 0, gone = 0;
  for (const d of approvalDepts) {
    if (d == null) none++;
    else if (d in byDept) byDept[d]++;
    else gone++;
  }
  return { byDept, none, gone };
}

/** Agents seated in a department, its head first, then down the chart in seat order. */
export function deptAgentIds(org: Org, deptId: string): string[] {
  const head = headOf(org, deptId);
  if (!head) return [];
  return [head, ...below(org, head.id)].filter((s) => s.holder === "agent" && s.agentId).map((s) => s.agentId as string);
}

/** The head's agent id, or null when the head seat is open or held by the owner. */
export function headAgentId(org: Org, deptId: string): string | null {
  const h = headOf(org, deptId);
  return h?.holder === "agent" ? h.agentId : null;
}
