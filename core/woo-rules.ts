// WooCommerce (card 254, docs/mcp-everywhere.md "WooCommerce"). Pure, so `npm run check:mcp` and
// `npm run check:policy` can test it.
//
// WooCommerce's own MCP adapter is a per-store plugin in preview, signed in with a WordPress password
// and with no read-only mode, so our own server (integrations/woo-server.ts) runs in the app over the
// store's REST API, with two keys the owner makes in WooCommerce (Settings, Advanced, REST API):
// - "WooCommerce" (a Read key, used by agents): orders over a period with totals, best sellers and
//   repeat buyers counted here, and low stock. No customer name, email or address leaves the server.
// - "WooCommerce order notes" (a Read/Write key, held only by the gateway): one write, a private note
//   on an order after an approver approves. Store staff see it; the customer doesn't. No other write.
// A Read/Write key is refused for the agents' sign-in and a Read key for the gateway's, checked when it
// is pasted. The store address is the owner's, so it is held to a custom server's rule: a public https
// host, checked right before every request.

import { REPORT_PERIODS } from "@/core/mcp-rules";

export const WOO_TOOLS = ["woo_orders", "woo_low_stock"] as const;
export const NOTE_TOOL = "woo_add_order_note";
export const NOTE_FIELDS = ["note"] as const;
export const NOTE_MAX = 500;
export type WooPeriod = (typeof REPORT_PERIODS)[number];
const DAYS: Record<WooPeriod, number> = { last_7_days: 7, last_30_days: 30, last_90_days: 90, last_365_days: 365 };
/** At most this many pages of 100 orders are read for one call; more is said, never guessed. */
export const MAX_PAGES = 5;

export interface WooKey { store: string; key: string; secret: string }
/**
 * What the owner pastes: the store's address, the consumer key and the consumer secret, separated by
 * spaces or new lines, in that order. https only, no path beyond the site's own, no credentials in it.
 */
export function readWooKey(pasted: string): WooKey | null {
  const parts = pasted.trim().split(/\s+/);
  if (parts.length !== 3) return null;
  const [store, key, secret] = parts;
  if (!/^ck_[0-9a-f]{40}$/.test(key) || !/^cs_[0-9a-f]{40}$/.test(secret)) return null;
  let u: URL;
  try { u = new URL(store); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return null;
  return { store: `${u.origin}${u.pathname.replace(/\/+$/, "")}`, key, secret };
}
export const looksLikeWooKey = (pasted: string) => !!readWooKey(pasted);
/** The REST base for a store. */
export const restBase = (k: WooKey) => `${k.store}/wp-json/wc/v3`;

/** A read tool's input, checked again on our server. Anything not named here is refused. */
export function checkWooArgs(tool: string, raw: unknown): { tool: "woo_orders"; period: WooPeriod } | { tool: "woo_low_stock"; atOrBelow: number } | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed: Record<string, string[]> = { woo_orders: ["period"], woo_low_stock: ["at_or_below"] };
  if (!(tool in allowed)) return { problem: `${tool || "that"} isn't a WooCommerce read tool` };
  const extra = Object.keys(a).filter((k) => !allowed[tool].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  if (tool === "woo_orders") {
    const period = (a.period ?? "last_30_days") as WooPeriod;
    if (!REPORT_PERIODS.includes(period)) return { problem: `period is one of ${REPORT_PERIODS.join(", ")}` };
    return { tool: "woo_orders", period };
  }
  const n = a.at_or_below === undefined ? 5 : Number(a.at_or_below);
  if (!Number.isInteger(n) || n < 0 || n > 1000) return { problem: "at_or_below is a whole number from 0 to 1000" };
  return { tool: "woo_low_stock", atOrBelow: n };
}

export const afterOf = (p: WooPeriod, nowMs: number) => new Date(nowMs - DAYS[p] * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "");
/** The fields asked for: no billing, shipping, email, name, phone or note. */
export const ORDER_FIELDS = "id,number,status,total,currency,date_created,customer_id,line_items";
export const PRODUCT_FIELDS = "id,name,sku,stock_quantity,stock_status,manage_stock";

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const plain = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
const cents = (n: number) => Math.round(n * 100) / 100;
/** Orders that count as sales. */
const PAID = new Set(["processing", "completed", "on-hold"]);

export interface OrderRow { id: number; number: string; status: string; total: number; currency: string; date: string; items: number }
/** Orders, totals, best sellers and repeat buyers, all counted here. A customer is an id only. */
export function readOrders(raw: readonly unknown[], truncated: boolean) {
  const orders = raw.map((o) => (o ?? {}) as Record<string, unknown>).filter((o) => Number.isInteger(o.id));
  const rows: OrderRow[] = orders.map((o) => ({
    id: o.id as number, number: plain(o.number ?? o.id, 20), status: plain(o.status, 20), total: cents(num(o.total)), currency: plain(o.currency, 3),
    date: plain(o.date_created, 25), items: ((o.line_items as { quantity?: unknown }[] | undefined) ?? []).reduce((n, l) => n + num(l.quantity), 0),
  }));
  const paid = orders.filter((o) => PAID.has(String(o.status)));
  const perCustomer = new Map<number, number>();
  for (const o of paid) { const c = num(o.customer_id); if (c > 0) perCustomer.set(c, (perCustomer.get(c) ?? 0) + 1); }
  const sellers = new Map<string, { product: string; quantity: number; revenue: number }>();
  for (const o of paid) for (const l of (o.line_items as Record<string, unknown>[] | undefined) ?? []) {
    const k = String(l.product_id ?? l.name);
    const s = sellers.get(k) ?? { product: plain(l.name, 100), quantity: 0, revenue: 0 };
    s.quantity += num(l.quantity); s.revenue = cents(s.revenue + num(l.total));
    sellers.set(k, s);
  }
  const revenue = cents(paid.reduce((n, o) => n + num(o.total), 0));
  return {
    orders: rows.slice(0, 50),
    totals: { orders: orders.length, paid_orders: paid.length, revenue, average_order: paid.length ? cents(revenue / paid.length) : 0, repeat_buyers: [...perCustomer.values()].filter((n) => n > 1).length, buyers_with_account: perCustomer.size },
    best_sellers: [...sellers.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    truncated,
  };
}

/** Products the store tracks stock for at or below a level, or out of stock, lowest first. */
export function readLowStock(raw: readonly unknown[], atOrBelow: number) {
  const products = raw.map((p) => (p ?? {}) as Record<string, unknown>);
  return products
    .filter((p) => p.manage_stock === true && (num(p.stock_quantity) <= atOrBelow || p.stock_status === "outofstock"))
    .map((p) => ({ product: plain(p.name, 100), sku: plain(p.sku, 60), in_stock: num(p.stock_quantity), status: plain(p.stock_status, 20) }))
    .sort((a, b) => a.in_stock - b.in_stock)
    .slice(0, 50);
}

/** Why a note is refused: one field, plain text up to 500 characters, no links, no markup. */
export function refuseNote(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => !(NOTE_FIELDS as readonly string[]).includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A note has only its text; it is always private.`;
  const note = args.note;
  if (typeof note !== "string" || !note.trim()) return "The note needs text.";
  if (note.length > NOTE_MAX) return `The note is longer than ${NOTE_MAX} characters.`;
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(note)) return "The note may not hold control characters.";
  if (/https?:\/\/|www\.|<[a-z/!]/i.test(note)) return "A note may not hold links or markup.";
  return null;
}

/** A WooCommerce order id as a target: digits only. */
export const orderIdOk = (s: unknown): s is string => typeof s === "string" && /^\d{1,12}$/.test(s);

/** What the server accepts for its one write tool, checked again there. */
export function checkNoteArgs(raw: unknown): { orderId: string; note: string } | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!orderIdOk(a.orderId)) return { problem: "orderId must be a WooCommerce order id" };
  const { orderId, ...rest } = a;
  const no = refuseNote(rest);
  return no ? { problem: no } : { orderId: orderId as string, note: String(a.note).trim() };
}
