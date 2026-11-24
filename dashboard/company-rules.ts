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
/** History and trust levels, folded at the foot of Company > Approvals (slice 10). */
/** New agent (card 420) from Company > Departments, and where the new agent's sheet then opens ("{id}" for its id). */
export const newAgentCompanyHref = () => `${companyHref("departments")}&agent=new`;
export const madeAgentCompanyHref = () => `${companyHref("departments")}&agent={id}`;
export const approvalsHistoryHref = () => `${companyHref("approvals")}#history`;

/** Company > Departments shows cards (the default) or the living org chart, and the chart's editor (slice 11). */
export const DEPT_VIEWS = ["cards", "chart", "edit"] as const;
export type DeptView = (typeof DEPT_VIEWS)[number];
export const deptView = (raw: unknown): DeptView => (DEPT_VIEWS as readonly string[]).includes(String(raw)) ? (raw as DeptView) : "cards";
export const deptViewHref = (v: DeptView) => (v === "cards" ? companyHref("departments") : `${companyHref("departments")}&view=${v}`);
/** The org switch, your org's day and the chains: a Settings section (slice 11; was Crew > Schedule). */
export const SCHEDULE_HREF = "/settings/schedule";

/** What "Add a department" types into Avery's chat: her department interview starts from it. */
export const ADD_DEPT_SAY = "Add a department for ";
/** Card 440: the window event a card's button fires to send a message in the chat on the same page. */
export const SAY_EVENT = "operator:say";
export const addDeptHref = () => `/?say=${encodeURIComponent(ADD_DEPT_SAY)}`;

/** The Company page's colour (the departments take theirs from DEPT_HUES). */
export const COMPANY_HUE = "#F2C46B";

/** "3 of 4 goals on track", counted in code from each goal's status. */
export function goalsWord(statuses: readonly string[]): string {
  if (!statuses.length) return "No goals yet.";
  const ok = statuses.filter((s) => s === "on_track" || s === "reached" || s === "done").length;
  return statuses.length === 1 ? (ok ? "1 goal, on track." : "1 goal, behind or not measured yet.") : `${ok} of ${statuses.length} goals on track.`;
}
