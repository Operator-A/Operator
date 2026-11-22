// Square (card 242, docs/mcp-everywhere.md "Square"). Pure, so `npm run check:square` can test it
// with no network.
//
// Square's hosted MCP server is in beta, lets only allow-listed clients sign in and reaches everything
// Square's APIs offer, so a profile can't name what may be called there. We run our own small server
// (integrations/square-server.ts) over Square's REST API, on one sign-in the business makes on Square's
// own page with the app's Square OAuth client:
// - read tools: each runs fixed requests written here, takes only a period or a row limit, and every
//   total is added up here.
// - one write tool, offered only to core/gateway after an approver approves: a draft invoice for one of
//   the business's own customers at one of its own locations. Square builds an invoice on an order, so
//   the draft is one order (ad hoc lines only) and one invoice that Square keeps as a DRAFT until the
//   owner publishes it in Square. No publish, cancel, delete, refund or payment call exists here.
// - right after sign-in, the token's scopes are read back from Square and must be exactly SQUARE_SCOPES.

import { INVOICE_CURRENCIES, INVOICE_FIELDS, INVOICE_LIMITS, MAX_INVOICE_USD, REQUEST_KEY, invoiceCents, refuseInvoice, type InvoiceArgs, type InvoiceLine } from "@/core/stripe-rules";

export const SQUARE_READ_TOOLS = ["square_payments", "square_locations", "square_open_invoices", "square_customers", "square_appointments"] as const;
export type SquareReadTool = (typeof SQUARE_READ_TOOLS)[number];
export const SQUARE_DRAFT_TOOL = "square_create_invoice_draft";
/** The gateway action type: a draft invoice in the business's Square. */
export const SQUARE_INVOICE = "square.invoice_draft";
export const SQUARE_INVOICE_GRANT = "square_invoice_draft";

/**
 * The profile's scopes, exactly. Reads: the business (who signed in, its locations), payments, customers
 * and invoices. Writes: invoices, and orders because a Square invoice is built on an order. Our server
 * makes only that one order, for the draft, and never updates or pays an order.
 */
export const SQUARE_SCOPES = ["MERCHANT_PROFILE_READ", "PAYMENTS_READ", "CUSTOMERS_READ", "INVOICES_READ", "INVOICES_WRITE", "ORDERS_WRITE", "APPOINTMENTS_READ", "APPOINTMENTS_ALL_READ"] as const;

/** Pinned so a change on Square's side can't change what a call does. */
export const SQUARE_VERSION = "2025-10-16";
export const SQUARE_HOST = "https://connect.squareup.com";
export const SQUARE_SANDBOX_HOST = "https://connect.squareupsandbox.com";
export const squareApi = (host: string) => `${host}/v2`;

/** Square's fixed sign-in addresses (no self-registration; our own OAuth client). */
export const squareAuth = (host: string) => ({
  authorization_endpoint: `${host}/oauth2/authorize`,
  token_endpoint: `${host}/oauth2/token`,
  revocation_endpoint: `${host}/oauth2/revoke`,
});

/**
 * Square's sign-in page address. Square's code flow with a client secret: no PKCE (a PKCE sign-in gets
 * short, single-use refresh tokens meant for apps with no secret). `session=false` asks the person to
 * sign in rather than reuse whatever Square session the browser has.
 */
export function squareAuthorizeUrl(host: string, o: { clientId: string; redirectUri: string; state: string }): string {
  const u = new URL(squareAuth(host).authorization_endpoint);
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SQUARE_SCOPES.join(" "));
  u.searchParams.set("session", "false");
  u.searchParams.set("state", o.state);
  u.searchParams.set("redirect_uri", o.redirectUri);
  return u.toString();
}

export const MAX_DAYS = 90;
export const MAX_ROWS = 25;
/** Rows per page and pages per read: at most 1,000 payments read for any one call. */
export const PAGE = 100;
export const MAX_PAGES = 10;
/** Square's invoice search takes one location at a time; at most this many are searched. */
export const MAX_LOCATIONS = 10;

/** Square ids: customers, locations, payments, orders and invoices are letters, digits, - and _. */
export const SQ_ID = /^[A-Za-z0-9_-]{4,64}$/;
/** Square lists bookings over at most 31 days at a time. */
export const MAX_BOOKING_DAYS = 31;

export type SquareArgs =
  | { tool: "square_payments"; days: number }
  | { tool: "square_locations" }
  | { tool: "square_open_invoices"; limit: number }
  | { tool: "square_customers"; limit: number }
  | { tool: "square_appointments"; days: number; when: "past" | "next" };

/** A read tool's input, checked again on our server. Anything not named here is refused. */
export function checkSquareArgs(tool: string, raw: unknown): SquareArgs | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed: Record<SquareReadTool, string[]> = { square_payments: ["days"], square_locations: [], square_open_invoices: ["limit"], square_customers: ["limit"], square_appointments: ["days", "when"] };
  if (!(tool in allowed)) return { problem: `${tool || "that"} isn't a Square read tool` };
  const t = tool as SquareReadTool;
  const extra = Object.keys(a).filter((k) => !allowed[t].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  if (t === "square_locations") return { tool: t };
  if (t === "square_appointments") {
    const days = a.days === undefined ? 7 : Number(a.days);
    const when = a.when === undefined ? "next" : a.when;
    if (!Number.isInteger(days) || days < 1 || days > MAX_BOOKING_DAYS) return { problem: `days is a whole number from 1 to ${MAX_BOOKING_DAYS}` };
    if (when !== "past" && when !== "next") return { problem: "when is past or next" };
    return { tool: t, days, when };
  }
  if (t === "square_payments") {
    const days = a.days === undefined ? 30 : Number(a.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return { problem: `days is a whole number from 1 to ${MAX_DAYS}` };
    return { tool: t, days };
  }
  const limit = a.limit === undefined ? 10 : Number(a.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS) return { problem: `limit is a whole number from 1 to ${MAX_ROWS}` };
  return { tool: t, limit };
}

/** The start of a lookback, as Square's RFC 3339 time. `now` in ms. */
export const sinceIso = (days: number, now: number) => new Date(now - days * 86_400_000).toISOString();

type Req = { method: "GET" | "POST"; path: string; query?: Record<string, string>; body?: unknown };

/** Every request our server sends, fixed here. */
export const squareRequest = {
  merchant: (): Req => ({ method: "GET", path: "merchants/me" }),
  locations: (): Req => ({ method: "GET", path: "locations" }),
  location: (id: string): Req => ({ method: "GET", path: `locations/${encodeURIComponent(id)}` }),
  payments: (since: string, cursor?: string): Req => ({ method: "GET", path: "payments", query: { begin_time: since, sort_order: "DESC", limit: String(PAGE), ...(cursor ? { cursor } : {}) } }),
  invoices: (locationId: string): Req => ({ method: "POST", path: "invoices/search", body: { query: { filter: { location_ids: [locationId] }, sort: { field: "INVOICE_SORT_DATE", order: "DESC" } }, limit: PAGE } }),
  customers: (limit: number): Req => ({ method: "GET", path: "customers", query: { limit: String(limit), sort_field: "CREATED_AT", sort_order: "DESC" } }),
  bookings: (startMin: string, startMax: string, cursor?: string): Req => ({ method: "GET", path: "bookings", query: { start_at_min: startMin, start_at_max: startMax, limit: String(PAGE), ...(cursor ? { cursor } : {}) } }),
  customer: (id: string): Req => ({ method: "GET", path: `customers/${encodeURIComponent(id)}` }),
  invoice: (id: string): Req => ({ method: "GET", path: `invoices/${encodeURIComponent(id)}` }),
  createOrder: (body: unknown): Req => ({ method: "POST", path: "orders", body }),
  createInvoice: (body: unknown): Req => ({ method: "POST", path: "invoices", body }),
};

// ---- Reading Square's replies. Amounts are in the currency's smallest unit; every sum is made here.

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const int = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : typeof x === "string" && /^-?\d+$/.test(x) ? Number(x) : 0);
const str = (x: unknown, max = 120): string => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd", "clp", "pyg", "ugx", "xaf", "xof", "isk"]);
/** Minor units to a plain amount. */
export const major = (minor: number, currency: string) => (ZERO_DECIMAL.has(currency) ? minor : Math.round(minor) / 100);
const round2 = (n: number) => Math.round(n * 100) / 100;
const money = (m: unknown) => ({ amount: int(obj(m).amount), currency: str(obj(m).currency, 3).toLowerCase() });

/** Who signed in: the business's name, its id and its main currency. */
export function readMerchant(j: unknown): { id: string; name: string; currency: string } | null {
  const m = obj(obj(j).merchant);
  const id = str(m.id, 64);
  if (!SQ_ID.test(id)) return null;
  return { id, name: str(m.business_name, 120) || id, currency: str(m.currency, 3).toLowerCase() };
}

/** The scopes Square says a token carries (POST /oauth2/token/status). */
export function readTokenScopes(j: unknown): string[] | null {
  const s = obj(j).scopes;
  return Array.isArray(s) ? s.filter((x): x is string => typeof x === "string") : null;
}

/** Why a token's scopes aren't exactly the profile's, or null when they match. */
export function squareScopeProblem(granted: readonly string[] | null): string | null {
  if (!granted) return "Square didn't say what this sign-in was granted";
  const missing = SQUARE_SCOPES.filter((s) => !granted.includes(s));
  if (missing.length) return `the sign-in wasn't granted ${missing.join(", ")}`;
  const extra = granted.filter((g) => !(SQUARE_SCOPES as readonly string[]).includes(g));
  return extra.length ? `the sign-in was granted more than it needs (${extra.join(", ")})` : null;
}

/** A token reply: Square sends `expires_at` as a time, not `expires_in`. `now` in ms. */
export function squareExpiresIn(j: unknown, now: number): number | null {
  const at = Date.parse(str(obj(j).expires_at, 40));
  return Number.isFinite(at) && at > now ? Math.floor((at - now) / 1000) : null;
}

export interface Location { id: string; name: string; currency: string; active: boolean }

/** The business's locations, active ones first. */
export function readLocations(j: unknown): Location[] {
  const all = arr(obj(j).locations).map(obj).map((l) => ({ id: str(l.id, 64), name: str(l.name, 80) || str(l.id, 64), currency: str(l.currency, 3).toLowerCase(), active: str(l.status, 20) === "ACTIVE" }))
    .filter((l) => SQ_ID.test(l.id));
  return [...all.filter((l) => l.active), ...all.filter((l) => !l.active)];
}

/** One location, checked for a draft: it must be active and bill in the invoice's currency. */
export function refuseLocation(j: unknown, currency: string): string | null {
  const l = obj(obj(j).location);
  if (!SQ_ID.test(str(l.id, 64))) return "That location isn't in the business's Square any more.";
  if (str(l.status, 20) !== "ACTIVE") return "That Square location isn't active.";
  const c = str(l.currency, 3).toLowerCase();
  if (c && c !== currency) return `That location takes ${c.toUpperCase()}, not ${currency.toUpperCase()}.`;
  return null;
}

/** A page of a list and Square's cursor for the next one. */
export function listPage(j: unknown, key: string): { rows: Json[]; next: string | null } {
  const cursor = str(obj(j).cursor, 400);
  return { rows: arr(obj(j)[key]).map(obj), next: cursor || null };
}

/** The currency with the most rows, so totals are never added across currencies. */
export function mainCurrency(currencies: readonly string[]): string | null {
  const n = new Map<string, number>();
  for (const c of currencies) if (c) n.set(c, (n.get(c) ?? 0) + 1);
  let best: string | null = null;
  for (const [c, k] of n) if (best === null || k > (n.get(best) ?? 0)) best = c;
  return best;
}

export interface Payments {
  currency: string | null;
  totals: { gross: number; refunds: number; fees: number; net: number; payments: number; average_sale: number };
  days: { date: string; gross: number; refunds: number; net: number; payments: number }[];
  locations: { location: string; gross: number; net: number; payments: number }[];
  /** Completed payments in other currencies, left out of the totals. */
  other_currency: number;
  /** True when more than MAX_PAGES pages existed and the oldest payments were not read. */
  cut: boolean;
}

/**
 * Completed payments over a period: gross is each payment's total (tips included), refunds are what was
 * refunded of it, fees are Square's processing fees, net is gross minus refunds minus fees. Payments
 * still pending, failed or cancelled are left out. One currency only. `names` maps location ids to names.
 */
export function readPayments(rows: readonly Json[], names: ReadonlyMap<string, string>, cut: boolean): Payments {
  const done = rows.filter((p) => str(p.status, 20) === "COMPLETED");
  const currency = mainCurrency(done.map((p) => money(p.total_money).currency));
  const day = new Map<string, { gross: number; refunds: number; net: number; payments: number }>();
  const loc = new Map<string, { gross: number; net: number; payments: number }>();
  let gross = 0, refunds = 0, fees = 0, count = 0, other = 0;
  for (const p of done) {
    const total = money(p.total_money);
    if (total.currency !== currency) { other++; continue; }
    const refunded = money(p.refunded_money).amount;
    const fee = arr(p.processing_fee).map(obj).reduce((t, f) => t + money(f.amount_money).amount, 0);
    const net = total.amount - refunded - fee;
    gross += total.amount; refunds += refunded; fees += fee; count++;
    const date = str(p.created_at, 40).slice(0, 10);
    const d = day.get(date) ?? { gross: 0, refunds: 0, net: 0, payments: 0 };
    d.gross += total.amount; d.refunds += refunded; d.net += net; d.payments++;
    day.set(date, d);
    const lid = str(p.location_id, 64);
    const l = loc.get(lid) ?? { gross: 0, net: 0, payments: 0 };
    l.gross += total.amount; l.net += net; l.payments++;
    loc.set(lid, l);
  }
  const c = currency ?? "usd";
  return {
    currency,
    totals: { gross: major(gross, c), refunds: major(refunds, c), fees: major(fees, c), net: major(gross - refunds - fees, c), payments: count, average_sale: count ? round2(major(gross, c) / count) : 0 },
    days: [...day].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, d]) => ({ date, gross: major(d.gross, c), refunds: major(d.refunds, c), net: major(d.net, c), payments: d.payments })),
    locations: [...loc].map(([id, l]) => ({ location: names.get(id) ?? (id || "?"), gross: major(l.gross, c), net: major(l.net, c), payments: l.payments })).sort((a, b) => b.gross - a.gross),
    other_currency: other,
    cut,
  };
}

const OPEN = new Set(["UNPAID", "SCHEDULED", "PARTIALLY_PAID"]);

export interface OpenInvoice { number: string; customer: string; location: string; currency: string; amount_due: number; due: string | null; days_late: number }

/**
 * Open invoices across the searched locations, most overdue first, with the amount still owed (each
 * payment request's computed amount less what was paid) and days late worked out here. Customer names
 * come from outside. `today` is YYYY-MM-DD.
 */
export function readOpenInvoices(rows: readonly Json[], names: ReadonlyMap<string, string>, today: string, limit: number): { invoices: OpenInvoice[]; open: number; overdue: number; overdue_amount: Record<string, number> } {
  const t0 = Date.parse(`${today}T00:00:00Z`);
  const all: OpenInvoice[] = [];
  for (const r of rows) {
    if (!OPEN.has(str(r.status, 30))) continue;
    let owed = 0, currency = "", due: string | null = null;
    for (const pr of arr(r.payment_requests).map(obj)) {
      const amount = money(pr.computed_amount_money), paid = money(pr.total_completed_amount_money).amount;
      currency ||= amount.currency;
      const left = Math.max(0, amount.amount - paid);
      owed += left;
      const d = str(pr.due_date, 10);
      if (left > 0 && /^\d{4}-\d{2}-\d{2}$/.test(d) && (!due || d < due)) due = d;
    }
    const who = obj(r.primary_recipient);
    const customer = str(who.company_name, 80) || [str(who.given_name, 40), str(who.family_name, 40)].filter(Boolean).join(" ") || str(who.email_address, 80) || "?";
    const late = due ? Math.floor((t0 - Date.parse(`${due}T00:00:00Z`)) / 86_400_000) : 0;
    all.push({ number: str(r.invoice_number, 40), customer, location: names.get(str(r.location_id, 64)) ?? "?", currency, amount_due: major(owed, currency || "usd"), due, days_late: Math.max(0, late) });
  }
  all.sort((a, b) => b.days_late - a.days_late);
  const overdue = all.filter((r) => r.days_late > 0);
  const overdueAmount: Record<string, number> = {};
  for (const r of overdue) overdueAmount[r.currency] = round2((overdueAmount[r.currency] ?? 0) + r.amount_due);
  return { invoices: all.slice(0, limit), open: all.length, overdue: overdue.length, overdue_amount: overdueAmount };
}

/** Customers to pick from for an invoice: id and a label (company, else name, else email). */
export function readCustomers(j: unknown): { id: string; label: string }[] {
  return arr(obj(j).customers).map(obj).map((c) => ({
    id: str(c.id, 64),
    label: str(c.company_name, 80) || [str(c.given_name, 40), str(c.family_name, 40)].filter(Boolean).join(" ") || str(c.email_address, 80) || str(c.id, 64),
  })).filter((c) => SQ_ID.test(c.id));
}

// ---- The draft invoice (gateway action type square.invoice_draft). Same guards as Stripe's draft.

export { INVOICE_CURRENCIES as SQUARE_CURRENCIES, INVOICE_LIMITS as SQUARE_INVOICE_LIMITS, MAX_INVOICE_USD as MAX_SQUARE_INVOICE_USD, invoiceCents };
export const SQUARE_INVOICE_FIELDS = INVOICE_FIELDS;
export type SquareInvoiceArgs = InvoiceArgs;

/** The target: the customer and the location, both picked by code from the business's own Square. */
export const squareTarget = (t: string) => /^[A-Za-z0-9_-]{4,64}@[A-Za-z0-9_-]{4,64}$/.test(t);
export const splitTarget = (t: string): { customerId: string; locationId: string } | null => {
  if (!squareTarget(t)) return null;
  const [customerId, locationId] = t.split("@");
  return { customerId, locationId };
};

/** Why a draft invoice's fields are refused: Stripe's guards (up to 5 plain lines, whole cents, the ceiling, due in 1 to 90 days). */
export function refuseSquareInvoice(args: Record<string, unknown>): string | null {
  const no = refuseInvoice(args);
  return no ? no.replace("picked from Stripe", "picked from Square") : null;
}

/** What the server accepts for its one write tool, checked again there. */
export function checkSquareDraftArgs(raw: unknown): ({ customerId: string; locationId: string; requestKey: string } & InvoiceArgs) | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof a.customerId !== "string" || !SQ_ID.test(a.customerId)) return { problem: "customerId must be a Square customer id" };
  if (typeof a.locationId !== "string" || !SQ_ID.test(a.locationId)) return { problem: "locationId must be a Square location id" };
  // the gateway's action id: sent to Square as the idempotency keys, so a retried request never makes a second draft
  if (typeof a.requestKey !== "string" || !REQUEST_KEY.test(a.requestKey)) return { problem: "requestKey must be the action's id" };
  const { customerId, locationId, requestKey, ...rest } = a;
  const no = refuseSquareInvoice(rest);
  if (no) return { problem: no };
  const r = rest as unknown as InvoiceArgs;
  return {
    customerId: customerId as string, locationId: locationId as string, requestKey: requestKey as string, currency: r.currency,
    lines: r.lines.map((l) => ({ description: l.description.trim(), amount: l.amount })), days_until_due: r.days_until_due, ...(r.memo?.trim() ? { memo: r.memo.trim() } : {}),
  };
}

/** The due date, `days` after `now` (UTC), as Square's YYYY-MM-DD. */
export const dueDate = (days: number, now: number) => new Date(now + days * 86_400_000).toISOString().slice(0, 10);

/**
 * The two bodies for the draft, fixed here: an order of ad hoc lines (no catalog items, so no taxes or
 * discounts are added), then an invoice on it that Square keeps as a DRAFT. Square never sends or charges
 * a draft; the owner publishes it from Square. Card is the only way to pay it once published.
 */
export function squareDraftBodies(a: { customerId: string; locationId: string; requestKey: string } & InvoiceArgs, now: number) {
  const cur = a.currency.toUpperCase();
  const order = {
    idempotency_key: `${a.requestKey}:order`,
    order: {
      location_id: a.locationId, customer_id: a.customerId, reference_id: "operator_gateway",
      line_items: a.lines.map((l: InvoiceLine) => ({ name: l.description, quantity: "1", base_price_money: { amount: Math.round(l.amount * 100), currency: cur } })),
    },
  };
  const invoice = (orderId: string) => ({
    idempotency_key: `${a.requestKey}:invoice`,
    invoice: {
      location_id: a.locationId, order_id: orderId, primary_recipient: { customer_id: a.customerId },
      payment_requests: [{ request_type: "BALANCE", due_date: dueDate(a.days_until_due, now) }],
      delivery_method: "EMAIL",
      accepted_payment_methods: { card: true, square_gift_card: false, bank_account: false, buy_now_pay_later: false, cash_app_pay: false },
      ...(a.memo ? { description: a.memo } : {}),
    },
  });
  return { order, invoice };
}

/** The order Square made: its id, and its total in minor units. */
export function readOrder(j: unknown): { id: string; total: number } | null {
  const o = obj(obj(j).order);
  const id = str(o.id, 64);
  return SQ_ID.test(id) ? { id, total: money(o.total_money).amount } : null;
}

/** The invoice Square made: its id, status and the amount its payment requests ask for, in minor units. */
export function readInvoice(j: unknown): { id: string; status: string; total: number } | null {
  const i = obj(obj(j).invoice);
  const id = str(i.id, 64);
  if (!SQ_ID.test(id)) return null;
  const total = arr(i.payment_requests).map(obj).reduce((t, pr) => t + money(pr.computed_amount_money).amount, 0);
  return { id, status: str(i.status, 30), total };
}

/** Square's own error message, short. */
export function squareError(j: unknown): string {
  const e = obj(arr(obj(j).errors)[0]);
  return str(e.detail, 200) || str(e.code, 80) || "error";
}

// ---- Appointments (2026-11-22): bookings by day, counted here. Customer ids only, never names or contacts.

/** The window a bookings read covers: the last `days` days up to now, or the next `days` days from now. */
export function bookingWindow(days: number, when: "past" | "next", now: number): { from: string; to: string } {
  const a = when === "past" ? now - days * 86_400_000 : now;
  return { from: new Date(a).toISOString(), to: new Date(a + days * 86_400_000).toISOString() };
}

const CANCELLED = new Set(["CANCELLED_BY_CUSTOMER", "CANCELLED_BY_SELLER", "DECLINED"]);

export interface Appointments {
  from: string; to: string;
  totals: { booked: number; cancelled: number; no_shows: number; pending: number; minutes_booked: number; no_show_rate: number };
  days: { date: string; booked: number; cancelled: number; no_shows: number }[];
  locations: { location: string; booked: number; no_shows: number }[];
  /** True when more than MAX_PAGES pages existed and the rest were not read. */
  cut: boolean;
}

/**
 * Bookings in a window: booked counts accepted, pending and no-show bookings (a no-show was booked);
 * cancelled counts customer and seller cancellations and declines. Minutes come from each booking's
 * segments. The no-show rate is no-shows over bookings whose time has passed.
 */
export function readBookings(rows: readonly Json[], names: ReadonlyMap<string, string>, window: { from: string; to: string }, now: number, cut: boolean): Appointments {
  const day = new Map<string, { booked: number; cancelled: number; no_shows: number }>();
  const loc = new Map<string, { booked: number; no_shows: number }>();
  let booked = 0, cancelled = 0, noShows = 0, pending = 0, minutes = 0, past = 0;
  for (const b of rows) {
    const status = str(b.status, 30);
    const start = str(b.start_at, 40);
    const at = Date.parse(start);
    if (!Number.isFinite(at)) continue;
    const date = start.slice(0, 10);
    const d = day.get(date) ?? { booked: 0, cancelled: 0, no_shows: 0 };
    const lid = str(b.location_id, 64);
    const l = loc.get(lid) ?? { booked: 0, no_shows: 0 };
    if (CANCELLED.has(status)) { cancelled++; d.cancelled++; day.set(date, d); continue; }
    if (!["ACCEPTED", "PENDING", "NO_SHOW"].includes(status)) continue;
    booked++; d.booked++; l.booked++;
    if (status === "PENDING") pending++;
    if (status === "NO_SHOW") { noShows++; d.no_shows++; l.no_shows++; }
    if (at <= now) past++;
    minutes += arr(b.appointment_segments).map(obj).reduce((t, s) => t + Math.max(0, int(s.duration_minutes)), 0);
    day.set(date, d);
    loc.set(lid, l);
  }
  return {
    from: window.from, to: window.to,
    totals: { booked, cancelled, no_shows: noShows, pending, minutes_booked: minutes, no_show_rate: past ? round2(noShows / past) : 0 },
    days: [...day].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, d]) => ({ date, ...d })),
    locations: [...loc].map(([id, l]) => ({ location: names.get(id) ?? (id || "?"), ...l })).sort((a, b) => b.booked - a.booked),
    cut,
  };
}
