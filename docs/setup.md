# First-run setup

What a new business sees before it has a crew (card 151, the first onboarding card in the product
definition). The Desk sends it to `/start` until setup is done. `/start` is one guided flow, one step
on screen at a time (card 181, the first slice of the white glove setup, epic card 180):

1. **Your business.** One card: "Let's build your company", a box for the business and one for the
   website. After the first message it becomes the conversation with the Chief of Staff, with what
   she has learned, the tools she knows about and the departments she is thinking of beside it. She
   asks about tools inside the conversation, one part of the business at a time (card 195, below).
2. **Your company.** The org chart Avery proposes (card 153, below), or **Start empty**.
3. **First job.** What the Desk offers next (card 154), and credits on OPERATOR's Claude.

## One step at a time

The step is `stage` in the `setup` row of `policies` (`STAGES` in `core/setup-rules.ts`: business,
company, first). `readStage` opens on the first step when the stored one is missing or not on
the list, so a business saved on the old tools step opens on the conversation. **Back** and **Next** call `setupGo` (an approver; the step is checked against the list),
and the page shows the saved step, so a refresh, a tool's sign-in or Stripe Checkout comes back to
the same place: their return addresses are plain `/start`.

The look is white glass over soft light that drifts as the steps change (`.wg` in
`app/globals.css`), always light whatever the Control Room's theme, with a blur-fade as each step
arrives. Reduced motion turns the movement off.

## Who goes to setup

`needsSetup` (`core/setup-rules.ts`) says yes only for a business that has not finished setup and
has no departments and no agents but the Chief of Staff that setup installed. A business with a crew,
or with an agent the owner built, never goes. Setup ends when the owner starts the company
(`setupInstall`) or taps Start empty (`setupStartEmpty`); both set `done` in the `setup` row of
`policies`.

## How Avery thinks (card 162)

On the cloud edition the conversation opens straight away on OPERATOR's Claude, with free setup
(below). Step 1 asks how agents think only when they can't think yet: the open edition with no key, or
free setup used up with no credits. The cloud edition offers two options, OPERATOR's Claude first:

- **Use OPERATOR's Claude.** Nothing to set up. Runs use the hosted key and are paid from prepaid
  credits at the model price plus 20% (card 128 slice 4). The panel comes from the `HostedClaude`
  slot: the balance and, for an owner, Buy $10 / $25 / $50 on Stripe Checkout, which comes back to
  `/start` (a fixed return place, `packReturn`). The conversation opens once the balance reaches
  $0.50.
- **Use your own Claude key.** Paste a key from the Claude Console; Anthropic bills it directly.

**Free setup** (decided 2026-11-20). On OPERATOR's Claude, setup messages (trigger `setup`) are free up
to `SETUP_FREE_USD` ($2 of model cost at list price) while the business is still in setup, so a new
founder talks to Avery right away with no credits. The allowance is counted in code from `agent_runs`
(`setupFree` in `ee/credits.ts`); a setup message is charged only for any cost past what was left.
It never pays for any other run, and once setup is done it is gone: step 4 and the side panel say
the crew's jobs need credits, and the Desk's first job waits until a pack is bought or a key pasted.

The open edition has no hosted Claude, so it shows only the key. The rules are in
`core/claude-choice-rules.ts` (`npm run check:claude-choice`): a key of the business's own always
comes first, as in runs, and a paused key is never skipped for credits. Connections > Claude shows the
same choice later.

## The conversation

The first message installs the Chief of Staff template (`ensureAvery`), off duty like every agent.
Each message is one run through `withRun` with the trigger `setup`. `core/runs.ts` lets a setup run
through while she is off duty, but only for the Chief of Staff and only while the business has no
departments; her daily budget still applies. Sending a message needs an approver and
`DASHBOARD_CONTROLS=on`, like her chat, because each one is a real model call. Both sides are kept in
the chat history, and each reply links to its run.

### The interview comes first (card 192)

Setup runs think with `SETUP_MODEL` (Opus 5.5) at `SETUP_EFFORT` high, whatever model her saved
spec names; they stay free up to `SETUP_FREE_USD`. The directive tells her to interview: one or two
follow-ups grounded in the founder's last answer, never a checklist, and always ask where the week
goes and what the founder would never do again.

Six interview areas are fact topics (`INTERVIEW_AREAS`: business, sells, customers, channels,
hand_off, goals). `coverage(facts)` counts the areas with a known fact; a fact read from a site counts
only once confirmed. Until at least `AREAS_TO_DESIGN` (5) are covered, and always the founder's week
(`hand_off`), the run gets no Design a department tool, and the
directive names what to ask next. The founder sees the same count in "What Avery needs to know"
above the facts panel.

For these runs she has a setup directive (`setupDirective`) and only these tools:

| Tool | What it does |
| --- | --- |
| Save a fact | Hands code one fact: a topic from `FACT_TOPICS` and one short line (at most 160 characters, 8 per message, 40 in all) |
| Design a department | Only once the interview is covered: hands code one part of one department in her sketch (below) |
| Read a web page | Only when the founder gave a site: Claude's own fetch, allowed on that one host, at most 2 pages |

The tools change nothing. Code saves what they hand it, and only after a run that finished:

- **Facts** go in `business_facts`. When the run read a web page, every fact it saves is
  `suggested` (`stateFor`). It waits on the panel for the founder to Confirm, Edit or Remove it.
  Facts from the conversation alone, and facts the founder types, are `known`.
- **The sketch** replaces `designs` in the `setup` row, after `applyDesign` checks every part
  (`core/design-rules.ts`).
- The lines under her reply come from code and say what it actually saved.

The site address is checked like a custom server's (`checkAddress`: a public https host). The page
is untrusted data. It never chooses a recipient, URL, product or category, and the directive says so.

## Connect your tools, inside the interview (card 195)

Avery asks about tools while she learns the business, one part at a time, and code draws the card
in the chat (the first versions were a grid of tiles, card 152, then a separate step with one
question per part, card 182). The parts are `TOOL_CATEGORIES` in `core/tools-step-rules.ts`, 14 of
them: eight **core** parts every business has (where you sell, payments, bank, books, email
marketing, inbox and calendar, website traffic, leads and customers) and six that fit only some
(ads, social, customer support, bookings, shipping, team and work). Each has the common tools for it,
the ones that connect today first (`tools`, with a `tile` for Shopify, Mercury, Klaviyo, Gmail and
Google Analytics), what Avery learns from it, and the fact topic its answer is saved under. The tools
that connect, their steps and what each permission is for are still `TOOL_TILES`.

- **Avery names a part, nothing else.** Her setup run has a report tool, Ask about a tool
  (`ask_tool`), whose only input is a part id from the list. Code refuses a part that already has an
  answer and more than one card per reply. The directive lists each part with its state, worked out
  in code (`toolLines`), and tells her never to name a tool, link or sign-in step herself. The ask is
  kept (`asked` in the setup state, `readAsked`) only after a run that finished.
- **The card.** Under her last message, code draws the part's card (`ToolCard` in
  `app/start/page.tsx`, `cardCategory`): the listed tools, **Something else**, **None yet** and
  **Skip for now**. It shows while the part is open; any answer closes it.
- **A tool that connects** opens its steps on the card (the panel below). Picking it also saves the
  answer as a fact ("Where you sell: Shopify").
- **A listed tool that doesn't connect yet** is saved as a fact and as the part's plan (`uses`), and
  goes on our build list as a connection request (`askFor`). It starts working the day it connects.
- **Something else** routes the typed name in code as before (`routeUnlisted`, `setupOtherTool`):
  a tile opens, a built-in or known server opens on Connections, anything else is a request and the
  part starts from an export. The name is also saved as the answer's fact.
- **None yet** is saved as a fact. A part with a starter tool (email marketing, website traffic)
  becomes **Avery sets it up** after setup (card 183); any other is plan `none`.
- **Skip for now** saves only the skip; the part stays in Your tools to tap later.
- **Your tools**, beside the chat (`partsShown`): every core part, and any other once Avery asked
  about it or it has an answer. Tapping one opens its card (`?q=`), even when answered, with **Change
  my answer** (`setupPlanClear`).
- **The answer's fact** is code's own line, one per part (`answerCategory`, `keepAnswerFact`): a new
  answer replaces it, the founder can edit or remove it like any fact, and it is skipped when the
  panel is full. Only an owner answers (`setupAnswerTool`, audited). No model call.
- **Avery knows what's connected.** Each message tells her which parts are connected, so she doesn't
  ask about them again (`connectedTiles` in `sendSetup`).
- **The panel.** Numbered steps, then what each permission is for (from the profile's scopes,
  `SCOPE_WORDS`), then the Connect button or, for Shopify, the store's address and the read-only key.
  Gmail also offers the drafts sign-in once the read-only one is connected.
- **Back to setup.** Connect from here goes to `/connections/<id>/connect?from=start`. The route
  takes only `start` and keeps it in its own short-lived cookie; the callback returns to
  `/start?c=<the tool>` (the conversation, with that tool's card showing it connected) only when that cookie says so. Anything else returns to Connections, so it can't
  become an open redirect.
- **Plans** are saved as `plans` in the setup state (`readPlans`: only real parts, a guide only where
  there is a starter, an export's name checked as a service name, a `uses` tool only from the part's
  own list). A connected tool wins over a plan,
  a plan over a skip (`categoryState`). Tapping a planned part shows what was chosen and **Change my
  answer** (`setupPlanClear`). The tool's name is the founder's typed text: it is shown, never used
  to choose a recipient, URL, product or category.
- **Left for later.** Your company shows the tools each department still waits on (`waitLine`), and for a
  planned part what happens instead: "Avery sets up Klaviyo with you after setup" or "Starts from an
  export of Mailchimp". It installs anyway and starts working once they're connected.
- **Finish setting up, on the Desk** (`followUps`, `dashboard/followUps.ts`). After setup the owner's
  Desk lists each planned part: for a guide, the click-by-click steps to create the account and a
  button to the normal Connect; for an export, a link to Connections > Find a tool > Upload an export
  (`docs/exports.md`). A part leaves the card when its tool is connected, when an export with that
  name is uploaded, or when the owner taps Not now.

## Your company

Step 3 (cards 153, 184) is "Meet your company": an org chart drawn in code (`core/company-rules.ts`,
`dashboard/company.ts`) and revealed in sequence.

- **The founder** at the top, then the Chief of Staff in the company seat, then a glass card per
  department in Avery's sketch (below), each appearing a moment after the last (all at once with
  reduced motion). The model only hands code checked parts (`applyDesign`); it never writes the
  chart, a cost or a number.
- **Each department card** shows its agents (name and role), the head's job (the template's
  mandate), the tools its agents use (labels from the tool list) and what it adds to the month
  (`deptMonth`, summed in code from each agent's estimate, `docs/usage.md`). An agent with no
  estimate is named as cost unknown, never counted as zero. Open seats show by title, with no cost.
- **Its status** (`deptStatus`): Waiting on a tool when it waits on a tool with no plan; else From an
  export when one of its tools is planned as an export (card 183); else After setup when one is
  planned for Avery to set up; else Ready. The line under it says which tool (`waitLine`).
- **The total** under the chart: agents, about how much a month once on duty, at most how much, and
  who pays.
- **Leave out** takes a department off the chart; **Also available** lists the rest, each with
  **Add**.
- **Start this company** installs exactly what's on the chart: `setupInstall` checks the picks
  against the chart (`readPick`: known department ids only, in chart order) before `startCompany`. **Change something** goes back to the tools questions. **Start empty instead**
  is a quiet link beside them.

Every agent still installs off duty with its playbook proposed, and every action stays at Draft.

### Avery designs the company (card 193)

Once the interview is covered, Avery sketches up to `MAX_DESIGNS` (4) departments for this business
with Design a department, a report tool that builds nothing. Each call names the department (`dept`)
and one part; code checks it (`applyDesign` in `core/design-rules.ts`, pure, tested by
`npm run check:setup`) and keeps the sketch in the setup state as `designs` only after a run that
finishes. The lines under her reply say what was sketched or refused.

- **about** creates a department or changes its purpose, reason or name. A new one needs a purpose,
  a reason (the founder's own words it answers, at least 10 characters, under 200, no links or
  addresses) and a kit or none.
- **A kit** is a department template she starts from, under the name she gives it (Money desk, not
  Finance). It brings its own people and goals, and each kit appears at most once.
- **Bespoke** (kit none) is a department draft built with the same checks as one drafted in the chat
  (`applyPart`, card 156): **head** and up to two narrow **agent**s with read and calculate tools
  only, then **goal**s measured in code or kept in words; **remove** takes one off. A person's name
  is free across the whole sketch, kits' agents included.
- **drop** takes a department off the sketch.

The directive lists the kits, the read tools and measures she may use, and her sketch so far, and
tells her to name departments for this business, in the founder's words, and to use a kit only when it
truly fits. There is no fixed list to lean toward: the leaning the chart uses is
derived in code (`leaningOf`: each kit in the sketch is a strong fit).

On step 3, Avery's sketch comes first in her order, then the remaining templates under **Also
available**. Each card shows "You said: …" with the reason; a bespoke one says "Designed for you by
Avery", its people come from the draft, and its cost is per run until a playbook is approved.
**Start this company** (`startCompany`) refuses a bespoke department with a gap (`designGaps`: a head
and at least one goal) before writing anything, installs the picked kits and renames their departments
to Avery's names, then builds each bespoke department with `buildDepartment`, everyone off duty, each
first run drafting its playbook for approval.

**What it replaces.** The fixed list of four templates and Lean toward departments (`readLeaning`),
and Avery's one-off idea (card 185: `suggest_department`, `readIdea`, the reveal's dashed idea box, the
Desk's IdeaCard, `ideaStart` and `seedDraft`).

## First job

After **Start this company** (card 154; `core/first-job-rules.ts`, `dashboard/firstJob.ts`), the
founder stays in setup for the wrap-up (card 186), and the Desk shows the same **First job** card for a
founder who leaves early. The founder's call (Nov 19): agents start only after the founder
approves each first playbook, and this card makes that one tap for the first one.

- **The pick, in code** (`pickFirstJob`): an installed department agent, never the Chief of Staff, with
  a first playbook waiting and at least one of its steps able to run now (`runnableSteps`: every tool the
  step needs is connected; the app's own data needs none). The founder's call (Nov 20, card 189): one
  tool, or none, is enough, so a founder without Shopify still gets a first job. Ranked: a job that ends
  in an approval card (an `action` tool that is connected) first, then workers before heads, then an
  agent with every tool before one missing some, then templates in order, then seat order. With a bank
  connected that is the Bookkeeper; with nothing connected, the Lead finder. The card lists only the
  steps that can run and says which tools it starts without. With nothing ready, the card says so and
  links to Connections.
- **The offer** shows the agent, its job, the playbook steps, the cost (`docs/usage.md`) and what comes
  back. **Approve and start** (`startFirstJob`, owner only, Controls on) checks the pick again, then
  approves that agent's first playbook and Avery's with only the steps that can run (a step whose tool
  isn't connected would fail the run and put the agent on hold), puts those two on duty, turns on only their chains
  and the org switch, and starts the first run now through `withRun` (the daily budget applies). Every
  other agent stays off duty with its playbook waiting.
- **Running, then done**: the steps and a pulse while the run goes, then its summary, its cost and the
  approvals waiting, for a day. Avery's summary of the day comes at 7:00 in the business's time zone.
- **Your other departments**: each says what it waits on, or that it's ready once its playbook is
  approved on Crew. Departments Avery designed come first.

### A first try for a department Avery designed (card 194)

A designed department's agents are built with no playbook: a playbook step is a tool call with fixed
inputs, and a draft has only the tools and a sentence on each run, so code doesn't guess them. Their
first job is a **first try** instead: one real run that reads only, sends nothing, queues nothing and
saves no output for other agents (trigger `preview`, the builder's Try it), after which code drafts the
routine from the calls that worked (`afterRun`).

- **The pick**: `builtCandidates` finds the installed people of the sketch's designed departments by name
  (names are unique across the sketch). Those with no playbook yet can start when at least one of their
  tools needs nothing unconnected. They rank before every template's agent, since they answer the
  founder's own words: workers before heads, every tool connected first, then sketch order.
- **The tap** (`startFirstJob`): Avery's playbook is approved and she goes on duty as before. The
  designed agent stays **off duty** (card 188: no agent goes on duty without an approved playbook) and
  makes its try in the background (`startTry`). The setup state keeps the kind (`firstJob.kind: "try"`).
- **After the try** the card shows the routine that was drafted and **Review its routine**, which opens
  the agent's page, where Go live approves it. The founder then puts the agent on duty.

### The wrap-up (card 186)

Start this company saves `wrapUp: true` with `done` and `offer`, so /start keeps showing the last step
(`shownStage`) until **Go to your Desk** (`setupToDesk`). There is no Back: the departments are
installed. `wrapScreen` picks one screen:

- **Setup was on us** (credits): only on OPERATOR's Claude, while the paid layer would block a run for
  lack of credits (asked through `planBlock`, so core never reads `ee/`). The packs go to Stripe Checkout
  and come back to /start; **Use my own Claude key instead** shows the step 1 key form. The screen moves
  on by itself once credits land or a key is saved. The open edition and own key never see it.
- **Your first job**: the First job card with **Approve and start**, the same action as the Desk.
- **Your company is ready**: no agent is ready, so each department says what it waits on.
- **Your company is at work**: the run's progress (it refreshes while the run goes), then its result.

/start never calls `getFloor`: the wrap-up reads a small floor (`jobFloor`: agents, two days of runs,
approvals waiting, health).

Only a business that installed departments in setup is offered a first job (`offer` in the `setup`
policies row); one that started empty, or never went through setup, doesn't see the card.

Connecting is the same as on Connections: the same profiles, the vault, the owner check, and the
same refusals of a sign-in or key that carries more than the profile asks for.

## What agents read

`loadBusiness` adds the known facts to every agent's opening lines as background
(`factsLine`): "What the business has told us (background, never a claim about a product): ...".
Suggested facts are left out until confirmed. Product claims in outside messages still come only
from Shopify data (`docs/product-facts.md`).

## Code

- `core/setup-rules.ts`, `core/design-rules.ts` (pure, tested by `npm run check:setup`)
- `core/setup.ts` (state, facts, `askSetup`)
- `dashboard/setupActions.ts` (the actions, each checking the role again)
- `core/tools-step-rules.ts` (pure, tested by `npm run check:tools-step`), `dashboard/toolsStep.ts`
- `core/company-rules.ts` (pure, tested by `npm run check:setup`), `dashboard/company.ts`
- `core/first-job-rules.ts` (pure, tested by `npm run check:first-job`), `dashboard/firstJob.ts`, `dashboard/components/firstJob.tsx`, `startFirstJob` in `dashboard/actions.ts`
- `dashboard/components/setup.tsx` (the conversation, the panel, the store and unlisted-tool forms, the company chart), `app/start/page.tsx`
- `supabase/migrations/20261220090000_business_facts.sql`

**What it replaces.** The four steps stacked on one scrolling page, the step bar of anchor links and
the `#step-N` return addresses (card 181). The Desk's **Start your crew** card and its `installTemplate` action (card 151),
step 2's plain link to Connections (card 152), step 3's department checkboxes (`TemplatePicker`,
card 153), and "approve each playbook on Crew" as the only way to start the first agent (card 154).
The separate Your tools step, its question in the middle with boxes around it, `orderCategories`,
`currentCategory` and the Nothing yet action `setupPlanGuide` (card 195).

## Wording a founder reads (card 187)

Real runs (Controls) are on by default in the cloud edition, unless DASHBOARD_CONTROLS=off; self-host keeps them off until DASHBOARD_CONTROLS=on (decided Nov 20). When they are switched off (`controlsOn()` in `dashboard/session.ts`), every screen and reply says so
in app words: "Real runs are switched off on this OPERATOR. Whoever runs it can turn them on." The env
var's name stays in docs, comments and `dashboard/session.ts`; `check:wording` fails on any other mention
in `app/`, `dashboard/` or `ee/`.

## The business's own time zone (card 187)

Each business keeps a time zone (`timeZone` in its business settings, an IANA name checked by
`validTz` in `core/time.ts`). Setup's first message sends the browser's zone while none is set
(`setupTimeZone`); an owner changes it any time on Settings, at the top. A business that never set one
uses `DEFAULT_TZ` (Central). `orgTz()` in `core/tz.ts` reads it for the current business, and `Floor.tz`
carries it to screens and client components.

It decides: every time on screen (`dashboard/format.ts` helpers take the zone; `zoneLabel` names it
beside an exact time), chain start times and "not before" waits (`firingsBetween`, `nextFirings`,
`afterStep`), today's email cap and this month's spend (`startOf` in the gateway and department
budgets), calendar days for goals, plans, the brief, the books and the daily numbers, Shopify order
days, and the date an agent is told. Schedules are wall-clock times, so they show no zone name.
Daily agent budgets (`withRun`) still reset at midnight UTC. `check:time-zone` tests the zone math and
fails on any file outside `core/time.ts` that names Chicago or "CT".
