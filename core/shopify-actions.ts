// Store actions on our own Shopify MCP server (docs/shopify-actions.md). Pure, so the server, the
// gateway and the checks build on the same rules. Each write tool runs one fixed mutation, named here
// and nowhere else (scripts/validate-graphql.mjs fails on a mutation in any other file), and only
// core/gateway calls one, through callWriteTool, after an approver approves or the trust ladder allows
// it. A model never writes GraphQL, a target id or a scope: the target is a Shopify id from a read
// result, picked by code; the tags are checked here.
import { gql } from "@/core/shopify-rules";

/** The write scopes the Shopify profile asks for. A key with any other write scope is refused. */
export const SHOPIFY_WRITE_SCOPES = ["write_orders", "write_customers", "write_inventory"] as const;

/** Gateway action type: add tags to one order or one customer. Undo removes only the tags it added. */
export const SHOPIFY_TAGS = "shopify.add_tags";
/** The write tool on our Shopify server that applies it. */
export const SHOPIFY_TAGS_TOOL = "shopify_add_tags";
/** The builder's tool an approver grants (core/tools/catalog.ts). */
export const SHOPIFY_TAGS_GRANT = "shopify_tag";

export type ShopifyTarget = { kind: "Order" | "Customer"; gid: string };
const GID = /^gid:\/\/shopify\/(Order|Customer)\/(\d{1,20})$/;
/** A target the gateway accepts: an order or a customer, by its Shopify id. */
export function shopifyTarget(target: string): ShopifyTarget | null {
  const m = GID.exec(target);
  return m ? { kind: m[1] as ShopifyTarget["kind"], gid: target } : null;
}
/** The write scope a tag change on this target needs (a stock change needs write_inventory). */
export const scopeFor = (t: ShopifyTarget) => (t.kind === "Order" ? "write_orders" : "write_customers");

export const TAG_LIMITS = { tags: 5, chars: 40 } as const;
const TAG = /^[A-Za-z0-9][A-Za-z0-9 _-]*$/;

/** Splits "a, b" into tags, trimmed, without repeats (case-insensitive), in order. */
export function tagList(v: unknown): string[] {
  const raw = Array.isArray(v) ? v.map(String) : String(v ?? "").split(",");
  const out: string[] = [];
  for (const t of raw.map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean)) if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  return out;
}

/** Why the tags are refused, or null: 1 to 5 short tags of letters, numbers, spaces, dashes and underscores, and nothing else in the proposal. */
export function refuseTags(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => k !== "tags");
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A tag change holds only tags.`;
  if (!Array.isArray(args.tags) || args.tags.some((t) => typeof t !== "string")) return "tags must be a list of words.";
  const tags = args.tags as string[];
  if (!tags.length) return "Name at least one tag.";
  if (tags.length > TAG_LIMITS.tags) return `At most ${TAG_LIMITS.tags} tags at once.`;
  if (tagList(tags).length !== tags.length) return "A tag is listed twice or is blank.";
  for (const t of tags) {
    if (t.length > TAG_LIMITS.chars) return `"${t.slice(0, 20)}…" is longer than ${TAG_LIMITS.chars} characters.`;
    if (!TAG.test(t) || t !== t.trim()) return `"${t.slice(0, 40)}" may hold only letters, numbers, spaces, dashes and underscores.`;
  }
  return null;
}

/**
 * What a tag change still has to do against the store's live tags: only tags not already there, compared
 * the way Shopify does (case-insensitive). Undo removes exactly `add`, so a tag someone set by hand is
 * never taken off.
 */
export function planTags(want: readonly string[], live: readonly string[]): { add: string[]; skipped: string[] } {
  const have = new Set(live.map((t) => t.toLowerCase()));
  return { add: want.filter((t) => !have.has(t.toLowerCase())), skipped: want.filter((t) => have.has(t.toLowerCase())) };
}

// The live tags of one order or customer, read right before the write. A read, so it may live here.
export const TAGS_OF = gql`
  query AgentTagsOf($id: ID!) {
    node(id: $id) {
      ... on Order { id name tags }
      ... on Customer { id tags numberOfOrders }
    }
  }
`;

// The only Shopify write in the repo for this action type: add tags. Never removes or replaces.
export const TAGS_ADD = gql`
  mutation AgentTagsAdd($id: ID!, $tags: [String!]!) {
    tagsAdd(id: $id, tags: $tags) { node { id } userErrors { field message } }
  }
`;

// ---------- slice 2: set the available count of one variant at one location ----------

/** Gateway action type: set the available count of one inventory item at one location. Draft only, never promoted. */
export const SHOPIFY_STOCK = "shopify.set_stock";
/** The write tool on our Shopify server that applies it. */
export const SHOPIFY_STOCK_TOOL = "shopify_set_stock";
/** The builder's tool an approver grants (core/tools/catalog.ts). */
export const SHOPIFY_STOCK_GRANT = "shopify_stock";

/**
 * The limits on one stock change, in code (decided 2026-11-21): a count from 0 to 10,000, moved at most
 * 100 units up or down from the count the card was staged against.
 */
export const STOCK_LIMITS = { max: 10_000, change: 100 } as const;
/** Shopify's own reason codes an agent may give. Anything else is refused. */
export const STOCK_REASONS = ["received", "correction", "cycle_count_available", "damaged", "shrinkage"] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export type StockTarget = { item: string; location: string };
const ITEM = /^gid:\/\/shopify\/InventoryItem\/\d{1,20}$/;
const LOCATION = /^gid:\/\/shopify\/Location\/\d{1,20}$/;
/** The target of a stock change: "<inventory item gid>@<location gid>", as a Stock levels row names it. */
export function stockTarget(target: string): StockTarget | null {
  const [item, location, more] = target.split("@");
  return more === undefined && ITEM.test(item ?? "") && LOCATION.test(location ?? "") ? { item, location } : null;
}
export const stockTargetOf = (item: string, location: string) => `${item}@${location}`;
/** An idempotency key for one stock change: the gateway action's id. */
export const stockKeyOk = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v);

const whole = (v: unknown, lo: number, hi: number) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Why a stock change is refused, or null: `from` (the count the card was staged against), `available`
 * (the new count) and `reason`, nothing else; both counts 0 to 10,000; a real change of at most 100 units.
 */
export function refuseStock(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => !["from", "available", "reason"].includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A stock change holds only the count before, the new count and a reason.`;
  if (!whole(args.from, -1_000_000, 1_000_000)) return "from must be the whole count the Stock levels row showed.";
  if (!whole(args.available, 0, STOCK_LIMITS.max)) return `The new count must be a whole number from 0 to ${STOCK_LIMITS.max.toLocaleString("en-US")}.`;
  const change = (args.available as number) - (args.from as number);
  if (change === 0) return "That is already the count.";
  if (Math.abs(change) > STOCK_LIMITS.change) return `A change of ${Math.abs(change)} units is over the limit of ${STOCK_LIMITS.change} per change.`;
  if (!STOCK_REASONS.includes(args.reason as StockReason)) return `reason must be one of: ${STOCK_REASONS.join(", ")}.`;
  return null;
}

/**
 * What a staged stock change may still do against the live count: write only when the store still shows
 * the count the card was staged against (Shopify's changeFromQuantity checks it again as it writes).
 */
export function planStock(from: number, available: number, live: number | null): { write: true } | { refuse: string } {
  if (live === null) return { refuse: "This item isn't stocked at that location any more." };
  if (live !== from) return { refuse: `Stock changed since this was staged (it was ${from}, it is ${live} now). Nothing was written.` };
  return available === live ? { refuse: "That is already the count." } : { write: true };
}

/**
 * Whether an undo of a stock change may put the count back: only while the store still shows the count
 * the action set, so a count someone changed since is never overwritten.
 */
export const mayUndoStock = (set: number, live: number | null) => live === set;

// The live count of one item at one location, read right before the write. A read, so it may live here.
export const STOCK_OF = gql`
  query AgentStockOf($item: ID!, $location: ID!) {
    inventoryItem(id: $item) {
      id tracked sku
      variant { title product { title } }
      inventoryLevel(locationId: $location) { id location { id name } quantities(names: ["available"]) { name quantity } }
    }
  }
`;

// The only Shopify write in the repo for this action type: set the available count, compared against the
// count it was staged against. The idempotency key is the gateway action's id, so a retry never applies twice.
export const STOCK_SET = gql`
  mutation AgentStockSet($input: InventorySetQuantitiesInput!, $key: String!) {
    inventorySetQuantities(input: $input) @idempotent(key: $key) { inventoryAdjustmentGroup { id } userErrors { field message code } }
  }
`;

/** Every mutation our Shopify server may run, by write tool. The server refuses any other document. */
export const SHOPIFY_MUTATIONS: Readonly<Record<string, string>> = { [SHOPIFY_TAGS_TOOL]: TAGS_ADD, [SHOPIFY_STOCK_TOOL]: STOCK_SET };

/** A document is exactly one of the fixed mutations above. */
export function assertFixedMutation(doc: string): void {
  if (!Object.values(SHOPIFY_MUTATIONS).includes(doc)) throw new Error("only a fixed store action may change Shopify");
}
