# Shopify store actions

Shopify in OPERATOR reads and writes (decided 2026-11-21: agents must be able to act, not just look).
Every change to the store is a gateway action type: an approval card first, then Act with an undo
window after 28 of its last 30 approvals went through unedited and the owner confirms, then Act, and
back to an approval card on a "wrong" rejection, a cap breach or a breaker trip (`docs/trust.md`).

## How it fits together

- **One app, one key.** The business's own Shopify custom app, pasted on Connections into the vault.
  It may carry read scopes plus only the write scopes in `SHOPIFY_WRITE_SCOPES`
  (`core/shopify-actions.ts`). A key with any other write scope is refused when pasted
  (`scopesBeyond`). A key with read scopes only still works for reads; approved store actions then
  fail with a message naming the scope to add.
- **Reads can't write.** Read tools run the fixed queries in `core/shopify-rules.ts`, and
  `shopifyQuery` refuses anything that isn't a single query.
- **Writes are fixed.** Each write tool runs one mutation from `SHOPIFY_MUTATIONS`
  (`core/shopify-actions.ts`), and `shopifyMutate` refuses any other document.
  `scripts/validate-graphql.mjs` fails on a mutation in any other file, and `check:mcp` checks each
  one is named on the Shopify profile (`core/mcp-rules.ts`), has no delete, remove, cancel or refund,
  and is refused by the read path.
- **Only the gateway writes.** `callWriteTool("shopify", …)` is called only from `core/gateway`, after
  the approval (or the trust level) allows it. Every apply re-checks the allow-list, the app's live
  scopes and the record's live state, and stores before, after and what to put back (`undo_json`).
- **Granted per agent by an approver**, on the builder's Tools step. A head's proposal or Avery's
  design can never hand out a store action.

## Action types

### `shopify.add_tags` (slice 1)

Adds 1 to 5 tags to one order or one customer. Write tool `shopify_add_tags`, mutation `tagsAdd`.

- **Target**: a Shopify order or customer id (`gid://shopify/Order/…`, `gid://shopify/Customer/…`),
  always a pick from a Recent orders result (`shopify_recent_orders`), never typed by the model.
- **Args**: `tags` only. Each at most 40 characters of letters, numbers, spaces, dashes and
  underscores, no repeats (`refuseTags`).
- **Scopes**: `write_orders` for an order, `write_customers` for a customer.
- **Apply**: reads the record's tags (`TAGS_OF`), adds only the ones not there (case-insensitive,
  `planTags`), and records `undo_json.tags_remove` with exactly those, so undo never removes a tag
  someone set by hand. At most `policies.max_shopify_writes_per_run` (25) per apply.
- **Card**: the order or customer, the tags, and the agent's one-line why.
- Starts at Draft, promotable.

### `shopify.set_stock` (slice 2)

Sets the available count of one inventory item at one location. Write tool `shopify_set_stock`,
mutation `inventorySetQuantities` (name `available`) with `@idempotent`, keyed by the action's id.

- **Target**: `<inventory item gid>@<location gid>`, always a pick from a Stock levels result
  (`shopify_stock_levels`), never typed by the model. The pick also carries the count the row showed,
  which becomes `from`.
- **Args**: `from` (the count the card was staged against), `available` (the new count, a whole
  number from 0 to 10,000, at most 100 units away from `from`: `STOCK_LIMITS`, a limit in code), and
  `reason`, one of Shopify's codes in `STOCK_REASONS` (received, correction, cycle_count_available,
  damaged, shrinkage). Nothing else (`refuseStock`).
- **Scope**: `write_inventory`.
- **Apply**: reads the live count (`STOCK_OF`). If it isn't `from` any more, the action is refused
  with "Stock changed since this was staged" and nothing is written (`planStock`). The write passes
  `changeFromQuantity: from`, so Shopify refuses it too if the count moves in between
  (`CHANGE_FROM_QUANTITY_STALE`, recorded as a refusal). Records `undo_json` = `{ set_available: from,
  only_if_available: available }`: an undo may put the count back only while the store still shows the
  count this action set (`mayUndoStock`), so a count someone changed since is never overwritten. At most
  `policies.max_shopify_writes_per_run` (25) per apply, shared with tags.
- **Card**: the item at its location, "12 → 40 (+28)", the reason and the agent's one-line why (where
  the number comes from).
- Starts at Draft and is **never promoted** (`promotable: false`): the new count comes from the agent
  reading a count sheet, an email or a note, and numbers come from code, not a model (decided 2026-11-21).
  A later slice may add a promotable change whose number is computed in code.
- Not in this slice: on hand, committed and incoming counts, moving stock between locations,
  turning tracking on or off, new locations.

### `shopify.update_copy` (slice 3)

Sets a new description and/or SEO title and description on one product. Write tool
`shopify_update_copy`, mutation `productUpdate` naming only the product id, `descriptionHtml` and
`seo { title description }` in the document itself (`COPY_SET`), so no title, price, status, tags or
handle can be sent.

- **Target**: a product gid, always a pick from a Product copy result (`shopify_product_copy`), never
  typed by the model. The pick also carries the fingerprint of the copy as it stood (`before`, from
  `copyPrint` over the description HTML and SEO text), the copy itself for the card, and the facts the
  product's own data allows.
- **Args**: `before`, plus at least one of `description` (plain text, up to 4,000 characters; a blank
  line starts a paragraph, lines starting with "- " make bullets), `seo_title` (up to 70) and
  `seo_description` (up to 320). No HTML, entities, links or control characters (`refuseCopy`). Code
  builds the HTML (`copyHtml`): `<p>`, `<br>`, `<ul><li>`, everything escaped.
- **Facts only from Shopify** (`refuseCopyFacts`): every number in the new text, and every claim word in
  `CLAIM_WORDS` (certified, organic, fair trade, B Corp, kosher, halal, vegan, gluten-free, non-GMO, USDA,
  award-winning), must already be in the product's Shopify data: title, description, type, vendor, tags,
  SEO text and the fact fields chosen on Settings › What agents may say about your products. Checked
  when the card is staged (against the pick) and again on the server right before the write (against
  the live product). Origins and other plain-language claims are for the approver to check on the card.
- **Scope**: `write_products`. Shopify has nothing narrower and it also covers prices and deleting
  products; our server sends only `COPY_SET`, so the server is the limit, and Connections says so.
- **Apply**: reads the live product (`COPY_OF`). If its fingerprint isn't `before` any more, the action
  is refused with "Product copy changed since this was staged" (`planCopy`); if the text states a fact
  the live data doesn't, it is refused with the words that broke it. A field left out is sent back as it
  stands. Records `diff_json` (description HTML and SEO text before and after) and `undo_json` =
  `{ set_copy: <before>, only_if_print: <fingerprint of what it set> }`: an undo may put the old copy
  back only while the store still shows what this action set (`mayUndoCopy`). At most
  `policies.max_shopify_writes_per_run` (25) per apply, shared with tags and stock.
- **Card**: the product, then each changed field's words before (struck through) and after, then the
  agent's one-line why.
- Starts at Draft, **promotable** (28 of the last 30 unedited), like posts: the facts checks run on every
  write, so they hold after promotion too (decided 2026-11-22).
- Not in this slice: the product title, images, variants, tags, status, handle and prices.

### `shopify.mark_shipped` (slice 5)
Marks every remaining item on one order shipped, with one carrier and tracking number. Write tool
`shopify_mark_shipped`, mutation `fulfillmentCreate` (`SHIP_CREATE`) with `notifyCustomer: true` and
`trackingInfo { company number }` written in the document itself, so no tracking link, message or
line-item subset can be sent. Shopify builds the tracking link from the carrier and emails the
customer its own shipping confirmation (decided 2026-11-22). That is the only customer email any store
action causes, and it is Shopify's template, not text a model wrote.

- **Target**: an order gid, always a pick from an Orders to ship result (`shopify_orders_to_ship`),
  never typed by the model. The pick also carries the order's open fulfillment order ids, which is
  what the change is staged against.
- **Args**: exactly `fulfillment_orders` (1 to 10 FulfillmentOrder gids, from the pick), `carrier` (one of
  `CARRIERS`: USPS, UPS, FedEx, DHL Express, Canada Post, Royal Mail, Australia Post) and `tracking`
  (spaces and dashes dropped, upper case, and it must fit that carrier's number shape) (`refuseShip`).
- **What can be marked here** (`shippable`): an open order that isn't archived, with items left, every
  open fulfillment order shipped by the business itself (`CREATE_FULFILLMENT`, not sent to a fulfillment
  app), by shipping (not pickup or local delivery), not on hold, all from one location, and not partly
  shipped already. Any other order shows in Orders to ship with the reason and no pick: the owner does
  it in Shopify.
- **Scope**: `write_merchant_managed_fulfillment_orders` (and its read scope for Orders to ship). It
  can't touch orders a fulfillment app handles.
- **Apply**: reads the live order (`SHIP_OF`). If it can't be marked here now, or its open fulfillment
  orders aren't exactly the card's, it is refused and nothing is written (`planShip`). A tracking number
  already used on another order's applied ship card in the last 60 days is refused
  (`SHIP_REPEAT_DAYS`); numbers typed by hand in Shopify aren't seen by this check. The write carries an
  idempotency key (the action's id). Records `diff_json` and `result_json` with
  `customer_emailed: true`. No undo: an email can't be taken back, so `undo_json` is null.
- **Card**: the order, how many items, the carrier and tracking number, and a line saying Shopify will
  email the customer.
- **Draft only, never promoted** (decided 2026-11-22): it emails a customer, and a wrong tracking
  number can't be unsent. Granted only by an approver on the Tools step ("Mark an order shipped").
- Not in this slice: shipping part of an order, more than one location, a custom carrier or link,
  editing or cancelling a fulfillment, and orders a fulfillment app handles.

## Not built (each its own slice, with a spec first)

Product titles, discount codes (needs a cap from the owner), refunds (moves money: needs per-refund and monthly caps from
the owner). Price changes, gift cards, cancelling orders and any delete stay out.

## Setting it up in Shopify

The write scopes are `write_orders` and `write_customers` (tags), `write_inventory` (stock),
`write_products` (product copy) and `write_merchant_managed_fulfillment_orders` (mark shipped; add
`read_merchant_managed_fulfillment_orders` too). Add only the ones for the actions you'll grant.

**A Dev Dashboard app** (new custom apps are made there; the key is a client secret):

1. dev.shopify.com, **Apps**, the app OPERATOR uses, **Versions**, **Create version**.
2. In **API access**, **Scopes**, add the write scopes to the end of the comma-separated list. Keep
   the read scopes. Leave **Optional scopes** empty.
3. Scroll down and click **Release**. The new version shows as **Active**.
4. Approve the new scopes for the store: back on the app's **Overview**, **Installs** box, **Test
   app**, pick the store, and approve the updated permissions.
5. Check in Shopify admin: **Settings**, **Apps**, the app. **Edit** shows **Granted** on Orders and
   Customers (tags), Products (stock and product copy), or Fulfillment orders (mark shipped). Nothing to paste again: the client secret stays the same, and
   OPERATOR picks up the new scopes within an hour.

**A legacy custom app** (made in Shopify admin before Dev Dashboard; the key is `shpat_…`):

1. Shopify admin: **Settings**, **Apps**, **Develop apps**, the app OPERATOR uses.
2. **Configuration**, **Admin API integration**, **Edit**: tick the write scopes, keep the read
   scopes, **Save**.
3. **API credentials**: **Install app** or **Update** when Shopify asks. If a new Admin API access
   token appears, paste it on Connections, Shopify.
