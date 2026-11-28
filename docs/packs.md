# Packs

A pack is a department or one agent as **data**, a JSON file in `packs/`, that a business installs
instead of building every agent by hand. There is no pack code: a pack can't add tools, Shopify reads,
measures, widgets or tables. Every ability comes from core, so a pack can only make an agent smaller,
never give it something new, and it can never grant an action.

Since card 501 (decided 2026-11-28; the Packs epic is card 500). Department templates became department
packs. Before card 134, a "template pack" was TypeScript compiled into the app (tools, tables, measures,
planned agents and a whole business's crew); that mechanism is gone, and `check:packs` keeps it gone.

## The file

Every pack starts with the same head:

| Field | What it holds |
| --- | --- |
| `id` | 2 to 31 lowercase letters, digits or dashes; the file's name |
| `kind` | `department` or `agent` |
| `version` | A whole number from 1. A higher one is offered to what was installed from a lower one, never applied by itself (card 503) |
| `name`, `about` | At most 60 and 200 characters |
| `author` | Who made it: a person's or group's name, never a business's |
| `license` | An SPDX id. Built-in packs are `AGPL-3.0-only` |
| `needs_operator` | The oldest OPERATOR version it works with (`package.json`'s version, `core/version.ts`). A pack that needs a newer one is refused with that reason, never half-installed |

A file is at most 200 KB. `packProblems` (`core/pack-rules.ts`) checks the head and each kind's shape.

**Department packs** then hold `departments`, `agents`, `specs`, `playbooks`, `seats`, `chains` and `goals`,
the same lists department templates had, and a department may lay out its Overview (below). `crewProblems`
(`core/install-rules.ts`) checks the contents.

**Agent packs** hold one agent for one seat: `seat` (title, line and words that match an open seat's title),
`agent` (name, role, model, icon, colour, daily budget), `spec`, `playbook`, `starts` (null for by hand, or
days and a 24 hour time) and `suggests` (at most 4 actions an approver may give it, shown as Can do toggles
that start off). `agentPackProblems` checks the contents. The built-in one is `conversion-analyst.json`, for the
store analytics department's Site and conversion seat.

What every pack is held to, whichever kind:

- the spec passes `readSpec` with no problems and only names core's tools;
- no action an approver grants is in a spec: an agent pack lists it in `suggests`, a department pack leaves it out;
- no Notion pages, report page, custom server tool, or another agent's output from outside the pack: those are one
  business's own, picked after install;
- a daily budget over $0 and at most `BUDGET_CEILING` ($50);
- no business's name and no one trade's words (`check:packs` reuses `scripts/lib/brand.mjs`).

## The starting set

| File | Department | Agents | Routine | Goal |
| --- | --- | --- | --- | --- |
| `finance.json` | Finance | CFO (head), Bookkeeper | Morning numbers, books on weekdays | Months of runway |
| `chief-of-staff.json` | (company seat) | Chief of Staff | The morning brief, after the numbers | |
| `prospecting.json` | Prospecting | Head of prospecting, Lead finder (by hand) | | Accounts won |
| `email-marketing.json` | Email marketing | Head of email marketing (Klaviyo reads), Campaign writer (by hand), open seats | | Email list size |
| `store-analytics.json` | Store analytics | Head of store analytics, an open Site and conversion seat | Week in numbers, Mondays | Revenue this month |

These are the first-version departments in the product definition (card 159): finance, prospecting,
email marketing and store analytics, for any store.

- **Store analytics.** The head reads **Week over week** (`weekly_numbers`): the last 7 full days
  against the 7 before, from the saved daily numbers and, when Google Analytics is connected, its visits
  by day, with every change worked out in code (`core/weekly-numbers-rules.ts`, `check:weekly-numbers`).
  Missing days or no Google Analytics are said, never guessed. Then Site visits, Where visits come from
  and Top pages explain the move.
- **Campaign writer.** Drafts one campaign a run (audience from the business's own Klaviyo lists,
  subject, preview text, body under 150 words) that claims only what Product facts says. It stages the
  campaign with Draft a Klaviyo campaign (`klaviyo_campaign_draft`, card 159b): the list is a pick code
  from Email lists, never typed by the model. An approver sees the exact list, subject, preview text and
  body on an approval card; approving makes a draft in Klaviyo, and the owner sends it from there.
- **Prospecting.** No one trade's words in core (`check:business` fails on them); tool ids like
  `wholesale_leads_recent` and the `wholesale_won` measure key stay, because stored setups and goals name them. First-run setup (`docs/setup.md`) offers them on
step 3 as the company Avery proposes from her interview (card 153): the departments she leans toward are on the chart, the rest under Also available.

## The Overview

Since packs slice 2 (card 502). A department pack may lay out its department's Overview: an `overview` list on the
department entry, rows of 1 to 3 widgets from core's catalog, each with a `span` of the 3 columns (on a phone every
widget is full width, in the same order). A department with no layout keeps the default Overview, exactly as before.

```json
"overview": [
  [{ "w": "needs", "span": 3 }],
  [{ "w": "report", "span": 2 }, { "w": "measure_tile", "measure": "revenue_month" }],
  [{ "w": "series_chart", "field": "revenue", "days": 30, "span": 2 },
   { "w": "run_metric", "agent": "analytics_head", "key": "now_sessions", "label": "Sessions, last 7 days" }]
]
```

The catalog (`core/widget-rules.ts`, `WIDGETS`) is fixed: a pack arranges what core draws, it can't add a widget,
a query or any markup. The default Overview's own widgets are there (`needs`, `report`, `week_tile`, `waiting_tile`,
`spend_tile`, `goal_tile`, `runs_chart`, `drafts`, `spend`, `goal_chart`, `agents`, `chains`), each at most once, and
three take settings:

| Widget | Shows | Settings |
| --- | --- | --- |
| `measure_tile` | A goal measure: revenue or orders this month from the saved daily numbers, against the same days last month; any other from its goal's saved daily readings, against a week before | `measure` (a core measure), `label` |
| `series_chart` | Revenue, orders or cash per day from the saved daily numbers; a day with nothing saved is a gap, never 0 | `field`, `days` (14, 30 or 90) |
| `run_metric` | A number an agent's tools returned on its runs (`agent_runs.metrics`), its change since the run before and a line over its last 7 runs | `agent` (one seated in the department), `key`, `label`, `unit` (count, usd, pct, rate) |

`layoutProblems` checks a layout at install (inside `crewProblems`) and again whenever the page reads one
(`readLayout`): a layout that fails shows the default Overview. Install saves it on `departments.overview`, and the
pack it came from on `departments.pack` (`store-analytics@1`), which the department's header shows.

It stays fast (`docs/speed.md`): the page reads the layout in the same round as the spend, and reads only what the
widgets on it show (`widgetNeeds`). The new widgets read saved rows only, never Shopify, Google or another live
service, each read once per request (`dashboard/widgets.ts`), and each streams into its own frame with a skeleton.
`check:widgets` holds all of it.

Changing a layout from the page comes with card 505.

## Installing

Step 3 of first-run setup (`/start`) shows the departments on the company chart; the owner leaves
some out or adds others and taps Start this company. `core/install.ts` (`installPacks`) installs department packs only into an org with no
agents, departments or seats yet, or one holding only the Chief of Staff that setup installed: then
her rows stay (`ontoSetup`) and the merged chains go in as the next crew flow version. The picked packs merge (`core/pack-rules.ts`, `mergePacks`):

- lists are joined in the order `core/packs.ts` lists the files;
- a chain whose key another picked pack used gets that pack's steps added, so the morning
  brief runs after the numbers when both are picked;
- a step for an agent that isn't being installed is dropped, and a chain left empty goes.

Then `core/install-rules.ts` checks the whole crew (`crewProblems`) and writes it switched off:
every agent off duty, every chain off, every playbook proposed for the owner's approval, goals with
no due date. Policies aren't installed: every cap starts at its default in code. Each spec, playbook and
chain version says which packs it came from (`created_by` `pack:<ids>`).

### Into a business that already runs

Decided 2026-11-28 (packs slice 3, approved mockup). Only the owner installs, and everything a pack adds starts
switched off, as at setup.

- **A department pack.** The sidebar's and Company page's Add a department opens a sheet (`/?add=dept`): Avery's
  interview first, then each built-in department pack but the Chief of Staff, its card saying what it adds and which
  connections it reads, checked against the business's (`core/pack-card-rules.ts`). A connection the pack's
  first playbook steps need is "not connected" when missing, any other is "optional". Next shows what it adds; Add
  installs it (`dashboard/packActions.ts` `installDeptPack`, `core/pack-install.ts` `installDepartmentPack`).
- **New ids.** A pack's ids are names inside the file (`core/pack-install-rules.ts` `livePlan`). A department whose
  id or name is taken gets the same number on both ("store_analytics_2", "Store analytics 2"), so installing a pack
  twice gives two departments. An agent keeps the pack's id when it's free, else gets a builder id from its name
  (`b_iris`). The gateway names some actions' agents by id (the bookkeeper and CFO, the lead finder), so a second
  install of a pack with one of those is refused before anything is written. Chain keys get a number. Seats, specs,
  playbooks, chain steps and owners, goals and the Overview's agent numbers all follow the new ids, and the whole
  crew passes `crewProblems` again.
- **The writes.** Departments, agents (tagged `pack` `id@version`, migration
  `20270115090000_agent_pack.sql`; before it, installs leave the tag out), specs, proposed playbooks, seats and goals,
  then the pack's chains, off, added to the active flow as its next version. If any write fails, everything written
  so far is deleted again, so a half-installed department can't exist.
- **After.** The owner lands on the new department, whose Overview shows what's left to turn it on: approve each
  playbook, try each agent and put it on duty, turn on each chain, each a link to the screen that does it. It is
  worked out from the rows on every visit (`packSetup`), never stored, and goes away once all are done.
- **An agent pack.** On a department's Agents tab, an open seat whose title or line holds one of an agent pack's
  `seat.matches` words shows Fill from a pack to the owner (`?fill=<seat>`). The sheet lists the packs that fit; the
  pack's `suggests` are Can do toggles that start off. Add puts the agent in that seat off duty with its spec as
  version 1 and its playbook proposed, with only the actions the owner turned on and the pack suggests
  (`seatPlan`, as a hire card does), and its `starts` as its own chain, off (`seatFlow`).

### A newer version, and Claude

Decided 2026-11-28 (packs slice 3b, mockup screen 5). When the pack on file is newer than the version a department
came from, its settings sheet offers it with what changed, worked out in code (`core/pack-update-rules.ts`
`packUpdate`). Each agent is matched to the pack's agent by its first spec's name. Save as drafts (owner only,
`savePackDrafts`) saves each changed spec as a draft version: Try it and Go live as for any change, and a spec the
owner edited is never replaced, only joined by the draft. What belongs to the business stays: the agent's name,
granted actions and custom tools, Notion pages, report page and whose results it reads. The Overview layout changes
on save. Chains, goals and seats never change in an update, and an agent new in the version isn't added.

The OPERATOR connector's `list_packs` lists the built-in packs with links into the install sheets above (a department
pack's link opens its confirm step); nothing installs from Claude.

`check:pack-install` holds all of it.

`npm run org:new -- --slug … --name … --owner … --packs finance,prospecting` does the same from the
command line.

## Adding a pack

A pull request with `packs/<id>.json` and a line in `core/packs.ts`. `check:packs` requires:

- JSON only in `packs/`, each file listed in `core/packs.ts`, and nothing else reads it;
- the shape (`packProblems`) and the contents (`crewProblems` or `agentPackProblems`), alone and, for
  department packs, with every other pick;
- only core's tools; pack ids unique, and agent, department and seat ids unique across department packs;
- the compiled pack mechanism stays gone: no `templates/`, no code in `packs/`, no pack hooks in core;
- no business's name and nothing business-specific: say "the business" and "the owner" (agents are
  told the business's name and what it does from Settings).

## Open seats instead of planned agents

A job with no agent yet is an open seat on the org chart, with a title and a line. Card 134 turned
every seat held for an agent that was never built into an open seat
(`supabase/migrations/20261216090000_seats_planned_to_open.sql`).

## The Packs page

Decided 2026-11-28 (packs slice 4, approved mockup). **Packs** has its own menu item, under More. The page lists every
pack this business can add (the Chief of Staff setup pack only goes in at first-run setup, so it isn't listed), with
search and two filters: the kind (departments or agents) and **Works with**, the connections a pack reads, connected
ones first with a green dot. Search and filters run in the browser on the cards the server worked out, in one read
round (`core/pack-market-rules.ts`, `dashboard/packMarket.ts`).

Each card opens the pack's page at `/packs/<id>`:

- A department pack's page shows its agents (model, daily budget, how many tools they read, that they ask for no
  actions), open seats, its Overview layout drawn small, chains (which start off), goals, the connections it reads and
  a monthly estimate. It is the confirm step: the owner's **Add** is the same action as the Add a department sheet
  (`installDeptPack`) and lands on the new department with its setup banner. A department the business already has
  says what a second one would be called; one whose second copy the gateway refuses (Finance, Prospecting: actions
  named by agent id) says why and has no Add button.
- An agent pack's page shows the agent, the actions it can ask for (all start off), its connections, the estimate and
  the open seats it fits. **Fill** opens that seat's Fill sheet with the pack picked (`&pack=<id>`).

The monthly estimate is the hire card's (`dashboard/cost.ts`): each agent's model, effort, tools and limits, at the
runs a month its pack's scheduled chains give it (an agent pack's suggested schedule), with no real runs yet. Nothing
costs anything while it's off. People who aren't the owner can browse but see no Add or Fill.

The Add a department sheet keeps its quick list and links to the page (**See every pack**); the Fill sheet links to the
agent packs. `list_packs` links open a pack's page.
