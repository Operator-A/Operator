# OPERATOR's own MCP server: Claude as a front door

Spec (approved Nov 23 2026): "Operator MCP for Claude: spec" (Claude Doc), Build Board card 310. This
file covers slice 1 and grows with each slice.

A member adds OPERATOR to Claude as a custom connector. Claude can then read the company (departments,
agents, runs, what is waiting) and, from slice 2, draft agents. OPERATOR stays the place agents run and
the place people decide.

## The rule: OPERATOR is the source of truth

- An agent lives in OPERATOR. Nothing is synced, and Claude keeps no copy.
- Reads come from OPERATOR on every call. Writes (slice 2) go one way, as off-duty drafts or proposals,
  through the builder's and proposals' own code, and carry the version they were based on.
- Approving or rejecting cards, Go live, the org switch, granting actions or custom tools, caps, budgets,
  schedules, vendors, Connections and People are never tools. A tool call written by a model is not a
  person's tap.

## Slices

1. **Connect and read** (this slice): `/api/mcp`, OPERATOR's own OAuth sign-in and consent page,
   `mcp_grants`, Settings > Connected apps, seven read tools.
2. **Draft writes**: `create_agent` and `update_agent` land as off-duty drafts (decided Nov 23 2026),
   `propose` files a proposal from Claude. Owner only.
3. **Try it and the move**: `try_agent` dry runs through `withRun`, and a guide for moving an agent that
   was set up in a Claude project into OPERATOR.

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
| `list_waiting` | Pending approval cards and proposals, in words | `/approvals`, `/proposals/<id>` |
| `list_tools` | Tools an agent can be given and whether each service is connected; actions apart, marked approver-only | `/connections` |
| `list_brains` | Models an agent can run on, with prices | |

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
