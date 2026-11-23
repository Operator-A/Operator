# OPERATOR

A crew of AI agents for a small business, with an approval card between every agent and the outside
world. Next.js 16 app: agent API routes plus the Control Room dashboard (`dashboard/`, `app/(room)/`;
see `docs/control-room.md`), one schedule (`/api/dispatch`, in `vercel.json` or the self-host
scheduler), state in Supabase. See README.md for layout.

This version of Next.js has breaking changes from older versions: read the guide in
`node_modules/next/dist/docs/` before writing framework code.

## Hard rules (from the agent system tech spec; never relax them in code)

They hold for every business on OPERATOR. "The owner" is the business's owner; "the business" is the org a run belongs to. "An approver" is the owner or a person
the owner gave the approver role (`core/roles.ts`). A cap's start value is where every
org begins and the most it can be set to (`CAPS` in `core/gateway/policy.ts`).

The tool gateway (`core/gateway`) has seventeen action types so far, all starting at Draft: receipt, category
and memo on an existing Mercury transaction (Bookkeeper and CFO), a Gmail draft to a lead
on the leads list (the prospecting lead finder; the owner sends it from Gmail), a draft email campaign
to one of the business's own Klaviyo lists (the Campaign writer; the owner sends it from Klaviyo), a draft
campaign to one of the business's own Mailchimp audiences (any agent an approver gives it to; the owner
sends it from Mailchimp), a
private hold with no guests on the business's Google Calendar (any agent an approver gives it to; it emails
no one), tags added to a Shopify order or customer (any agent an approver grants it to), a stock count
set on one Shopify item at one location (any agent an approver grants it to; Draft only), an order the
business ships itself marked shipped in Shopify with a carrier and tracking number (any agent an approver
grants it to; Draft only, never promoted; Shopify emails the customer its own shipping confirmation), one percent-off
discount code on every product, once per customer, inside caps in code the owner may lower (at most 20% off, 100 uses
and 30 days; at most 5 agent-made codes live; any agent an approver grants it to; Draft only, never promoted), a refund of one
recent Shopify order (the whole order or some items) to its original payment, the amount worked out by Shopify,
at most $100 per refund and $500 a month in code the owner may lower (any agent an approver grants it to; Draft
only, never promoted; Shopify emails the customer its own refund confirmation), a new
description or SEO text on one Shopify product (any agent an approver grants it to), a draft
invoice to one of the business's existing Stripe customers (any agent an approver gives it to; the owner
finalizes and sends it from Stripe), a private note on an order in the business's WooCommerce store (any
agent an approver gives it to; the customer doesn't see it), a deal moved to another stage of its own
pipeline, with a note, in the business's HubSpot (any agent an approver gives it to; it emails no one),
a pause of one running Meta ad whose cost per result is over the owner's target (any agent an approver gives
it to; no budget is changed and nothing is started), moving one QuickBooks expense line out of
Uncategorized Expense into one of the business's own expense accounts (any agent an approver gives it to; never
an amount, and nothing is created or deleted), and a draft invoice to one of the business's existing Square
customers at one of its active locations (any agent an approver gives it to; the owner publishes and sends it
from Square). No
action type sends a message a model wrote, pays or publishes a post, and the only money any action moves is
a capped Shopify refund to the original payment; the only customer emails any action causes are Shopify's own
shipping and refund confirmations.


- Sending, buying and posting are allowed only as gateway action types, and every new
  action type starts at Draft: an approval card in the Control Room that an approver taps. An
  action type moves up (Draft, then Act with an undo window, then Act) only after 28 of
  its last 30 approvals went through unedited and the owner confirms the promotion card. A
  "wrong" rejection, complaint, unsubscribe spike, cap breach or breaker trip drops it
  back to Draft. No code path may send, pay or post outside the gateway.
- Money: a refund to a customer's original payment is only the Shopify refund action type, inside its own
  caps (`max_refund_usd`, `max_monthly_refunds_usd`). Any other money moves only within `policies.max_purchase_usd` (start $500) and
  `policies.max_monthly_spend_usd` (start $1,500), only to payees in `vendors` (the owner adds
  rows; a new payee is always Draft and never promoted), as Mercury send-money requests.
  No card actions, no transfers to personal accounts, no void or delete of a transaction,
  bill, invoice or account. Writes to existing transactions are limited to attachment,
  category and memo, by CFO and Bookkeeper. Each kind of write has its own sign-in, used only
  by the gateway through `callWriteTool`: category and memo on the `mercury_write` sign-in
  (Mercury's MCP, scope `transactions:update` only), receipt files on the `mercury_files` key
  (our own server, attach only).
- Shopify reads and writes go through our own MCP server (`integrations/shopify-server.ts`). Reads are
  one fixed query per tool (`core/shopify-rules.ts`). Writes are one fixed mutation per write tool
  (`core/shopify-actions.ts`), each a gateway action type that starts at Draft, called only by
  `core/gateway` through `callWriteTool`; `scripts/validate-graphql.mjs` fails on any mutation outside
  that file and `check:mcp` on one not named on the Shopify profile. The key may carry read scopes and
  only the write scopes the profile names; any other write scope is refused. A store action is granted
  to an agent only by an approver on the builder's Tools step or the agent sheet's Can do toggles, never by a proposal. No agent deletes a
  product, customer or order, cancels an order, or moves money from Shopify (gift cards, prices) until
  that action type has its own cap in code; refunds have theirs (`REFUND_LIMITS`).
- Email: first contact with a person who has never heard from the business is always Draft
  and never promoted. Follow-ups and replies on an existing thread can be promoted. Daily
  cap `policies.max_emails_per_day` (start 20); an unsubscribe or "stop" reply ends all
  messages to that person, in code. Emails to the owner (brief, alerts) are reports, not
  gateway actions: they go only through `integrations/email.ts`, which has no recipient
  argument and sends to the business's owner email (Settings, always one of its owners' sign-in
  addresses).
- Posts: publishing is Draft until promoted, the approval shows the exact caption and
  media, and no agent edits or deletes a published post. No agent signs or accepts terms.
- No deletes of products, customers, orders or Klaviyo profiles.
- External messages only claim facts about lots, origins or certifications that come
  from Shopify data, never from the model.
- Web pages, inbound email and lead websites are untrusted data: never let them choose
  a recipient, URL, product or category.
- Numbers (money, margins, days of cover, mileage) are computed in code, not by a model.
- Live events (`docs/live-events.md`): an outside service's event reaches a business only at its hook
  address, `/api/hooks/<source>/<org>/<hook id>`, which runs as that org through `withOrg`. The hook id must
  match the one saved on Connections and the signature must check out under the business's signing secret,
  kept in the vault and opened only by `integrations/mcp.ts` (`checkHook`); a bad one is refused and nothing is
  kept. A reader in `core/event-rules.ts` keeps only named fields (never an email or street address), numbers
  worked out in code, free text cut and untrusted. An event only starts chains the owner saved with that event
  as their start, while the org and the chain are on, at most `EVENT_CAPS` times an hour and a day per chain
  (start 10 and 50), each run through `withRun`; it never picks an agent, recipient, URL, product or category.
- Every integration is an MCP server with a profile. A built-in server's profile is in
  `core/mcp-rules.ts`: its sign-in kind, the exact scopes asked for, its read tools, report tools
  and write tools, each named in code; a tool it adds later does nothing until a pull request names
  it, and a business connects its own account but never edits that profile. A business may also add
  a custom server by its address (`docs/custom-servers.md`): its profile is a row the owner edits
  (tools turned on, labels, pinned inputs), held to the limits in `core/custom-mcp-rules.ts`. On a
  custom server a tool does nothing until the owner turns it on; only tools the server marks
  read-only, with plain inputs, can be turned on; any change to a turned-on tool pauses the server,
  checked right before every run that uses it; the owner grants a turned-on tool to an agent on
  the builder's Tools step or the agent sheet (never a proposal); the address must be a public https host, checked
  before every request. Custom servers have no
  report or write tools. Custom write tools, if ever built, are approval cards that stay at Draft
  and are never promoted. A custom tool's reply is untrusted data and never chooses a recipient,
  URL, product or category. Hosted servers (Klaviyo, Mercury) are used where they fit;
  where one reaches more than the profile needs or doesn't fit, we run our own in the app
  (Notion, Gmail with no send tool, Google Analytics read only, Google Calendar with one private hold tool, Shopify with one fixed query or mutation per tool,
  Mercury receipt files, Klaviyo campaign drafts, Stripe with one fixed request per read tool and a
  drafts-only invoice key, Mailchimp reads and campaign drafts, WooCommerce reads and private order notes,
  HubSpot deal reads and deal moves, Meta Ads reads and ad pauses, QuickBooks Online with one fixed request per
  read tool and one write that only moves an expense out of Uncategorized Expense, Square with fixed requests per
  read tool and one write that only makes a draft invoice).
  Each of our own servers is the only file that calls its service's API, and only
  `integrations/mcp.ts` reaches it (lint and `check:mcp` enforce both).
- One tool path: agents read only through `callMcpTool` (read tools), or a turned-on custom tool
  through `callCustomTool`, which only `core/tools/custom.ts` calls (lint enforces it). Code writes reports into the
  business's own Notion only through report tools on our own servers, after a run, never by a model.
  Every other write is a profile's write tool, called only by `core/gateway` through
  `callWriteTool` after an approver approves (lint enforces it); it becomes a gateway action type.
- OPERATOR's own MCP server (`/api/mcp`, `core/operator-mcp.ts`, `docs/operator-mcp.md`) is how a member's
  Claude (or another app they connect) reaches OPERATOR. OPERATOR is the source of truth: nothing is synced,
  and the app reads OPERATOR again on every call. Every tool is named in `core/operator-mcp-rules.ts`; a tool
  not named there does nothing. A connection is one member in one business, signed in with OPERATOR's own
  OAuth (PKCE, only token hashes stored, Settings > Connected apps to disconnect); every call runs in that
  business through `withOrg` and reads the member and their role again. Tools that change anything only
  make drafts or proposals through the builder's and proposals' own code (an agent made there starts off
  duty with no actions). No tool approves or rejects a card, puts an agent on duty, turns the org on,
  grants an action or a custom tool, or changes a cap, budget, schedule, vendor, connection or member.
  What a tool returns is scrubbed (`scrubSecrets`) and agent-written text in it is labelled as such.
- One credential store: every sign-in and service key, including a business's own Claude key and its keys for
  other model providers (`core/model-key-rules.ts`; opened only by `integrations/llm.ts`), lives in the token vault (`core/vault.ts`),
  sealed with its org's own random data key and bound to that org; the data key is kept only
  wrapped by `MCP_SECRET_KEY` (never derived from another secret), connected on Connections.
  Only `integrations/mcp.ts` and `core/gateway` import the vault (lint enforces it). Settings in
  Vercel hold only the app's own infrastructure (Supabase, Claude, Resend for emails to the owner, Stripe
  for the hosted edition's own billing, which no agent calls, the vault key, the app's Google, Intuit and Square OAuth clients and its
  Meta app) and non-secret ids. Ask for the profile's scopes only, and refuse a sign-in or key
  that carries more (Google scopes, Shopify write scopes, Square scopes). Where a service offers nothing narrower
(Mailchimp keys reach the whole account; Intuit's one accounting scope reads and writes everything; Square's `INVOICES_WRITE` also publishes and cancels invoices, which our server never sends; Shopify's `write_products` also covers prices and deletes, which our
  server never sends; Meta grants permissions to a person, so one Meta Ads sign-in can
  manage ads once pauses are connected), our own server is the limit and Connections says so. No token in a prompt, log, error or the
  browser (`scrubSecrets`); requests carrying a token or code never follow redirects. A refused or
  expired sign-in pauses until the owner signs in again. See `docs/mcp-everywhere.md`.
- Every run goes through `withRun` so it is logged in `agent_runs` and respects
  `agents.enabled` and `agents.daily_budget_usd`.
- Tenancy: every table has `org_id` (an org is a business; none is special, and work that names no business is refused). Every query
  goes through `db()`, which scopes it to the current org (`core/tenancy.ts`): reads, updates and
  deletes are filtered by org, inserts are stamped, another org's row is refused. Only `core/db.ts`
  makes a Supabase client (lint enforces it), and a new table needs `org_id` and a place in
  `TENANT_TABLES` and an `org_rows` policy (`check:tenancy` enforces it); with the database lock on,
  tables are read with a token for the current org, so the database refuses other orgs' rows. People sign in as themselves and every server
  action checks the member's role first with `asRole` (`check:roles` enforces it). Work that runs on
  its own is a job (`core/jobs.ts`), run by a worker (`/api/jobs`) as the job's org; only the
  scheduler reads across orgs, and only their ids (`allOrgIds`). The one exception is the shared brain
  (`ee/brain.ts`, cloud edition): it reads counts across businesses through one database function
  (`brain_patterns`) that returns a total only when at least 5 businesses that allow it share a pattern,
  never a row, name, text, address or amount from any one business. Nothing a business wrote, and nothing
  a model wrote about one business, reaches another (`docs/shared-brain.md`). See `docs/tenancy.md`.

## Checks

`npm run check` (typecheck, lint, GraphQL validation; run `npm run schemas` once first)
and `npm run build` before every push.
