# First-run setup

What a new business sees before it has a crew (card 151, the first onboarding card in the product
definition). The Desk sends it to `/start` until setup is done. `/start` has four steps:

1. **Tell Avery about your business.** A conversation with the Chief of Staff, plus a panel of what
   she has learned so far.
2. **Connect your tools.** A tile per tool, each with click-by-click steps (card 152, below).
3. **Your company.** The org chart Avery proposes (card 153, below), or **Start empty**.
4. **Meet your crew.** A placeholder until card 153.

## Who goes to setup

`needsSetup` (`core/setup-rules.ts`) says yes only for a business that has not finished setup and
has no departments and no agents but the Chief of Staff that setup installed. A business with a crew,
or with an agent the owner built, never goes. Setup ends when the owner starts the company
(`setupInstall`) or taps Start empty (`setupStartEmpty`); both set `done` in the `setup` row of
`policies`.

## How Avery thinks (card 162)

Before the conversation opens, step 1 asks how agents think. The cloud edition offers two options,
OPERATOR's Claude first:

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

Step 2 (card 152) has a tile for Shopify, Mercury, Klaviyo, Gmail and Google Analytics (our own
read-only server, card 152b, `docs/mcp-everywhere.md`). The tiles, their steps and what each
permission is for are in `core/tools-step-rules.ts`. When the Analytics sign-in sees more than one
property, the panel asks which one agents report on.

- **Needed for.** A tile is marked "Needed for Finance" when a department Avery leans toward has a
  tool whose `needs` names it (`SHOPIFY_CONNECTED` and so on, `NEED_TILE`). Nobody types it.
- **The panel.** Numbered steps, then what each permission is for (from the profile's scopes,
  `SCOPE_WORDS`), then the Connect button or, for Shopify, the store's address and the read-only key.
  Gmail also offers the drafts sign-in once the read-only one is connected.
- **Back to setup.** Connect from here goes to `/connections/<id>/connect?from=start`. The route
  takes only `start` and keeps it in its own short-lived cookie; the callback returns to
  `/start#step-2` only when that cookie says so. Anything else returns to Connections, so it can't
  become an open redirect.
- **A tool that isn't listed?** The founder types its name and code routes it (`routeUnlisted`): a
  tile opens, a built-in opens on Connections, a known server opens Add a server with its address
  filled in, and anything else becomes a connection request (`askFor`). No model call, and nothing is
  connected.
- **Skip for now.** Step 3 shows the tools each department still waits on. It installs anyway and
  starts working once they're connected.

## Your company

Step 3 (card 153) is an org chart drawn in code (`core/company-rules.ts`, `dashboard/company.ts`):

- **The founder** at the top, then the Chief of Staff in the company seat, then a branch per
  department template Avery leans toward, strong or likely. The model only named template ids in the
  conversation (`readLeaning`); it never writes the chart, a job, a tool or a number.
- **Each agent** shows its name and role, its job (the template's mandate), the tools it uses (labels
  from the tool list) and what it adds to the month (`docs/usage.md`, "What an agent costs"): an
  estimate on the template's schedule, with "at most" from its cap. Open seats show by title, with no
  cost. A department that waits on a tool says so.
- **The total** under the chart: agents, about how much a month once on duty, at most how much, and
  who pays.
- **Leave out** takes a department off the chart; **Also available** lists the rest, each with
  **Add**.
- **Start this company** installs exactly what's on the chart: `setupInstall` checks the picks
  against the chart (`readPick`: known department ids only, in template order) before
  `installTemplates`. **Change something** goes back to the conversation, where her new leaning
  redraws the chart.

Every agent still installs off duty with its playbook proposed, and every action stays at Draft.

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

**What it replaces.** The Desk's **Start your crew** card and its `installTemplate` action (card 151),
step 2's plain link to Connections (card 152), step 3's department checkboxes (`TemplatePicker`,
card 153), and "approve each playbook on Crew" as the only way to start the first agent (card 154).
