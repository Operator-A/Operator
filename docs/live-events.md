# Live events

A service tells OPERATOR the moment something happens, and a chain on the Crew canvas starts within
seconds instead of at its next scheduled time (the scheduler runs every 15 minutes). Slice 1, decided
2026-11-23. Slice 2 (agents that run in Claude, fired through a routine's API trigger) builds on it.

## Events in slice 1

| Event | Service's name | Fields kept |
| --- | --- | --- |
| Shopify: new order | `orders/create` | order id and name, total, currency, item and line counts, customer id, the order note (cut, untrusted), test flag |
| Stripe: invoice paid | `invoice.paid` | invoice id and number, amount paid, currency, customer id, line count, the description (cut, untrusted), test mode |

Anything else a service sends is answered 200 and not kept. Email addresses, phone numbers, names and
street addresses are never kept.

## How an event travels

1. **Hook address.** Connections > Live events: the owner pastes the service's signing secret, and
   OPERATOR makes the business's address, `/api/hooks/<source>/<org id>/<hook id>`. The hook id is 192
   random bits kept in plain settings on the `<source>_events` connection row; the secret is sealed in the
   vault on the same row. The owner adds the address in the service (steps on the card).
2. **Check.** `app/api/hooks/[source]/[org]/[hook]/route.ts` runs as the org in the address (`withOrg`), so
   nothing reads across businesses. `checkHook` (integrations/mcp.ts) compares the hook id and checks the
   signature (`core/event-signature.ts`: Shopify's base64 HMAC of the body; Stripe's `t=…,v1=…` with a
   5-minute clock, so a replay is refused). Bad: 400 or 404, nothing kept. Bodies over 256 KB: 413.
3. **Keep.** The reader (`core/event-rules.ts` `readEvent`) keeps the named fields; the row goes in
   `inbound_events`, unique per service event id, so a retry is a duplicate. Rows are kept 30 days
   (the scheduler prunes them).
4. **Answer, then match.** The service gets 200 at once; after the answer, `core/events.ts` starts every
   chain that is on and starts on this event (with an optional minimum total, compared in code). Each start
   is a job (`startStep`), so the run goes through `withRun` (on duty, daily budget, plan) like any other.
5. **First step reads the event.** The chain's first step gets the event as a hand-off: a line written in
   code from the named fields, and its numbers, marked as data, never instructions. Later steps read the
   step before, as today.

## Caps and org off

- A chain starts on events at most 10 times an hour and 50 a day (`EVENT_CAPS`, decided 2026-11-23),
  counted from its `chain_fires` rows. Past that the event is held (`inbound_events.held`), and the
  scheduler starts one catch-up run for the chain when it has room, handed the newest held event and how
  many more came in.
- While the org is off, events are still checked and kept, marked "Would have started …", and nothing runs.
- Status shows the last 20 events and what each did.

## Vercel

The hook route is a public address: on a deployment behind Vercel Authentication, the services can't reach
it until the production domain is reachable without it (the same as `/api/mcp`).

## Tests

`npm run check:events`: readers (named fields only, no addresses), signatures (tampered body, wrong
secret, Stripe replay), signing secret shapes, starts and caps, the flow's event start, the job payload,
and source rules (signature before reading, chains start after the answer, no cross-business read).

## Slice 2: agents that run in Claude

Decided 2026-11-23: when Claude drafts an agent through OPERATOR's own MCP server and the agent needs a
connector OPERATOR doesn't have but the owner's Claude account does, OPERATOR still gets the agent: a linked
agent that shows on its department page and sheet with "Runs in Claude", whose runs happen in one of the
owner's Claude routines and link to the Claude session. It can also be run by hand from OPERATOR.

### Making one

- `create_agent` takes `runs_on: "claude"`. It gets no OPERATOR tools, and OPERATOR doesn't list the routine's
  connectors: they are set in Claude (decided 2026-11-24; the old `claude_tools` labels are gone). It lands off duty like every agent made from Claude, and the answer
  carries the line to paste into the routine's prompt.
- The owner makes a routine on claude.ai with the connectors its job needs and that line, adds an API trigger,
  generates its token, and pastes the routine id (`trig_…`) and token on the agent's sheet (Edit tab). The
  token is sealed in the vault on its own row (`routineVaultId`), bound to that agent; only
  `integrations/mcp.ts` opens it. Anthropic has no API to make a routine or its token, so this is by hand.
- It goes on duty only once its routine is connected and not paused (`linkedOnDutyProblem`), instead of
  needing an approved playbook.

### A run

Every start works as before, because the run is still `jobOf` inside `withRun` (on duty, daily budget,
plan, the run log): its schedule, a chain step, a live event, an approval, and Run now on its sheet or the
Crew canvas. `runBuilt` sees `runs_on = 'claude'` and, instead of the runner:

1. checks OPERATOR's caps: at most 25 fires an hour per linked agent and 90 per business (`ROUTINE_CAPS`,
   under Anthropic's 30 per routine and 100 per account);
2. writes the note in code (`fireNote`): the agent, the run id and its link, what started it, the job as
   saved, and the step before's or the event's facts, marked as data;
3. fires the routine (`integrations/claude-routine.ts`, the only file that calls the endpoint, reached only
   through `integrations/mcp.ts` `fireRoutine`). No redirect is followed. There is no idempotency key, so only
   a 429 with a short Retry-After and a 503 are retried, once; a 500 or a timeout is "may have started" and
   never retried. A 401 or 403 pauses the routine until a new token is pasted;
4. saves the session on the run (`agent_runs.claude_session`), so the run row and the sheet's Runs tab link
   to it ("Open in Claude").

The session posts its result with `finish_run` on OPERATOR's MCP server: once per run, within 24 hours, only
on a run that started a session. The result is saved as the run's summary, labelled as the session's words.
Anything outward the session wants goes through `propose`, so a person decides it in OPERATOR. What the
session does with its own Claude connectors is outside OPERATOR's gateway; the sheet says so.

### Switching where it runs (card 405)

The Runs on picker on the agent sheet's Edit tab (`dashboard/components/runsOn.tsx`, rules in
`dashboard/runs-on-rules.ts`) lists the models OPERATOR runs, grouped by maker (Claude, OpenAI, Gemini, Grok, on
the business's own keys), then "A Claude routine". Picking the other side shows what the agent keeps and what
stops; Save asks once, and `setRunsOn` (owner only) does the switch. Either way the agent goes off duty and keeps
its runs, history, schedule and chains.

- Into a Claude routine: OPERATOR asks for nothing but the routine's trigger id and key. Its reads and
  can do stay in its versions but aren't used, and no action is carried into Claude. Connect the routine, then
  put it on duty.
- Back into OPERATOR: its routine token is forgotten. It needs reads, a clean try and an approved playbook,
  like any agent. Forget token takes it off duty too.

Only Claude has a routine OPERATOR can start from outside and get the result back from (checked 2026-11-24:
OpenAI workspace agents can be started but their answer can't be read through the API; Gemini's scheduled tasks
and Grok's automations live only in their apps). Decided 2026-11-24: other makers' models run inside OPERATOR.

### Chains across where agents run (card 405)

A chain step that runs in Claude keeps its place in the chain on its session (`agent_runs.claude_session.chain`).
The chain doesn't move on when the routine starts: it goes on when the session posts its result with
`finish_run`, which hands that result to the next step (`resumeChain` in `core/chain.ts`). With no result within
24 hours, the scheduler (`expireWaits`) finishes the step as failed, and the chain's own rule for that step
(only when it worked, or however it went) decides what happens next.

### Database (`20270106090000_claude_agents.sql`)

`agents.runs_on` (`operator` or `claude`), `agents.claude_tools` (no longer written or read; always empty), `agent_runs.claude_session` (the
session id and link, when it was fired, and once finished, its status and result).

### Tests

`npm run check:claude-agents`: routine id and token shapes, the vault row id, caps, retry
rules, the session link (claude.ai only), the note (hand-off marked as data, cut), finish_run's input and
once-only rule, and source rules (one file fires, only `integrations/mcp.ts` reaches it, no redirect, a
refused token pauses, the caps are checked before every fire). `check:operator-mcp` covers `finish_run` and
`runs_on`; `check:on-duty` the routine check before duty.

### Rolling it out

Apply the migration, then merge. Nothing changes for existing agents (they all run in OPERATOR). The first
linked agent needs its routine made on claude.ai, as above.

## Slice 3: more events

Two more events on the sources slice 1 already checks, so nothing new about signatures or the vault:

- **Shopify: refund** (`refunds/create`). Kept: the refund and order ids, the amount refunded (summed in code,
  in cents, from the refund's successful refund transactions), how many items came back, and the refund's
  note as untrusted text. The owner adds a second Shopify webhook (Refund create) to the same address.
- **Stripe: invoice payment failed** (`invoice.payment_failed`). Kept: the invoice, its number and customer
  ids, the amount still due and how many tries Stripe has made. The owner adds the event to the same Stripe
  destination.

Both can start a chain like the slice 1 events, with an optional minimum ("Refund at least", "Amount due
at least"), under the same caps. The agent sheet's trigger picker now points to Crew > Schedule for live
event starts instead of saying Soon.

Not in this slice, and why:

- **Klaviyo signup.** A flow's webhook action can carry a secret header, but it isn't signed, offers no
  documented profile id or per-send id to tell Klaviyo's retries apart (it retries up to 17 times in a day),
  and the profile's own fields are the only data. Klaviyo's system webhooks are signed
  (`Klaviyo-Signature`) and have a subscribed-to-email topic, but need its Advanced KDP add-on. Which way to
  go is the owner's call.
- **New Gmail.** Google's push goes through Pub/Sub in OPERATOR's own Google Cloud project, which needs a
  topic, a push subscription and a weekly watch renewal set up there first.
