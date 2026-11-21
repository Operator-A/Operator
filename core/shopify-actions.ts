// Store actions on our own Shopify MCP server (docs/shopify-actions.md). Pure, so the server, the
// gateway and the checks build on the same rules. Each write tool runs one fixed mutation, named here
// and nowhere else (scripts/validate-graphql.mjs fails on a mutation in any other file), and only
// core/gateway calls one, through callWriteTool, after an approver approves or the trust ladder allows
// it. A model never writes GraphQL, a target id or a scope: the target is a Shopify id from a read
// result, picked by code; the tags are checked here.
import { gql } from "@/core/shopify-rules";

/** The write scopes the Shopify profile asks for. A key with any other write scope is refused. */
export const SHOPIFY_WRITE_SCOPES = ["write_orders", "write_customers"] as const;

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
/** The write scope a tag change on this target needs. */
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

/** Every mutation our Shopify server may run, by write tool. The server refuses any other document. */
export const SHOPIFY_MUTATIONS: Readonly<Record<string, string>> = { [SHOPIFY_TAGS_TOOL]: TAGS_ADD };

/** A document is exactly one of the fixed mutations above. */
export function assertFixedMutation(doc: string): void {
  if (!Object.values(SHOPIFY_MUTATIONS).includes(doc)) throw new Error("only a fixed store action may change Shopify");
}
