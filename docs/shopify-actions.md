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

## Not built (each its own slice, with a spec first)

Stock at a location, product description and SEO text, discount codes (needs a cap from the owner),
marking an order shipped with tracking, refunds (moves money: needs per-refund and monthly caps from
the owner). Price changes, gift cards, cancelling orders and any delete stay out.

## Setting it up in Shopify

1. Shopify admin: **Settings**, **Apps and sales channels**, **Develop apps**, the app OPERATOR uses.
2. **Configuration**, **Admin API integration**, **Edit**: tick `write_orders` and `write_customers`,
   keep the read scopes, **Save**.
3. **API credentials**: **Install app** or **Update** when Shopify asks. If a new Admin API access
   token appears, paste it on Connections, Shopify.
