# Extension slots: how the paid layer plugs in

OPERATOR is one app with two editions. The **open edition** is the AGPL-3.0 code on its own, what
self-hosters build. The **cloud edition** is the same app built with the paid layer in `ee/` (its own
license, `ee/LICENSE`): billing, seats, managed credits, SAML/SCIM and the support console (Build
Board card 128).

The app never imports `ee/` (check:open-core refuses it). Instead it has a short list of slots, and
each slot has a do-nothing default in core:

| Slot | Asked when | Open edition |
| --- | --- | --- |
| `planBlock({ kind: "run" })` | before every run, after the on-duty and budget checks (`core/runs.ts`) | never blocks |
| `planBlock({ kind: "invite" })` | an owner adds a person on Settings > People | never blocks |
| `planBlock({ kind: "agent_on" })` | putting an agent back on duty, or turning on the org | never blocks |
| `planBlock({ kind: "custom_server" })` | adding a custom MCP server on Connections | never blocks |
| `SettingsCards` | extra cards at the bottom of Settings | none |
| `SignupPage` | the page at `/signup` | none, so `/signup` is not found |
| `api` | POST `/api/ee/<name>` (`app/api/ee/[name]/route.ts`), such as Stripe's webhook; each route checks its own caller | none, so every name is not found |
| `afterMembersChange()` | after someone is added to or removed from People | nothing |
| `HostedClaude` | setup step 1 and Connections > Claude, when the founder picks OPERATOR's Claude (card 162): balance, price, Buy buttons | none, so only the own-key option is offered |
| `pooledKey()` | by `integrations/anthropic.ts`, only when the business has no Claude key of its own | none, so the run is refused |
| `afterRun({ runId, costUsd, billing })` | after every run that cost something (`core/runs.ts`) | nothing |
| `edition` | for anything that needs to say which edition it is | `"open"` |

## How the swap works

- `core/extension-types.ts` names the slots (`SLOTS`) and their types.
- `core/extensions/none.ts` is the open edition's answer to every slot.
- `ee/index.ts` is the cloud edition's answer to every slot.
- `core/extensions.ts` is the only file that imports them, by the name `operator-extensions`.
  `tsconfig.json` maps that name to `core/extensions/none.ts`, so typecheck, scripts and a plain
  `npm run build` get the open edition.
- With `OPERATOR_EDITION=cloud` set, `next.config.ts` adds a Turbopack alias that maps
  `operator-extensions` to `ee/index.ts` instead. That setting is the only switch between editions.
  Without `ee/index.ts` (the public repo) the cloud build stops with a clear error.

## What a slot may do

A slot can only add a "no" or add a page. It can never turn off something core checks: roles,
the hard rules in CLAUDE.md, caps, budgets and the gateway run whatever a slot answers, and a plan
check that throws counts as a "no". A new slot needs a pull request to core with its default in
`none.ts` (check:open-core fails until every edition fills every slot).

## The public repo

The public repo ships `ee/` in full, under its own license (`ee/LICENSE`). A build without
`OPERATOR_EDITION=cloud` never resolves it, so the same tree builds the open edition; CI builds
both. The hosted cloud deploys this repo with `OPERATOR_EDITION=cloud`.

## Billing (cloud edition, card 128 slice 3)

One plan: $20 a month with the owner, plus $5 a month for each other person, after a 14-day trial
(`ee/plan-rules.ts`). Each business on the cloud edition has one `ee_subscriptions` row, kept by
sign-up and Stripe's webhook; the app only reads it.

| Where it stands | What the plan check says |
| --- | --- |
| Comped (a row we set, never Stripe) | Never billed and never paused; the webhook never writes over it |
| Trial, active, or within 7 days of a failed payment | Nothing is blocked |
| No row, trial over, unpaid after the grace period, or canceled | Runs pause, agents can't go on duty, adding people and servers stops |

Nothing is deleted when a plan runs out, and approvals already waiting can still be tapped. The
paid layer's tables are named `ee_*`: they sit in `TENANT_TABLES` with an `org_rows` policy like
any other, and come from their own migration after the starting one (`*_ee_tables.sql`), so an
open-edition install has them empty. `npm run check:ee` tests the plan.

**Stripe.** Paying for OPERATOR is not an agent action: no agent calls Stripe, and it is not an MCP
server or a gateway action type. Only `ee/stripe.ts` calls its API, with `STRIPE_SECRET_KEY` and
`STRIPE_PRICE_ID` (one recurring price with graduated tiers: $20 for the first person, $5 for each
next) and `STRIPE_WEBHOOK_SECRET`, set in the deployment's settings like Supabase and Resend.

- **Add a card** (owners, Settings > Billing) opens Stripe Checkout for as many people as are on
  People; what is left of the 14-day trial carries over when it is more than 48 hours.
- **Manage billing** opens Stripe's customer portal: change the card, see invoices, cancel.
- **The webhook**, `POST /api/ee/stripe`, checks Stripe's signature and records the subscription on
  the row of the org id we put on it at checkout (never a comped row). Listen for
  `checkout.session.completed` and `customer.subscription.created`, `.updated` and `.deleted`. A
  failed payment or a cancel emails the owner through `integrations/email.ts`.
- **Seats** follow People: adding or removing a person updates the subscription's quantity,
  prorated.

**Invite-only sign-up.** `/signup` asks for a sign-up code, the business's name, the owner's name
and email. A code is 12 letters and digits (no 0, 1, I, L or O), works once, for 30 days, and only
its hash is kept (`ee_signup_codes`, rows of the admin business). Using it makes the business through
`core/install`'s `newOrg`, the same path as `npm run org:new`: its owner, its owner email in
Settings, a 14-day trial, every agent off duty and every action type at Draft. Then the owner gets
the usual sign-in link. The admin business's owners make and end codes on Settings > Billing.
Which business is the admin is one setting, `OPERATOR_ADMIN_ORG_ID` (an org id, not a secret); with
it unset, nobody makes codes and `/signup` says sign-up is closed (`ee/admin.ts`). No business is the
admin by being first; a code is
ended, never deleted. Sign-up is the one server action with no role check, like signing in: the
code is its check (check:roles).

## Managed Claude credits (cloud edition, card 128 slice 4)

A business on the cloud edition can run without its own Claude key: it buys prepaid credits and its
runs use the deployment's key, charged at Anthropic's list price plus 20% (`ee/credit-rules.ts`).

- **Who pays** is decided in code (`billingFor` in `core/cost-rules.ts`): the business's own key
  whenever it has one (Connections > Claude API); otherwise credits on the cloud edition. The open
  edition has no credits, so a business without a key has its runs refused, as before. Every cost
  screen (proposals, setup's company chart, the Desk) shows the price on credits, margin included.
- **Packs** of $10, $25 or $50 (owners, Settings > Billing) open a one-time Stripe Checkout payment.
  The webhook adds the credit once per Checkout session, only when it is paid, in dollars, and the
  amount charged is exactly one of the packs (`checkout.session.completed` and
  `checkout.session.async_payment_succeeded` with mode `payment`).
- **A run** on credits is charged its cost from the price list times 1.2, once per run, after it
  ends. Below $0.50, runs that call Claude pause with a reason on the run log; a tapped approval is
  still applied, and nothing is deleted. A run can take the balance a little under zero (at most its
  cap); the next run waits for a top-up.
- **The deployment's key** is one setting, `OPERATOR_CLAUDE_KEY`, read only by `ee/credits.ts` and
  handed out only for a business with a plan that allows runs and at least $0.50 of credits.
- **The ledger** is `ee_credit_ledger` (migration `20261224090000_ee_credit_ledger.sql`): a row per
  pack and per run, never changed or deleted; the balance is the sum, worked out in code.

Credits only pay for the model. Caps, budgets, approval cards and the hard rules are the same on
credits and on a business's own key.
