# First-run setup

What a new business sees before it has a crew (card 151, the first onboarding card in the product
definition). The Desk sends it to `/start` until setup is done. `/start` is one guided flow, one step
on screen at a time (card 181, the first slice of the white glove setup, epic card 180):

1. **Your business.** One card: "Let's build your company", a box for the business and one for the
   website. After the first message it becomes the conversation with the Chief of Staff, with what
   she has learned and the departments she is thinking of beside it.
2. **Your tools.** A tile per tool, each with click-by-click steps (card 152, below).
3. **Your company.** The org chart Avery proposes (card 153, below), or **Start empty**.
4. **First job.** What the Desk offers next (card 154), and credits on OPERATOR's Claude.

## One step at a time

The step is `stage` in the `setup` row of `policies` (`STAGES` in `core/setup-rules.ts`: business,
tools, company, first). `readStage` opens on the first step when the stored one is missing or not on
the list. **Back** and **Next** call `setupGo` (an approver; the step is checked against the list),
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

For these runs she has a setup directive (`setupDirective`) and only these tools:

| Tool | What it does |
| --- | --- |
| Save a fact | Hands code one fact: a topic from `FACT_TOPICS` and one short line (at most 160 characters, 8 per message, 40 in all) |
| Lean toward departments | Hands code one department template id from the list, as `strong` or `likely`, at most 4 |
| Read a web page | Only when the founder gave a site: Claude's own fetch, allowed on that one host, at most 2 pages |

The tools change nothing. Code saves what they hand it, and only after a run that finished:

- **Facts** go in `business_facts`. When the run read a web page, every fact it saves is
  `suggested` (`stateFor`). It waits on the panel for the founder to Confirm, Edit or Remove it.
  Facts from the conversation alone, and facts the founder types, are `known`.
- **Leaning** replaces the list in the `setup` row, after `readLeaning` checks each id against the
  department templates.
- The lines under her reply come from code and say what it actually saved.

The site address is checked like a custom server's (`checkAddress`: a public https host). The page
is untrusted data. It never chooses a recipient, URL, product or category, and the directive says so.

## Connect your tools

Step 2 asks one question per part of the company (card 182; the first version was a grid of tiles,
card 152). The parts are `TOOL_CATEGORIES` in `core/tools-step-rules.ts`: Store (Shopify), Website
(Google Analytics, our own read-only server, card 152b, `docs/mcp-everywhere.md`), Books (Mercury),
Email marketing (Klaviyo) and Inbox (Gmail). Each has its question, one line on what connecting it
gets the founder, and the line shown once it is connected. The tools themselves, their steps and what
each permission is for are still `TOOL_TILES`. When the Analytics sign-in sees more than one
property, the panel asks which one agents report on.

- **The question.** One on screen at a time, in the middle, with the five parts as boxes around it
  (under it on a phone): open, being asked, connected with the account's name, or left for later.
  Tapping a box goes to its question. Which one is on screen is worked out in code
  (`currentCategory`): the one asked for (`?q=`, or the tool in `?c=`), else the first still open.
- **The order.** Parts that a department Avery leans toward needs come first (`orderCategories`);
  the box says "Needed for Finance" from the tools' `needs` (`SHOPIFY_CONNECTED` and so on,
  `NEED_TILE`). Nobody types it.
- **Skip for now** is saved (`skipped` in the setup state, `setupSkipTool`), so the next question
  comes up and the box says Later. When every part is connected, planned or skipped, the card says so and Next
  reads "Show me my company".
- **The panel.** Numbered steps, then what each permission is for (from the profile's scopes,
  `SCOPE_WORDS`), then the Connect button or, for Shopify, the store's address and the read-only key.
  Gmail also offers the drafts sign-in once the read-only one is connected.
- **Back to setup.** Connect from here goes to `/connections/<id>/connect?from=start`. The route
  takes only `start` and keeps it in its own short-lived cookie; the callback returns to
  `/start?c=<the tool>` (the question that tool answers, on the saved step) only when that cookie says so. Anything else returns to Connections, so it can't
  become an open redirect.
- **Something else?** The founder types the tool's name and code routes it (`routeUnlisted`,
  `setupOtherTool`): a tile opens, a built-in opens on Connections, a known server opens Add a server
  with its address filled in. Anything else becomes a connection request (`askFor`) and the part is
  marked **Export for now** with the tool's name. No model call, and nothing is connected.
- **Nothing yet** (card 183). Website and Email marketing each have a starter tool (`starter` on the
  category: Google Analytics, Klaviyo). Tapping Nothing yet marks the part **Avery sets it up**
  (`setupPlanGuide`) and setup carries on. Nothing is created: no agent signs up for a service or
  accepts its terms. The founder creates the account from the steps on the Desk after setup.
- **Plans** are saved as `plans` in the setup state (`readPlans`: only real parts, a guide only where
  there is a starter, the tool's name checked as a service name). A connected tool wins over a plan,
  a plan over a skip (`categoryState`). Tapping a planned part shows what was chosen and **Change my
  answer** (`setupPlanClear`). The tool's name is the founder's typed text: it is shown, never used
  to choose a recipient, URL, product or category.
- **Left for later.** Step 3 shows the tools each department still waits on (`waitLine`), and for a
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
  department template Avery leans toward, strong or likely, each appearing a moment after the last
  (all at once with reduced motion). The model only named template ids in the conversation
  (`readLeaning`); it never writes the chart, a job, a tool or a number.
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
  against the chart (`readPick`: known department ids only, in template order) before
  `installTemplates`. **Change something** goes back to the tools questions. **Start empty instead**
  is a quiet link beside them.

Every agent still installs off duty with its playbook proposed, and every action stays at Draft.

### Avery's idea (card 185)

Once in setup, and only from what the founder said in the chat (a web page alone is never the reason),
Avery may suggest one department outside the template list with `suggest_department`: a name, a line on
why it fits, and up to four role titles. It is a report tool and builds nothing. Code checks it
(`readIdea` in `core/setup-rules.ts`): a name that starts with a letter, under 40 characters, a reason
under 200, no links or addresses, and never a department already on the list. It is kept in the setup
state as `idea` only after a run that finishes.

The reveal draws it beside the chart in a dashed box, "Avery's idea, from our chat", with **Build it with
Avery** and **Not now** (`setupIdeaWant`, owner only). It is never installed with the company. When the
founder kept it, the Desk shows "Next: your X department" after the first job has started (`ideaOffer`).
**Start with Avery** (`ideaStart`, audited) opens a department draft with the idea's name and purpose
(`seedDraft`, only when no draft is open), and Avery's chat walks the rest of the department interview as
usual: nothing is hired until the owner approves the proposal.

## First job

After **Start this company** (card 154; `core/first-job-rules.ts`, `dashboard/firstJob.ts`), the
Desk shows one **First job** card. The founder's call (Nov 19): agents start only after the founder
approves each first playbook, and this card makes that one tap for the first one.

- **The pick, in code** (`pickFirstJob`): an installed department agent, never the Chief of Staff, with
  a first playbook waiting and every tool it needs connected. Ranked: a job that ends in an approval
  card (an `action` tool) first, then templates in order, workers before heads, then seat order. With a
  bank connected that is the Bookkeeper. With nothing ready, the card says so and links to Connections.
- **The offer** shows the agent, its job, the playbook steps, the cost (`docs/usage.md`) and what comes
  back. **Approve and start** (`startFirstJob`, owner only, Controls on) checks the pick again, then
  approves that agent's first playbook and Avery's, puts those two on duty, turns on only their chains
  and the org switch, and starts the first run now through `withRun` (the daily budget applies). Every
  other agent stays off duty with its playbook waiting.
- **Running, then done**: the steps and a pulse while the run goes, then its summary, its cost and the
  approvals waiting, for a day. Avery's summary of the day comes at 7:00 CT.
- **Your other departments**: each says what it waits on, or that it's ready once its playbook is
  approved on Crew.

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

- `core/setup-rules.ts` (pure, tested by `npm run check:setup`)
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
