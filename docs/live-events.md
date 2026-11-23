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
