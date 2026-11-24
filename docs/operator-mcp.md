# OPERATOR's own MCP server: Claude as a front door

Spec (approved Nov 23 2026): "Operator MCP for Claude: spec" (Claude Doc), Build Board card 310. This
file covers all three slices.

A member adds OPERATOR to Claude as a custom connector. Claude can then read the company (departments,
agents, runs, what is waiting) and, from slice 2, draft agents. OPERATOR stays the place agents run and
the place people decide.

## The rule: OPERATOR is the source of truth

- An agent lives in OPERATOR. Nothing is synced, and Claude keeps no copy.
- Reads come from OPERATOR on every call. Writes (slice 2) go one way, as off-duty drafts or proposals,
  through the builder's and proposals' own code, and carry the version they were based on.
- Approving or rejecting cards, Go live, the org switch, granting custom tools, raising caps or budgets,
  vendors, Connections and People are never tools. A tool call written by a model is not a person's tap.
- Actions and when an agent starts may be put into a **draft** by
  `update_agent` (decided 2026-11-23). They change nothing until the owner's Go live, after a clean try, on a
  confirm that lists each one. See "Slice 4: actions and starts in a draft" below.

## Slices

1. **Connect and read** (done): `/api/mcp`, OPERATOR's own OAuth sign-in and consent page,
   `mcp_grants`, Settings > Connected apps, seven read tools.
2. **Draft writes** (done, below): `create_agent` and `update_agent` land as off-duty drafts (decided Nov 23 2026),
   `propose` files a proposal from Claude. Owner only.
3. **Try it and the move** (done, below): `try_agent` dry runs through `withRun`, and a guide for moving an agent that
   was set up in a Claude project into OPERATOR.
4. **Actions and starts in a draft** (built, below): `update_agent` puts actions and when the agent starts into a
   draft that applies only at the owner's Go live.

## Slice 1: connect and read

### How a person connects

1. Settings > Connected apps shows the address: `https://<this OPERATOR>/api/mcp`.
2. In Claude: Settings, Connectors, Add custom connector, paste the address.
3. Claude finds the sign-in (below), registers itself, and opens `/oauth/authorize`. Signed out, the
   proxy sends the person to sign in first and back after.
4. The consent page names the app, the business, the person and their role, lists what the app can
   read and what it can never do. Allow returns to Claude with a five-minute sign-in code.
5. Claude trades the code (with its PKCE verifier) for a one-hour access token and a 30-day refresh
   token, and calls the tools.

### Sign-in (OAuth 2.1)

| Piece | Where | What it does |
|---|---|---|
| Resource metadata (RFC 9728) | `/.well-known/oauth-protected-resource[/api/mcp]`, rewritten to `/api/oauth/meta/resource` | Names the server and its sign-in. |
| Sign-in metadata (RFC 8414) | `/.well-known/oauth-authorization-server`, rewritten to `/api/oauth/meta/server` | Endpoints, S256 only, public clients only. |
| Registration (RFC 7591) | `POST /api/oauth/register` | Nothing stored: the client id is the registration (name, redirect addresses), signed with `SESSION_SECRET`. Redirects must be https, or http on localhost. |
| Consent | `/oauth/authorize` (page) | Signed-in members only. An unknown app or an unregistered redirect is shown as an error, never redirected to. |
| Token | `POST /api/oauth/token` | `authorization_code` (PKCE checked against the stored challenge, redirect must match) and `refresh_token` (rotated). A code used twice revokes its grant. |

Tokens look like `op<c|a|r>1.<org id>.<grant id>.<secret>`. The org and grant say where to look; only
`sha256` of the secret is stored in `mcp_grants`, so a database row signs nobody in. `/.well-known/` is
outside the Control Room's sign-in (`proxy.ts`): it holds nothing private.

### Every call

`POST /api/mcp`, one JSON-RPC message, JSON answer (Streamable HTTP without a stream; GET and DELETE are
405). Before the body is read:

1. The bearer token is checked against its grant (live, not revoked, hash matches, not expired).
2. The member is read again inside the token's business. Removed, and the call is refused.
3. The call counts against 60 a minute per connection.

Then `tools/list` offers the tools the member's role may call, and `tools/call` checks the arguments
against the tool's schema (known keys only, capped) and runs it inside `withOrg(<the business>)`. A 401
carries `WWW-Authenticate` with the resource metadata address, so Claude can sign in again.

### Read tools

| Tool | What it returns | Link back |
|---|---|---|
| `get_company` | Departments, heads, seats and who holds each | `/crew` |
| `list_agents` | Each agent's job, department, duty, model, live version, waiting draft, 30-day runs and cost, spend this month, last run | `/crew` |
| `get_agent` | One agent's live version and waiting draft in full, with version numbers | `/agents/<id>` |
| `list_runs` | Recent runs (not tries or chats), with cost, summary and link | `/runs/<id>` |
| `list_waiting` | Pending approval cards and proposals, in words | `/?tab=approvals`, `/proposals/<id>` |
| `list_tools` | Tools an agent can be given and whether each service is connected; actions apart, marked approver-only | `/connections` |
| `list_brains` | Models an agent can run on, with prices | |
| `get_run` (slice 3) | One run in full, tries included: status, cost, summary, each step | `/runs/<id>` |

Every answer goes through `scrubSecrets` plus a list of key shapes, is cut at 24,000 characters, and
says that run summaries were written by agents.

### Settings > Connected apps

Each live connection: the app, the person, when connected and last used. A member disconnects their
own; an owner disconnects anyone's. Disconnect sets `revoked_at` and clears the hashes, so the next call
is refused. Allow and Disconnect are audited (`connect_app`, `disconnect_app`).

### Database (`20270103090000_mcp_grants.sql`)

`mcp_grants`: one row per connection, with `org_id`, `member_id` (cascade on member delete), the app's
name and redirect, the code's hash, challenge and expiry, the access and refresh hashes and expiries, the
minute's call count, `last_used_at` and `revoked_at`. In `TENANT_TABLES`, with the `org_rows` policy.

### Tests

`npm run check:operator-mcp`: the tool list (reads only, no tool that approves, grants or deletes),
argument checks, JSON-RPC answers (notifications, unknown tools, scrubbed errors), metadata, registration
and signed client ids, the authorize request (never redirecting an unknown app), PKCE with the RFC 7636
example, tokens, the minute limit, and the source: the server writes only `mcp_grants`, imports no draft,
proposal or gateway code in this slice, runs every tool in `withOrg`, and checks the token before reading
the body. `check:roles` and `check:audit` cover the two actions; `check:settings-sections` the new section.

### Rolling it out

Apply the migration, then merge. Nothing changes for anyone until a member connects an app. No new
settings: client ids are signed with `SESSION_SECRET`. The production address must be reachable without
Vercel Authentication for Claude to connect.

## Slice 2: draft writes (owner only)

Three tools, offered only when the connected member is an owner (read again on every call). Each one
writes through the code the Control Room already uses, so nothing new can go live, act or spend:

| Tool | Goes through | Lands as | Link back |
|---|---|---|---|
| `create_agent` | `createBuiltAgent` | A new agent, v1, **off duty**, $1 a day, no schedule, no actions. Optionally in an open seat (`setHolder`). | `/agents/<id>` |
| `update_agent` | `saveSpecVersion` | A **draft version**. What runs today doesn't change until a person tries it and goes live. | `/agents/<id>` |
| `propose` | `fileProposal` (source `claude`) | A **proposal** on Proposals, decided by a person. Same checks as a head's proposal: no actions. | `/proposals/<id>` |

Rules, in code:

- **Tools**: Claude may list reads and calculations only (`draftTools`, at most 8). Reports, actions and
  tools from servers the owner added are refused when asked for, and on a change they carry over as they
  were. Dropping a read is fine. Actions change only through `add_actions` and `drop_actions` (slice 4).
- **Based-on version**: `update_agent` needs `based_on_version`, the newest version `get_agent` showed. If
  someone saved since, the change is refused and Claude reads again (`staleRead`). Only fields passed change.
- **Never looser**: a change is checked by `readSpec` like a builder save, the model's provider must have a
  key, and `specLooser` must find nothing apart from the actions named in `add_actions` (no new report or
  custom tool, no higher run limits). Run limits,
  Notion pages, agents it reads from, duty, budget and schedule aren't arguments at all.
- **Who**: versions are saved by `<email> (via <app>)`; each write is audited (`create_agent`, `save_spec`,
  `file_proposal`) with the app's name.
- The consent page lists the three draft lines only for an owner.

### Tests

`npm run check:operator-mcp` adds: draft tools are owner only (a viewer and an approver are offered reads
only, and a call below owner never reaches the tool), no draft takes duty, budget, schedule, limits or
actions, `draftTools` and `staleRead`, enum and line-break handling, and the source: the server uses
`createBuiltAgent`, `saveSpecVersion` and `fileProposal` and never `activateSpecVersion`, `acceptProposal`,
`declineProposal`, the gateway, `withRun` or dashboard actions, and still writes no table but `mcp_grants`.

### Rolling it out

No migration and no new settings. Merge; an owner's Claude sees the three tools on its next `tools/list`.

## Slice 3: try it, and moving an agent in

### `try_agent` (owner only)

The builder's own try, moved to `core/agent-try.ts` so the builder, the first job and this server share it:
one run of the draft (or the live version when there is no draft) on today's data, through `withRun` with
trigger `preview`. It reads and thinks like a real run but sends nothing, queues no card and saves no output
for other agents; afterwards code drafts or updates the routine, which Go live approves in OPERATOR. It runs
while the agent is off duty and counts against its daily budget.

- Needs `based_on_version`, the newest version `get_agent` showed (`staleRead`), so the try runs what Claude read.
- Refused when real runs are switched off on this OPERATOR (`controlsOn`, now in `core/controls.ts`).
- Starts in the background (`after()`) and answers once the run is logged, with its id; Claude reads the result
  with `get_run`. `/api/mcp` has `maxDuration = 300`, like the builder's pages.
- Audited as `try_agent` with the app's name. Going live stays a tap in OPERATOR, after a try where every step worked.

### Moving an agent from a Claude project

Settings > Connected apps shows owners a prompt (`MOVE_PROMPT`) to paste into the Claude project that runs the
agent. Claude reads the project and OPERATOR (`get_company`, `list_tools`, `list_brains`), writes the agent,
names what OPERATOR has no tool for and anything it sends, posts or buys (those become actions an approver
grants here), waits for the owner's OK, then `create_agent`, `try_agent` and `get_run`, and stops. Duty,
actions and schedule stay in OPERATOR. Every step is a tool on this server, so the same limits hold.

### Tests

`check:operator-mcp`: `try_agent` is owner only and needs the version, `get_run` is a read, the move prompt
uses only this server's tools and stops before duty, and the source: a try checks `controlsOn` and the version,
goes through `startTry`, and `core/agent-try.ts` runs through `withRun` as a preview with `trying: true` and
never acts, goes live or puts an agent on duty. `check:first-job` reads the try from its new home.

### Rolling it out

No migration and no new settings. Merge; an owner's Claude sees `try_agent` and `get_run` on its next list.

## Live events slice 2: agents that run in Claude

`create_agent` takes `runs_on: "claude"` for an agent whose connectors only the owner's Claude account has
(they are set in the routine on claude.ai, never named in OPERATOR; `claude_tools` was dropped 2026-11-24): it lands off duty with no OPERATOR tools, and the answer carries the line to paste into
the routine's prompt. `finish_run` (owner only, kind `finish`) lets the routine's session post its result
onto the run OPERATOR started: once per run, within 24 hours, and only on a run that fired a session. See
`docs/live-events.md`, slice 2.

## Slice 4: actions and starts in a draft (decided 2026-11-23)

Spec: "Spec: Claude changes agent actions, triggers and schedules" (Claude Doc). Two parts.

### Part 1: actions (built)

`update_agent` takes `add_actions` and `drop_actions`, comma-separated action ids from `list_tools`.

- **Which actions**: only ones an approver may give any agent (`agents: "granted"` in code, `any_agent` in
  `list_tools`) whose service is connected; dropping needs only that the agent has it (`draftActions`, at most
  8 actions in all). `readSpec` checks the gateway's allow-list for the agent again.
- **Where it waits**: in the new draft version's tools (`saveSpecVersion`), as the agent sheet's Can do
  toggles do. What runs today doesn't change.
- **Go live**: the owner's Go live (Controls on, a clean try of that version) already lists each added action
  through `specLooser` ("adds the action ...") and asks to confirm. Taking an action away needs no confirm.
- **Still refused**: a report, a tool from a server the owner added, or higher run limits in the same draft
  (`specLooser` runs on the draft minus the actions Claude named). `create_agent` still makes an agent with no
  actions: Claude creates it, then drafts v2.
- Every action still starts at Draft on the trust ladder, so each send is an approval card.
- Audit: `save_spec` records `adds_actions` and `drops_actions`.

### Part 2: when it starts (built)

`update_agent` also takes `days` + `time`, `by_hand`, `start_on_event` (+ `min_total`) and `run_after`
(+ `after_result`). `readStarts` checks them (core/draft-starts-rules.ts).

- **Where it waits**: on that draft version, in `agent_defs.starts` (migration
  `20270107090000_draft_starts.sql`). The crew flow and `agents.manual_only` don't change. A further draft
  from Claude on top of it keeps those starts (parts named again replace them); a draft saved in OPERATOR
  doesn't carry them.
- **Checked at save**: `flowWithStarts` works out the flow from today's flow, then `flowProblems` checks it
  (at most 8 agents a chain, no loops, a by-hand agent only in Run chain chains). An agent that runs in Claude
  can't take starts.
- **What each start does**: a schedule or by hand goes through `withAgentTime`, as the sheet does. An event
  makes or replaces the agent's own event chain (`event-<agent>`; event caps unchanged); `none` drops it.
  `run_after` takes the agent out of every chain it doesn't start, then adds it as the next step of a chain
  that starts on its own and ends with the other agent (its schedule first), when that has room.
- **Go live** (`dashboard/actions.ts`): reads the version's starts, works out the flow again from today's,
  locks Go live if it no longer checks out, and adds each change in words (`startsWords`) to the confirm with
  `specLooser`'s lines. On confirm it makes the version live, then saves the flow as a new flow version noted
  "<name>: from v<n>" and sets `manual_only` the way `setAgentTime` does.
- **Seen**: `get_agent` gives `starts_today` and the draft's `at_go_live`; the agent sheet lists "When it goes
  live" under a draft.

### Tests

`npm run check:operator-mcp`: `draftActions` (granted and connected only, no repeats, drop keeps the rest,
both lists at once refused, at most 8), only `update_agent` takes the action arguments, the server never calls
`activateSpecVersion`, `goLive`, `setAgentTime` or `setEnabled`, only the named actions skip `specLooser`, and
Go live asks to confirm added actions. Part 2 adds `readDays`, `readStarts` (every argument and its refusals),
`flowWithStarts` for a schedule, by hand, an event and its removal, run after (own and shared chains, a full
chain, nothing to follow) with `flowProblems` on each result and today's flow left untouched, `startsWords`,
`startsToday`, `readStored`, and the source: the server never saves a flow or `manual_only`, starts are saved
on the draft, and Go live reads them, locks on a bad flow and lists them on its confirm.
