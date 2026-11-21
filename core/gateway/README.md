# Tool gateway

Every write an agent wants to make outside its own tables goes through here. Agents never
call a write tool: `callWriteTool` (integrations/mcp.ts) can only be imported from
`core/gateway/` (enforced in `eslint.config.mjs` and `check:mcp`), and every write tool is named
on a profile in `core/mcp-rules.ts`.

- `policy.ts`: the rules in plain code. `TOOLS` is the allow-list of write tools, which
  agents may use each one, its starting tier (always Draft), whether it may ever be promoted, and its
  fields. `refuseProposal` checks a proposal;
  `planWrite` re-checks it against Mercury's live state right before a write.
- `index.ts`: `propose` (refuse, or record in `agent_actions` at the agent's trust level for that tool:
  an approval card at Draft, scheduled at Act with undo, approved at Act), `queueBookkeeperProposals`,
  `decide` (a rejection says why; wrong or policy drops the type back to Draft), `cancelScheduled`,
  `applyTrusted` (the scheduler's round), `expireStale`, `retry`, `applyApproved`.
- Trust levels: `core/trust.ts` and `core/trust-rules.ts`, explained in `docs/trust.md` (card 7).

Sending, payments and posting are allowed by the tech spec only as gateway action types
with approval levels and caps (see CLAUDE.md). None of them is built yet, so no agent has
one of those integrations.

## Proposals from agents built in the app (docs/agent-builder.md, slice 5)

The runner (`core/runner.ts`) stages a proposal when the model calls an action tool, and after a
run that finishes calls `propose` here, with the run id. The gateway's checks are the same as for
Quinn's proposals: `refuseProposal` (allow-list of agents and fields), then the live re-check in
`applyOne` before any write. The runner never imports a write integration.

## Who may propose an action (card 250)

Each entry in `TOOLS` says who may propose it (`agents`):

- **A list of agent ids**: only those agents. Today's three action types work this way, and Mercury
  writes stay CFO and Bookkeeper only by hard rule.
- **`"granted"`**, with `grant` naming the action's catalog tool: any agent whose active saved spec
  holds that tool. Only an approver gives it, on the builder's Tools step (`createBuilt` and
  `saveSpec`). A template (`crewProblems`), a proposal (`grant_tool`, `hire`) and a department Avery
  designs (`departmentProblems`) can't hand one out.

The gateway checks a granted action twice: `propose` reads the agent's active spec (`refuseAgent`),
and `applyApproved` refuses, rather than applies, any approved granted action whose agent no longer
holds the tool (`refuseUngranted`). That covers actions released from the undo window too.

## `mailchimp.campaign_draft` (card 252)

A draft campaign in the business's Mailchimp, to one of its own audiences, for the owner to send from
Mailchimp. Granted: any agent an approver gives `mailchimp_campaign_draft` to. The audience is a pick
from `mailchimp_audiences`; `refuseMailchimpCampaign` checks the words on proposal and again in
`applyMailchimpOne`, and the server reads the audience again right before it writes. Needs the
Mailchimp campaign drafts key on Connections; until then approved drafts wait.

## `hubspot.deal_stage` (card 253)

Moves one deal in the business's HubSpot to another stage of its own pipeline and logs a note on it
saying why. It emails no one. Granted: any agent an approver gives `hubspot_move_deal` to. The deal and
the stage are picks from `hubspot_deals`. `refuseMove` checks the stage id and the note on proposal and
again in `applyHubSpotMove`. Right before it writes, the server reads the deal's pipeline as HubSpot
lists it, and refuses a stage outside that pipeline or the deal's current stage. The stage before and
after go into `diff_json`. It starts at Draft and may be promoted. It needs the HubSpot deal moves key
on Connections; until that is connected, approved moves wait.

## `meta.pause_ad` (card 255)

Pauses one running ad in the business's Meta ad account whose cost per result is over the owner's
target for that result (Connections > Meta Ads pauses). Granted: any agent an approver gives
`meta_pause_ad` to. The ad is a pick from `meta_ad_results`; the proposal carries the result kind, the
period and a reason, never a target or a budget (`refusePause`, on proposal and again in
`applyMetaPause`). On apply the gateway reads the owner's target again (none: refused), and the server
reads the ad again: still running and still over the target, or refused. The status before and after
go into `diff_json`. It starts at Draft and may be promoted. It needs the Meta Ads pauses sign-in on
Connections; until that is connected, approved pauses wait.

## `woocommerce.order_note` (card 254)

One private note on one order in the business's WooCommerce store. Store staff see it; the customer
doesn't, and isn't emailed. Granted: any agent an approver gives `woo_order_note` to. The order is a
pick from `woo_orders`; `refuseNote` checks the note on proposal and again in `applyWooNote`, and the
server reads the order again on the same key right before it writes. Starts at Draft and may be
promoted (28 of the last 30 approvals unedited). Needs the WooCommerce order notes key on
Connections; until then approved notes wait.

## `calendar.hold` (card 251)

A private hold on the business's primary Google Calendar: a title, a start and an end, nothing else.
Granted: any agent an approver gives `calendar_hold` to. The time is a free slot from
`calendar_free_time`, picked by code, so an event title can't choose it. `refuseHold` checks the
fields on proposal and again in `applyHold`; the Calendar holds server checks the time is still free
right before it writes (a taken slot is refused, not retried). The event is private and busy, has no
guests and is inserted with `sendUpdates=none`, so no one is emailed. Starts at Draft and may be
promoted (28 of the last 30 approvals unedited). Needs the Calendar holds sign-in on Connections;
until then approved holds wait.

## `gmail.create_draft` (slice 7)

A plain-text draft in the business's Gmail, to a lead on the leads list (`wholesale_leads`). Only
`wholesale_hunter`. Draft tier, and `promotable: false`: a first email to someone stays
approval-only for good. The owner still sends each draft from Gmail.

- The proposal holds only `subject` and `body` (no links, no control characters; the body keeps
  line breaks). The target is the lead's id. There is no recipient field: the gateway reads the
  address from the lead's row, at proposal time and again when it makes the draft.
- Refused when the lead has no address, the address is in `email_suppressions`, or the lead is
  marked lost or skip (`refuseDraftTo`).
- Proposed by Rowan's leads list report (`report_leads`, for each new lead with an address,
  when the spec also grants `gmail_draft_lead` and Gmail is connected) or by the model through
  `gmail_draft_lead`, naming a lead from a Leads list result.
- Applying needs the gateway's own "Gmail drafts" sign-in (Connections, Gmail; `gmail.compose`
  only, through `callWriteTool("gmail", "gmail_create_draft")`), `DASHBOARD_CONTROLS=on` and Rowan on duty; at most
  `policies.max_gmail_drafts_per_run` (10) per apply. The lead moves from new to drafted.

## `klaviyo.campaign_draft` (card 159b)

A draft email campaign in the business's Klaviyo, to one of its own lists. Only `campaign_writer`.
Draft tier, `promotable: true` (a list of people who signed up, and the app never sends it). The owner
sends each campaign from Klaviyo: nothing in the app can send, schedule, cancel or delete one.

- The proposal holds only `subject` (at most 50 characters), `preview` (at most 90) and `body` (at
  most 3,000, plain text). No links, no Klaviyo template tags, no control characters
  (`refuseCampaign` in `core/klaviyo-draft-rules.ts`). The target is the Klaviyo list id, which the
  model names only by a pick code from an Email lists result.
- The list must be on the business's Klaviyo lists, read by code through the read-only sign-in, when
  proposed and again when applied (`refuseCampaignTo`); the drafts server reads it once more on its own
  key right before the write.
- Applying needs the gateway's own "Klaviyo campaign drafts" key (Connections, Klaviyo; a private key
  with campaigns:write, templates:write and lists:read only, refused when it can read profiles, flows or
  metrics), through `callWriteTool("klaviyo_drafts", "klaviyo_create_draft")`, with
  `DASHBOARD_CONTROLS=on` and the Campaign writer on duty; at most `policies.max_campaign_drafts_per_run`
  (3) per apply. The server makes a template (the body, escaped, plus Klaviyo's unsubscribe tag added by
  code) and a draft campaign, and returns their ids.

## `mercury.annotate_transaction`

Receipt attachment, category and memo on a Mercury transaction that already exists. Only
`bookkeeper` and `cfo`. Draft tier: every action waits for the owner.

1. Quinn saves proposals on `expense_docs` (`proposal_*`) and, at the end of a real run,
   calls `queueBookkeeperProposals`: one `agent_actions` row (`proposed`) and one `approvals`
   row (`pending`) per charge. The Control Room's "Check for Quinn's proposals" does the same.
2. An approver approves or rejects in the Control Room (`/approvals`). Pending items older than
   `policies.approval_expiry_hours` (72) expire as stale.
3. Applying needs the gateway's Mercury sign-ins on Connections (Mercury writes for category and
   memo, Mercury receipt files for the file), `DASHBOARD_CONTROLS=on`, and the agent on duty
   (`applyApproved` runs inside `withRun(agent, "approval")`, so it is logged at $0 and
   skipped while `agents.enabled = false`). Approved items wait until all three hold.
4. Before each write the gateway re-checks: the fields are on the allow-list; the charge is
   in `expense_docs` and not marked personal; Mercury still has it, settled, for the same
   amount; the category is in Mercury's list. It never replaces a category, memo or
   attachment that is already there (that field is skipped and the reason logged). The
   receipt file must be that transaction's own object in the private `receipts` bucket.
5. Result, before/after (`diff_json`) and what to put back (`undo_json`) are stored on the
   action. At most `policies.max_mercury_writes_per_run` (20) per apply.

Mercury endpoints used (the only writes in the repo): `PATCH /api/v1/transaction/{id}` with
`note` and/or `categoryId`, and `POST /api/v1/transaction/{id}/attachments` (multipart,
`attachmentType=receipt`). `GET /api/v1/transaction/{id}` (read token) for the live check.

## `shopify.add_tags` (docs/shopify-actions.md)

Tags added to one Shopify order or customer. Any agent an approver grants "Tag an order or customer"
on the Tools step. Draft tier, `promotable: true` (a label on the business's own records, fully undoable).

- The target is a Shopify order or customer id, a pick from a Recent orders result. The proposal holds
  only `tags` (1 to 5, short, plain: `refuseTags` in `core/shopify-actions.ts`).
- Applying needs Shopify connected with `write_orders` (orders) or `write_customers` (customers) on the
  app, through `callWriteTool("shopify", "shopify_add_tags")`, `DASHBOARD_CONTROLS=on` and the agent on
  duty; at most `policies.max_shopify_writes_per_run` (25) per apply. The server re-checks the scopes and
  the live tags, adds only the missing ones (Shopify's `tagsAdd`), and the action stores
  `undo_json.tags_remove` with exactly those.

## `shopify.set_stock` (docs/shopify-actions.md)

The available count of one Shopify item at one location. Any agent an approver grants "Set stock at a
location" on the Tools step. Draft tier, `promotable: false` (the number comes from the agent, and
numbers come from code: it always waits for an approver).

- The target is `<inventory item>@<location>`, a pick from a Stock levels result, which also carries the
  count the row showed (`from`). The proposal holds only `from`, `available` (0 to 10,000, at most 100
  units from `from`) and one of Shopify's reasons (`refuseStock` in `core/shopify-actions.ts`).
- Applying needs Shopify connected with `write_inventory`, through `callWriteTool("shopify",
  "shopify_set_stock")`; at most `policies.max_shopify_writes_per_run` (25) per apply. The server
  re-checks the scope and the live count (refused if it moved), then writes with `changeFromQuantity`
  and an idempotency key (the action's id). The action stores `undo_json` = the count before, valid only
  while the count is still the one it set.

## Caps, vendors and suppressed addresses

The fences the payment and email action types will have to pass. Neither action type exists yet.

- `CAPS` in `policy.ts`: per purchase ($500), per calendar month ($1,500), emails per day (20),
  undo window (30 minutes). The owner's values are rows in `policies`; each has a limit in code that
  `effectiveCap` never lets a row pass. The owner changes them on Settings; agents
  never write `policies`.
- `checkPurchase`: payee must be in `vendors` with a Mercury recipient; amount within the
  per-purchase cap; this month plus the amount within the monthly cap (cents, in code). A first
  payment to a vendor is flagged so it always waits for the owner.
- `checkEmail`: never to an address in `email_suppressions`, never past today's cap, and for an
  agent seated in a department never past that department's cap (never above the company cap).
- `index.ts`: `loadCaps`, `monthSpentUsd` and `emailsSentToday` (month and day in the business's time zone, from
  applied actions), `paidVendorIds`, and `onBreach`, where the trust levels card will demote
  the action type to Draft.
- Only a signed-in the owner adds vendors (Settings, `DASHBOARD_CONTROLS=on`).
- `npm run check:policy` exercises the checks.

Not built yet: the Notion approvals database, Act tier and promotion, circuit breakers,
an Undo button, and Edit on an approval (reject it instead).

## Lead checks (departments slice 4)

When an agent's department has "Lead checks drafts first" on, `propose` tags the approval with the agent above it on the org chart (`reviewer_agent_id`, `review_status = 'waiting'`, `review_due` a day out). `leadReview` takes that agent's check after its run: a note, or one send-back (`sent_back` on the approval and the action, not a decision of the owner's). `releaseOverdueChecks` moves unchecked drafts to the owner. A lead never approves, rejects or edits; `decide` is still the only approval. See docs/org-chart.md, slice 4.
