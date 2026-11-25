# Agent setup

> **Nov 13, builder flow slice 2:** the Setup tab, its canvas and its four editors are gone (docs/builder-flow.md). Each of the four agents keeps its last saved setup until it goes live on the runner; its saved spec is edited in the builder flow, and the money and email caps on Settings. What follows is kept as history.
>
> **Nov 13, builder flow slice 6:** the setup store is retired too: every agent runs its live version on the shared engine, and `core/setup.ts`, the menus and `agent_setup` are gone.

Design (approved by the owner 2026-11-12): https://claude.ai/artifact/WvLXFtHnHbd2J94j6vQhmb.
Epic on the Build Board: "EPIC: Customizable agents (Agent Setup + canvas editor)".

The goal: every phase of an agent's loop (Trigger, Reads, Memory, Thinking, Guardrails, Writes)
is visible and, slice by slice, editable in the Control Room, instead of being spread over code
constants, prompt files, `vercel.json`, env vars and `policies`.

## Three homes for every setting

| Home | What lives there | How it changes |
| --- | --- | --- |
| App | A choice among things already built: model, tuning numbers, instructions (later: fact sources, outputs, schedule) | The Control Room, saved as a versioned setup |
| Code | The hard rules, ceilings, and anything that gives an agent a new ability (an integration, a fact source, an output, a gateway action type) | A reviewed pull request |
| Vercel | Keys and tokens | Vercel settings. The app shows Connected or Missing key, never a value |

A fourth label, Database, marks a value that is a row in Supabase but has no screen yet
(for example `policies.memory_budget_tokens`).

## Menu and setup

- **Menu** (`agents/<folder>/menu.ts`, listed in `agents/menus.ts`): what the agent is able to do.
  Its thinking step and the models that step may use, its fact sources, its outputs, every tuning
  number with a default, lowest and highest value, and the built-in instructions.
- **Setup** (table `agent_setup`): what the owner picked from the menu. One row per version, one active
  per agent, with a note. `agent_runs.setup_version` records which version a run used
  (null = the menu's built-in defaults).

`core/setup.ts` lays the active row over the menu's defaults (`resolveSetup`, pure code):

- A value the menu doesn't offer (a model not on the step's list, a number outside its range, a
  key the agent doesn't have) is ignored, the default is used, and the run summary and the canvas
  say so. Nothing is clamped into a value the owner didn't pick.
- A setup that can't be read (table missing, Supabase down) never stops a run: the agent runs on
  the menu's defaults and the summary says so.
- `withRun` loads the setup for real runs, next to memory, and passes it to the job. A dry run
  loads its own and reports it in its summary.

## Rules

- A setup can only pick from the menu. It can't add an integration, a fact source, an output or a
  gateway action type.
- A setup is choices, never authority. `core/gateway` and `integrations/` may not import
  `core/setup` (lint enforces it), the same way they may not import memory.
- Only models with a price in `integrations/anthropic.ts` may be listed in a menu, so cost is
  always computed in code. An agent refuses to run on a model (or fallback model) without a price
  before it reads or sends anything.
- The safety block is locked. It lives in the agent's code (`core/runner.ts`,
  `SAFETY`), is sent first on every model call, and a setup can only replace the instructions
  after it. The canvas shows it so nothing is hidden.
- Loosening means a costlier model, a costlier fallback or more effort. Saving or rolling back to
  a costlier setup needs a confirm and `DASHBOARD_CONTROLS=on`; the server checks both
  (`loosening` in `core/setup.ts`). Cheaper changes and instruction edits need only the login.
- The Guardrails box lists only what code enforces. Instructions and standing orders are guidance
  the model reads, so they sit in Thinking and Memory.
- Trust levels (Draft, Act with undo, Act) are not a setting. They move only through the
  promotion card.

## The agent canvas

`/agents/<id>?tab=setup`. Built on React Flow (`@xyflow/react`), in
`dashboard/components/AgentCanvas.tsx`; `dashboard/canvas.ts` builds its data on the server.

- **Replay** shows what the latest real run did, like the Live floor.
- **Edit** shows the setup box by box. Clicking a box lists every value behind it, its home
  (App, Code, Vercel, Database), where to change it, and Connected or Missing key for anything
  that needs a key. Boxes marked Edit open an editor; the rest are read-only for now.

## Editing Thinking (slice 2)

`dashboard/components/ThinkingEditor.tsx`, data from `getThinkingEditor` in `dashboard/data.ts`,
actions `previewSetup`, `saveSetupVersion` and `rollBackSetup` in `dashboard/actions.ts`.

- Model, effort and fallback model come from the menu's list; instructions are free text up to
  6,000 characters under the locked safety block.
- The fallback model is tried once when the main model can't be reached (an API error), before
  the fixed rules. A refusal is handled separately by the Claude API's own server-side fallback.
- Cost per run, now and with the draft: the price table times the average tokens of the last 10
  real runs that called a model.
- A change is a draft (kept in this browser) until it is saved as a new version with a note.
  Saving switches the old version off and the new one on. Roll back makes an older version
  active again; nothing is deleted.
- Preview runs the draft for real on today's facts and memory and shows the email, the Briefs
  row, the watch list, the focus and what it would remember. It writes nothing: no Notion, no
  email, no memory written or counted down. Its one model call is logged with trigger `preview`
  so the cost counts against the daily budget. Previews stay out of the floor, the run log,
  Replay and Avery's own "What ran". A preview may run while the agent is off duty (it acts on
  nothing) and needs `DASHBOARD_CONTROLS=on` because it spends money.
- On a phone the boxes stack, like the Live floor.
- Every built agent has a menu since slice 7. An agent added later without one still gets the
  canvas, with its values reading Code.

Mission control's Live floor and the run replay page still use `RunCanvas.tsx`. They move to the
new canvas with the crew canvas (slice 5), so both views change once.

## Models across providers

`integrations/models.ts` is the one list of models: id, label, provider, price per million
tokens in and out, and abilities (`structured-output`, `anthropic-web-search`, `pdf`,
`reasoning`). Cost is always the token counts times this table, in code
(`costUsd` in `integrations/anthropic.ts`). A model that isn't in the list can't be picked, and a
stored id that falls off the list is ignored like any other invalid setup value.

- Each menu step says what it `requires`; its picker lists only models with those abilities
  (`modelsFor`).
- A run reaches its model through one interface, `integrations/llm.ts`: `modelClient(model)` picks
  the client by provider, and each turn comes back as the reply plus its token counts (in, out,
  cache writes, cache reads, web searches). The transcript keeps the Claude Messages shape, which
  holds everything other providers return, so a client for another provider translates at its own
  edge and `core/runner.ts` doesn't change.
- Claude runs on the business's own key or OPERATOR credits (Connections > Claude API). The Claude
  client keeps prompt caching, effort, the server-side refusal fallback and Anthropic's web tools.
  Any listed model is valid in a spec (`specModelOk`, `core/agent-spec.ts`); one on another provider
  can be saved only while that provider's key is saved and not paused (`modelReady`, checked on save in
  `dashboard/actions.ts`), and every turn checks the key again, so removing a key later stops the run
  with a line naming Connections > Other models.
- Builder picker (slice 4): Thinking > Advanced lists every model grouped by provider, with prices.
  A provider without a key shows its models greyed with "add a key on Connections > Other models".
  The Quick, Balanced and Deep presets stay on Claude, and so do the agents Avery proposes. Under the
  picker a line says who bills the run, that the agent's job, facts and memory go to that provider,
  and that web search and fetch run only on Claude.
- Other providers (decided 2026-11-23): first each business's own key per provider, sealed in the
  vault and called directly; later OPERATOR credits through Vercel AI Gateway. Gateway keys are set
  per Vercel team, not per request, so a business's own key can't go through it.
- Provider keys (slice 2): Connections > Other models takes an owner's key for OpenAI, xAI or Google
  (`core/model-key-rules.ts`). It is shape-checked, then checked with one read-only list-models call
  that never follows a redirect, sealed with the org's data key on its own `mcp_connections` row
  (`openai_key`, `xai_key`, `google_ai_key`), and never shown again. `modelKey()` opens one, and only
  `integrations/llm.ts` may call it (`check:mcp`). A provider key carries no scopes, so the runner and
  the gateway stay the limit, as on Claude.
- Other providers' turns (slice 3): `providerClient` in `integrations/llm.ts` opens the business's key
  for one request and sends the turn to that provider only (`turns` in `core/model-key-rules.ts`):
  OpenAI and xAI on the Responses API (function tools on current OpenAI models work only there),
  Google on its OpenAI-compatible chat completions. `core/llm-wire.ts` translates both ways, pure and
  tested: thinking blocks, cache markers and server tools are dropped, tool calls and results are
  paired by id, and nothing is stored at the provider (`store: false`). Requests never follow a
  redirect, errors never carry the key, and a 401 or 403 pauses the key until the owner pastes a new
  one. The runner never offers Claude's web search or fetch to these models. Their cached input has
  its own price (`cacheIn`), and writing the cache costs nothing extra. Models listed 2026-11-23, at
  each provider's own page: GPT-6.2 Sol, Grok 4.7, Grok 4.3, Gemini 3.1 Pro (preview) and Gemini 3.1
  Flash-Lite. Models whose price couldn't be read on the provider's page that day are left off.
- The run summary names the model that wrote the result, and the run replay splits cost by the
  model whose price matches the logged cost.
- Changing a price or adding a model is a pull request; read the provider's price page that day.


### Through the AI Gateway (conductor ticket 1b, built 2026-11-25)

With the business's AI Gateway key saved (Connections > AI Gateway), every Claude turn goes to the gateway's
Anthropic-compatible Messages endpoint (`https://ai-gateway.vercel.sh/v1/messages`, Bearer key, no redirects), with
the model named the gateway's way (`gatewayClaudeId`: `claude-sonnet-5-5` is `anthropic/claude-sonnet-5.5`). Prompt
caching and effort are sent; the Anthropic-only refusal fallback beta is not. Vercel bills it at Anthropic's price,
so the run's billing is the business's own key, never credits (`billingNow`). If the gateway can't run a turn, the
turn is sent again on the business's own Claude key when it has one, never on credits; a refused gateway key is
paused; a used-up budget (402) stops the run. Without a gateway key nothing changes. Other makers' text models
listed with provider `gateway` (`openai/gpt-6.2-sol` and others) run on chat completions through the same key and
show under "Other makers (AI Gateway)" in the Runs on picker. Other server-side Claude calls (setup interview, books
sync) still use `claude()`: the business's own key or credits.

**Claude runs on (built 2026-11-25).** With both keys saved, Connections > Claude shows a "Claude runs on" choice:
AI Gateway (to start with) or My own Claude key, saved per business in `policies` under `claude_via`
(`core/claude-via.ts`, read on each gateway Claude turn; only an owner changes it, through `claudeSetVia`, audited).
With the own key picked, a turn goes straight to Anthropic (refusal fallback included); if it fails, the gateway is
tried once, with its own budget and refused-key handling; if both fail the run stops. A forgotten or paused own key
means the gateway, and without a gateway key the choice doesn't apply. Neither path ever uses credits. Pictures and
other makers' models always go through the gateway.

## Reads and Writes (slice 4)

`dashboard/components/ReadsWritesEditor.tsx`; the shared draft, Preview, save and versions are in
`dashboard/components/setupEditor.tsx`. One draft covers every box: changes in Reads, Thinking
and Writes are saved together as one version.

- Reads: each fact source in the menu on or off, plus the reads tuning numbers within their range
  (Avery: low-green warning, green use window, snapshot history). A source that is off is not
  read at all; its values are empty and the model is told it was turned off, so it never treats
  it as zero.
- Writes: each output on or off (never all of them), the Notion target, and the sections of the
  brief, on or off and in order. The email and the Notion copy use the same sections. A section
  whose fact source is off is left out (Numbers needs Yesterday's numbers, What ran needs Other
  agents' runs). Today's focus is always on.
- Notion target: picked from pages and databases the Notion integration can see (`notionSearch`
  in `integrations/notion.ts`), so the app can't widen access. A database must have every column
  the Briefs row writes (`menu.notion.dbProps`); a page gets one new page per day under it. The
  server opens the target again on save. With no target picked, the briefs database, then the
  briefs page on Settings > Where things go, still work, so nothing changes until the owner picks one.
- The email recipient is never a choice: `integrations/email.ts` has no recipient argument and
  sends to the business's owner email (Settings).
- Gateway action types show read only in Writes, with their tier. Avery has none.
- Looser, so a confirm and `DASHBOARD_CONTROLS=on`: an output turned back on, or a different
  Notion target, as well as the slice 2 cost rules. Turning things off never needs either.
- Avery's default section order is now the email's (focus, waiting, numbers, watch, what ran)
  for the Notion copy too.

## Crew canvas: triggers and chains (slice 5)

`app/(room)/crew` (Crew canvas in the sidebar), `dashboard/components/CrewCanvas.tsx`. The rules
are in `core/flow-rules.ts` (no database, so the browser checks a draft too), the store in
`core/flow.ts` (table `crew_flow`, versioned like `agent_setup`), running in `core/chain.ts`, the
dispatcher in `app/api/dispatch`. Migration `20261112200000_crew_flow.sql`.

- A flow is up to 30 chains. A chain has a name, an on switch, an owner, one start and one to eight steps, each an agent or an Ask a model step (docs/chains.md).
- Starts: a schedule (every day, weekdays or Mondays, in the business's time zone, on a quarter hour), the Run chain
  button, or an approval being decided (approve, reject or either; at most once a minute per chain).
- Each step after the first can: run after the step before worked, failed, or either way; only go
  on if a number the step before computed in code passes a check (Rowan: new leads, drafts; Quinn:
  changes proposed, receipts still missing; Morgan: orders yesterday); only run on weekdays or Mondays; wait
  until a time ("not before 6:45"); and read the step before's summary and numbers as facts
  (Avery only, so far). The hand-off is labelled as another agent's words, not instructions.
- One Vercel Schedule, `dispatch`, every 15 minutes. It starts the chains whose time came in the
  last hour (each firing once, `chain_fires`) and kicks the steps that are due: each step is a job
  (`jobs`, docs/tenancy.md slice 3), and a waiting step is a job due at its time.
  With every chain off it does nothing. The old `cfo` and `chief-of-staff` schedules are gone:
  version 1 of the flow is the Morning chain (Morgan at 5:30, then Avery on weekdays not before
  6:45, either way, with the hand-off), saved **off**.
- Each step is a job run by its own worker request (`/api/jobs/<id>`), so it gets its own time
  limit and goes through `withRun` (on duty, daily budget, setup, memory). The job only names a
  chain and a step; the worker reads the saved flow for the agent, so nothing outside the flow (an
  email, a web page, a run's output) can choose what runs next.
- A skipped step (agent off duty or over budget) stops the chain. A chain never turns an agent on.
- Rowan and Quinn run only by hand, so they can only be in a chain started with Run chain.
- No loops: an agent appears once per chain.
- Looser, so a confirm and `DASHBOARD_CONTROLS=on`: a chain that starts running on its own
  (turned on, or new and on), or an on chain that gains an agent or changes its start. Turning a
  chain off or dropping a step needs neither. Run chain is a real run, so it needs the controls.
- Preview chain dry-runs each step on real data in order (no writes, no model, no cost, nothing
  logged) and says what the chain would do next. A dry run reports no numbers, so checks show as
  not tested.
- Cost: each agent's average over its last real runs; per chain run, and per month for a
  scheduled chain that is on (30 runs daily, 22 weekdays, 4 Mondays).
- Replay: a chain run's page shows every step of that chain run, its status and cost, and the
  total. `agent_runs` gains `chain_id`, `chain_key`, `chain_step`, `parent_run_id` and `metrics`.

## Guardrails box and caps (slice 6)

`dashboard/components/GuardrailsEditor.tsx`, built by `dashboard/guardrails.ts`; shown when the
Guardrails box is clicked in Edit on the Setup tab, for every built agent. Three bands, every
line tagged "Enforced in code":

- Crew hard rules, locked (`HARD_RULES` in `dashboard/crew.ts`, from CLAUDE.md).
- Limits for this agent: the daily budget (adjustable; lowering any time, raising needs
  `DASHBOARD_CONTROLS=on`; $50 ceiling in code) and the limits code holds for that agent (Rowan's
  leads, searches, page reads and turns; Quinn's Gmail searches, PDF size and look-back; the
  gateway's writes per apply, memo length and approval expiry; Avery's watch list, instructions
  length and fixed recipient). Each line names the file or `policies` row that enforces it.
  Since slice 7 Rowan's and Quinn's numbers are setup choices at or under these limits.
- Money and email caps, crew-wide (`policies`): per purchase, per calendar month, emails per day,
  undo window. Lowering applies right away (the undo window is the other way round: shorter is
  looser). Loosening needs a confirm and `DASHBOARD_CONTROLS=on`, and stops at the limit in code
  (`CAPS` in `core/gateway/policy.ts`, today equal to the owner's starting values: $500, $1,500, 20,
  30 minutes). Every change is a row in `policy_log`. `effectiveCap` holds a row inside the code
  limit, so editing the table directly can't pass it either.
- Instructions and standing orders never appear here, and trust levels aren't editable.

The caps themselves come from the Build Board card "Gateway: spending caps, email cap and vendors
list", built in the same pull request: migration `20261112230000_caps_and_vendors.sql`
(the four policies, `vendors`, `email_suppressions`, `policy_log`), `checkPurchase` and
`checkEmail` in `policy.ts`, loaders in `core/gateway/index.ts` (`loadCaps`, `monthSpentUsd`,
`emailsSentToday`, `paidVendorIds`, `onBreach`), and Settings showing the caps with usage, the
vendors list (add needs `DASHBOARD_CONTROLS=on`) and addresses that get no email.
`npm run check:policy` runs the checks against a table of cases.

## Menus for Rowan, Quinn and Morgan (slice 7)

`agents/<id>/menu.ts` for each, registered in `agents/menus.ts`; migration
`20261113090000_setup_rowan_quinn_morgan.sql` seeds v1 for each with the values it already ran
with, so nothing changes until the owner saves a v2. Every number's highest value is today's limit in
code, so a setup can make a run smaller and cheaper, never bigger.

- Rowan (`wholesale_hunter`): one step, Claude only (Anthropic's web tools), no fallback in
  code; effort; editable instructions after a locked safety block (the prompt is now split into
  `SAFETY` and `SOP`, and SOP holds no numbers or lists); web searches, pages read and model
  turns (Thinking); areas and kinds of business, picked from fixed lists in code (Reads and
  Thinking), so a web page can't add one; leads per run, Gmail drafts on or off, and the Notion
  page the run's page goes under (Writes). Offer facts, the pipeline and web search are locked on,
  and so is the `wholesale_leads` output.
- Quinn (`bookkeeper`): two steps, each with its own Claude model and effort (read a receipt,
  needs PDF; suggest categories), no fallback; the instructions stay in code
  (`instructionsLocked`) because both are short prompts whose answers code checks. Look-back
  days, Gmail searches per run and per charge, and receipt search in Gmail on or off (Reads);
  the Notion page (Writes). Mercury, `expense_docs` and approval cards are locked on. Cost is
  added up per call, since the two steps can use different models.
- Morgan (`cfo`): no steps (`Setup.model` is `none`), every read and the snapshot output locked.
  The menu exists so the canvas shows the same boxes with each part marked as fixed in code.
- Notion for Rowan and Quinn is `pageOnly`: the picker lists only pages, and a database is
  refused. With no page picked they use `NOTION_LEADS_PARENT_ID` / `NOTION_BOOKS_PARENT_ID`.
- Preview for agents without a model preview is "Dry run with this draft": the free dry run
  with the draft setup (real reads, no model, nothing written, not logged), so it needs no
  `DASHBOARD_CONTROLS`. Avery keeps the one-call preview.
- `core/setup.ts` gained what these menus need: extra steps in `Setup.more`, pick-lists in
  `Setup.choices`, `fallbackOff`, `instructionsLocked`, locked parts and `pageOnly`. Loosening
  also checks each extra step's model and effort.

## Slices

1. Setup store and the read-only canvas. Avery reads its model, effort,
   instructions and low-green warning from its setup; version 1 holds the values it already had.
2. Edit mode: Thinking for Avery (model, effort, instructions with a locked safety block,
   preview, versions, roll back).
3. Model choice across providers (one model interface; only Claude is connected so far).
4. Reads and Writes editable for Avery (sources, outputs, Notion target, sections).
5. Crew canvas: triggers and chains.
6. Guardrails box and caps.
7. Menus for Rowan, Quinn and Morgan (built).
