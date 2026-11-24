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
| 6 | Change agents and goals by asking (change cards); the agent sheet's More detail | The step editor (`/build/[id]?edit`) and the Set a goal form |
| 7 | Department settings on its page: name, monthly AI budget, emails a day, head checks drafts, rules, remove | Crew's department editor |
| 8 | Avery's Company page: home, with Chat (Avery), Departments, Goals and Approvals | The Desk and the floating Avery panel |
| 9 | A calmer top bar: one working pill, the bell's drop-down, your initial's menu | The agent rail, the date pill, the top bar's theme button, the sidebar's Sign out, Everyone |
| 10 | Company > Approvals holds everything the Approvals page did | The Approvals menu item and page, the Proposals list, the department filter, the bookkeeper-only button and banner |

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
  (Deleted in slice 9: the bell is a drop-down and Company > Departments lists agents in no department.)
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

## Slice 4: the agent sheet

- **One sheet for one agent.** Tapping an agent on a department's Agents tab or on Everyone opens its sheet
  (a drawer on the right on a computer, a bottom sheet on a phone). The sheet is in the address
  (`/dept/[id]?tab=agents&agent=…`, or `/?tab=departments&agent=…` for an agent with no department, slice 9), so Back and a
  shared link work. `agentHref` in `dashboard/dept-rules.ts` picks the address. The header has the on duty
  toggle, the model, the next run and Run now.
- **Runs.** The agent's last 60 days of runs, newest first, from the same reader as the department chat
  (`deptRuns`): title, time, status, result, the checklist from `run_steps`, steps, how long, cost and a link
  to how it thought.
- **Edit.** The job in the owner's words, the model, when it runs, what it reads, what it can do, the daily
  AI budget, whom it reports to, lessons waiting for Keep or Discard, what it remembers, and earlier versions
  with Go back. `agentSheet` in `dashboard/agentSheet.ts` reads all of it in one round; the sheet binds the
  same server actions the old agent and builder pages used (`setEnabled`, `realRun`, `setAgentTime`,
  `setBuiltBudget`, `saveSpec`, `tryBuilt`, `goLive`, `goBack`, the memory and lesson actions), so every role
  check, cap and refusal stays where it was.
- **A change takes effect after a clean try.** Saving a changed job, model, reads or can do makes a new
  draft version (`saveSpec`, owner only). The sheet then shows the draft with Try it and Go live; Go live is
  disabled until the latest try ran clean, and `goLive` checks that again on the server. A changed time or
  budget saves straight away, as before.
- **Any days.** A schedule can run on any set of days, not only every day, weekdays or Mondays
  (`Days` in `core/flow-rules.ts` now has `on:` day sets, digits 0 for Sunday to 6). Counts for cost
  (`dayRuns`) and words (`dayWords`) cover sets.
- **Triggers.** "+ Add a trigger" offers the schedule; "after another agent finishes" and "when you approve a
  draft" link to Crew > Schedule, where those chains are set today; triggers from a connected tool come in
  slice 6.
- **Can do = an approver's grant.** The Can do toggles grant an action an approver may give (`agents:
  "granted"`), exactly as the builder's Tools step did; a proposal still can't grant one. CLAUDE.md names
  the sheet (since slice 6, the sheet and the hire card only).
- **The step editor stays for fine detail.** What a good result looks like, run limits, pages and other
  agents it reads stay in the step-by-step editor (`/build/[id]?edit=1`, linked from the sheet) until hiring
  moves into the chat (slice 5).
- **Deletes.** The agent page (`/agents/[id]` now redirects to the sheet), the builder's version page
  (`/build/[id]` without `?edit` redirects too), its try route and `TryLive`, and the `AgentTabs` strip.

Tests: `npm run check:dept` (sheet addresses; day sets, words and counts; one schedule chain when a time
moves; the sheet binds only the existing actions and never writes the database itself; save is owner only
and makes a version; Go live needs a clean try, in code and on the button; the old pages redirect).

## Slice 5: hire in the chat

- **The head drafts, code checks.** Asked to hire, the head asks at most two questions, then files the hire with
  its File a proposal tool. A hire now also carries when it runs (`days`, `time`: daily, weekdays, day names
  or only when asked, read by `hireWhen` in `core/proposal-rules.ts`) and `can`: actions it would need, as
  suggestions. `can` takes only actions an approver may give (`agents: "granted"`); none is ever one of the
  hire's tools until a person turns it on.
- **The hire card.** A pending hire for the department shows in its chat as a card, in time order
  (`deptHires` in `dashboard/hireCards.ts`, pure parts in `dashboard/hire-rules.ts`): name and seat, job, when,
  reports to, reads, and Can do toggles that start off. The cost comes from code (`monthCostOf` from the model,
  tools and limits, times the runs a month the schedule gives), never from the model. Filed again under the
  same name, a hire replaces the card that was waiting (Change something).
- **Hire and try once.** `hireInChat` (owner only) accepts the hire through `acceptProposal` with the toggles
  that were on: `hireDraft` keeps only grants the hire suggested and an approver may give. The agent starts
  off duty, takes its seat and its schedule. The chat then runs a fresh try with the existing `tryBuilt`; that
  try posts in the chat as a First try run card (`tryInFeed`: tries post only for agents with a card).
- **Put on duty.** An agent seated in the department, off duty and with no approved routine keeps its card
  (`newAgent`). After a clean try the card offers Put on duty, which is the existing `goLive` (needs the clean
  try, approves the routine the try saved) and then `setEnabled`. A try that wasn't clean says why and offers
  Try again. Agents drafted from Claude through the Operator connector get the same card.
- **Links.** Open seats, Crew's New agent and a proposal's Change it open the department's chat with the hire
  typed in (`hireHref`, `?say=`).
- **Deletes.** `/build/new`, `createBuilt`, `proposalCreate`, the builder's templates and its create mode. The
  step editor (`/build/[id]?edit`) stays for an existing agent's fine detail until slice 6.

Tests: `npm run check:dept` (a hire's schedule and suggested actions; a suggestion never becomes a tool; only
suggested, approver-grantable actions get through a Hire tap; the cost line; card stages; only a new agent's
first try posts; no link to `/build/new`; the head asks at most two questions) and `npm run check:proposals`.

## Slice 6: change agents and goals by asking

- **The head files, the owner approves.** Asked to change one of its agents, the head files a `change_agent`
  with File a proposal, giving only what changes: when it runs (`days`, `time`), its daily `budget` (up to
  `CHANGE_MAX_BUDGET`), its job (`each_run`, the whole job in the owner's words), `good_result`, read tools to
  add (`tools`) or take away (`drop`), and `cost_cap` a run (`CHANGE_COST_CAP`, $0.01 to $2). `planProposal`
  refuses a model, an action (only a person grants or takes one away, on the sheet's Can do toggles), a link,
  and a change with nothing in it. The server refuses an agent outside the head's department, and a head
  changing itself. A goal change is a `goal` proposal: new, change, drop, and now pause, turn back on and
  mark done.
- **The change card.** A waiting change shows in the department's chat as a card in time order
  (`deptChanges` in `dashboard/changeCards.ts`, pure parts in `dashboard/change-rules.ts`): each line is Now
  → New, worked out in code from the agent's saved version or the goal row. Filed again for the same agent
  or goal, it replaces the waiting card (Change something). A decided card stays in the chat for
  `CHANGE_KEEP_DAYS`.
- **Approve.** `changeInChat` (owner only, audited) goes through `acceptProposal`. A goal change goes through
  the goal's own code (`createGoal`, `editGoal`, `setGoalState`). A new time or budget goes through the
  sheet's own actions (`setAgentTime`, `setBuiltBudget`). A change to the job, good result, reads or cost cap
  saves a draft version (`saveSpecVersion`); it never goes live by itself. The chat then runs a try with the
  existing `tryBuilt` (it posts as "Try of vN"), and after a clean try the card offers Go live with vN, the
  existing `goLive`, which checks again.
- **More detail in the sheet.** The sheet's Edit tab gains a More detail section: what a good result looks
  like, each run's cost and step limits (inside `RUN_LIMITS`), Notion pages it reads, other agents' results it
  reads, and where it saves its result (report tools). Saving any of them saves a draft, like the rest of the
  Edit tab.
- **Goals.** Every Set a goal link (the Desk, the Goals tab, a goal page) opens the department's chat with the
  ask typed in (`goalHref`). The goal page stays, read only: pace, the head's plan with Mark done on the
  owner's jobs (Needs you links there), the review and the department's AI spend.
- **Event triggers** came with live events (docs/live-events.md): an event chain is set on Crew > Schedule.
- **Deletes.** The step editor (`/build/[id]?edit`, `Flow.tsx`, `flowSteps.ts`), `/goals/new` and
  `GoalForm.tsx`, the goal form's actions (`goalCreate`, `goalEdit`, `goalSetState`), the builder's seat
  picker (`seatChoices`, `seatToolChoices`, `placeAgent`), `addStandard`, `dryRunBuilt` and `dryRunTools`,
  and `BudgetForm`. `/build/[id]` and `/agents/[id]` only redirect to the agent's sheet (`?edit` opens its
  Edit tab). The rules that named "the builder's Tools step" now name the agent sheet's Can do toggles.

Tests: `npm run check:proposals` (a change carries only what changes; no action, model or link; cost cap and
budget inside code's limits; goal pause, turn back on and done carry no fields), `npm run check:dept` (Now →
New lines, card stages, a replaced card leaves the chat, Approve is the owner's and goes through the
proposal's own path, a change saves a draft and never goes live by itself, only the head's own department,
the deleted files and links are gone, the sheet's More detail fields), `npm run check:interrupts` and
`npm run check:audit`.

## Slice 7: department settings on its page

- **Where.** A gear at the right of the department header opens its settings, a sheet like the agent sheet
  (`?settings=1`, `settingsHref`, so back closes it). On a phone the title pill opens it. Settings on Crew's Edit
  chart opens the same page.
- **What.** The department's name, its monthly AI budget (with this month's spend and a bar), emails a day
  (never over the company cap; blank uses it), the head checking drafts first (`LEAD_REVIEW_HOURS`), the rules
  every agent in it follows (add and remove; asking the head in the chat still works), and Remove (only when
  every seat is open).
- **How.** `DeptSettingsFor` (`dashboard/components/deptSettingsFor.tsx`) reads the department and binds the
  owner-only actions Crew's editor used: `orgRenameDepartment`, `orgSetDeptBudget`, `orgSetDeptEmails`,
  `orgSetLeadChecks`, `orgAddDeptRule`, `orgForgetDeptRule`, `orgRemoveDepartment`. A raised budget or email cap
  comes back as "Confirm first" from the server; the sheet shows it and saves again only on Confirm and save.
- **Deletes.** Crew's department editor (`DeptEditor`, `LimitForm`) and `orgEditDeptRule`.

Tests: `npm run check:dept` (the settings address, the sheet uses those owner-only actions, a raise stops for a
confirm, emails stay under the company cap, the sheet never writes the database, Crew's editor is gone) and
`npm run check:audit`.

## Slice 8: Avery's Company page

- **Where.** Home (`/`), "Company" in the menu, in place of the Desk. The same shape as a department page:
  a short header (the business, Avery as chief of staff, the month's AI spend, what needs you, a gear to
  Settings; on a phone the title pill) and four tabs in the address (`?tab=`, `dashboard/company-rules.ts`).
- **Chat.** Avery's chat, in the same glass room as a head's (`HeadChat`, with `send={sendToAvery}`, the
  `avery_chat` table and no live poll). Avery's runs post there with their checklists. Pinned at the end:
  the department Avery is drafting (card 156), the first job, what setup left to finish, skipped findings,
  then the day's line (`deskGreeting`, `deskLine`, streamed behind Suspense), a Needs you card with only the
  four kinds that interrupt (card 158), and what can wait for her summary. Add a department (in the menu
  and on Departments) types "Add a department for " into her chat.
- **Departments.** One card per department: head, agents on duty, what needs you (`needsByDept`), goals
  (`goalsWord`, counted in code), AI spend against the budget, the head's latest line. Each opens the page.
- **Goals.** Every goal by department, the same `GoalTiles` as a department's Goals tab.
- **Approvals.** Every waiting draft as the same `ApprovalCard`, plus the proposals that interrupt.
- **Counts.** The header's "need you" is `interruptCount`, the same as the menu's Approvals and the bell.
- **Deletes.** The Desk page and the floating Avery panel (`dashboard/components/avery.tsx`, its CSS and the
  panel width code in `dashboard/chat-ui.ts`). Words that pointed at the Desk now say the Company page.

Tests: `npm run check:dept` (the tabs and addresses, Avery's chat through `sendToAvery` and its checks, her
runs in the chat, the shared counts, cards and tiles, setup still first, no Desk or floating panel left),
`check:chat-ui`, `check:interrupts`, `check:speed` (the tabs and the day line stream behind Suspense).

## Slice 9: a calmer top bar

The first slice of the app audit (mockup v17). The top bar is the brand, then three drop-downs on the right
(`HeaderPop` in `dashboard/components/client.tsx`; the rules in `dashboard/header-rules.ts`):

- **Working pill.** In place of an icon per agent: "2 working" with a soft pulse while runs are live (running
  and under 6 minutes old, the same rule as `isLive`), "All quiet" otherwise. Tapping it lists each live run,
  newest first, with its department's colour and how long it has run, opening that department's chat (where
  the run posts its checklist), or the agent's sheet when it has no department. On phones it is a round dot
  with the count.
- **Bell.** A drop-down of what needs you (`bellRows`): the kinds that interrupt first and marked red, then the
  rest, at most 6 and "and N more", never "connect a tool" (card 189), and a link to Company > Approvals.
- **Your initial.** Your email and role, Light or Dark, Settings, Sign out.
- **Agents in no department.** The chief of staff and any agent without a department are listed under Not in
  a department on Company > Departments, and open their sheet there (`agentHref`).
- **Deletes.** The agent rail (`RailLink`, `.rail*`, `.badge`), the date pill, the top bar's theme button,
  the sidebar's Sign out (the phone menu keeps it at the bottom) and the Everyone page.

The menu items come next, each its own slice: Approvals into Company (10), Crew split (11), Activity (12).

Tests: `npm run check:header` (the pill's words, which runs it lists and where each opens, the bell's order and
cap, the three drop-downs and nothing they replaced), `check:dept`, `check:sidebar`, `check:signout`,
`check:interrupts`, `check:speed`.

## Slice 10: Approvals on the Company page

Mockup v18. Approvals leaves the menu; Company carries its red count, and `/approvals` and `/proposals` only send old
links to Company > Approvals. The tab, top to bottom:

- **Earned trust.** A card for each offer (28 of the last 30 unedited): Yes, promote / Not yet, the same actions as before.
- **Waiting for your OK.** Every department's drafts as `ApprovalCard`, with Approve all; then the lead's queue.
- **Proposals to decide.** Every pending proposal, each opening its own page (`/proposals/[id]` stays).
- **Going out on earned trust.** What runs by itself when its undo window ends: Cancel, or Cancel, it's wrong.
- **Approved, not applied yet.** Apply now and Retry.
- **History and trust levels** (folded, `#history`): trust levels with Back to Draft, decided cards and proposals, the
  gateway log. A department's "History and trust levels" link opens it.
- When writes are blocked (real runs off, a missing sign-in), one generic note says approving records the decision.
- **Deletes.** The Approvals page and its department filter (each department has its own tab), the Proposals list, and
  the leftovers of one business: the button that queued one bookkeeper's proposals by hand (the books sync already
  queues them after each run) and the Mercury-only banner; the receipt-photo line no longer names an agent.

Tests: `npm run check:dept` (the redirects, the menu, every piece the old page had, no agent of one business named).

## Move cards (card 370)

Asked in Avery's chat to put an agent in a department, Avery files a `move_agent` proposal; it shows in that
department's chat as a change card with Department, Seat and Reports to, Now → New, and Approve / Not now (no
Change something: a head can't file a move). Approve places the agent through `placeAgent`, the same path as
Crew's Add to a department. Detail and checks: docs/org-chart.md, "Adding an agent to a department".
