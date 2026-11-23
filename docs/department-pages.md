# Department pages

Each department gets one page, `/dept/[id]`, with four tabs: Chat, Agents, Goals and Approvals. You run
the department from its chat. Design approved 2026-11-23 (desktop and phone mockups, linked on the
Build Board card "Department pages with chat"). Chat stays in OPERATOR: every head and agent runs here on
the model picked for it, and a member's Claude reaches OPERATOR only through OPERATOR's own MCP server
(`docs/operator-mcp.md`), where anything it makes is an off-duty draft.

## Slices

Each slice deletes the screen it replaces and ships with tests and a before/after diagram.

| # | Builds | Deletes |
| --- | --- | --- |
| 1 | `/dept/[id]` with Agents, Goals and Approvals tabs; departments in the side menu with red counts; Everyone on the bell | The Crew canvas's department panel |
| 2 | Chat with the head (table `dept_chat`, one run per message through `withRun`) | Nothing; Avery stays the company chat |
| 3 | Runs post into the chat: a checklist from `run_steps`, the result, drafts as approval cards | The department's run list on the Desk |
| 4 | The agent sheet: Runs and Edit (model, schedule, reads, grants, budget, triggers inside OPERATOR) | `/agents/[id]` and `/build/[id]` |
| 5 | Hire in the chat: a draft card with grant toggles and cost in code; Hire runs a first try | `/build/new` step screens |
| 6 | Change agents and goals by asking (change cards); event triggers from connected tools | The Set a goal form |

## Slice 1: the page

- **Route.** `app/(room)/dept/[id]/page.tsx`. The tab is in the address (`?tab=goals`, `?tab=approvals`;
  anything else opens Agents), read by `deptTab` in `dashboard/dept-rules.ts`. It asks only for the pieces
  it shows (`getRoster`, `getCounts`, `getTz`, `getOrgSwitch`; check:speed), and reads goals or approvals
  only on their tab.
- **Agents tab.** Every agent seated in the department, its head first, then down the chart
  (`deptAgentIds`): state, the model it runs on, its last run and result, drafts waiting on you, when it
  runs next, and Run now (the same `realRun` action as the agent page, which checks the role). Open seats
  link to the builder until slice 5.
- **Goals tab.** The department's goals from `goalsByDept`, every number from code.
- **Approvals tab.** Drafts from the department waiting on an approver, by the department stamped on the
  card (the same field the Approvals page filters on). The card is `ApprovalCard` in
  `dashboard/components/approvalBits.tsx`, which the Approvals page draws too, so approving in either place
  is one action and every count drops together.
- **Red counts.** `needsByDept` counts each card waiting on the owner exactly once, by its department;
  cards from no department or from a department since removed are counted apart, so the parts add up to
  the Approvals count. The side menu, the page header, the Approvals tab and Everyone all use it.
- **Side menu.** Departments sit under the main items with their head's name and the red count, on
  desktop and in the phone's menu sheet.
- **Everyone.** `/everyone`, opened by the bell: what needs you (the Desk's list), then every
  department's agents with their state and last run, then the company seat and agents in no department.
- **Crew canvas.** Opening a department on the canvas now shows its limits and an Open button for its
  page; the panel's goals, agents, rules and today's runs are gone (they are on the page). Clicking an
  agent on the canvas still shows what it does.

Tests: `npm run check:dept` (tabs, who works here, the counts adding up, and that the menu, page,
Everyone and Approvals page share the counts and the one card).
