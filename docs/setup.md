# First-run setup

What a new business sees before it has a crew (card 151, the first onboarding card in the product
definition). The Desk sends it to `/start` until setup is done. `/start` has four steps:

1. **Tell Avery about your business.** A conversation with the Chief of Staff, plus a panel of what
   she has learned so far.
2. **Connect your tools.** A tile per tool, each with click-by-click steps (card 152, below).
3. **Pick departments.** The department templates (`docs/templates.md`), ticked where Avery leans
   toward them, or **Start empty**.
4. **Meet your crew.** A placeholder until card 153.

## Who goes to setup

`needsSetup` (`core/setup-rules.ts`) says yes only for a business that has not finished setup and
has no departments and no agents but the Chief of Staff that setup installed. A business with a crew,
or with an agent the owner built, never goes. Setup ends when the owner installs departments
(`setupInstall`) or taps Start empty (`setupStartEmpty`); both set `done` in the `setup` row of
`policies`.

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
- **Skip for now.** Step 3 lists the tools each department still waits on. It installs anyway and
  starts working once they're connected.

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
- `dashboard/components/setup.tsx` (the conversation, the panel, the store and unlisted-tool forms), `app/start/page.tsx`
- `supabase/migrations/20261220090000_business_facts.sql`

**What it replaces.** The Desk's **Start your crew** card and its `installTemplate` action (card 151),
and step 2's plain link to Connections (card 152).
