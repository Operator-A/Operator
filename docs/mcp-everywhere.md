# Every integration over MCP

Design: https://claude.ai/artifact/8SWRasPZ2DPeoxQBiSHhBg (approved by the owner, Nov 15 2026).
Build Board: Orders 90 (design) to 98.

The runner speaks only MCP. Each server has a profile in code (`core/mcp-rules.ts`): its address,
the exact scopes to ask for, its read tools, and later its write tools with the gateway action
type each becomes. A business connects its own account with a Connect button and never edits a
profile. Writes go through the gateway and start at Draft. Tenancy is a separate epic.

Servers a business adds itself, by address, are in `docs/custom-servers.md`.

Slices: 1 runner speaks only MCP, 2 credential vault, 3 profiles and connection registry,
4 Notion, 5 Mercury, 6 Gmail (reads and drafts; send stays off), 7 Shopify on our own server,
8 cleanup.

## Slice 1: the runner speaks only MCP

Every read and calculate call goes through the in-app MCP server (`core/tools/mcp-host.ts`): a
JSON-RPC `tools/call` over the tool list, crossing as JSON, read back with the same
`parseRpc`/`toolPayload` that read Klaviyo's replies. Callers use `core/tools/call.ts`
(`callTool`, `listTools`): the runner's explore and playbook steps, the playbook dry run and the
builder's tool check. The server serves only tools that read or work numbers out (not reports,
actions or Claude's own web tools), checks every input again, passes the caller's context in
`_meta["operator/ctx"]`, and drops numbers that aren't finite. A tool's error comes back as it was.
`npm run check:mcp` fails if anything else calls a tool's `run`.

Report and action tools stay out of MCP on purpose: code delivers reports after a run, and
actions are staged for the gateway.

## Slice 2: the credential vault

| Rule | Where |
|---|---|
| Sign-ins sealed with AES-256-GCM under the org's own data key, bound to the org (`v3`); the data key is kept in `org_keys` wrapped by `MCP_SECRET_KEY`, a key of its own (docs/tenancy.md, slice 4) | `core/vault.ts`, `integrations/mcp.ts` |
| Each sealed value names its key (`v2.<key id>.…`); `MCP_SECRET_KEY_OLD` still opens what it sealed; rows move onto the current key when read, or all at once with **Re-lock now** | `seal`, `open`, `readSecret`, `resealAll` |
| Without `MCP_SECRET_KEY` nothing can be connected or renewed | `VAULT_MISSING` |
| Only the vault's two users import it: the MCP client and the gateway | `eslint.config.mjs` |
| Ask for the profile's scopes only, cut to what the server supports; never the server's whole list | `MCP_SERVERS[id].scopes`, `pickScopes` |
| Token values never reach a saved error, the log or the browser | `scrubSecrets` |
| Requests carrying a code, token or client secret never follow a redirect; only discovery documents do | `fetchJson`, `rpc` |
| A rotated refresh token replaces the old one at once | `readTokens` |
| A failed renewal or a 401/403 pauses the connection (`paused_at`) until the owner signs in again | `pause`, `accessToken` |
| Disconnect asks the server to cancel the sign-in (RFC 7009) where it has a revoke address, then forgets it | `disconnectMcp` |
| Sign-in log without token values: connected, refreshed, refresh_failed, refused, revoked, revoke_failed, disconnected, resealed | `mcp_connection_events` |

Migration: `supabase/migrations/20261126090000_mcp_vault.sql` (`mcp_connections.paused_at`,
`mcp_connection_events`, RLS on, no policies).

### Changing the key

1. In Vercel, copy the value of `MCP_SECRET_KEY` into a new variable `MCP_SECRET_KEY_OLD`.
2. Set `MCP_SECRET_KEY` to a new value (`openssl rand -base64 32`), redeploy.
3. On Connections, open any MCP connection and tap **Re-lock now**. This rewraps the org's data key
   with the new `MCP_SECRET_KEY`; the sign-ins themselves stay on the data key.
4. Delete `MCP_SECRET_KEY_OLD`, redeploy.

## Slice 3: server profiles and the tool check

Each server's profile in `core/mcp-rules.ts` (`MCP_SERVERS`) holds its address, the scopes to ask
for, its read tools, its write tools with the gateway action type each becomes (none yet), and
who should sign in. Only a pull request changes a profile; a business only connects its account.
The Connections page and the floor's health read every server from this registry.

The tool check: when the owner signs in, the server's `tools/list` is fingerprinted (each read tool's
input schema, key order ignored) and saved in `mcp_connections.tools_seen`. Before a call, at most
every `TOOL_CHECK_HOURS` (6), the list is compared again (`checkTools`). A read tool that's gone or
whose inputs changed pauses the server with a note saying which, logged as `tools_changed`, until
The owner looks and signs in again, which accepts the tools as they are then.

Migration: `supabase/migrations/20261127090000_mcp_tool_check.sql` (`tools_seen`,
`tools_checked_at`, two new log events). The code reads the new columns, so apply it before merging.

## Slice 4: Notion on our own server

Notion's hosted MCP server signs in with OAuth as a person, reaches everything that person can see
and has no read-only switch. So Notion runs on our own MCP server, in the app
(`integrations/notion-server.ts`), over Notion's REST API (`integrations/notion-api.ts`) with the
agents' internal integration key. That key sees only the pages and databases shared with the
integration (the owner's choice, 2026-11-16).

- The profile (`MCP_SERVERS.notion`) has `auth: "token"`: the owner pastes the integration's key once on
  Connections. `saveMcpKey` checks its shape (`looksLikeNotionKey`), asks Notion whose it is
  (`users/me`, must be a bot), and seals it in the vault. It is never shown again. `NOTION_TOKEN`
  is gone from the code and should be deleted in Vercel.
- Two read tools agents may be granted: `notion_page_text` and `notion_row_on`.
- Four report tools (`reportTools`, `mayReport`): `notion_create_page`, `notion_create_row`,
  `notion_update_row`, `notion_archive_row`. These write report pages and rows into the business's own
  workspace, like an email to the owner. Code calls them after a run (briefs, books pages, lead lists,
  Build Board cards). A model never calls one, and a hosted server can never have them.
- Every call goes through `callLocalTool` in `integrations/mcp.ts`. It opens the key for that call,
  sends a JSON-RPC `tools/call` to the server as JSON, and reads the reply with the same code that
  reads a remote server's reply. Errors are scrubbed. A 401 from Notion pauses the connection
  until a new key is pasted. A 403 or 404 means a page isn't shared, which doesn't pause it.
- The server checks every request again (`checkNotionArgs` in `core/notion-blocks.ts`). Ids must be
  32 hex characters, at most 100 blocks are sent, and only the profile's tools are served.
- There is no tool check for our own server, because its tools ship with the app.
- Disconnect forgets the key. Notion has no API to cancel an integration key: to make an old key
  stop working, refresh the integration's secret in Notion.
- Lint: only `notion-server.ts` imports `notion-api.ts`, and only `integrations/mcp.ts` imports
  `notion-server.ts`. Everything else uses `integrations/notion.ts`.

No migration.

## Slice 5a: Mercury reads over Mercury's MCP server

Mercury's hosted server (`https://mcp.mercury.com/mcp`) signs in with OAuth and dynamic client
registration. Every write tool needs its own scope (`transactions:request`, `transactions:update`,
`receipts:manage` and so on), and "a connection without a tool's required scope cannot use that write
tool" (Mercury's MCP docs). So the agents' sign-in (`MCP_SERVERS.mercury`) asks for `read` and
`offline_access` only. Even if code tried to call a write tool, that token can't use it, and
`mayCall` names only five read tools: `getAccounts`, `listTransactions`, `listCategories`,
`getTransactionById` and `getOrganization`.

- `integrations/mercury.ts` keeps its exports (`mercuryCash`, `mercuryTransactions`,
  `mercuryCategories`, `mercuryTransaction`) and calls the server through `callMcpTool`. The tool
  check, pausing, refresh and the vault all work as they do for Klaviyo. `hasMercury()` is async
  now, because it reads the sign-in row.
- Replies are read in `core/mercury-rules.ts`, which is pure and tested. A row without an id or a
  finite amount is dropped, never counted as $0. The server may cut a page (`truncatedAt`); the
  same call is then asked again with that limit. If the server says it dropped the date filter
  (`_retryNote`), those rows are not for the asked dates and are not used.
- Connections shows which organization was signed in (`getOrganization`, name only), so a sign-in
  to the household account is easy to spot.
- `MERCURY_API_TOKEN` is gone from the code. `MERCURY_ACCOUNT_IDS` still picks the accounts that count
  as cash.
- Writes (receipt, category, memo) still go through the gateway with `MERCURY_WRITE_TOKEN`. Slice 5b
  moves them to a second, gateway-only sign-in that asks only for the write scopes they need.

No migration.

## Slice 5b: gateway writes on their own Mercury sign-in

The owner's choice (2026-11-16): split the write. Mercury's MCP server can set a charge's category and
memo (`updateTransaction`, scope `transactions:update`). It can't attach a file to a chosen charge:
`createReceiptUploadUrl` + `matchReceipt` upload a receipt and let Mercury's OCR pick the charge,
and there is no way to undo a wrong match. So:

- **Category and memo** go through a second sign-in to the same server, `MCP_SERVERS.mercury_write`.
  It asks for `transactions:update` and `offline_access` only, with no payment, transfer, receipt,
  budget or reimbursement scope. Its one write tool is `updateTransaction`, and it has no read
  tools. The owner connects it under Connections → Mercury → Mercury writes.
- **Receipt files** stay on `MERCURY_WRITE_TOKEN` (`integrations/mercury-write.ts`, now
  `attachReceipt` only), attached to the exact charge an approver approved.
- `callWriteTool` in `integrations/mcp.ts` calls only a profile's write tools. Lint lets only
  `core/gateway` import it, and `check:mcp` checks that too. The gateway still re-checks the
  charge live (through the read sign-in) before writing, and checks that both ways in are set up
  before it writes anything, so a change never lands half done.
- The tool check watches write tools as well (`checkedTools`): if `updateTransaction` changes its
  inputs, the write sign-in pauses until the owner signs in again.

No migration.

## Slice 6: Gmail on our own server, signed in with Google

Google's own Gmail MCP server (`gmailmcp.googleapis.com`) is a Developer Preview: it needs the
preview program, your own OAuth client marked for AI agents, and has no self-registration. It also
can't hand over an attachment's bytes, and Quinn reads receipt PDFs. So Gmail runs on our own server
in the app, like Notion:

- **`integrations/gmail-server.ts`** speaks MCP's JSON-RPC and serves four tools: `gmail_search`,
  `gmail_message`, `gmail_attachment` and `gmail_create_draft`. It serves only the tools of the
  profile it is opened for (`checkedTools`), so the read sign-in can never reach the draft tool.
  There is no send tool, and none may be added. Every input is checked again (`checkGmailArgs` in
  `core/gmail-rules.ts`): message ids before they go into a URL, one plain recipient address with
  no display name, and a subject that can't add a header.
- **`integrations/gmail-api.ts`** is Gmail's REST API: search, read, attachment, create draft. No
  send, trash, modify or label call (`check:mcp` checks the file). Only the Gmail server imports it,
  and only `integrations/mcp.ts` imports the server (lint and `check:mcp` enforce both).
- **Two Google sign-ins**, each a profile in `core/mcp-rules.ts` with `auth: "google"`:
  - `gmail_read` ("Gmail (read only)"): `gmail.readonly` alone. Quinn's receipt search
    (`integrations/gmail-read.ts`, through `callMcpTool`).
  - `gmail` ("Gmail drafts"): `gmail.compose` alone, one write tool, `gmail_create_draft`. Only the
    gateway uses it (`callWriteTool`), after an approver approves a draft; the address always comes from
    the lead's row. The owner sends every email from Gmail.
- **Signing in:** Connect sends the owner to Google's own page with the business's OAuth client
  (`GMAIL_CLIENT_ID`), PKCE, `access_type=offline` and `prompt=consent`. Google's addresses are fixed
  in code (`GOOGLE_AUTH`); there is no discovery or registration. The client secret stays in Vercel
  (`GMAIL_CLIENT_SECRET`) and is never put in the vault, the cookie or the browser. After the code is
  traded, the granted scopes must be exactly the profile's (`scopeProblem`): a box left unticked, or
  an older grant riding along, cancels the sign-in at Google and nothing is kept. The mailbox it
  belongs to is read and shown on Connections. A token Google stops accepting pauses the sign-in.
- **Disconnect** cancels the refresh token at Google. Both sign-ins use the same OAuth client, so
  Google may cancel the other one too; it then shows Paused and the owner signs it in again.
- The tool check doesn't run for our own servers: their tools are in this repo.
- Removed: `GMAIL_REFRESH_TOKEN` and `GMAIL_RECEIPTS_REFRESH_TOKEN` (their refresh tokens are now in
  the vault), `accessToken` and the REST calls in `integrations/gmail.ts` and `gmail-read.ts`.

Setup: add `https://<Control Room domain>/connections/gmail_read/callback` and
`/connections/gmail/callback` as Authorized redirect URIs on the OAuth client (a Web application
client). A consent screen in Testing with user type External makes Google's refresh tokens expire
after 7 days; Internal (Workspace) or In production doesn't.

No migration.

## Slice 7: Shopify on our own server

Shopify's own MCP servers are for storefronts and building apps, not a read-only Admin view of one
store, so Shopify runs on our own server in the app, like Notion and Gmail:

- **`core/shopify-rules.ts`** (pure) holds the rules and every query, one fixed read per tool.
  **`core/shopify-queries.ts`** lists them all, one per tool, and builds each tool's variables from
  checked inputs (`shopifyVariables`). No tool takes GraphQL or a search string: a pack's searches
  and settings are fixed in its code, dates must
  be `YYYY-MM-DD`, cursors must look like cursors. `assertReadOnly` refuses anything but a single
  named query, and `scripts/validate-graphql.mjs` still checks every document against Shopify's
  schema. Order reads carry no customer names, emails or addresses.
- **`integrations/shopify-server.ts`** serves `shopify_green_lots`, `shopify_stock_coffees`,
  `shopify_shop_settings`, `shopify_recent_orders`, `shopify_board_orders` and
  `shopify_orders_between`. **`integrations/shopify-api.ts`** is the only file that posts to
  Shopify (`check:mcp` checks that). Lint and `check:mcp` make sure only the server imports it, and
  only `integrations/mcp.ts` imports the server. The facades in `integrations/shopify/*` call
  `callMcpTool("shopify", …)` and keep their shapes, so agents didn't change.
- **The key** (the read-only app's Admin API access token, or a Dev Dashboard app's client secret
  with `SHOPIFY_CLIENT_ID` in Vercel) is pasted on Connections into the vault. Before it is kept, the
  server asks Shopify which shop it opens and every scope the app was granted: a key for another
  store, or one whose app has a write scope the profile doesn't name, is refused. (Until
  2026-11-21 any write scope was refused; store actions are in `docs/shopify-actions.md`.) A key Shopify stops
  accepting pauses the connection.
- Removed: `integrations/shopify/client.ts`, `SHOPIFY_ADMIN_ACCESS_TOKEN` and `SHOPIFY_CLIENT_SECRET`.
  `SHOPIFY_STORE_DOMAIN`, `SHOPIFY_API_VERSION` and `SHOPIFY_CLIENT_ID` stay: none is a secret.
  (`SHOPIFY_STOCK_COLLECTION` stayed until card 133.5, when the pack read that used it left.)

No migration.

## Slice 8: cleanup

- **One credential store.** The last service key outside the vault, the gateway's Mercury receipt
  token (`MERCURY_WRITE_TOKEN`), moved in: it is the `mercury_files` profile, a key pasted under
  Connections → Mercury → Mercury receipt files, served by our own small server
  (`integrations/mercury-files-server.ts`) with one write tool, `mercury_attach_receipt`. It is
  checked on paste (shape, and Mercury must not answer 401). `integrations/mercury-write.ts` is
  gone. Vercel settings now hold only the app's own infrastructure (Supabase, Claude, Resend for
  emails to the owner, `MCP_SECRET_KEY`, Google's OAuth client) and non-secret ids; `check:mcp` fails if
  an old service token comes back into `core/env.ts`.
- **One tool path.** Agents read through `callMcpTool`; code writes reports through report tools;
  every other write is a profile's write tool through `callWriteTool`, now on every kind of server
  (hosted, Google, or our own with a key), still importable only by `core/gateway`.
- The slice 6 vault format (a key made from the service role key) is no longer opened: every row
  was on `MCP_SECRET_KEY` before this shipped (`legacyKey` removed).
- `isOauth` is now `isHosted` (hosted servers that sign in on their own page).
- CLAUDE.md's hard rules talk about servers, profiles, one tool path and one credential store.

No migration.

## Google Analytics on our own server (card 152b)

The first analytics source, chosen by the owner of the first business (2026-11-19). Google's own
Analytics MCP server runs on a person's computer with their own Google credentials, so it can't be a
business's connection; ours runs in the app, like Gmail's.

- **Profile** `ga4` (`core/mcp-rules.ts`): signed in with Google, using the same Google OAuth client
  as Gmail (`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`), asking for
  `https://www.googleapis.com/auth/analytics.readonly` alone. A grant with anything more, or less, is
  cancelled at Google and not kept (`scopeProblem`). No write tools.
- **Who it is:** right after Connect, the server lists the properties the sign-in can see. None, and
  the sign-in is cancelled. One is picked at once; with more, an owner picks one on Connections or
  in setup (`ga4PickProperty`, audited). The property is kept in the connection's settings and is
  never a tool's input.
- **Tools** (`core/ga4-rules.ts`, one fixed report each): `ga4_properties`, `ga4_overview`
  (sessions, users, page views, key events, in total and by day), `ga4_top_pages` and
  `ga4_channels`. A tool takes a period from `REPORT_PERIODS` and, for the lists, a row limit of 1
  to 20; anything else is refused. Key events per 100 sessions is worked out in code.
- **Agents** read them as `analytics_overview`, `analytics_top_pages` (page paths are untrusted) and
  `analytics_channels`, group `analytics`, needing `ANALYTICS_CONNECTED` (connected, and a property
  picked).
- **Files:** `integrations/ga4-api.ts` is the only file that calls Google Analytics (two calls:
  `accountSummaries` and `runReport`), and only `integrations/ga4-server.ts` imports it. Only
  `integrations/mcp.ts` reaches the server. Lint and `check:mcp` enforce both.
- **Google sign-ins in `integrations/mcp.ts`** now come from one list (`GOOGLE`): each server with its
  "who is this" check, run right after Connect.

**Setting it up (once per Google OAuth client):** in Google Cloud, open the project that holds the
client in `GMAIL_CLIENT_ID`. Turn on **Google Analytics Data API** and **Google Analytics Admin API**
(APIs & Services > Library), then add the scope `.../auth/analytics.readonly` under Google Auth
platform > Data access.

No migration.

## Google Calendar on our own server (card 251)

Google's Calendar MCP server (`calendarmcp.googleapis.com`) is a gated Developer Preview, so a
business can't connect it. Ours runs in the app like Gmail's, with two Google sign-ins.

- **Profiles** (`core/mcp-rules.ts`), both signed in with Google on the Gmail OAuth client:
  - `calendar`: `https://www.googleapis.com/auth/calendar.events.readonly` alone. Read tools
    `calendar_events` and `calendar_free`. No write tools.
  - `calendar_holds`: `https://www.googleapis.com/auth/calendar.events` alone, held only by the
    gateway. One write tool, `calendar_create_hold` (action type `calendar.hold`). No read tools.
  A grant with anything more, or less, is cancelled at Google and not kept (`scopeProblem`).
- **Who it is:** right after Connect the server reads the primary calendar's name and time zone,
  kept in the connection's settings.
- **What the reads return** (`core/calendar-rules.ts`): the primary calendar only. The server asks
  Google for a fixed field list with no attendee email, description, place or link
  (`LIST_FIELDS`), so none reach the app. An event is a time, a title cut to 80 characters
  (untrusted: whoever sent the invite wrote it) and a guest count. Meetings, hours in meetings, the
  busiest day and free slots (working hours less busy time, 30 minutes or more, in the calendar's
  own time zone) are worked out in code. Declined, free, cancelled and all-day events don't block time.
- **Agents** read them as `calendar_week` (untrusted) and `calendar_free_time` (trusted; each slot
  carries a pick), group `calendar`, needing `CALENDAR_CONNECTED`.
- **The action** `calendar_hold` is the first granted action type (card 250): any agent an approver
  gives it to on the builder's Tools step. It takes a slot pick, a length (15 minutes to 8 hours,
  inside the slot), a title and a reason; the model never types a time. The gateway checks the fields
  (`refuseHold`: title, start and end only; no links or addresses; 5 minutes to 30 days out) when it
  is proposed and again before it is applied, and the server checks the time is still free on the
  calendar right before it writes. The hold is private, busy, has no guests and no reminders, and is
  inserted with `sendUpdates=none`, so no one is invited or emailed. There is no update, move or
  delete code. At most `policies.max_calendar_holds_per_run` (default 10) per agent per apply.
- **Files:** `integrations/calendar-api.ts` is the only file that calls Google Calendar (list events,
  insert a hold), and only `integrations/calendar-server.ts` imports it. Only `integrations/mcp.ts`
  reaches the server. Lint and `check:mcp` enforce both.

**Setting it up (once per Google OAuth client):** in Google Cloud, open the project that holds the
client in `GMAIL_CLIENT_ID`. Turn on **Google Calendar API** (APIs & Services > Library), then add the
scopes `.../auth/calendar.events.readonly` and `.../auth/calendar.events` under Google Auth platform >
Data access.

## Mailchimp on our own server (card 252)

Mailchimp's hosted MCP server isn't documented for other apps, and Mailchimp has no narrower key or
OAuth scope: every key reaches the whole account. So our server is the limit.

- **Profiles** (`core/mcp-rules.ts`), both a pasted Mailchimp API key, sealed in the vault:
  - `mailchimp`: the agents' key. Read tools `mailchimp_audiences` (each audience's members,
    unsubscribes and campaigns) and `mailchimp_campaigns` (reports for a period). No write tools.
  - `mailchimp_drafts`: a second key, held only by the gateway. One write tool,
    `mailchimp_create_draft` (action type `mailchimp.campaign_draft`). No read tools.
- **The host** comes from the key's own data-centre suffix, checked against `-us<digits>`
  (`baseOf`), so nothing can steer a request elsewhere. Requests never follow redirects.
- **What the reads return** (`core/mailchimp-rules.ts`): a fixed field list with no member, email
  address or merge field. Rates per 100 sent and totals are worked out in code.
- **Agents** read them as `mailchimp_audiences` (each audience carries a pick) and
  `mailchimp_results`, group `mailchimp`, needing `MAILCHIMP_CONNECTED`.
- **The action** `mailchimp_campaign_draft` is granted (card 250): the audience is a pick, the words
  are the Klaviyo draft's rules plus no Mailchimp merge tags (`refuseMailchimpCampaign`). On apply the
  server reads the audience again, creates a regular campaign with the audience's own default sender,
  and sets the HTML (body escaped, then `*|UNSUB|*` and the audience's address, added by code). There
  is no send, schedule, test, member or delete call (`check:mcp` fails on one). At most
  `policies.max_campaign_drafts_per_run` (default 3) per agent per apply.
- **Files:** `integrations/mailchimp-server.ts` is the only file that calls Mailchimp, and only
  `integrations/mcp.ts` reaches it (lint and `check:mcp`).

**Setting it up:** nothing in Vercel. The business makes two keys in Mailchimp (profile, Extras, API
keys, Create A Key) and pastes them on Connections > Mailchimp.

## HubSpot on our own server (card 253)

HubSpot's hosted MCP server (mcp.hubspot.com) takes its scopes from its own tool list, writes
included, so it can't give agents read access only. Our server runs in the app over HubSpot's CRM API
with two **service keys** the owner makes in HubSpot (Development > Keys > Service keys). HubSpot
stopped new legacy private apps in October 2026, and service keys take exact scopes for one account.
Keys are pasted for now. A HubSpot app for one-tap Connect is a later card (253.5).

- **Profiles** (`core/mcp-rules.ts`), both a pasted service key sealed in the vault:
  - `hubspot`: the agents' key, with `crm.objects.deals.read`, `crm.objects.contacts.read` and
    `crm.objects.companies.read`. Read tools `hubspot_deals` and `hubspot_contacts`. No write tools.
  - `hubspot_deals`: a second key, held only by the gateway, with `crm.objects.deals.read` and
    `crm.objects.deals.write`. One write tool, `hubspot_move_deal` (action type `hubspot.deal_stage`).
- **Which key is which** is checked when it is pasted (`checkHubSpotKey`). The server asks to change no
  property on deal 0, which doesn't exist. A key without deal write gets 403 for the missing scope, and
  a key with it gets 400 or 404, so nothing is written either way. A key that can write is refused for
  `hubspot`, and one that can't is refused for `hubspot_deals`. HubSpot has no documented way to list a
  service key's scopes, so this probe is the check.
- **The host** is fixed (`https://api.hubapi.com`), and requests never follow redirects.
- **What the reads return** (`core/hubspot-rules.ts`):
  - Deals come back with fixed properties (name, amount, stage, pipeline, close date, last change), and
    no contact, owner or email.
  - Code works out open deals per stage, amounts, and the deals untouched for 14 days or more, using the
    pipelines as HubSpot lists them.
  - Contacts and companies are counts only, all-time and new in a period, from HubSpot's search
    `total`.
- **Agents** read them as `hubspot_deals` (each deal and each open stage carries a pick) and
  `hubspot_contacts`, group `hubspot`, needing `HUBSPOT_CONNECTED`.
- **The action** `hubspot_move_deal` is granted (card 250):
  - The deal and the stage are picks. The note is plain text up to 500 characters, with no links
    (`refuseMove`).
  - On apply, the server reads the deal and its pipeline's stages again on the same key. It refuses a
    stage that isn't in the deal's own pipeline, or the stage the deal is already in.
  - It then changes `dealstage` and logs the note on the deal (association type 214).
  - There is no create, delete, merge, contact, company, email or sequence call (`check:mcp` fails on
    one).
  - At most `policies.max_deal_moves_per_run` (default 20) moves per agent per apply.
- **Files:** `integrations/hubspot-server.ts` is the only file that calls HubSpot, and only
  `integrations/mcp.ts` reaches it (lint and `check:mcp`).

**Setting it up:** nothing in Vercel. A super admin in HubSpot opens Development > Keys > Service keys
and taps Create service key twice:
- "OPERATOR agents", with the three read scopes, pasted on Connections > HubSpot.
- "OPERATOR deal moves", with deal read and write, pasted on Connections > HubSpot deal moves.

To confirm on the first real key: HubSpot's docs don't name a scope for creating notes. If a move's
note is refused, the error names the scope to add.

## Meta Ads on our own server (card 255)

Meta's hosted Ads MCP server (mcp.facebook.com/ads) asks for `ads_management` on every sign-in, which
can change campaigns and budgets, so it can't give agents read access only. Our server runs in the app
over the Marketing API (Graph API v26.0, one pinned version) with two sign-ins made with Connect on
OPERATOR's own Meta app (Facebook Login, `META_APP_ID` and `META_APP_SECRET` in Vercel).

- **Profiles** (`core/mcp-rules.ts`, auth `meta`):
  - `meta`: asks for `ads_read` alone. Read tools `meta_ad_accounts` and `meta_ad_results`. No write tools.
  - `meta_pauses`: asks for `ads_management`, held only by the gateway. One write tool, `meta_pause_ad`
    (action type `meta.pause_ad`). No read tools.
- **Meta grants permissions to a person and an app, not to one sign-in.** Once the same person connects
  pauses, the agents' sign-in can manage ads too. So, as with Mailchimp keys, our own server is the
  limit: the `meta` profile is served read tools only, and Connections says so. `permissionProblem`
  allows `ads_read` and `ads_management` only (plus `public_profile`) and refuses a sign-in that lists
  anything else, or lacks the one its profile needs. A refused sign-in isn't kept; nothing is cancelled
  at Meta, since a cancel takes the whole app from that person, other sign-in included.
- **The sign-in:** PKCE and a state check, then the short token is traded at once for Meta's long one
  (`fb_exchange_token`, about 60 days). There is no refresh token: when it runs out, the sign-in pauses
  until the owner signs in again. Disconnect forgets it here; Meta has no revoke address, so removing
  OPERATOR entirely is done in Facebook (Settings > Business integrations).
- **What the reads return** (`core/meta-rules.ts`): ad accounts (id, name, currency, active, all-time
  spend), and per ad over 7, 30 or 90 days: spend, impressions, clicks and results of one kind
  (purchase, lead or link click, first matching action type so overlapping ones count once). Cost per
  result and totals are worked out in code; no results means no cost per result, never a guess.
  Insights are asked for by fixed fields with no audience, targeting or creative. An account must be
  one the sign-in lists.
- **The owner's cost targets** (`TARGET_KEYS`, policies rows, set on Connections > Meta Ads pauses): a
  cost per purchase, per lead and per link click, in the account's currency. Agents never set them.
  `meta_ad_results` marks each ad over or under the target; with no target, nothing is paused on that
  result.
- **Agents** read them as `meta_ad_accounts` and `meta_ad_results` (each running ad carries a pick),
  group `meta`, needing `META_CONNECTED`.
- **The action** `meta_pause_ad` is granted (card 250):
  - The ad is a pick; the proposal carries only the result kind, the period and a reason
    (`refusePause` refuses a target, a budget or anything else).
  - On apply the gateway reads the owner's target for that result again (none: refused), and the server
    reads the ad again on the same sign-in: it must still be running, and its cost per result must still
    be over the target, or its spend over the target with no result (`overTarget`). Otherwise refused.
  - Then it sets the ad's status to `PAUSED`. The owner can turn it back on in Ads Manager.
  - There is no budget, bid, create, copy, resume or delete call (`check:mcp` fails on one). Budget
    changes wait for a cap the owner sets.
  - At most `policies.max_ad_pauses_per_run` (default 10) per agent per apply.
- **Files:** `integrations/meta-server.ts` is the only file that calls Meta, and only
  `integrations/mcp.ts` reaches it (lint and `check:mcp`).

**Setting it up (once, for OPERATOR's Meta app):**
1. At developers.facebook.com, create an app with the use case "Create & manage ads with Marketing API"
   and connect OPERATOR's business portfolio (Settings). This adds Facebook Login for Business.
2. Facebook Login for Business > Settings: add `https://<domain>/connections/meta/callback` and
   `https://<domain>/connections/meta_pauses/callback` as Redirect URIs, and save.
3. Facebook Login for Business > Configurations: make two user access token configurations, one with
   `ads_read` and one with `ads_management`. Put their ids in `META_CONFIG_READ` and
   `META_CONFIG_PAUSES` (without them the classic `scope` is sent).
4. App settings > Basic: put the App ID in `META_APP_ID` and the App secret in `META_APP_SECRET`.

Until Meta grants the app full access (App Review > Permissions and Features, and the Marketing API
access tier), only the app's admins and developers can connect, at low rate limits. That is enough for
the business that owns the app. To confirm on the first real sign-in: Meta's docs don't say whether the
dialog takes PKCE, or whether a token from a limited-access Marketing API app expires (when Meta sends
no `expires_in`, the sign-in is kept with no expiry and pauses on Meta's first refusal).

## WooCommerce on our own server (card 254)

WooCommerce's own MCP adapter is a plugin each store installs, still in preview, signed in with a
WordPress password and with no read-only mode. So our server runs in the app over the store's REST
API, with two keys the owner makes in WooCommerce.

- **Profiles** (`core/mcp-rules.ts`), both pasted as the store's address, the consumer key and the
  consumer secret, sealed in the vault:
  - `woo`: the agents' key, a **Read** key. Read tools `woo_orders` (orders in a period) and
    `woo_low_stock`. No write tools.
  - `woo_notes`: a **Read/Write** key, held only by the gateway. One write tool, `woo_add_order_note`
    (action type `woocommerce.order_note`). No read tools.
- **Which key is which** is checked when it is pasted (`checkWooKey`): the server asks to add a note
  to order 0, which doesn't exist. A Read key is refused at sign-in (401) and a Read/Write key gets
  "no such order" (400 or 404), so nothing is written either way. A key that can write is refused
  for `woo`, and a Read key for `woo_notes`.
- **The store address** is the owner's, so it is held to a custom server's rule: https, no
  credentials, port, query or hash (`readWooKey`), and a public host, checked (`assertPublic`) right
  before every request. Requests never follow redirects.
- **What the reads return** (`core/woo-rules.ts`): orders asked for with a fixed field list with no
  billing, shipping, name, email, phone or note. Revenue, average order, repeat buyers and best sellers
  are counted in code, and only paid orders (processing, completed, on hold) count as sales. A
  customer is an id inside the server and never leaves it. At most 5 pages of 100 are read, and a
  longer period says it was cut (`truncated`).
- **Agents** read them as `woo_orders` (each order carries a pick) and `woo_low_stock`, group `woo`,
  needing `WOO_CONNECTED`.
- **The action** `woo_order_note` is granted (card 250): the order is a pick, the note is plain text
  up to 500 characters with no links or markup (`refuseNote`), and it is always private
  (`customer_note: false`): store staff see it, the customer doesn't. On apply the server reads the
  order again on the same key, then adds the note. There is no order, status, product, stock,
  refund, coupon or customer write (`check:mcp` fails on one). At most
  `policies.max_order_notes_per_run` (default 20) per agent per apply.
- **Files:** `integrations/woo-server.ts` is the only file that calls a WooCommerce store, and only
  `integrations/mcp.ts` reaches it (lint and `check:mcp`).

**Setting it up:** nothing in Vercel. In WordPress: WooCommerce > Settings > Advanced > REST API >
Add key. For the agents' key, Description "OPERATOR agents", Permissions **Read**, Generate API key,
then paste the store's address, the Consumer key and the Consumer secret on Connections >
WooCommerce. For the notes key, do the same with Permissions **Read/Write** and paste it on
Connections > WooCommerce order notes.

## Klaviyo campaign drafts on our own server (card 159b)

Klaviyo's hosted MCP server stays read-only for agents (`read-only=true`). The one write the Campaign
writer needs, a draft campaign, runs on our own small server in the app, on a separate key only the
gateway uses.

- **Profile** `klaviyo_drafts` (`core/mcp-rules.ts`): a pasted key, no read tools, one write tool
  `klaviyo_create_draft` that becomes the gateway action type `klaviyo.campaign_draft` (Draft).
- **The key:** a Klaviyo private key (`pk_…`) with Campaigns Full Access, Templates Full Access and
  Lists Read Access. Before it is kept, the server checks Klaviyo accepts it for lists and that it can't
  read profiles, flows or metrics; a key that can is refused as more than the profile needs. Klaviyo has
  no draft-only scope, so the guarantee that nothing is sent is in code: the server has no send job,
  schedule, cancel or delete call, and `check:mcp` fails if one appears.
- **The tool:** checks its input again (`checkDraftArgs`), reads the list on its key (a list that isn't
  there is refused), creates a template from the approved body (escaped, with Klaviyo's unsubscribe tag
  added by code), creates a draft campaign to that list with the approved subject and preview text, and
  attaches the template. Klaviyo API revision pinned to 2024-10-15. Requests never follow redirects; a
  401 pauses the key until the owner pastes a new one.
- **Files:** `integrations/klaviyo-drafts-server.ts` is the only file that calls Klaviyo's REST API, and
  only `integrations/mcp.ts` imports it (lint and `check:mcp`).

**Setting it up:** in Klaviyo, open **Settings > API keys > Create Private API Key**. Name it
"Campaign drafts", pick **Custom Key**, set **Campaigns** to Full Access, **Templates** to Full Access and
**Lists** to Read Access, leave everything else at No Access, and tap **Create**. In the Control Room,
open **Connections > Klaviyo**, paste the key under **Klaviyo campaign drafts** and tap **Save**.

## Stripe on our own server (card 240)

A business's own Stripe account (not OPERATOR's billing in `ee/`, which no agent reaches). Stripe's
hosted MCP server (`mcp.stripe.com`) offers only generic tools, `stripe_api_read` (any GET) and
`stripe_api_write` (any write, refunds included), and has no read-only switch, so it can't be held to a
profile. Our own server runs in the app with two restricted keys.

- **Profile** `stripe` (`core/mcp-rules.ts`): a restricted key (`rk_…`) with Read on Balance, Balance
  transaction sources, Subscriptions, Invoices and Customers. Five read tools, each one fixed request in
  `core/stripe-rules.ts`: `stripe_balance`, `stripe_money_in` (gross, refunds, fees, net, by day, for 7,
  30 or 90 days), `stripe_subscriptions` (MRR, active, past due, trialing, starts and cancellations),
  `stripe_open_invoices` (most overdue first) and `stripe_customers` (picks for an invoice). Every sum is
  made in code and never added across currencies; lists page up to 1,000 rows and say when they were cut.
- **Profile** `stripe_drafts`: a second restricted key with Write on Invoices (and Invoice items), Read
  on Customers. No read tools; one write tool `stripe_create_invoice_draft`, the gateway action type
  `stripe.invoice_draft` (Draft). The server re-reads the customer, creates the invoice with
  `collection_method=send_invoice`, `auto_advance=false` and `pending_invoice_items_behavior=exclude`,
  adds the approved lines, and reads the subtotal back; the action is marked partly applied if it doesn't
  match what was approved. Each POST carries an idempotency key made from the action id, so a retry
  never makes a second invoice; a failure after the draft exists is recorded as partly done, never retried.
  There is no finalize, send, pay, void, refund or delete call, and `check:stripe` fails on one.
- **Key checks:** a secret key (`sk_…`) is refused before any request. A pasted key must answer the
  GETs its profile needs, then is probed with updates of objects that can't exist (refunds, charges,
  payouts, customers, subscriptions, products, invoices, invoice items): Stripe answers 403 when the key
  lacks the permission and 404 when it has it, so nothing is changed. The read key must be refused all of
  them; the drafts key must reach invoices and invoice items and nothing else.
- **Who drafts:** no agent is named in code. The owner gives `stripe_invoice_draft` to an agent on the
  builder's Tools step (granted actions, card 250), the gateway checks the agent's active spec at propose
  and apply, and each draft is capped at 5 lines and $5,000 in code.
- **Files:** `integrations/stripe-api.ts` is the only file that calls Stripe for a business, only
  `integrations/stripe-server.ts` imports it, and only `integrations/mcp.ts` imports the server (lint and
  `check:stripe`). API version pinned to 2024-06-20; requests never follow redirects; a 401 pauses the key.

**Setting it up:** in the Stripe dashboard, open **Developers > API keys** and tap **Create restricted
key**. Name it "OPERATOR read", set **Balance**, **Balance transaction sources**, **Subscriptions**,
**Invoices** and **Customers** to **Read**, leave everything else on **None**, tap **Create key**, and
copy it. In the Control Room, open **Connections > Stripe**, paste it under **Read key** and tap
**Save**. For invoice drafts, make a second restricted key named "OPERATOR invoice drafts" with
**Invoices** (and **Invoice items**, if listed) on **Write** and **Customers** on **Read**, and paste it
under **Stripe invoice drafts**.
