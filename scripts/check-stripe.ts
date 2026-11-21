// The Stripe integration (card 240, docs/mcp-everywhere.md "Stripe"): `npm run check:stripe`. No network:
// Stripe's API is a fake `fetch` that records every request.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MCP_SERVERS, checkedTools, mayCall, mayReport, mayWrite } from "../core/mcp-rules";
import {
  STRIPE_DRAFT_TOOL, STRIPE_READ_TOOLS, WRITE_PROBES, checkDraftInvoiceArgs, checkStripeArgs, draftBodies, invoiceCents, isSecretKey, keyProblem, listPage, looksLikeStripeKey,
  readBalance, readCustomers, readMoneyIn, readOpenInvoices, readRequest, readSubscriptions, refuseCustomer, refuseInvoice, monthly,
} from "../core/stripe-rules";
import { INVOICE_DRAFT, TOOLS, refuseProposal } from "../core/gateway/policy";
import { stripeServer, checkStripeDraftsKey, checkStripeReadKey } from "../integrations/stripe-server";

// ---- profiles: two keys, reads for agents, one draft write for the gateway only
assert.equal(MCP_SERVERS.stripe.auth, "token");
assert.deepEqual([...MCP_SERVERS.stripe.readTools], [...STRIPE_READ_TOOLS]);
assert.deepEqual(MCP_SERVERS.stripe.writeTools ?? [], [], "the read key writes nothing");
for (const t of STRIPE_READ_TOOLS) assert.ok(mayCall("stripe", t) && !mayWrite("stripe", t), t);
assert.deepEqual(MCP_SERVERS.stripe_drafts.readTools, [], "the drafts key reads nothing for agents");
assert.deepEqual(checkedTools("stripe_drafts"), [STRIPE_DRAFT_TOOL]);
assert.ok(mayWrite("stripe_drafts", STRIPE_DRAFT_TOOL) && !mayCall("stripe_drafts", STRIPE_DRAFT_TOOL) && !mayReport("stripe_drafts", STRIPE_DRAFT_TOOL), "only the gateway's callWriteTool reaches it");
for (const bad of ["stripe_api_write", "stripe_api_read", "finalize_invoice", "send_invoice", "pay_invoice", "void_invoice", "create_refund", "delete_invoice"]) assert.ok(!mayWrite("stripe_drafts", bad) && !mayWrite("stripe", bad) && !mayCall("stripe", bad), `never ${bad}`);
assert.equal(TOOLS[INVOICE_DRAFT].tier, "Draft", "a new action type starts at Draft");
assert.equal(TOOLS[INVOICE_DRAFT].agents, "granted", "no agent is named in code: the owner gives it on the Tools step");

// ---- keys: restricted only
const rk = "rk_live_" + "a1B2".repeat(6);
assert.ok(looksLikeStripeKey(rk) && looksLikeStripeKey("rk_test_" + "x".repeat(24)));
assert.ok(!looksLikeStripeKey("sk_live_" + "a".repeat(24)) && !looksLikeStripeKey("rk_live_short") && !looksLikeStripeKey("pk_live_" + "a".repeat(24)));
assert.ok(isSecretKey("sk_live_abc") && !isSecretKey(rk));
const probes = (can: string[], code = 403) => Object.fromEntries(WRITE_PROBES.map((p) => [p.what, can.includes(p.what) ? 404 : code]));
assert.equal(keyProblem("read", probes([])), null, "a read key that can write nothing is kept");
assert.match(keyProblem("read", probes(["refunds"]))!, /refunds/, "a read key that can refund is refused");
assert.equal(keyProblem("drafts", probes(["invoices", "invoice items"])), null);
assert.match(keyProblem("drafts", probes(["invoices"]))!, /invoice items/, "the drafts key needs invoice items");
assert.match(keyProblem("drafts", probes(["invoices", "invoice items", "charges"]))!, /charges/, "the drafts key may change nothing else");
assert.match(keyProblem("read", probes([], 500))!, /couldn't be read/, "an unreadable answer refuses the key");

// ---- read inputs: named fields only, fixed requests
assert.deepEqual(checkStripeArgs("stripe_money_in", {}), { tool: "stripe_money_in", period: "last_30_days" });
assert.ok("problem" in checkStripeArgs("stripe_money_in", { period: "last_5_years" }));
assert.ok("problem" in checkStripeArgs("stripe_balance", { path: "charges" }), "no extra inputs");
assert.ok("problem" in checkStripeArgs("stripe_customers", { limit: 500 }));
assert.ok("problem" in checkStripeArgs("stripe_api_read", {}));
const now = Date.UTC(2026, 10, 21);
for (const t of STRIPE_READ_TOOLS) {
  const a = checkStripeArgs(t, {});
  assert.ok(!("problem" in a));
  assert.match(readRequest(a, now).path, /^(balance|balance_transactions|subscriptions|invoices|customers)$/, "only fixed paths");
}
assert.equal(readRequest({ tool: "stripe_money_in", period: "last_7_days" }, now, "txn_9").query.starting_after, "txn_9");

// ---- readers: sums made here, one currency only
assert.deepEqual(listPage({ data: [{ id: "a" }, { id: "b" }], has_more: true }).next, "b");
assert.equal(listPage({ data: [{ id: "a" }], has_more: false }).next, null);
assert.deepEqual(readBalance({ available: [{ currency: "usd", amount: 12345 }, { currency: "jpy", amount: 500 }], pending: [{ currency: "usd", amount: 55 }] }).currencies,
  [{ currency: "usd", available: 123.45, pending: 0.55 }, { currency: "jpy", available: 500, pending: 0 }]);
const day1 = Date.UTC(2026, 10, 20) / 1000, day2 = Date.UTC(2026, 10, 21) / 1000;
const m = readMoneyIn([
  { type: "charge", currency: "usd", amount: 10000, fee: 320, created: day1 },
  { type: "payment", currency: "usd", amount: 5000, fee: 175, created: day2 },
  { type: "refund", currency: "usd", amount: -2000, fee: 0, created: day2 },
  { type: "payout", currency: "usd", amount: -8000, fee: 0, created: day2 },
  { type: "charge", currency: "eur", amount: 999, fee: 30, created: day2 },
], false);
assert.equal(m.currency, "usd");
assert.deepEqual(m.totals, { gross: 150, refunds: 20, fees: 4.95, net: 125.05, payments: 2, refund_count: 1 });
assert.equal(m.other_currency_rows, 1, "the euro charge is counted apart, never added in");
assert.deepEqual(m.days.map((d) => d.date), ["2026-11-20", "2026-11-21"]);
assert.equal(monthly(12000, 1, "year", 1), 1000);
assert.equal(monthly(1000, 2, "month", 1), 2000);
const since = day1 - 86_400;
const s = readSubscriptions([
  { status: "active", currency: "usd", created: day1, items: { data: [{ quantity: 1, price: { unit_amount: 2000, recurring: { interval: "month", interval_count: 1 } } }] } },
  { status: "past_due", currency: "usd", created: 1, items: { data: [{ quantity: 1, price: { unit_amount: 12000, recurring: { interval: "year", interval_count: 1 } } }] } },
  { status: "trialing", currency: "usd", created: day2, items: { data: [] } },
  { status: "canceled", currency: "usd", created: 1, canceled_at: day2, items: { data: [{ quantity: 1, price: { unit_amount: 5000, recurring: { interval: "month" } } }] } },
], since, false);
assert.deepEqual({ mrr: s.mrr, active: s.active, past_due: s.past_due, trialing: s.trialing, started: s.started_in_period, cancelled: s.cancelled_in_period }, { mrr: 30, active: 1, past_due: 1, trialing: 1, started: 2, cancelled: 1 });
const inv = readOpenInvoices({ data: [
  { id: "in_1", number: "A-1", customer_name: "Fleet Cafe", currency: "usd", amount_remaining: 25000, due_date: day1 - 10 * 86_400 },
  { id: "in_2", number: "A-2", customer_email: "b@x.co", currency: "usd", amount_remaining: 5000, due_date: day2 + 86_400 * 5 },
] }, now, 10);
assert.deepEqual(inv.invoices.map((i) => [i.pick, i.number, i.days_late]), [["i1", "A-1", 11], ["i2", "A-2", 0]]);
assert.deepEqual(inv.overdue_amount, { usd: 250 });
assert.ok(!JSON.stringify(inv.invoices).includes("in_1"), "ids stay out of what the model sees; it picks by i1, i2");
assert.deepEqual(readCustomers({ data: [{ id: "cus_ABC1234", name: "Fleet Cafe", currency: "USD" }, { id: "cus_DEL0000", deleted: true }, { id: "bad" }] }), [{ id: "cus_ABC1234", label: "Fleet Cafe", currency: "usd" }]);

// ---- the draft invoice: plain lines, whole cents, the ceiling, the customer picked from Stripe
const okInv = { currency: "usd", lines: [{ description: "Wholesale order, 20 lb", amount: 360 }, { description: "Shipping", amount: 24.5 }], days_until_due: 30 };
assert.equal(refuseInvoice(okInv), null);
assert.equal(invoiceCents(okInv.lines), 38450);
for (const [bad, why] of [
  [{ ...okInv, currency: "btc" }, /currency/],
  [{ ...okInv, lines: [] }, /at least one/],
  [{ ...okInv, lines: Array(6).fill(okInv.lines[0]) }, /At most/],
  [{ ...okInv, lines: [{ description: "x", amount: 10.005 }] }, /whole cents/],
  [{ ...okInv, lines: [{ description: "x", amount: -5 }] }, /more than 0/],
  [{ ...okInv, lines: [{ description: "see https://evil.example", amount: 5 }] }, /links/],
  [{ ...okInv, lines: [{ description: "x", amount: 5, price: "price_1" }] }, /only a description/],
  [{ ...okInv, lines: [{ description: "x", amount: 5000.01 }] }, /ceiling/],
  [{ ...okInv, days_until_due: 120 }, /Days until due/],
  [{ ...okInv, memo: "pay at www.evil.example" }, /links/],
  [{ ...okInv, customer: "cus_X", auto_advance: "true" }, /allow-list/],
] as [Record<string, unknown>, RegExp][]) assert.match(refuseInvoice(bad) ?? "", why, JSON.stringify(bad));
const actionId = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
assert.ok("problem" in checkDraftInvoiceArgs({ ...okInv, customerId: "cus_../x", requestKey: actionId }));
assert.ok("problem" in checkDraftInvoiceArgs({ ...okInv, customerId: "cus_ABC1234", requestKey: "again" }), "no draft without the action id as idempotency key");
const ok = checkDraftInvoiceArgs({ ...okInv, customerId: "cus_ABC1234", requestKey: actionId });
assert.ok(!("problem" in ok));
const bodies = draftBodies(ok as Exclude<typeof ok, { problem: string }>);
assert.equal(bodies.invoice.auto_advance, "false", "Stripe never finalizes it on its own");
assert.equal(bodies.invoice.collection_method, "send_invoice", "never charges a card on file");
assert.equal(bodies.invoice.pending_invoice_items_behavior, "exclude", "only the approved lines");
assert.deepEqual(bodies.items.map((i) => i.amount), ["36000", "2450"]);
assert.equal(refuseCustomer({ currency: "eur" }, "usd")?.includes("EUR"), true);
assert.ok(refuseCustomer({ deleted: true }, "usd") && refuseCustomer(null, "usd") && refuseCustomer({ currency: null }, "usd") === null);
// the gateway guard: target is a customer id, and only an agent the owner gave the tool to
assert.equal(refuseProposal("b_finance_2", INVOICE_DRAFT, "cus_ABC1234", okInv, 200, ["stripe_customers", "stripe_invoice_draft"]), null);
assert.ok(refuseProposal("b_finance_2", INVOICE_DRAFT, "cus_ABC1234", okInv, 200, ["stripe_customers"]), "not given the tool");
assert.ok(refuseProposal("b_finance_2", INVOICE_DRAFT, "cus_ABC1234", okInv, 200, null), "spec unreadable");
assert.ok(refuseProposal("b_finance_2", INVOICE_DRAFT, "https://evil.example", okInv, 200, ["stripe_invoice_draft"]), "not a customer id");

// ---- only our server calls Stripe, only the MCP client reaches our server, and no finalize/send/pay path exists
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? (f === "node_modules" ? [] : files(p)) : /\.tsx?$/.test(f) ? [p] : []; });
const all = ["core", "agents", "templates", "dashboard", "app", "integrations"].flatMap(files);
const importers = (mod: string) => all.filter((f) => new RegExp(`from "[^"]*/${mod}"`).test(readFileSync(f, "utf8")));
assert.deepEqual(importers("stripe-api"), ["integrations/stripe-server.ts"]);
assert.deepEqual(importers("stripe-server"), ["integrations/mcp.ts"]);
const callers = all.filter((f) => f !== "core/stripe-rules.ts" && f !== "core/mcp-rules.ts" && readFileSync(f, "utf8").includes("api.stripe.com"));
assert.deepEqual(callers, [], "Stripe's address lives only in the rules and the profile");
const server = readFileSync("integrations/stripe-server.ts", "utf8") + readFileSync("integrations/stripe-api.ts", "utf8");
assert.doesNotMatch(server.replace(/^\s*\/\/.*$/gm, ""), /\/finalize|\/send\b|\/pay\b|\/void|mark_uncollectible|"refunds"|method: "DELETE"/, "no finalize, send, pay, void, refund or delete call");
assert.equal((server.match(/stripePost\(/g) ?? []).length, 4, "POSTs: the definition, the key probes, the invoice and its lines");

// ---- the server, end to end, on a fake Stripe
type Call = { method: string; url: string; body: string; idem: string | null };
function fakeStripe(reply: (c: Call) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    assert.equal(init?.redirect, "error", "a request carrying the key never follows a redirect");
    assert.equal(h.get("Stripe-Version"), "2024-06-20");
    const c = { method: init?.method ?? "GET", url: String(input), body: String(init?.body ?? ""), idem: h.get("Idempotency-Key") };
    calls.push(c);
    const r = reply(c);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}
const rpc = (name: string, args: unknown) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
type Reply = { result?: { isError?: boolean; structuredContent?: { result: Record<string, unknown> }; content?: { text: string }[] } };

(async () => {
  // reads: the read key serves only reads, and a draft is refused on it
  let calls = fakeStripe(() => ({ status: 200, json: { available: [{ currency: "usd", amount: 100 }], pending: [] } }));
  const reader = stripeServer("stripe", rk);
  const list = (await reader({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), [...STRIPE_READ_TOOLS]);
  assert.ok(list.result.tools.every((t) => t.annotations.readOnlyHint));
  const bal = (await reader(rpc("stripe_balance", {}))) as Reply;
  assert.deepEqual(bal.result?.structuredContent?.result, { currencies: [{ currency: "usd", available: 1, pending: 0 }] });
  assert.ok(calls.every((c) => c.method === "GET"));
  assert.ok(((await reader(rpc(STRIPE_DRAFT_TOOL, {}))) as Reply).result?.isError, "the read key can't make a draft");

  // the draft: customer re-read, invoice, lines, read back; idempotency keys from the action id
  calls = fakeStripe((c) => {
    if (c.method === "GET" && c.url.endsWith("/customers/cus_ABC1234")) return { status: 200, json: { id: "cus_ABC1234", currency: "usd" } };
    if (c.method === "POST" && c.url.endsWith("/invoices")) return { status: 200, json: { id: "in_NEW1", status: "draft" } };
    if (c.method === "POST" && c.url.endsWith("/invoiceitems")) return { status: 200, json: { id: "ii_1" } };
    if (c.method === "GET" && c.url.endsWith("/invoices/in_NEW1")) return { status: 200, json: { id: "in_NEW1", subtotal: 38450 } };
    return { status: 500, json: {} };
  });
  const drafter = stripeServer("stripe_drafts", rk);
  const dl = (await drafter({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string }[] } };
  assert.deepEqual(dl.result.tools.map((t) => t.name), [STRIPE_DRAFT_TOOL], "the drafts key serves only the draft");
  const made = (await drafter(rpc(STRIPE_DRAFT_TOOL, { ...okInv, customerId: "cus_ABC1234", requestKey: actionId }))) as Reply;
  assert.deepEqual(made.result?.structuredContent?.result, { invoiceId: "in_NEW1", currency: "usd", approved_cents: 38450, subtotal_cents: 38450, lines: 2, status: "draft" });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace("https://api.stripe.com/v1/", "")}`), ["GET customers/cus_ABC1234", "POST invoices", "POST invoiceitems", "POST invoiceitems", "GET invoices/in_NEW1"]);
  assert.deepEqual(calls.filter((c) => c.method === "POST").map((c) => c.idem), [`${actionId}:invoice`, `${actionId}:line1`, `${actionId}:line2`]);
  assert.match(calls[1].body, /auto_advance=false/);
  assert.ok(calls.slice(2, 4).every((c) => c.body.includes("invoice=in_NEW1")), "lines go on this draft only");
  assert.ok(((await drafter(rpc("stripe_balance", {}))) as Reply).result?.isError, "the drafts key reads nothing for agents");

  // a line failing after the draft exists says which draft, so the gateway records it as partly done
  fakeStripe((c) => {
    if (c.url.endsWith("/customers/cus_ABC1234")) return { status: 200, json: { id: "cus_ABC1234" } };
    if (c.url.endsWith("/invoices")) return { status: 200, json: { id: "in_NEW2", status: "draft" } };
    return { status: 400, json: { error: { message: "bad line" } } };
  });
  const half = (await drafter(rpc(STRIPE_DRAFT_TOOL, { ...okInv, customerId: "cus_ABC1234", requestKey: actionId }))) as Reply;
  assert.ok(half.result?.isError && /^Partly made draft in_NEW2/.test(half.result.content?.[0].text ?? ""));

  // a customer in another currency is refused before anything is made
  calls = fakeStripe(() => ({ status: 200, json: { id: "cus_ABC1234", currency: "eur" } }));
  const wrong = (await drafter(rpc(STRIPE_DRAFT_TOOL, { ...okInv, customerId: "cus_ABC1234", requestKey: actionId }))) as Reply;
  assert.ok(wrong.result?.isError && calls.every((c) => c.method === "GET"));

  // key checks: a secret key is refused before any request; a read key that can refund is refused
  calls = fakeStripe(() => ({ status: 200, json: {} }));
  await assert.rejects(checkStripeReadKey("sk_live_" + "a".repeat(24)), /secret key/);
  assert.equal(calls.length, 0);
  fakeStripe((c) => (c.method === "GET" ? { status: 200, json: {} } : { status: c.url.includes("/refunds/") ? 404 : 403, json: {} }));
  await assert.rejects(checkStripeReadKey(rk), /refunds/);
  fakeStripe((c) => (c.method === "GET" ? { status: 200, json: {} } : { status: /\/invoices\/|\/invoiceitems\//.test(c.url) ? 404 : 403, json: {} }));
  assert.match((await checkStripeDraftsKey(rk)).name, /invoices and invoice items only/);
  await assert.rejects(checkStripeReadKey(rk), /invoices/, "a key that can write invoices is no read key");
  console.log("stripe: ok");
})().catch((e) => { console.error(e); process.exit(1); });
