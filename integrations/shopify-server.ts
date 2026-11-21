import "server-only";
// Our own Shopify MCP server (docs/mcp-everywhere.md, slice 7). Shopify's own MCP servers are for
// storefronts and building apps, not a read-only Admin view of one store, so Shopify runs here, like
// Notion and Gmail. It speaks the same JSON-RPC as any MCP server and is reached only through
// integrations/mcp.ts, which opens the app's key from the token vault. Each read tool runs one fixed
// query (core/shopify-queries.ts); each write tool runs one fixed mutation (core/shopify-actions.ts)
// and is reached only by core/gateway through callWriteTool. There is no tool that takes GraphQL.
import { MCP_PROTOCOL, MCP_SERVERS } from "@/core/mcp-rules";
import { settings } from "@/core/settings";
import { DEFAULT_TZ } from "@/core/time";
import { SHOPIFY_QUERIES, shopifyKeyKind, shopifyVariables, scopesBeyond } from "@/core/shopify-queries";
import { SHOPIFY_STOCK_TOOL, SHOPIFY_TAGS_TOOL, SHOPIFY_WRITE_SCOPES, STOCK_OF, STOCK_SET, TAGS_ADD, TAGS_OF, planStock, planTags, refuseStock, refuseTags, scopeFor, shopifyTarget, stockKeyOk, stockTarget } from "@/core/shopify-actions";
import { shopifyMutate, shopifyQuery, whoIs } from "./shopify-api";

const READS = MCP_SERVERS.shopify.readTools as readonly string[];
const WRITES = (MCP_SERVERS.shopify.writeTools as readonly { tool: string }[]).map((w) => w.tool);
const TOOLS = Object.fromEntries(SHOPIFY_QUERIES.map((q) => [q.tool, q]));
const WRITE_ABOUT: Record<string, { description: string; inputSchema: unknown }> = {
  [SHOPIFY_TAGS_TOOL]: {
    description: "Adds tags to one order or one customer. Only the gateway calls it, after an approver approves. Never removes a tag.",
    inputSchema: { type: "object", required: ["target", "tags"], properties: { target: { type: "string" }, tags: { type: "array", items: { type: "string" } } } },
  },
  [SHOPIFY_STOCK_TOOL]: {
    description: "Sets the available count of one inventory item at one location, only while the store still shows the count it was staged against. Only the gateway calls it, after an approver approves.",
    inputSchema: { type: "object", required: ["target", "from", "available", "reason", "key"], properties: { target: { type: "string" }, from: { type: "integer" }, available: { type: "integer" }, reason: { type: "string" }, key: { type: "string" } } },
  },
};

// where a business adds a write scope: a new version of its app (Dev Dashboard) or the legacy custom app's Configuration
const addScope = (need: string) => `the Shopify app doesn't have ${need} yet. Add ${need} to the app's scopes (Dev Dashboard: your app, Versions, Create version, Scopes, Release; then approve it for your store), and try again`;

/** Before a key is kept: its shape, which shop it opens, and that it carries no write scope beyond the profile's. */
export async function checkShopifyKey(key: string): Promise<{ name: string; workspace: string }> {
  if (!shopifyKeyKind(key)) throw new Error("not an Admin API access token or a client secret");
  const w = await whoIs(key);
  const bad = scopesBeyond(w.scopes, SHOPIFY_WRITE_SCOPES);
  if (bad.length) throw new Error(`this app can do more than OPERATOR asks for (${bad.slice(0, 6).join(", ")}). Untick those scopes: keep the read scopes plus ${SHOPIFY_WRITE_SCOPES.join(" and ")}`);
  const shop = (await settings()).shopifyDomain;
  if (shop && w.domain !== shop) throw new Error(`it opens ${w.domain}, not ${shop}`);
  const writes = SHOPIFY_WRITE_SCOPES.filter((s) => w.scopes.includes(s));
  return { name: w.name, workspace: `${w.domain}, ${w.scopes.length - writes.length} read scopes${writes.length ? `, ${writes.join(" and ")}` : ", no store actions yet"}` };
}

type TagsOf = { node: { id: string; name?: string; tags: string[]; numberOfOrders?: string | number } | null };
type TagsAdded = { tagsAdd: { node: { id: string } | null; userErrors: { field?: string[]; message: string }[] } };

/**
 * Adds tags to one order or customer: the inputs checked again, the app's live scopes, the live tags,
 * then Shopify's tagsAdd with only the tags not already there. Returns what it added (the undo) and
 * what the record had before.
 */
async function addTags(key: string, raw: unknown): Promise<Record<string, unknown>> {
  const a = (raw && typeof raw === "object" ? raw : {}) as { target?: unknown; tags?: unknown };
  const target = typeof a.target === "string" ? shopifyTarget(a.target) : null;
  if (!target) throw new Error("the target isn't a Shopify order or customer id");
  const no = refuseTags({ tags: a.tags });
  if (no) throw new Error(no);
  const need = scopeFor(target);
  const { scopes } = await whoIs(key);
  if (!scopes.includes(need)) throw new Error(addScope(need));
  const live = (await shopifyQuery<TagsOf>(key, TAGS_OF, { id: target.gid })).node;
  if (!live || live.id !== target.gid) throw new Error(`Shopify doesn't have this ${target.kind.toLowerCase()} any more`);
  const plan = planTags(a.tags as string[], live.tags ?? []);
  const label = target.kind === "Order" ? `order ${live.name ?? ""}`.trim() : "customer";
  if (!plan.add.length) return { added: [], skipped: plan.skipped, before: live.tags ?? [], label };
  const out = await shopifyMutate<TagsAdded>(key, TAGS_ADD, { id: target.gid, tags: plan.add });
  const errs = out.tagsAdd.userErrors ?? [];
  if (errs.length) throw new Error(`Shopify refused the tags: ${errs.map((e) => e.message).join("; ").slice(0, 200)}`);
  return { added: plan.add, skipped: plan.skipped, before: live.tags ?? [], label };
}

type StockOf = { inventoryItem: { id: string; tracked: boolean; sku: string | null; variant: { title: string; product: { title: string } | null } | null; inventoryLevel: { id: string; location: { id: string; name: string }; quantities: { name: string; quantity: number }[] } | null } | null };
type StockSet = { inventorySetQuantities: { inventoryAdjustmentGroup: { id: string } | null; userErrors: { field?: string[] | string; message: string; code?: string }[] } };

/**
 * Sets the available count of one item at one location: the inputs checked again, the app's live scopes,
 * the live count (it must still be the count the card was staged against), then Shopify's
 * inventorySetQuantities with changeFromQuantity, so Shopify refuses it too if the count moved meanwhile.
 */
async function setStock(key: string, raw: unknown): Promise<Record<string, unknown>> {
  const a = (raw && typeof raw === "object" ? raw : {}) as { target?: unknown; from?: unknown; available?: unknown; reason?: unknown; key?: unknown };
  const target = typeof a.target === "string" ? stockTarget(a.target) : null;
  if (!target) throw new Error("the target isn't a Shopify inventory item at a location");
  if (!stockKeyOk(a.key)) throw new Error("a stock change needs the action's id as its idempotency key");
  const no = refuseStock({ from: a.from, available: a.available, reason: a.reason });
  if (no) throw new Error(no);
  const from = a.from as number, available = a.available as number;
  const { scopes } = await whoIs(key);
  if (!scopes.includes("write_inventory")) throw new Error(addScope("write_inventory"));
  const item = (await shopifyQuery<StockOf>(key, STOCK_OF, { item: target.item, location: target.location })).inventoryItem;
  if (!item || item.id !== target.item) throw new Error("Shopify doesn't have this item any more");
  if (!item.tracked) throw new Error("Shopify doesn't track stock for this item");
  const lvl = item.inventoryLevel && item.inventoryLevel.location.id === target.location ? item.inventoryLevel : null;
  const live = lvl ? lvl.quantities.find((q) => q.name === "available")?.quantity ?? null : null;
  const name = item.variant ? [item.variant.product?.title, item.variant.title === "Default Title" ? "" : item.variant.title].filter(Boolean).join(" · ") : "";
  const label = `${name || item.sku || "item"} at ${lvl?.location.name ?? "that location"}`;
  const plan = planStock(from, available, live);
  if ("refuse" in plan) return { refused: plan.refuse, live, label };
  const out = await shopifyMutate<StockSet>(key, STOCK_SET, {
    input: { name: "available", reason: a.reason, quantities: [{ inventoryItemId: target.item, locationId: target.location, quantity: available, changeFromQuantity: from }] },
    key: a.key,
  });
  const errs = out.inventorySetQuantities.userErrors ?? [];
  if (errs.some((e) => e.code === "CHANGE_FROM_QUANTITY_STALE")) return { refused: "Stock changed in Shopify while this was being written. Nothing was written.", live: null, label };
  if (errs.length) throw new Error(`Shopify refused the stock change: ${errs.map((e) => e.message).join("; ").slice(0, 200)}`);
  return { before: from, after: available, label, adjustment: out.inventorySetQuantities.inventoryAdjustmentGroup?.id ?? null };
}

/** A JSON-RPC handler for one call, with the key the vault opened. */
export function shopifyServer(key: string) {
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-shopify", version: "1" } });
      case "tools/list":
        return reply(id, { tools: [
          ...READS.map((name) => ({ name, description: TOOLS[name].description, inputSchema: TOOLS[name].inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })),
          ...WRITES.map((name) => ({ name, ...WRITE_ABOUT[name], annotations: { readOnlyHint: false, destructiveHint: name === SHOPIFY_STOCK_TOOL, idempotentHint: true, openWorldHint: false } })),
        ] });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        // integrations/mcp.ts lets only callWriteTool (the gateway) reach a write tool
        const write = name === SHOPIFY_TAGS_TOOL ? addTags : name === SHOPIFY_STOCK_TOOL ? setStock : null;
        if (write && WRITES.includes(name)) {
          try {
            return reply(id, { structuredContent: await write(key, req.params?.arguments), content: [{ type: "text", text: "ok" }] });
          } catch (e) {
            return toolError(id, e instanceof Error ? e.message : String(e));
          }
        }
        if (!READS.includes(name)) return toolError(id, `${name || "That"} isn't a tool this server serves.`);
        const s = await settings();
        const v = shopifyVariables(name, req.params?.arguments, { productCollections: s.productCollections, productFields: s.productFields, timeZone: s.timeZone ?? DEFAULT_TZ });
        if ("problem" in v) return toolError(id, `Input refused: ${v.problem}`);
        try {
          const result = await shopifyQuery(key, v.doc, v.variables);
          return reply(id, { structuredContent: { result }, content: [{ type: "text", text: "ok" }] });
        } catch (e) {
          return toolError(id, e instanceof Error ? e.message : String(e));
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `no method ${req.method}` } };
    }
  };
}
