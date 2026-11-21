// Stripe (card 240, docs/mcp-everywhere.md "Stripe"). Pure, so `npm run check:mcp` and
// `npm run check:policy` can test it with no network.
//
// Stripe's hosted MCP server has only generic tools (any GET, any write, refunds included) and no
// read-only switch, so a profile can't name what may be called there. We run our own small server
// (integrations/stripe-server.ts) over Stripe's REST API with two restricted keys the business makes:
// - the read key: each read tool runs one fixed request written here, takes only a period and a row
//   limit, and every total is added up here. A key that can change anything is refused.
// - the invoice-drafts key: used only by core/gateway, after an approver approves, to make one draft
//   invoice (auto_advance off, so Stripe never finalizes, sends or charges it on its own). It may
//   write invoices and invoice items, and nothing that moves money.

export const STRIPE_READ_TOOLS = ["stripe_balance", "stripe_money_in", "stripe_subscriptions", "stripe_open_invoices", "stripe_customers"] as const;
export type StripeReadTool = (typeof STRIPE_READ_TOOLS)[number];
export const STRIPE_DRAFT_TOOL = "stripe_create_invoice_draft";

/** Pinned so a change on Stripe's side can't change what a call does. */
export const STRIPE_VERSION = "2024-06-20";
export const STRIPE_BASE = "https://api.stripe.com/v1";

export const STRIPE_PERIODS = ["last_7_days", "last_30_days", "last_90_days"] as const;
export type StripePeriod = (typeof STRIPE_PERIODS)[number];
const DAYS: Record<StripePeriod, number> = { last_7_days: 7, last_30_days: 30, last_90_days: 90 };
export const periodDays = (p: StripePeriod) => DAYS[p];
/** Unix seconds at the start of the period, counted back from `now` (ms). */
export const periodStart = (p: StripePeriod, now: number) => Math.floor(now / 1000) - DAYS[p] * 86_400;

/** Rows per page and pages per read: at most 1,000 objects read for any one tool call. */
export const PAGE = 100;
export const MAX_PAGES = 10;
export const MAX_ROWS = 25;

/** Restricted keys only: a secret key (sk_) can do everything, so it is refused before any request. */
export const looksLikeStripeKey = (k: string) => /^rk_(live|test)_[A-Za-z0-9]{20,200}$/.test(k.trim());
export const isSecretKey = (k: string) => /^sk_(live|test)_/.test(k.trim());
export const stripeMode = (k: string): "live" | "test" => (k.trim().startsWith("rk_live_") ? "live" : "test");

export type StripeArgs =
  | { tool: "stripe_balance" }
  | { tool: "stripe_money_in"; period: StripePeriod }
  | { tool: "stripe_subscriptions"; period: StripePeriod }
  | { tool: "stripe_open_invoices"; limit: number }
  | { tool: "stripe_customers"; limit: number };

/** A read tool's input, checked again on our server. Anything not named here is refused. */
export function checkStripeArgs(tool: string, raw: unknown): StripeArgs | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed: Record<StripeReadTool, string[]> = { stripe_balance: [], stripe_money_in: ["period"], stripe_subscriptions: ["period"], stripe_open_invoices: ["limit"], stripe_customers: ["limit"] };
  if (!(tool in allowed)) return { problem: `${tool || "that"} isn't a Stripe read tool` };
  const t = tool as StripeReadTool;
  const extra = Object.keys(a).filter((k) => !allowed[t].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  if (t === "stripe_balance") return { tool: t };
  if (t === "stripe_money_in" || t === "stripe_subscriptions") {
    const period = (a.period ?? "last_30_days") as StripePeriod;
    if (!STRIPE_PERIODS.includes(period)) return { problem: `period is one of ${STRIPE_PERIODS.join(", ")}` };
    return { tool: t, period };
  }
  const limit = a.limit === undefined ? 10 : Number(a.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS) return { problem: `limit is a whole number from 1 to ${MAX_ROWS}` };
  return { tool: t, limit };
}

/** The fixed GET for a read, with its query. `after` is the list cursor for the next page. */
export function readRequest(a: StripeArgs, now: number, after?: string): { path: string; query: Record<string, string>; paged: boolean } {
  const q = (o: Record<string, string>) => (after ? { ...o, starting_after: after } : o);
  switch (a.tool) {
    case "stripe_balance": return { path: "balance", query: {}, paged: false };
    case "stripe_money_in": return { path: "balance_transactions", query: q({ limit: String(PAGE), "created[gte]": String(periodStart(a.period, now)) }), paged: true };
    case "stripe_subscriptions": return { path: "subscriptions", query: q({ limit: String(PAGE), status: "all", "expand[]": "data.items.data.price" }), paged: true };
    case "stripe_open_invoices": return { path: "invoices", query: { limit: String(PAGE), status: "open" }, paged: false };
    case "stripe_customers": return { path: "customers", query: { limit: String(a.limit) }, paged: false };
  }
}

// ---- Reading Stripe's replies. Amounts are in the currency's smallest unit; every sum is made here.

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const int = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : 0);
const str = (x: unknown, max = 120): string => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Currencies with no minor unit (Stripe's list of zero-decimal currencies, the common ones). */
const ZERO_DECIMAL = new Set(["jpy", "krw", "vnd", "clp", "pyg", "ugx", "xaf", "xof", "bif", "djf", "gnf", "kmf", "mga", "rwf", "vuv", "xpf"]);
/** Minor units to a plain amount, to 2 places. */
export const major = (minor: number, currency: string) => (ZERO_DECIMAL.has(currency) ? minor : Math.round(minor) / 100);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The list's rows, and the cursor for the next page (the last row's id) when Stripe says there is more. */
export function listPage(j: unknown): { rows: Json[]; next: string | null } {
  const rows = arr(obj(j).data).map(obj);
  const last = rows.length ? str(rows[rows.length - 1].id, 80) : "";
  return { rows, next: obj(j).has_more === true && last ? last : null };
}

/** Cash in Stripe now: available and pending, per currency. */
export function readBalance(j: unknown): { currencies: { currency: string; available: number; pending: number }[] } {
  const by = new Map<string, { available: number; pending: number }>();
  for (const kind of ["available", "pending"] as const) {
    for (const r of arr(obj(j)[kind]).map(obj)) {
      const c = str(r.currency, 3).toLowerCase();
      if (!/^[a-z]{3}$/.test(c)) continue;
      const cur = by.get(c) ?? { available: 0, pending: 0 };
      cur[kind] += int(r.amount);
      by.set(c, cur);
    }
  }
  return { currencies: [...by].map(([currency, v]) => ({ currency, available: major(v.available, currency), pending: major(v.pending, currency) })) };
}

/** The currency with the most rows, so totals are never added across currencies. */
export function mainCurrency(rows: readonly Json[]): string | null {
  const n = new Map<string, number>();
  for (const r of rows) { const c = str(r.currency, 3).toLowerCase(); if (c) n.set(c, (n.get(c) ?? 0) + 1); }
  let best: string | null = null;
  for (const [c, k] of n) if (best === null || k > (n.get(best) ?? 0)) best = c;
  return best;
}

const MONEY_IN = new Set(["charge", "payment"]);
const REFUND = new Set(["refund", "payment_refund"]);

export interface MoneyIn {
  currency: string | null;
  totals: { gross: number; refunds: number; fees: number; net: number; payments: number; refund_count: number };
  days: { date: string; gross: number; refunds: number; net: number; payments: number }[];
  /** Rows in other currencies, left out of the totals. */
  other_currency_rows: number;
  /** True when more than MAX_PAGES pages existed and the oldest rows were not read. */
  cut: boolean;
}

/**
 * Money in over a period from balance transactions: charges and payments are gross, refunds are
 * refunds, fees are every row's fee on those, net is gross minus refunds minus fees. Payouts and
 * transfers are moves of the business's own money, so they are left out. One currency only.
 */
export function readMoneyIn(rows: readonly Json[], cut: boolean): MoneyIn {
  const currency = mainCurrency(rows);
  const day = new Map<string, { gross: number; refunds: number; net: number; payments: number }>();
  let gross = 0, refunds = 0, fees = 0, payments = 0, refundCount = 0, other = 0;
  for (const r of rows) {
    const type = str(r.type, 40);
    if (!MONEY_IN.has(type) && !REFUND.has(type)) continue;
    if (str(r.currency, 3).toLowerCase() !== currency) { other++; continue; }
    const date = new Date(int(r.created) * 1000).toISOString().slice(0, 10);
    const d = day.get(date) ?? { gross: 0, refunds: 0, net: 0, payments: 0 };
    const amount = int(r.amount), fee = int(r.fee);
    if (MONEY_IN.has(type)) { gross += amount; d.gross += amount; payments++; d.payments++; }
    else { refunds += -amount; d.refunds += -amount; refundCount++; }
    fees += fee;
    d.net += amount - fee;
    day.set(date, d);
  }
  const c = currency ?? "usd";
  return {
    currency,
    totals: { gross: major(gross, c), refunds: major(refunds, c), fees: major(fees, c), net: major(gross - refunds - fees, c), payments, refund_count: refundCount },
    days: [...day].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, d]) => ({ date, gross: major(d.gross, c), refunds: major(d.refunds, c), net: major(d.net, c), payments: d.payments })),
    other_currency_rows: other,
    cut,
  };
}

/** A price's amount per month, in minor units: unit amount times quantity, spread over its interval. */
export function monthly(unitAmount: number, quantity: number, interval: string, count: number): number {
  const per = unitAmount * Math.max(0, quantity);
  const n = Math.max(1, count);
  switch (interval) {
    case "month": return per / n;
    case "year": return per / (12 * n);
    case "week": return (per * 52) / (12 * n);
    case "day": return (per * 365) / (12 * n);
    default: return 0;
  }
}

const LIVE_SUB = new Set(["active", "past_due"]);

export interface Subscriptions {
  currency: string | null;
  /** Monthly recurring revenue from active and past-due subscriptions, before discounts. */
  mrr: number;
  active: number; past_due: number; trialing: number;
  started_in_period: number; cancelled_in_period: number;
  other_currency: number;
  cut: boolean;
}

/** Subscription counts and monthly recurring revenue, worked out here. `since` in Unix seconds. */
export function readSubscriptions(rows: readonly Json[], since: number, cut: boolean): Subscriptions {
  const currency = mainCurrency(rows);
  let mrr = 0, active = 0, pastDue = 0, trialing = 0, started = 0, cancelled = 0, other = 0;
  for (const s of rows) {
    const status = str(s.status, 30);
    if (int(s.created) >= since) started++;
    if (int(s.canceled_at) >= since && int(s.canceled_at) > 0) cancelled++;
    if (status === "active") active++;
    else if (status === "past_due") pastDue++;
    else if (status === "trialing") trialing++;
    if (!LIVE_SUB.has(status)) continue;
    if (str(s.currency, 3).toLowerCase() !== currency) { other++; continue; }
    for (const it of arr(obj(s.items).data).map(obj)) {
      const price = obj(it.price), rec = obj(price.recurring);
      mrr += monthly(int(price.unit_amount), int(it.quantity ?? 1), str(rec.interval, 10), int(rec.interval_count ?? 1));
    }
  }
  const c = currency ?? "usd";
  return { currency, mrr: round2(major(Math.round(mrr), c)), active, past_due: pastDue, trialing, started_in_period: started, cancelled_in_period: cancelled, other_currency: other, cut };
}

export interface OpenInvoice { pick: string; number: string; customer: string; currency: string; amount_due: number; due: string | null; days_late: number }

/** Open invoices, most overdue first, with the amount still owed and days late worked out here. Customer names come from outside. */
export function readOpenInvoices(j: unknown, now: number, limit: number): { invoices: OpenInvoice[]; ids: string[]; open: number; overdue: number; overdue_amount: Record<string, number> } {
  const rows = listPage(j).rows;
  const today = Math.floor(now / 1000);
  const all = rows.map((r) => {
    const currency = str(r.currency, 3).toLowerCase();
    const due = int(r.due_date);
    return {
      id: str(r.id, 80), number: str(r.number, 40), customer: str(r.customer_name) || str(r.customer_email) || "?", currency,
      amount_due: major(int(r.amount_remaining), currency), due: due ? new Date(due * 1000).toISOString().slice(0, 10) : null,
      days_late: due && due < today ? Math.floor((today - due) / 86_400) : 0,
    };
  }).filter((r) => r.id);
  all.sort((a, b) => b.days_late - a.days_late);
  const overdue = all.filter((r) => r.days_late > 0);
  const overdueAmount: Record<string, number> = {};
  for (const r of overdue) overdueAmount[r.currency] = round2((overdueAmount[r.currency] ?? 0) + r.amount_due);
  const shown = all.slice(0, limit);
  return { invoices: shown.map((r, i) => ({ pick: `i${i + 1}`, number: r.number, customer: r.customer, currency: r.currency, amount_due: r.amount_due, due: r.due, days_late: r.days_late })), ids: shown.map((r) => r.id), open: all.length, overdue: overdue.length, overdue_amount: overdueAmount };
}

/** Customers to pick from for an invoice: id, a label (name, else email) and their billing currency when Stripe has one. */
export function readCustomers(j: unknown): { id: string; label: string; currency: string | null }[] {
  return listPage(j).rows.filter((r) => r.deleted !== true).map((r) => ({
    id: str(r.id, 80), label: str(r.name, 80) || str(r.email, 80) || str(r.id, 80), currency: str(r.currency, 3).toLowerCase() || null,
  })).filter((r) => CUSTOMER_ID.test(r.id));
}

// ---- Checking a pasted key (integrations/stripe-server.ts runs these, then reads the answers here).

/**
 * Writes a key must NOT be able to make. Each is an update of an object that can't exist, so it can't
 * change anything whatever the key: Stripe answers 403 when the key lacks the permission and 404 when
 * it has it (and found nothing). Nothing here creates, sends, pays or refunds.
 */
export const WRITE_PROBES: { what: string; path: string }[] = [
  { what: "refunds", path: "refunds/re_operator_probe" },
  { what: "charges", path: "charges/ch_operator_probe" },
  { what: "payouts", path: "payouts/po_operator_probe" },
  { what: "customers", path: "customers/cus_operator_probe" },
  { what: "subscriptions", path: "subscriptions/sub_operator_probe" },
  { what: "products", path: "products/prod_operator_probe" },
  { what: "invoices", path: "invoices/in_operator_probe" },
  { what: "invoice items", path: "invoiceitems/ii_operator_probe" },
];
/** The two writes the invoice-drafts key must have; every other probe must be refused. */
export const DRAFT_WRITES = ["invoices", "invoice items"];
/** The reads the read key needs, one GET each. */
export const READ_NEEDS: { what: string; path: string }[] = [
  { what: "Balance", path: "balance" },
  { what: "Balance transaction sources", path: "balance_transactions?limit=1" },
  { what: "Subscriptions", path: "subscriptions?limit=1" },
  { what: "Invoices", path: "invoices?limit=1" },
  { what: "Customers", path: "customers?limit=1" },
];

/** What a probe's status says: the key can write there, can't, or the answer can't be read. */
export const probeSays = (status: number): "can" | "cannot" | "unknown" => (status === 404 ? "can" : status === 403 ? "cannot" : "unknown");

/**
 * Why a key is refused, from its probe answers, or null when it reaches exactly what the profile
 * needs. `kind` is the profile: the read key may write nothing; the drafts key must write invoices
 * and invoice items and nothing else.
 */
export function keyProblem(kind: "read" | "drafts", probes: Record<string, number>): string | null {
  const unknown = Object.entries(probes).filter(([, s]) => probeSays(s) === "unknown").map(([w]) => w);
  if (unknown.length) return `Stripe's answer for ${unknown.join(", ")} couldn't be read, so the key can't be checked`;
  const can = Object.entries(probes).filter(([, s]) => probeSays(s) === "can").map(([w]) => w);
  if (kind === "read") return can.length ? `the key can also change ${can.join(", ")}. Make a restricted key with Read on the five lists and None everywhere else` : null;
  const missing = DRAFT_WRITES.filter((w) => !can.includes(w));
  if (missing.length) return `the key can't write ${missing.join(" and ")}. Set Invoices and Invoice items to Write`;
  const extra = can.filter((w) => !DRAFT_WRITES.includes(w));
  return extra.length ? `the key can also change ${extra.join(", ")}. Set those to None` : null;
}

// ---- The draft invoice (gateway action type stripe.invoice_draft).

export const CUSTOMER_ID = /^cus_[A-Za-z0-9]{6,40}$/;
export const REQUEST_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const INVOICE_CURRENCIES = ["usd", "cad", "gbp", "eur", "aud"] as const;
export const INVOICE_LIMITS = { lines: 5, description: 100, memo: 500, minDays: 1, maxDays: 90 } as const;
/** The most one draft invoice may ask for, in code (2026-11-21 spec, to be confirmed). */
export const MAX_INVOICE_USD = 5000;
export const INVOICE_FIELDS = ["currency", "lines", "days_until_due", "memo"] as const;
export interface InvoiceLine { description: string; amount: number }
export interface InvoiceArgs { currency: (typeof INVOICE_CURRENCIES)[number]; lines: InvoiceLine[]; days_until_due: number; memo?: string }

const LINK = /https?:\/\/|www\.|\{\{|\{%/i;
const CTRL = /[\u0000-\u001f\u007f]/;

/** Why a draft invoice's fields are refused: up to 5 plain lines of whole cents, a due date 1 to 90 days out, the total within the ceiling. */
export function refuseInvoice(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => !(INVOICE_FIELDS as readonly string[]).includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A draft invoice holds only a currency, its lines, days until due and a memo; the customer is picked from Stripe.`;
  const a = args as Partial<InvoiceArgs>;
  if (!INVOICE_CURRENCIES.includes(a.currency as InvoiceArgs["currency"])) return `The currency is one of ${INVOICE_CURRENCIES.join(", ")}.`;
  if (!Array.isArray(a.lines) || a.lines.length < 1) return "The invoice needs at least one line.";
  if (a.lines.length > INVOICE_LIMITS.lines) return `At most ${INVOICE_LIMITS.lines} lines.`;
  let cents = 0;
  for (const l of a.lines as unknown[]) {
    const line = obj(l);
    const extraLine = Object.keys(line).filter((k) => k !== "description" && k !== "amount");
    if (extraLine.length) return `A line holds only a description and an amount (not ${extraLine.join(", ")}).`;
    if (typeof line.description !== "string" || !line.description.trim()) return "Every line needs a description.";
    if (line.description.length > INVOICE_LIMITS.description) return `A line's description is longer than ${INVOICE_LIMITS.description} characters.`;
    if (CTRL.test(line.description) || LINK.test(line.description)) return "A line's description must be one line of plain text with no links.";
    const amount = line.amount;
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return "Every line's amount must be more than 0.";
    if (Math.abs(Math.round(amount * 100) - amount * 100) > 1e-6) return "Amounts are whole cents.";
    cents += Math.round(amount * 100);
  }
  if (cents > MAX_INVOICE_USD * 100) return `The invoice totals ${(cents / 100).toFixed(2)}, over the ${MAX_INVOICE_USD.toLocaleString("en-US")} ceiling for one draft.`;
  const days = a.days_until_due;
  if (typeof days !== "number" || !Number.isInteger(days) || days < INVOICE_LIMITS.minDays || days > INVOICE_LIMITS.maxDays) return `Days until due is a whole number from ${INVOICE_LIMITS.minDays} to ${INVOICE_LIMITS.maxDays}.`;
  if (a.memo !== undefined) {
    if (typeof a.memo !== "string") return "The memo must be text.";
    if (a.memo.length > INVOICE_LIMITS.memo) return `The memo is longer than ${INVOICE_LIMITS.memo} characters.`;
    if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(a.memo) || LINK.test(a.memo)) return "The memo may not hold links or control characters.";
  }
  return null;
}

/** The invoice's total in cents, added up here. */
export const invoiceCents = (lines: readonly InvoiceLine[]) => lines.reduce((t, l) => t + Math.round(l.amount * 100), 0);

/** What the server accepts for its one write tool, checked again there. */
export function checkDraftInvoiceArgs(raw: unknown): ({ customerId: string; requestKey: string } & InvoiceArgs) | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof a.customerId !== "string" || !CUSTOMER_ID.test(a.customerId)) return { problem: "customerId must be a Stripe customer id" };
  // the gateway's action id: sent to Stripe as the idempotency key, so a retried request never makes a second draft
  if (typeof a.requestKey !== "string" || !REQUEST_KEY.test(a.requestKey)) return { problem: "requestKey must be the action's id" };
  const { customerId, requestKey, ...rest } = a;
  const no = refuseInvoice(rest);
  if (no) return { problem: no };
  const r = rest as unknown as InvoiceArgs;
  return { customerId: customerId as string, requestKey: requestKey as string, currency: r.currency, lines: r.lines.map((l) => ({ description: l.description.trim(), amount: l.amount })), days_until_due: r.days_until_due, ...(r.memo?.trim() ? { memo: r.memo.trim() } : {}) };
}

/** Whether the customer can be invoiced in this currency: Stripe bills a customer in one currency once it has one. */
export function refuseCustomer(c: { deleted?: unknown; currency?: unknown } | null, currency: string): string | null {
  if (!c || c.deleted === true) return "That customer isn't in the business's Stripe any more.";
  const cur = typeof c.currency === "string" ? c.currency.toLowerCase() : "";
  if (cur && cur !== currency) return `That customer is billed in ${cur.toUpperCase()}, not ${currency.toUpperCase()}.`;
  return null;
}

/** The form bodies for the draft, fixed here: the invoice (send_invoice, auto_advance off), then one invoice item per line. */
export function draftBodies(a: { customerId: string } & InvoiceArgs): { invoice: Record<string, string>; items: Record<string, string>[] } {
  const invoice: Record<string, string> = {
    customer: a.customerId, currency: a.currency, collection_method: "send_invoice", days_until_due: String(a.days_until_due),
    auto_advance: "false", pending_invoice_items_behavior: "exclude", "metadata[made_by]": "operator_gateway",
  };
  if (a.memo) invoice.description = a.memo;
  const items = a.lines.map((l) => ({ customer: a.customerId, currency: a.currency, amount: String(Math.round(l.amount * 100)), description: l.description }));
  return { invoice, items };
}
