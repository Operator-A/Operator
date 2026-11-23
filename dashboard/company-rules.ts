// The Company page (docs/department-pages.md, slice 8): Avery's page, home in place of the Desk. Which tab
// is open, its address, and the words typed in by its links. Pure: no database, no network, so
// `npm run check:dept` can test it.

/** The Company page's tabs, the same shape as a department's. Chat comes first and opens by default. */
export const COMPANY_TABS = ["chat", "departments", "goals", "approvals"] as const;
export type CompanyTab = (typeof COMPANY_TABS)[number];
export const COMPANY_TAB_LABEL: Record<CompanyTab, string> = { chat: "Chat", departments: "Departments", goals: "Goals", approvals: "Approvals" };

/** The tab in the address, or Chat. */
export const companyTab = (raw: unknown): CompanyTab => (COMPANY_TABS as readonly string[]).includes(String(raw)) ? (raw as CompanyTab) : "chat";
/** The tab's address: Chat is the page itself. */
export const companyHref = (t: CompanyTab) => (t === "chat" ? "/" : `/?tab=${t}`);

/** What "Add a department" types into Avery's chat: her department interview starts from it. */
export const ADD_DEPT_SAY = "Add a department for ";
export const addDeptHref = () => `/?say=${encodeURIComponent(ADD_DEPT_SAY)}`;

/** The Company page's colour (the departments take theirs from DEPT_HUES). */
export const COMPANY_HUE = "#F2C46B";

/** "3 of 4 goals on track", counted in code from each goal's status. */
export function goalsWord(statuses: readonly string[]): string {
  if (!statuses.length) return "No goals yet.";
  const ok = statuses.filter((s) => s === "on_track" || s === "reached" || s === "done").length;
  return statuses.length === 1 ? (ok ? "1 goal, on track." : "1 goal, behind or not measured yet.") : `${ok} of ${statuses.length} goals on track.`;
}
