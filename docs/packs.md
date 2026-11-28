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
the same lists department templates had. `crewProblems` (`core/install-rules.ts`) checks the contents.

**Agent packs** hold one agent for one seat: `seat` (title, line and words that match an open seat's title),
`agent` (name, role, model, icon, colour, daily budget), `spec`, `playbook`, `starts` (null for by hand, or
days and a 24 hour time) and `suggests` (at most 4 actions an approver may give it, shown as Can do toggles
that start off). `agentPackProblems` checks the contents. Installing one comes with card 503.

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

Installing into a business that already runs, a department beside the others or one agent into an open
seat, comes with card 503.

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
