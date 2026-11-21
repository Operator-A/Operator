import "server-only";
// Our own WooCommerce MCP server (card 254, docs/mcp-everywhere.md "WooCommerce"). WooCommerce's MCP
// adapter is a per-store plugin in preview with no read-only mode, so this one runs in the app over the
// store's REST API. It is the only file that calls a WooCommerce store, and only integrations/mcp.ts
// reaches it (lint). Agents' key (profile "woo", a Read key): orders with totals counted in code, and
// low stock, asking the store for fields with no customer name, email, phone or address. The gateway's
// key (profile "woo_notes", a Read/Write key): one private note on one order. There is no other write:
// no order, product, stock, refund, coupon or customer call, and none may be added (check:mcp fails on
// one). The store address is the owner's, so it is checked as a public https host before every request.
import { MCP_PROTOCOL, checkedTools, type McpId } from "@/core/mcp-rules";
import { MAX_PAGES, NOTE_TOOL, ORDER_FIELDS, PRODUCT_FIELDS, afterOf, checkNoteArgs, checkWooArgs, readLowStock, readOrders, readWooKey, restBase, type WooKey } from "@/core/woo-rules";

const TIMEOUT_MS = 25_000;
type Check = (url: string) => Promise<void>;
const DESCRIPTIONS: Record<string, string> = {
  woo_orders: "Orders in a period: count, revenue, average order, repeat buyers and best sellers, counted in code. No customer names or addresses.",
  woo_low_stock: "Products the store tracks stock for that are at or below a level, or out of stock.",
  [NOTE_TOOL]: "Adds one private note to one order (store staff see it; the customer doesn't). Gateway only, after an approval.",
};

function keyOf(pasted: string): WooKey {
  const k = readWooKey(pasted);
  if (!k) throw new Error("not a WooCommerce store address, consumer key and consumer secret");
  return k;
}

async function woo(k: WooKey, check: Check, path: string, init?: { body: unknown }): Promise<{ status: number; json: unknown; total: number }> {
  const url = `${restBase(k)}${path}`;
  await check(url);
  const res = await fetch(url, {
    method: init ? "POST" : "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Basic ${Buffer.from(`${k.key}:${k.secret}`).toString("base64")}`, Accept: "application/json", ...(init ? { "Content-Type": "application/json" } : {}) },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, total: Number(res.headers.get("x-wp-totalpages") ?? 1) || 1 };
}
const must = (r: { status: number; json: unknown }, what: string) => {
  if (r.status < 200 || r.status >= 300) throw new Error(`WooCommerce ${r.status} on ${what}: ${JSON.stringify(r.json ?? "").slice(0, 200)}`);
  return r.json;
};

/**
 * Before a key is kept: the store answers with it, and its permission is the one the profile needs.
 * The probe asks to add a note to order 0, which doesn't exist: a Read key is refused at sign-in (401),
 * a Read/Write key gets "no such order" (400 or 404). Nothing is written either way.
 */
export async function checkWooKey(profile: McpId, pasted: string, check: Check): Promise<{ name: string; workspace: string }> {
  const k = keyOf(pasted);
  must(await woo(k, check, "/orders?per_page=1&_fields=id"), "read orders");
  const probe = await woo(k, check, "/orders/0/notes", { body: { note: "permission check", customer_note: false } });
  const canWrite = probe.status === 400 || probe.status === 404;
  if (probe.status !== 401 && !canWrite) throw new Error(`WooCommerce ${probe.status}: couldn't tell whether this key can write`);
  if (profile === "woo" && canWrite) throw new Error("this key can write. Agents get a Read key: make one with Permissions set to Read");
  if (profile === "woo_notes" && !canWrite) throw new Error("this key can only read. The gateway needs a Read/Write key");
  return { name: new URL(k.store).host, workspace: profile === "woo" ? "read only" : "order notes only" };
}

/** A JSON-RPC handler for one call, serving only `profile`'s tools, with the key the vault opened. */
export function wooServer(profile: McpId, pasted: string, check: Check, now: () => number = Date.now) {
  const offered = checkedTools(profile).filter((t) => t in DESCRIPTIONS);
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-woocommerce", version: "1" } });
      case "tools/list":
        return reply(id, { tools: offered.map((name) => ({ name, description: DESCRIPTIONS[name], annotations: { readOnlyHint: name !== NOTE_TOOL, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!offered.includes(name)) return toolError(id, `${name || "That"} isn't a tool this key serves.`);
        try {
          const k = keyOf(pasted);
          let result: unknown;
          if (name === NOTE_TOOL) {
            const a = checkNoteArgs(req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            // the order must still exist in this store, read on this key right before the write
            const o = must(await woo(k, check, `/orders/${a.orderId}?_fields=id,number`), "read order") as { id?: unknown; number?: unknown };
            if (String(o?.id) !== a.orderId) throw new Error("WooCommerce 404: that order isn't in the store any more");
            const n = must(await woo(k, check, `/orders/${a.orderId}/notes`, { body: { note: a.note, customer_note: false } }), "add order note") as { id?: unknown };
            if (!Number.isInteger(n?.id)) throw new Error("WooCommerce didn't return a note id");
            result = { noteId: n.id, order: String(o.number ?? a.orderId), customerNote: false };
          } else {
            const a = checkWooArgs(name, req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            const all: unknown[] = [];
            let pages = 1;
            const path = a.tool === "woo_orders"
              ? (p: number) => `/orders?per_page=100&page=${p}&after=${encodeURIComponent(afterOf(a.period, now()))}&_fields=${ORDER_FIELDS}`
              : (p: number) => `/products?per_page=100&page=${p}&_fields=${PRODUCT_FIELDS}`;
            for (let p = 1; p <= Math.min(pages, MAX_PAGES); p++) {
              const r = await woo(k, check, path(p));
              const rows = must(r, a.tool === "woo_orders" ? "list orders" : "list products");
              if (Array.isArray(rows)) all.push(...rows);
              pages = r.total;
            }
            result = a.tool === "woo_orders" ? readOrders(all, pages > MAX_PAGES) : { products: readLowStock(all, a.atOrBelow), at_or_below: a.atOrBelow, truncated: pages > MAX_PAGES };
          }
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
