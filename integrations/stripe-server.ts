import "server-only";
// Our own Stripe MCP server (card 240, docs/mcp-everywhere.md "Stripe"). Stripe's hosted server has
// only generic tools (any GET, any write) and no read-only switch, so it can't be held to a profile;
// this one runs in the app and is reached only through integrations/mcp.ts, which opens the key
// from the vault. Two profiles, two restricted keys:
// - "stripe": each read tool runs one fixed request (core/stripe-rules.ts) and sums are made there.
//   A key that can change anything is refused when it is pasted.
// - "stripe_drafts": one write tool, used only by core/gateway after an approver approves: a draft
//   invoice with auto_advance off. No finalize, send, pay, void, refund or delete call is here, and
//   none may be added (check:mcp fails on one): the owner finalizes and sends from Stripe.
import { MCP_PROTOCOL, checkedTools, type McpId } from "@/core/mcp-rules";
import {
  DRAFT_WRITES, MAX_PAGES, READ_NEEDS, STRIPE_DRAFT_TOOL, WRITE_PROBES, checkDraftInvoiceArgs, checkStripeArgs, draftBodies, invoiceCents, isSecretKey, keyProblem, listPage,
  looksLikeStripeKey, periodStart, readBalance, readCustomers, readMoneyIn, readOpenInvoices, readRequest, readSubscriptions, refuseCustomer, stripeMode, type StripeArgs,
} from "@/core/stripe-rules";
import { errorText, stripeGet, stripeJson, stripePost } from "./stripe-api";

/** Starts an error raised after the draft was made, so the gateway records it as partly done, never retried. */
const PARTIAL = "Partly made draft";

const DESCRIPTIONS: Record<string, string> = {
  stripe_balance: "Cash in Stripe now: available and pending, per currency.",
  stripe_money_in: "Payments, refunds, fees and net for a period, in total and by day.",
  stripe_subscriptions: "Active, past-due and trialing subscriptions, monthly recurring revenue, and starts and cancellations in a period.",
  stripe_open_invoices: "Open invoices, most overdue first, with the amount still owed and days late.",
  stripe_customers: "The most recent customers, to pick one for an invoice.",
  [STRIPE_DRAFT_TOOL]: "Creates one draft invoice for one customer. Never finalizes, sends or charges it.",
};

/** Before a key is kept: restricted, accepted, and reaching exactly what its profile needs. */
async function checkKey(kind: "read" | "drafts", key: string): Promise<{ name: string; workspace: string }> {
  if (isSecretKey(key)) throw new Error("that's a secret key, which can do everything in Stripe. Make a restricted key (rk_…) instead");
  if (!looksLikeStripeKey(key)) throw new Error("not a Stripe restricted key (rk_live_… or rk_test_…)");
  const needs = kind === "read" ? READ_NEEDS : [{ what: "Customers", path: "customers?limit=1" }];
  for (const n of needs) {
    const res = await stripeGet(key, n.path);
    if (res.status === 401) throw new Error("Stripe 401: the key wasn't accepted");
    if (!res.ok) throw new Error(`Stripe ${res.status}: the key needs ${n.what} set to Read`);
  }
  const probes: Record<string, number> = {};
  for (const p of WRITE_PROBES) probes[p.what] = (await stripePost(key, p.path, { "metadata[operator_probe]": "1" })).status;
  const no = keyProblem(kind, probes);
  if (no) throw new Error(no);
  const mode = stripeMode(key) === "live" ? "live mode" : "test mode";
  return kind === "read" ? { name: "Stripe read key", workspace: mode } : { name: `Stripe invoice drafts key (${DRAFT_WRITES.join(" and ")} only)`, workspace: mode };
}
export const checkStripeReadKey = (key: string) => checkKey("read", key);
export const checkStripeDraftsKey = (key: string) => checkKey("drafts", key);

/** Every page of a paged list, at most MAX_PAGES; `cut` when more were left. */
async function allPages(key: string, a: StripeArgs, now: number) {
  const rows: Record<string, unknown>[] = [];
  let after: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const r = readRequest(a, now, after);
    const page = listPage(await stripeJson(key, r.path, r.query));
    rows.push(...page.rows);
    if (!page.next) return { rows, cut: false };
    after = page.next;
  }
  return { rows, cut: true };
}

async function read(key: string, a: StripeArgs): Promise<unknown> {
  const now = Date.now();
  switch (a.tool) {
    case "stripe_balance": return readBalance(await stripeJson(key, "balance"));
    case "stripe_money_in": { const p = await allPages(key, a, now); return readMoneyIn(p.rows, p.cut); }
    case "stripe_subscriptions": { const p = await allPages(key, a, now); return readSubscriptions(p.rows, periodStart(a.period, now), p.cut); }
    case "stripe_open_invoices": { const r = readRequest(a, now); return readOpenInvoices(await stripeJson(key, r.path, r.query), now, a.limit); }
    case "stripe_customers": { const r = readRequest(a, now); return { customers: readCustomers(await stripeJson(key, r.path, r.query)) }; }
  }
}

/** The draft: the customer re-read on this key, then the invoice (auto_advance off), then its lines. */
async function draft(key: string, raw: unknown): Promise<unknown> {
  const a = checkDraftInvoiceArgs(raw);
  if ("problem" in a) throw new Error(`Input refused: ${a.problem}`);
  const cres = await stripeGet(key, `customers/${a.customerId}`);
  if (cres.status === 404) throw new Error("Stripe 404: that customer isn't in the business's Stripe any more");
  if (!cres.ok) throw new Error(`Stripe ${cres.status} on read customer: ${await errorText(cres)}`);
  const no = refuseCustomer((await cres.json()) as { deleted?: unknown; currency?: unknown }, a.currency);
  if (no) throw new Error(no);
  const bodies = draftBodies(a);
  const ires = await stripePost(key, "invoices", bodies.invoice, `${a.requestKey}:invoice`);
  if (!ires.ok) throw new Error(`Stripe ${ires.status} on create draft invoice: ${await errorText(ires)}`);
  const inv = (await ires.json()) as { id?: unknown; status?: unknown };
  if (typeof inv.id !== "string" || inv.status !== "draft") throw new Error("Stripe didn't return a draft invoice");
  // From here a draft exists: a failure says which one, so it is fixed in Stripe and never made twice.
  for (const [i, item] of bodies.items.entries()) {
    const r = await stripePost(key, "invoiceitems", { ...item, invoice: inv.id }, `${a.requestKey}:line${i + 1}`);
    if (!r.ok) throw new Error(`${PARTIAL} ${inv.id}: Stripe ${r.status} on adding a line: ${await errorText(r)}`);
  }
  const back = await stripeGet(key, `invoices/${inv.id}`);
  const subtotal = back.ok ? Number(((await back.json()) as { subtotal?: unknown }).subtotal) : NaN;
  return { invoiceId: inv.id, currency: a.currency, approved_cents: invoiceCents(a.lines), subtotal_cents: Number.isFinite(subtotal) ? subtotal : null, lines: a.lines.length, status: "draft" };
}

/** A JSON-RPC handler for one call, serving only `profile`'s tools, with the key the vault opened. */
export function stripeServer(profile: McpId, key: string) {
  const offered = checkedTools(profile).filter((t) => t in DESCRIPTIONS);
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-stripe", version: "1" } });
      case "tools/list":
        return reply(id, { tools: offered.map((name) => ({ name, description: DESCRIPTIONS[name], annotations: { readOnlyHint: name !== STRIPE_DRAFT_TOOL, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!offered.includes(name)) return toolError(id, `${name || "That"} isn't a tool this key serves.`);
        try {
          let result: unknown;
          if (name === STRIPE_DRAFT_TOOL) result = await draft(key, req.params?.arguments);
          else {
            const a = checkStripeArgs(name, req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            result = await read(key, a);
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
