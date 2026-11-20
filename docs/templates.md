# Department templates

A new business can start from department templates instead of building every agent by hand. A
template is **data**, a JSON file in `templates/`: one department with its head and agents, their
specs and playbooks, its seats on the org chart, its routines (chains) and a starting goal. There is
no template code: templates can't add tools, Shopify reads, measures or tables. Every ability comes
from core, so a template can only make an agent smaller, never give it something new.

Since card 134. Before it, a "template pack" was TypeScript compiled into the app (tools, tables,
measures, planned agents and a whole business's crew); that mechanism is gone.

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
some out or adds others and taps Start this company. `core/install.ts` (`installTemplates`) installs only into an org with no
agents, departments or seats yet, or one holding only the Chief of Staff that setup installed: then
her rows stay (`ontoSetup`) and the merged chains go in as the next crew flow version. The picked templates merge (`core/template-rules.ts`, `mergeTemplates`):

- lists are joined in the order `core/templates.ts` lists the files;
- a chain whose key another picked template used gets that template's steps added, so the morning
  brief runs after the numbers when both are picked;
- a step for an agent that isn't being installed is dropped, and a chain left empty goes.

Then `core/install-rules.ts` checks the whole crew (`crewProblems`) and writes it switched off:
every agent off duty, every chain off, every playbook proposed for the owner's approval, goals with
no due date. Policies aren't installed: every cap starts at its default in code.

`npm run org:new -- --slug … --name … --owner … --templates finance,prospecting` does the same from the
command line.

## Adding a template

A pull request with `templates/<id>.json` and a line in `core/templates.ts`. `check:templates`
requires:

- JSON only in `templates/`, each file listed in `core/templates.ts`, and nothing else reads it;
- the shape (`templateProblems`) and the crew's own checks, alone and with every other pick;
- only core's tools; agent, department and seat ids unique across templates;
- no business's name and nothing business-specific: say "the business" and "the owner" (agents are
  told the business's name and what it does from Settings).

## Open seats instead of planned agents

A job with no agent yet is an open seat on the org chart, with a title and a line. Card 134 turned
every seat held for an agent that was never built into an open seat
(`supabase/migrations/20261216090000_seats_planned_to_open.sql`).
