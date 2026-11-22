// Store actions on our own Shopify MCP server (docs/shopify-actions.md). Pure, so the server, the
// gateway and the checks build on the same rules. Each write tool runs one fixed mutation, named here
// and nowhere else (scripts/validate-graphql.mjs fails on a mutation in any other file), and only
// core/gateway calls one, through callWriteTool, after an approver approves or the trust ladder allows
// it. A model never writes GraphQL, a target id or a scope: the target is a Shopify id from a read
// result, picked by code; the tags are checked here.
import { gql } from "@/core/shopify-rules";

/** The write scopes the Shopify profile asks for. A key with any other write scope is refused. */
export const SHOPIFY_WRITE_SCOPES = ["write_orders", "write_customers", "write_inventory", "write_products", "write_merchant_managed_fulfillment_orders", "write_discounts"] as const;

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

// ---------- slice 3: a product's description and SEO text ----------

/** Gateway action type: a new description and/or SEO title and description on one product. Promotable. */
export const SHOPIFY_COPY = "shopify.update_copy";
/** The write tool on our Shopify server that applies it. */
export const SHOPIFY_COPY_TOOL = "shopify_update_copy";
/** The builder's tool an approver grants (core/tools/catalog.ts). */
export const SHOPIFY_COPY_GRANT = "shopify_copy";

/** The longest text an agent may write in each field. */
export const COPY_LIMITS = { description: 4000, seo_title: 70, seo_description: 320 } as const;
export const COPY_FIELDS = ["description", "seo_title", "seo_description"] as const;
export type CopyField = (typeof COPY_FIELDS)[number];

const PRODUCT = /^gid:\/\/shopify\/Product\/\d{1,20}$/;
/** The target of a copy change: one product, by its Shopify id from a Product copy row. */
export const productTarget = (target: string) => PRODUCT.test(target);

/** A short fingerprint of a product's copy (FNV-1a over the three values), so a card knows what it was written against. */
export function copyPrint(descriptionHtml: string | null, seoTitle: string | null, seoDescription: string | null): string {
  const s = [descriptionHtml ?? "", seoTitle ?? "", seoDescription ?? ""].join("\u0000");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}
const PRINT = /^[0-9a-f]{8}$/;

/**
 * Words that claim a certification or a standing. A new text may use one only when the product's own
 * Shopify data already does, so an agent can't award a product "organic" or "award-winning".
 */
export const CLAIM_WORDS: readonly { word: string; re: RegExp }[] = [
  { word: "certified", re: /\bcertifi(?:ed|cation)\b/i },
  { word: "organic", re: /\borganic(?:ally)?\b/i },
  { word: "fair trade", re: /\bfair[\s-]?trade\b/i },
  { word: "B Corp", re: /\bb[\s-]?corp(?:oration)?\b/i },
  { word: "kosher", re: /\bkosher\b/i },
  { word: "halal", re: /\bhalal\b/i },
  { word: "vegan", re: /\bvegan\b/i },
  { word: "gluten-free", re: /\bgluten[\s-]?free\b/i },
  { word: "non-GMO", re: /\bnon[\s-]?gmo\b/i },
  { word: "USDA", re: /\busda\b/i },
  { word: "award-winning", re: /\baward(?:s|[\s-]?winning)?\b/i },
];

/** The numbers in a text, written the way they compare: commas between digits dropped, so "1,000" and "1000" match. */
export function numbersIn(text: string): string[] {
  return [...new Set((text.replace(/(\d),(?=\d{3}\b)/g, "$1").match(/\d+(?:\.\d+)?/g) ?? []).map((n) => n.replace(/^0+(?=\d)/, "")))];
}
/** The claim words a text uses, by their canonical name. */
export const claimsIn = (text: string) => CLAIM_WORDS.filter((c) => c.re.test(text)).map((c) => c.word);

/** What a product's own Shopify data allows a new text to state: the numbers and claim words already in it. */
export type CopyFacts = { numbers: string[]; claims: string[] };
export function copyFacts(parts: readonly (string | null | undefined)[]): CopyFacts {
  const all = parts.filter((p): p is string => typeof p === "string" && p.length > 0).join("\n");
  return { numbers: numbersIn(all), claims: claimsIn(all) };
}

/**
 * Why a new text states something the product's Shopify data doesn't, or null: every number and every
 * claim word in it must already be there (the hard rule: facts come from Shopify, never the model).
 */
export function refuseCopyFacts(text: string, facts: CopyFacts): string | null {
  const nums = numbersIn(text).filter((n) => !facts.numbers.includes(n));
  const claims = claimsIn(text).filter((c) => !facts.claims.includes(c));
  if (!nums.length && !claims.length) return null;
  const bits = [nums.length ? `the number${nums.length === 1 ? "" : "s"} ${nums.slice(0, 5).join(", ")}` : "", claims.length ? `"${claims.join('", "')}"` : ""].filter(Boolean);
  return `The new text says ${bits.join(" and ")}, which this product's Shopify data doesn't. Facts come only from Shopify; leave ${nums.length + claims.length === 1 ? "it" : "them"} out or add ${nums.length + claims.length === 1 ? "it" : "them"} to the product in Shopify first.`;
}

/** One product as the Product copy read and the live check before a write return it. */
export interface CopyProduct {
  id: string; title: string; status?: string; description: string | null; descriptionHtml: string | null; productType: string | null; vendor: string | null; tags: string[];
  seo: { title: string | null; description: string | null } | null;
  metafields: { nodes: { namespace: string; key: string; value: string | null }[] } | null;
}
/** The facts a product's own Shopify data allows: its title, description, type, vendor, tags, SEO text and the chosen fact fields. */
export const factsOf = (p: CopyProduct) => copyFacts([p.title, p.description, p.productType, p.vendor, ...p.tags, p.seo?.title, p.seo?.description, ...(p.metafields?.nodes ?? []).map((m) => m.value)]);
/** The fingerprint of a product's copy as it stands. */
export const printOf = (p: CopyProduct) => copyPrint(p.descriptionHtml, p.seo?.title ?? null, p.seo?.description ?? null);
/** All the new text in a copy change, for the facts check. */
export const copyText = (args: Record<string, unknown>) => COPY_FIELDS.map((f) => (typeof args[f] === "string" ? (args[f] as string) : "")).filter(Boolean).join("\n");

const hasMarkup = (s: string) => /<[^>]*>|&[a-z#0-9]+;|https?:\/\/|www\.|\[[^\]]*\]\([^)]*\)/i.test(s);

/**
 * Why a copy change is refused, or null: `before` (the fingerprint of the copy the card was written
 * against) and at least one of description, seo_title and seo_description, nothing else; plain text
 * within the limits, no markup, links or control characters (the description keeps line breaks).
 */
export function refuseCopy(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => k !== "before" && !(COPY_FIELDS as readonly string[]).includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A copy change holds only the description, the SEO title and the SEO description.`;
  if (typeof args.before !== "string" || !PRINT.test(args.before)) return "before must be the fingerprint of the copy the Product copy row showed.";
  const given = COPY_FIELDS.filter((f) => args[f] !== undefined);
  if (!given.length) return "Write at least one of the description, the SEO title or the SEO description.";
  for (const f of given) {
    const v = args[f];
    if (typeof v !== "string" || !v.trim()) return `${f} must be text.`;
    if (v.length > COPY_LIMITS[f]) return `${f} is ${v.length} characters, over the limit of ${COPY_LIMITS[f]}.`;
    if ((f === "description" ? /[\u0000-\u0009\u000b-\u001f]/ : /[\u0000-\u001f]/).test(v)) return `${f} may not hold control characters${f === "description" ? "" : " or line breaks"}.`;
    if (hasMarkup(v)) return `${f} must be plain text: no HTML, links or markdown links. Code builds the page's HTML.`;
  }
  return null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/**
 * The description's HTML, built in code from plain text: blank lines make paragraphs, lines starting
 * with "- " make a bullet list, everything escaped. No links, images, scripts or styling can get in.
 */
export function copyHtml(text: string): string {
  const out: string[] = [];
  for (const block of text.replace(/\r\n?/g, "\n").split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean)) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^- /.test(l))) out.push(`<ul>${lines.map((l) => `<li>${esc(l.slice(2).trim())}</li>`).join("")}</ul>`);
    else out.push(`<p>${lines.map(esc).join("<br>")}</p>`);
  }
  return out.join("\n");
}

/** What a staged copy change may still do: write only while the store's copy is the copy the card was written against. */
export function planCopy(before: string, live: string | null): { write: true } | { refuse: string } {
  if (live === null) return { refuse: "Shopify doesn't have this product any more." };
  return live === before ? { write: true } : { refuse: "Product copy changed since this was staged. Nothing was written." };
}
/** Whether an undo of a copy change may put the old text back: only while the store still shows what the action set. */
export const mayUndoCopy = (set: string, live: string | null) => live === set;

// The live copy of one product, with the data a new text may state facts from, read right before the
// write. `keys` are the fact fields chosen on Settings. A read, so it may live here.
export const COPY_OF = gql`
  query AgentCopyOf($id: ID!, $keys: [String!]!) {
    product(id: $id) {
      id title status description descriptionHtml productType vendor tags
      seo { title description }
      metafields(first: 20, keys: $keys) { nodes { namespace key value } }
    }
  }
`;

// The only Shopify write in the repo for this action type: the product's description HTML and SEO text,
// nothing else (no title, price, status, tags or handle can be named here).
export const COPY_SET = gql`
  mutation AgentCopySet($id: ID!, $html: String!, $seoTitle: String!, $seoDescription: String!) {
    productUpdate(product: { id: $id, descriptionHtml: $html, seo: { title: $seoTitle, description: $seoDescription } }) {
      product { id }
      userErrors { field message }
    }
  }
`;

// ---------- slice 5: mark an order shipped with a carrier and tracking number ----------

/** Gateway action type: mark every remaining item on one order shipped, with tracking. Draft only, never promoted. */
export const SHOPIFY_SHIP = "shopify.mark_shipped";
/** The write tool on our Shopify server that applies it. */
export const SHOPIFY_SHIP_TOOL = "shopify_mark_shipped";
/** The builder's tool an approver grants (core/tools/catalog.ts). */
export const SHOPIFY_SHIP_GRANT = "shopify_ship";
/** The write scope it needs: fulfillment orders the business ships itself (not a fulfillment app's). */
export const SHIP_SCOPE = "write_merchant_managed_fulfillment_orders";
/** How long a tracking number already used on another order is refused, in days. */
export const SHIP_REPEAT_DAYS = 60;

/**
 * The carriers an agent may name, by the company name Shopify knows (so Shopify builds the tracking link
 * itself), each with the shape its tracking numbers take. A number that doesn't fit is refused.
 */
export const CARRIERS: readonly { name: string; re: RegExp; shape: string }[] = [
  { name: "USPS", re: /^(\d{20,22}|[A-Z]{2}\d{9}US)$/, shape: "20 to 22 digits, or 2 letters, 9 digits and US" },
  { name: "UPS", re: /^1Z[0-9A-Z]{16}$/, shape: "1Z and 16 letters or digits" },
  { name: "FedEx", re: /^(\d{12}|\d{15}|\d{20}|\d{22})$/, shape: "12, 15, 20 or 22 digits" },
  { name: "DHL Express", re: /^\d{10}$/, shape: "10 digits" },
  { name: "Canada Post", re: /^(\d{16}|[A-Z]{2}\d{9}CA)$/, shape: "16 digits, or 2 letters, 9 digits and CA" },
  { name: "Royal Mail", re: /^[A-Z]{2}\d{9}GB$/, shape: "2 letters, 9 digits and GB" },
  { name: "Australia Post", re: /^([A-Z]{2}\d{9}AU|[0-9A-Z]{12,23})$/, shape: "12 to 23 letters or digits, or 2 letters, 9 digits and AU" },
];
export const CARRIER_NAMES = CARRIERS.map((c) => c.name);

/** A tracking number the way carriers print it, made comparable: spaces and dashes dropped, upper case. */
export const normTracking = (v: unknown) => String(v ?? "").replace(/[\s-]+/g, "").toUpperCase();
const FO = /^gid:\/\/shopify\/FulfillmentOrder\/\d{1,20}$/;

/**
 * Why a ship change is refused, or null: the order's open fulfillment order ids (from an Orders to ship
 * row), a carrier from the list and a tracking number in that carrier's shape, nothing else.
 */
export function refuseShip(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => !["fulfillment_orders", "carrier", "tracking"].includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A ship change holds only the order's fulfillment orders, the carrier and the tracking number.`;
  const fos = args.fulfillment_orders;
  if (!Array.isArray(fos) || !fos.length || fos.length > 10 || fos.some((f) => typeof f !== "string" || !FO.test(f)) || new Set(fos).size !== fos.length) return "fulfillment_orders must be the order's open fulfillment orders, from an Orders to ship row.";
  const carrier = CARRIERS.find((c) => c.name === args.carrier);
  if (!carrier) return `carrier must be one of: ${CARRIER_NAMES.join(", ")}.`;
  if (typeof args.tracking !== "string" || args.tracking !== normTracking(args.tracking)) return "tracking must be the tracking number without spaces.";
  if (!carrier.re.test(args.tracking)) return `${args.tracking.slice(0, 30)} isn't a ${carrier.name} tracking number (${carrier.shape}).`;
  return null;
}

/** One order as Orders to ship and the live check before a write return it. No names or addresses. */
export interface ShipOrder {
  id: string; name: string; createdAt?: string; cancelledAt: string | null; closed: boolean; displayFulfillmentStatus: string;
  fulfillmentOrders: { nodes: {
    id: string; status: string; requestStatus: string; supportedActions: { action: string }[]; fulfillmentHolds: { id: string }[];
    deliveryMethod: { methodType: string } | null; assignedLocation: { name: string; location: { id: string } | null };
    lineItems: { nodes: { remainingQuantity: number }[] };
  }[] };
}

/**
 * Whether an order can be marked shipped here, and how: every open fulfillment order must be one the
 * business ships itself (CREATE_FULFILLMENT, not sent to a fulfillment app), by shipping, not on hold, all
 * from one location. Anything else is for the owner to do in Shopify.
 */
export function shippable(o: ShipOrder): { fos: string[]; items: number; from: string } | { not: string } {
  if (o.cancelledAt) return { not: "cancelled" };
  if (o.closed) return { not: "archived" };
  const open = o.fulfillmentOrders.nodes.filter((f) => (f.status === "OPEN" || f.status === "IN_PROGRESS") && f.lineItems.nodes.some((l) => l.remainingQuantity > 0));
  if (!open.length) return { not: "nothing left to ship" };
  if (o.fulfillmentOrders.nodes.some((f) => f.status === "ON_HOLD") || open.some((f) => f.fulfillmentHolds.length)) return { not: "on hold" };
  if (open.some((f) => f.deliveryMethod && f.deliveryMethod.methodType !== "SHIPPING")) return { not: "pickup or local delivery" };
  if (open.some((f) => f.requestStatus !== "UNSUBMITTED" || !f.supportedActions.some((a) => a.action === "CREATE_FULFILLMENT"))) return { not: "handled by a fulfillment app" };
  if (new Set(open.map((f) => f.assignedLocation.location?.id ?? f.assignedLocation.name)).size > 1) return { not: "ships from more than one location" };
  if (o.displayFulfillmentStatus === "PARTIALLY_FULFILLED") return { not: "partly shipped already" };
  return { fos: open.map((f) => f.id).sort(), items: open.reduce((n, f) => n + f.lineItems.nodes.reduce((m, l) => m + Math.max(0, l.remainingQuantity), 0), 0), from: open[0].assignedLocation.name };
}

/** What a staged ship change may still do: write only while the order's open fulfillment orders are exactly the card's. */
export function planShip(cardFos: readonly string[], live: ShipOrder | null): { write: true; fos: string[] } | { refuse: string } {
  if (!live) return { refuse: "Shopify doesn't have this order any more." };
  const s = shippable(live);
  if ("not" in s) return { refuse: `This order can't be marked shipped here now (${s.not}). Nothing was written; do this one in Shopify.` };
  const want = [...cardFos].sort();
  if (want.join() !== s.fos.join()) return { refuse: "The order changed since this was staged. Nothing was written." };
  return { write: true, fos: s.fos };
}

// The live order, read right before the write: its status and open fulfillment orders. No names or
// addresses. A read, so it may live here.
export const SHIP_OF = gql`
  query AgentShipOf($id: ID!) {
    order(id: $id) {
      id name cancelledAt closed displayFulfillmentStatus
      fulfillmentOrders(first: 10) {
        nodes {
          id status requestStatus
          supportedActions { action }
          fulfillmentHolds { id }
          deliveryMethod { methodType }
          assignedLocation { name location { id } }
          lineItems(first: 50) { nodes { remainingQuantity } }
        }
      }
    }
  }
`;

// The only Shopify write in the repo for this action type: fulfill the order's open fulfillment orders
// with one carrier and tracking number. Shopify emails the customer its own shipping confirmation
// (decided 2026-11-22) and builds the tracking link from the carrier; no link can be sent here.
export const SHIP_CREATE = gql`
  mutation AgentShip($fos: [FulfillmentOrderLineItemsInput!]!, $company: String!, $number: String!, $key: String!) {
    fulfillmentCreate(fulfillment: { lineItemsByFulfillmentOrder: $fos, notifyCustomer: true, trackingInfo: { company: $company, number: $number } }) @idempotent(key: $key) {
      fulfillment { id status }
      userErrors { field message }
    }
  }
`;

// ---------- slice 4: one discount code, percent off, inside caps written in code ----------

/** Gateway action type: create one percent-off discount code. Draft only, never promoted (decided 2026-11-22). */
export const SHOPIFY_DISCOUNT = "shopify.create_discount";
/** The write tool on our Shopify server that applies it. */
export const SHOPIFY_DISCOUNT_TOOL = "shopify_create_discount";
/** The builder's tool an approver grants (core/tools/catalog.ts). */
export const SHOPIFY_DISCOUNT_GRANT = "shopify_discount";
/** The write scope it needs. */
export const DISCOUNT_SCOPE = "write_discounts";
/** The tag every agent-made code carries, so live ones can be counted. */
export const DISCOUNT_TAG = "operator-agent";
/**
 * The most a code can ever be (decided 2026-11-22): percent off, uses, and days from start to end. The
 * owner can set each lower on Settings (CAPS in core/gateway/policy.ts), never higher. Plus: at most
 * `live` agent-made codes active or scheduled at once, and a start at most `aheadDays` away.
 */
export const DISCOUNT_LIMITS = { percent: 20, uses: 100, days: 30, live: 5, aheadDays: 30, title: 60 } as const;
export type DiscountCaps = { percent: number; uses: number; days: number };
export interface DiscountArgs { title: string; percent: number; uses: number; starts: string; ends: string }

const CODE = /^[A-Z0-9]{4,20}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A discount card's target: `code:<CODE>`, the code it creates. */
export function discountTarget(target: string): string | null {
  const m = /^code:(.+)$/.exec(target);
  return m && CODE.test(m[1]) ? m[1] : null;
}
/** A code the way people type it, made comparable: spaces and dashes dropped, upper case. */
export const normCode = (v: unknown) => String(v ?? "").replace(/[\s-]+/g, "").toUpperCase();
const dayMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const validDay = (d: unknown): d is string => typeof d === "string" && DAY.test(d) && Number.isFinite(dayMs(d)) && new Date(dayMs(d)).toISOString().slice(0, 10) === d;
/** Whole days from one date to another (YYYY-MM-DD). */
export const daysBetween = (a: string, b: string) => Math.round((dayMs(b) - dayMs(a)) / 86_400_000);
/** A date `n` days after another (YYYY-MM-DD). */
export const addDays = (d: string, n: number) => new Date(dayMs(d) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * Why a discount card is refused, or null: exactly a title, a whole percent off, a use limit and a start
 * and end date, each inside the caps. No fixed amount, free shipping, product list or customer list can
 * be named. The caps passed in are the owner's (never above DISCOUNT_LIMITS).
 */
export function refuseDiscount(args: Record<string, unknown>, caps: DiscountCaps = DISCOUNT_LIMITS): string | null {
  const extra = Object.keys(args).filter((k) => !["title", "percent", "uses", "starts", "ends"].includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A discount holds only a title, a percent off, a use limit and its dates.`;
  const pct = Math.min(caps.percent, DISCOUNT_LIMITS.percent), uses = Math.min(caps.uses, DISCOUNT_LIMITS.uses), days = Math.min(caps.days, DISCOUNT_LIMITS.days);
  if (typeof args.title !== "string" || !args.title.trim() || args.title.length > DISCOUNT_LIMITS.title || /[\u0000-\u001f<>]/.test(args.title)) return `title must be plain text, 1 to ${DISCOUNT_LIMITS.title} characters.`;
  if (!Number.isInteger(args.percent) || (args.percent as number) < 1) return "percent must be a whole number of 1 or more.";
  if ((args.percent as number) > pct) return `${args.percent}% is over the cap of ${pct}% off.`;
  if (!Number.isInteger(args.uses) || (args.uses as number) < 1) return "uses must be a whole number of 1 or more: every code has a use limit.";
  if ((args.uses as number) > uses) return `${args.uses} uses is over the cap of ${uses}.`;
  if (!validDay(args.starts) || !validDay(args.ends)) return "starts and ends must be dates (YYYY-MM-DD): every code has an end date.";
  const len = daysBetween(args.starts, args.ends);
  if (len < 1) return "ends must be after starts.";
  if (len > days) return `${len} days is over the cap of ${days} days.`;
  return null;
}

/** Whether the dates still work on `today` (YYYY-MM-DD): when staged, the start is today or later and at most 30 days away; at any time, the end hasn't passed. */
export function refuseDiscountDates(a: { starts: string; ends: string }, today: string, staging: boolean): string | null {
  if (a.ends < today) return "This code's end date has passed. Nothing was written.";
  if (staging && a.starts < today) return "starts can't be in the past.";
  if (staging && daysBetween(today, a.starts) > DISCOUNT_LIMITS.aheadDays) return `starts can be at most ${DISCOUNT_LIMITS.aheadDays} days away.`;
  return null;
}

/** What a staged discount may still do: write only while the code is free and fewer than the live cap of agent codes are active or scheduled. */
export function planDiscount(live: { taken: boolean; agentLive: number }): { write: true } | { refuse: string } {
  if (live.taken) return { refuse: "Shopify already has a discount with this code. Nothing was written." };
  if (live.agentLive >= DISCOUNT_LIMITS.live) return { refuse: `${live.agentLive} agent-made codes are already live (the most is ${DISCOUNT_LIMITS.live}). End one in Shopify first. Nothing was written.` };
  return { write: true };
}

/** One code as the live check reads it. */
export interface DiscountNode { id: string; codeDiscount: { __typename: string; status?: string; tags?: string[] } | null }
/** Agent-made codes that are active or scheduled. */
export const agentLiveCount = (nodes: DiscountNode[]) => nodes.filter((n) => n.codeDiscount?.__typename === "DiscountCodeBasic" && (n.codeDiscount.status === "ACTIVE" || n.codeDiscount.status === "SCHEDULED") && (n.codeDiscount.tags ?? []).includes(DISCOUNT_TAG)).length;

// Right before the write: is the code taken, and how many agent-made codes are live (the newest 100
// codes). A read, so it may live here.
export const DISCOUNT_OF = gql`
  query AgentDiscountOf($code: String!) {
    codeDiscountNodeByCode(code: $code) { id }
    codeDiscountNodes(first: 100, sortKey: CREATED_AT, reverse: true) {
      nodes { id codeDiscount { __typename ... on DiscountCodeBasic { status tags } } }
    }
  }
`;

// The only Shopify write in the repo for this action type: one percent-off code on every product for
// every customer, once per customer, not combined with other discounts, with a use limit and an end date,
// tagged as agent-made. Only the title, code, percent, dates and use limit come from the card.
export const DISCOUNT_CREATE = gql`
  mutation AgentDiscount($title: String!, $code: String!, $percentage: Float!, $startsAt: DateTime!, $endsAt: DateTime!, $usageLimit: Int!) {
    discountCodeBasicCreate(basicCodeDiscount: { title: $title, code: $code, startsAt: $startsAt, endsAt: $endsAt, usageLimit: $usageLimit, appliesOncePerCustomer: true, context: { all: ALL }, customerGets: { value: { percentage: $percentage }, items: { all: true } }, combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: false }, tags: ["operator-agent"] }) {
      codeDiscountNode { id }
      userErrors { field message code }
    }
  }
`;

// ---------- slice 6: a refund on one recent order, inside caps written in code ----------

/** Gateway action type: refund one order (all of it, or some items) to its original payment. Draft only, never promoted (decided 2026-11-22). */
export const SHOPIFY_REFUND = "shopify.refund";
/** The write tool on our Shopify server that applies it. */
export const SHOPIFY_REFUND_TOOL = "shopify_refund";
/** The builder's tool an approver grants (core/tools/catalog.ts). */
export const SHOPIFY_REFUND_GRANT = "shopify_refund";
/**
 * The most a refund can ever be, in US dollars (decided 2026-11-22): per refund and per calendar month in
 * the business's time zone. The owner can set each lower on Settings (CAPS in core/gateway/policy.ts),
 * never higher. Plus: orders from the last `days`, at most `lines` line items, and Shopify's amount at
 * approval may be at most `slackUsd` over the card's.
 */
export const REFUND_LIMITS = { perRefund: 100, monthly: 500, days: 60, lines: 20, slackUsd: 0.05 } as const;
export type RefundCaps = { perRefund: number; monthly: number };
export interface RefundArgs { whole: boolean; lines: { line: string; qty: number }[]; amount: string; refunded_before: string }

const LINE = /^gid:\/\/shopify\/LineItem\/\d{1,20}$/;
const MONEY = /^\d{1,7}\.\d{2}$/;
/** Dollars to whole cents, for comparing money without floating point. */
export const cents = (v: string | number) => Math.round(Number(v) * 100);
/** Cents to a two-decimal string. */
export const dollars = (c: number) => (c / 100).toFixed(2);

/**
 * Why a refund card is refused, or null: exactly whether it is the whole order, the line items and
 * quantities (none for a whole order), the amount Shopify worked out when it was staged and how much the
 * order had refunded then, with the amount inside the per-refund cap. No custom amount, gift card, store
 * credit or restock can be named.
 */
export function refuseRefund(args: Record<string, unknown>, caps: Pick<RefundCaps, "perRefund"> = REFUND_LIMITS): string | null {
  const extra = Object.keys(args).filter((k) => !["whole", "lines", "amount", "refunded_before"].includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A refund holds only the whole order or its items, and the amounts Shopify worked out.`;
  if (typeof args.whole !== "boolean") return "whole must be true (the whole order) or false (some items).";
  const lines = args.lines;
  if (!Array.isArray(lines)) return "lines must be a list (empty for the whole order).";
  if (args.whole && lines.length) return "A whole-order refund names no items.";
  if (!args.whole && (!lines.length || lines.length > REFUND_LIMITS.lines)) return `Name 1 to ${REFUND_LIMITS.lines} items to refund.`;
  const seen = new Set<string>();
  for (const l of lines as unknown[]) {
    const x = (l && typeof l === "object" ? l : {}) as { line?: unknown; qty?: unknown };
    if (Object.keys(x).some((k) => k !== "line" && k !== "qty") || typeof x.line !== "string" || !LINE.test(x.line) || !Number.isInteger(x.qty) || (x.qty as number) < 1 || (x.qty as number) > 1000) return "Each item is a line item from an Orders to refund row and a whole quantity.";
    if (seen.has(x.line)) return "An item is named twice.";
    seen.add(x.line);
  }
  if (typeof args.amount !== "string" || !MONEY.test(args.amount) || cents(args.amount) < 1) return "amount must be the refund Shopify works out, in dollars and cents.";
  if (typeof args.refunded_before !== "string" || !MONEY.test(args.refunded_before)) return "refunded_before must be what the order had refunded, in dollars and cents.";
  const cap = Math.min(caps.perRefund, REFUND_LIMITS.perRefund);
  if (cents(args.amount) > cents(cap)) return `$${args.amount} is over the cap of $${dollars(cents(cap))} per refund.`;
  return null;
}

/** Whether a refund of `amountCents` fits the month: what was refunded this month plus this, at most the monthly cap. */
export function refuseRefundMonth(amountCents: number, monthCents: number, caps: Pick<RefundCaps, "monthly"> = REFUND_LIMITS): string | null {
  const cap = cents(Math.min(caps.monthly, REFUND_LIMITS.monthly));
  if (monthCents + amountCents > cap) return `This refund ($${dollars(amountCents)}) would take this month's refunds to $${dollars(monthCents + amountCents)}, over the cap of $${dollars(cap)}. Nothing was written.`;
  return null;
}

/** One order as the live check before a refund reads it. No names or addresses. */
export interface RefundOrder {
  id: string; name: string; createdAt: string; cancelledAt: string | null; test: boolean; displayFinancialStatus: string; currencyCode: string;
  totalRefundedSet: { shopMoney: { amount: string } };
  suggestedRefund: {
    amountSet: { shopMoney: { amount: string; currencyCode: string } };
    refundLineItems: { lineItem: { id: string }; quantity: number }[];
    suggestedTransactions: { gateway: string | null; kind: string; amountSet: { shopMoney: { amount: string } }; parentTransaction: { id: string } | null }[];
  } | null;
}

/** Whether an order can be refunded here: paid or partly refunded, not cancelled or a test, in US dollars, from the last `days` days. */
export function refundable(o: Pick<RefundOrder, "createdAt" | "cancelledAt" | "test" | "displayFinancialStatus" | "currencyCode">, now = new Date()): string | null {
  if (o.cancelledAt) return "cancelled";
  if (o.test) return "a test order";
  if (o.displayFinancialStatus !== "PAID" && o.displayFinancialStatus !== "PARTIALLY_REFUNDED") return o.displayFinancialStatus === "REFUNDED" ? "refunded already" : "not paid";
  if (o.currencyCode !== "USD") return "not in US dollars (the caps are in dollars)";
  if (now.getTime() - Date.parse(o.createdAt) > REFUND_LIMITS.days * 86_400_000) return `older than ${REFUND_LIMITS.days} days`;
  return null;
}

/**
 * What a staged refund may still do: write only while the order can be refunded, has refunded exactly what
 * the card saw, Shopify's amount is at most the card's (plus a few cents of rounding) and inside
 * `maxCents` (the owner's per-refund cap and what's left of the month), and every dollar goes back through
 * the order's own payments.
 */
export function planRefund(a: RefundArgs, live: RefundOrder | null, maxCents: number, now = new Date()): { write: true; amountCents: number } | { refuse: string } {
  if (!live) return { refuse: "Shopify doesn't have this order any more." };
  const not = refundable(live, now);
  if (not) return { refuse: `This order can't be refunded here now (${not}). Nothing was written.` };
  if (cents(live.totalRefundedSet.shopMoney.amount) !== cents(a.refunded_before)) return { refuse: "The order was refunded since this was staged. Nothing was written." };
  const s = live.suggestedRefund;
  if (!s || s.amountSet.shopMoney.currencyCode !== "USD") return { refuse: "Shopify has no refund for this. Nothing was written." };
  const amt = cents(s.amountSet.shopMoney.amount);
  if (amt < 1) return { refuse: "Nothing is left to refund on these items. Nothing was written." };
  if (amt > cents(a.amount) + cents(REFUND_LIMITS.slackUsd)) return { refuse: `Shopify now works out $${dollars(amt)}, more than the $${a.amount} on the card. Nothing was written.` };
  if (amt > maxCents) return { refuse: `Shopify works out $${dollars(amt)}, over what the caps allow now ($${dollars(maxCents)}). Nothing was written.` };
  const tx = s.suggestedTransactions;
  if (!tx.length || tx.some((t) => !t.parentTransaction || t.kind !== "SUGGESTED_REFUND" || !t.gateway || /gift_card|store_credit/i.test(t.gateway))) return { refuse: "Shopify can't send this refund back to the original payment. Do this one in Shopify. Nothing was written." };
  if (tx.reduce((n, t) => n + cents(t.amountSet.shopMoney.amount), 0) !== amt) return { refuse: "Shopify's refund doesn't add up. Do this one in Shopify. Nothing was written." };
  return { write: true, amountCents: amt };
}

// Right before the write: the order, what it has refunded, and Shopify's own refund for these items (or the
// whole order with shipping). No names or addresses. A read, so it may live here.
export const REFUND_OF = gql`
  query AgentRefundOf($id: ID!, $lines: [RefundLineItemInput!], $full: Boolean!) {
    order(id: $id) {
      id name createdAt cancelledAt test displayFinancialStatus currencyCode
      totalRefundedSet { shopMoney { amount } }
      suggestedRefund(refundLineItems: $lines, suggestFullRefund: $full, refundShipping: $full) {
        amountSet { shopMoney { amount currencyCode } }
        refundLineItems { lineItem { id } quantity }
        suggestedTransactions { gateway kind amountSet { shopMoney { amount } } parentTransaction { id } }
      }
    }
  }
`;

// The only Shopify write in the repo for this action type: a refund on one order, the line items with no
// restock (the server builds them), full shipping only on a whole-order refund, and only the transactions
// Shopify suggested back to the original payment. Shopify emails the customer its own refund confirmation
// (decided 2026-11-22). No custom amount, gift card or store credit can be sent.
export const REFUND_CREATE = gql`
  mutation AgentRefund($orderId: ID!, $lines: [RefundLineItemInput!]!, $shipping: ShippingRefundInput, $transactions: [OrderTransactionInput!]!, $note: String!, $key: String!) {
    refundCreate(input: { orderId: $orderId, notify: true, note: $note, refundLineItems: $lines, shipping: $shipping, transactions: $transactions }) @idempotent(key: $key) {
      refund { id totalRefundedSet { shopMoney { amount } } }
      userErrors { field message }
    }
  }
`;

/** Every mutation our Shopify server may run, by write tool. The server refuses any other document. */
export const SHOPIFY_MUTATIONS: Readonly<Record<string, string>> = { [SHOPIFY_TAGS_TOOL]: TAGS_ADD, [SHOPIFY_STOCK_TOOL]: STOCK_SET, [SHOPIFY_COPY_TOOL]: COPY_SET, [SHOPIFY_SHIP_TOOL]: SHIP_CREATE, [SHOPIFY_DISCOUNT_TOOL]: DISCOUNT_CREATE, [SHOPIFY_REFUND_TOOL]: REFUND_CREATE };

/** A document is exactly one of the fixed mutations above. */
export function assertFixedMutation(doc: string): void {
  if (!Object.values(SHOPIFY_MUTATIONS).includes(doc)) throw new Error("only a fixed store action may change Shopify");
}
