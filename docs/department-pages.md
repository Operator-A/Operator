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

- **Route.** `app/(room)/dept/[id]/page.tsx`. The tab is in the address (`?tab=agents`, `?tab=goals`,
  `?tab=approvals`; anything else opens Chat since slice 2), read by `deptTab` in `dashboard/dept-rules.ts`. It asks only for the pieces
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

## Slice 2: chat with the head

- **Chat tab.** The first tab and the default (`/dept/[id]`). It shows the department's conversation with
  its head (`dashboard/components/headChat.tsx`), light, on the page; Avery's dark panel stays the company
  chat. A department led by a person, or with an open head seat, says so instead.
- **One run per message.** `talkToHead` (`core/head-chat.ts`) runs the head's active spec through
  `withRun(head, "chat")`, so each message is logged in `agent_runs`, respects `agents.enabled` and the
  head's daily budget, and links to its replay. The server action `sendToHead` checks the member's role
  (approver), that real runs are on, and the message, like Avery's chat.
- **What the head can do.** Answer from its read tools, Goal progress, and The crew now limited to its
  department; Save a rule in the owner's own words (checked in code) for its department or one of its
  agents, never everyone or another department (`deptReach` in `core/head-chat-rules.ts`); and File a
  proposal for its department, which waits on Proposals. It never runs, sends, buys, posts or changes an
  agent, and never reaches the gateway. Code adds the lines under a reply saying what it saved.
- **Kept.** Table `dept_chat` (migration `20270104090000_dept_chat.sql`): `org_id`, `department_id`,
  `role` (owner or head), `text`, `run_id`, `notes`; in `TENANT_TABLES` with an `org_rows` policy. A run's
  replay shows what was asked (`askedIn` reads both chats).

Tests: `npm run check:dept` (Chat is the default tab; a head's rules and proposals stay inside its
department; the directive; the run, role and tenancy wiring).

## Slice 3: runs in the chat, and the page built to the mockup

- **Runs post into the chat.** Every run of a department agent shows in its chat, in time order with the
  conversation (`deptRuns` in `dashboard/deptFeed.ts`, pure parts in `dashboard/dept-feed.ts`). Chat
  replies, tries and approved writes being carried out don't post (`inFeed`). A run shows its title from
  how it started, a status pill, then a checklist, its result, its drafts and a foot line (steps, how long,
  cost, a link to its replay).
- **The checklist is code, not model text.** One line per tool the run used, in order, labelled by the
  tool's own label (`TOOLS`), repeats folded into "· 3 times", a failed call marked failed, a stop marked
  "Stopped before it finished". It reads only `run_steps.kind`, `tool` and `ok`.
- **Live.** The runner now saves each step as it happens for every logged run (it did only for tries), and
  the chat asks `GET /dept/[id]/live?since=` every 3 seconds while a run is going and every 20 seconds
  otherwise. The route checks who is signed in and that the department exists, and reads through `db()`.
  When a run that was going finishes, the page draws again on the server for its result and cards.
- **Drafts are approval cards.** A draft a run made (`agent_actions.run_id`) shows under it as the same
  `ApprovalCard` the Approvals page uses (`look="chat"`; the Approvals tab uses `look="tab"`), so approving
  in the chat, on the tab and on the Approvals page is one action. There is no Edit button yet: no edit flow
  for a draft exists.
- **Built to the mockup.** The page, its tabs and its chat follow the approved desktop and phone mockups
  exactly (glass tabs floating over the content with a sliding ink, the chat room with soft colour, run
  cards, the phone's floating menu, title pill and bell). The side menu's Departments section follows the
  mockup too; Desk, Approvals, Crew and the top bar stay as they are. Styles are the `dp-` rules in
  `app/globals.css`, scoped to the page.
- **Deletes.** The Desk had no department run list left to delete. The old department and head chat styles
  are gone.

Tests: `npm run check:dept` (the checklist comes only from logged steps, folded and marked; what posts;
titles, pills, foot line, result text, goal numbers and day dividers in the business's time zone; the
feed's order; the live route, the runner and the one approval path).
