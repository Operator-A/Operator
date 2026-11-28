// The Square integration (card 242, docs/mcp-everywhere.md "Square"): `npm run check:square`.
// No network: Square's API is a fake `fetch` that records every request.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MCP_SERVERS, checkedTools, isAppSignIn, isGoogle, isHosted, mayCall, mayReport, mayWrite, usesConnect } from "../core/mcp-rules";
import {
  SQUARE_DRAFT_TOOL, SQUARE_HOST, SQUARE_INVOICE, SQUARE_INVOICE_GRANT, SQUARE_READ_TOOLS, SQUARE_SANDBOX_HOST, SQUARE_SCOPES, SQUARE_VERSION, checkSquareArgs, checkSquareDraftArgs, dueDate,
  bookingWindow, readBookings, readCustomers, readInvoice, readLocations, readOpenInvoices, readOrder, readPayments, readTokenScopes, refuseLocation, refuseSquareInvoice, splitTarget, squareAuth, squareAuthorizeUrl,
  squareDraftBodies, squareExpiresIn, squareScopeProblem, squareTarget,
} from "../core/square-rules";
import { TOOLS, refuseProposal } from "../core/gateway/policy";
import { SCOPE_WORDS, TILE_BY_ID, permissionsOf } from "../core/tools-step-rules";
import { squareServer, squareWho } from "../integrations/square-server";

// ---- the profile: one Square sign-in, reads for agents, one write for the gateway only
const p = MCP_SERVERS.square;
assert.equal(p.auth, "square");
assert.ok(isAppSignIn("square") && usesConnect("square") && !isHosted("square") && !isGoogle("square"));
assert.deepEqual([...p.scopes], ["MERCHANT_PROFILE_READ", "PAYMENTS_READ", "CUSTOMERS_READ", "INVOICES_READ", "INVOICES_WRITE", "ORDERS_WRITE", "APPOINTMENTS_READ", "APPOINTMENTS_ALL_READ"], "exactly these scopes: no payments write, appointments write, refunds, customers write, items or team");
assert.deepEqual([...p.readTools], [...SQUARE_READ_TOOLS]);
assert.deepEqual(p.writeTools, [{ tool: SQUARE_DRAFT_TOOL, actionType: SQUARE_INVOICE }]);
assert.deepEqual(p.reportTools, []);
for (const t of SQUARE_READ_TOOLS) assert.ok(mayCall("square", t) && !mayWrite("square", t), t);
assert.ok(mayWrite("square", SQUARE_DRAFT_TOOL) && !mayCall("square", SQUARE_DRAFT_TOOL) && !mayReport("square", SQUARE_DRAFT_TOOL), "only the gateway's callWriteTool reaches the write");
for (const bad of ["publish_invoice", "cancel_invoice", "delete_invoice", "create_payment", "refund_payment", "update_order", "create_customer"]) assert.ok(!mayWrite("square", bad) && !mayCall("square", bad), `never ${bad}`);
assert.deepEqual(checkedTools("square"), [...SQUARE_READ_TOOLS, SQUARE_DRAFT_TOOL]);
assert.equal(TOOLS[SQUARE_INVOICE].tier, "Draft", "a new action type starts at Draft");
assert.equal(TOOLS[SQUARE_INVOICE].agents, "granted", "no agent is named in code: an approver gives it on the Tools step");
assert.equal(TOOLS[SQUARE_INVOICE].grant, SQUARE_INVOICE_GRANT);
assert.ok(permissionsOf(TILE_BY_ID.square).every((x) => x.words === SCOPE_WORDS[x.scope]) && SQUARE_SCOPES.every((s) => SCOPE_WORDS[s]), "every scope has plain words");

// ---- sign-in: Square's fixed addresses, the profile's scopes, no PKCE, held to the scopes exactly
for (const h of [SQUARE_HOST, SQUARE_SANDBOX_HOST]) for (const u of Object.values(squareAuth(h))) assert.match(u, /^https:\/\/connect\.squareup(sandbox)?\.com\/oauth2\/(authorize|token|revoke)$/);
const au = new URL(squareAuthorizeUrl(SQUARE_HOST, { clientId: "sq0idp-abc", redirectUri: "https://x.example/connections/square/callback", state: "s" }));
assert.equal(au.searchParams.get("scope"), SQUARE_SCOPES.join(" "));
assert.equal(au.searchParams.get("session"), "false");
assert.equal(au.searchParams.get("code_challenge"), null, "a sign-in with a secret: long-lived refresh tokens, no PKCE");
assert.equal(au.searchParams.get("redirect_uri"), "https://x.example/connections/square/callback");
assert.equal(squareScopeProblem([...SQUARE_SCOPES]), null);
assert.match(squareScopeProblem([...SQUARE_SCOPES, "PAYMENTS_WRITE"]) ?? "", /more than it needs/, "a sign-in that carries more is refused");
assert.match(squareScopeProblem(SQUARE_SCOPES.slice(1)) ?? "", /wasn't granted MERCHANT_PROFILE_READ/);
assert.ok(squareScopeProblem(null));
assert.deepEqual(readTokenScopes({ scopes: ["PAYMENTS_READ"] }), ["PAYMENTS_READ"]);
const now = Date.parse("2026-11-22T12:00:00Z");
assert.equal(squareExpiresIn({ expires_at: "2026-12-22T12:00:00Z" }, now), 30 * 86_400);
assert.equal(squareExpiresIn({ expires_at: "2026-11-01T00:00:00Z" }, now), null);
assert.equal(squareExpiresIn({}, now), null);

// ---- importers: one API file, one server, reached only through the MCP client
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const q = join(d, f); return statSync(q).isDirectory() ? (f === "node_modules" ? [] : files(q)) : /\.tsx?$/.test(f) ? [q] : []; });
const all = ["core", "agents", "packs", "dashboard", "app", "integrations"].flatMap(files);
const importers = (mod: string) => all.filter((f) => new RegExp(`from "[^"]*/${mod}"`).test(readFileSync(f, "utf8")));
assert.deepEqual(importers("square-api"), ["integrations/square-server.ts"]);
assert.deepEqual(importers("square-server"), ["integrations/mcp.ts"]);
// the setup check (card 281) names Square's help site as a domain its web reads may use, never an API address
const callers = all.filter((f) => f !== "core/square-rules.ts" && /squareup(sandbox)?\.com/.test(readFileSync(f, "utf8").replace(/square: "squareup\.com"/, "")));
assert.deepEqual(callers, [], "Square's address lives only in the rules");
const server = (readFileSync("integrations/square-server.ts", "utf8") + readFileSync("integrations/square-api.ts", "utf8")).replace(/^\s*(\/\/|\*).*$/gm, "");
assert.doesNotMatch(server, /\/publish|\/cancel|"refunds|refunds\/|"DELETE"|"PUT"|squareRequest\.(?!merchant|locations|location|payments|invoices|customers|customer|invoice|bookings|createOrder|createInvoice)\w+/, "no publish, cancel, delete, refund or update call");
const rules = readFileSync("core/square-rules.ts", "utf8").replace(/^\s*(\/\/|\*).*$/gm, "");
assert.doesNotMatch(rules, /\/publish|\/cancel|path: "refunds|refunds\/|"DELETE"|"PUT"|payments"\s*,\s*body|"POST", path: "payments"/, "no write path but the order and the draft");
assert.equal((rules.match(/method: "POST"/g) ?? []).length, 3, "POSTs: invoice search, the order, the draft invoice");

// ---- inputs
assert.deepEqual(checkSquareArgs("square_payments", {}), { tool: "square_payments", days: 30 });
assert.ok("problem" in checkSquareArgs("square_payments", { days: 91 }) && "problem" in checkSquareArgs("square_payments", { days: 1.5 }));
assert.deepEqual(checkSquareArgs("square_open_invoices", { limit: 5 }), { tool: "square_open_invoices", limit: 5 });
assert.ok("problem" in checkSquareArgs("square_customers", { limit: 26 }));
assert.ok("problem" in checkSquareArgs("square_locations", { query: "x" }), "no inputs from outside beyond the named ones");
assert.ok("problem" in checkSquareArgs(SQUARE_DRAFT_TOOL, {}), "the write isn't a read");
assert.deepEqual(checkSquareArgs("square_appointments", {}), { tool: "square_appointments", days: 7, when: "next" });
assert.deepEqual(checkSquareArgs("square_appointments", { days: 31, when: "past" }), { tool: "square_appointments", days: 31, when: "past" });
assert.ok("problem" in checkSquareArgs("square_appointments", { days: 32 }), "Square reads at most 31 days of bookings");
assert.ok("problem" in checkSquareArgs("square_appointments", { when: "all" }));

// ---- readers: totals in code
const names = new Map([["LOC1", "Main St"], ["LOC2", "Market"]]);
const pay = (id: string, status: string, total: number, refunded: number, fee: number, loc: string, day: string, cur = "USD") => ({
  id, status, created_at: `${day}T15:00:00Z`, location_id: loc, total_money: { amount: total, currency: cur },
  ...(refunded ? { refunded_money: { amount: refunded, currency: cur } } : {}), processing_fee: [{ amount_money: { amount: fee, currency: cur } }],
});
const pays = [pay("a", "COMPLETED", 1000, 0, 59, "LOC1", "2026-11-20"), pay("b", "COMPLETED", 2500, 500, 103, "LOC2", "2026-11-21"), pay("c", "FAILED", 9999, 0, 0, "LOC1", "2026-11-21"), pay("d", "COMPLETED", 700, 0, 0, "LOC1", "2026-11-21", "CAD")];
const r = readPayments(pays, names, false);
assert.equal(r.currency, "usd");
assert.deepEqual(r.totals, { gross: 35, refunds: 5, fees: 1.62, net: 28.38, payments: 2, average_sale: 17.5 });
assert.equal(r.other_currency, 1, "another currency is counted, not added in");
assert.deepEqual(r.days.map((d) => d.date), ["2026-11-20", "2026-11-21"]);
assert.deepEqual(r.locations.map((l) => l.location), ["Market", "Main St"]);

const locs = { locations: [{ id: "LOC2", name: "Market", status: "INACTIVE", currency: "USD" }, { id: "LOC1", name: "Main St", status: "ACTIVE", currency: "USD" }] };
assert.deepEqual(readLocations(locs).map((l) => [l.id, l.active]), [["LOC1", true], ["LOC2", false]], "active ones first");
assert.equal(refuseLocation({ location: locs.locations[1] }, "usd"), null);
assert.match(refuseLocation({ location: locs.locations[0] }, "usd") ?? "", /isn't active/);
assert.match(refuseLocation({ location: locs.locations[1] }, "cad") ?? "", /takes USD, not CAD/);
assert.match(refuseLocation({}, "usd") ?? "", /isn't in the business's Square/);

const inv = (n: string, status: string, due: string, amount: number, paid: number, loc = "LOC1") => ({ invoice_number: n, status, location_id: loc, primary_recipient: { given_name: "Ada", family_name: "Lovelace" }, payment_requests: [{ due_date: due, computed_amount_money: { amount, currency: "USD" }, total_completed_amount_money: { amount: paid, currency: "USD" } }] });
const oi = readOpenInvoices([inv("1", "UNPAID", "2026-11-12", 5000, 0), inv("2", "PARTIALLY_PAID", "2026-11-20", 3000, 1000), inv("3", "PAID", "2026-11-01", 100, 100), inv("4", "DRAFT", "2026-11-01", 100, 0), inv("5", "UNPAID", "2026-12-01", 2000, 0)], names, "2026-11-22", 10);
assert.equal(oi.open, 3, "paid and draft invoices are not open");
assert.deepEqual(oi.invoices.map((i) => [i.number, i.amount_due, i.days_late]), [["1", 50, 10], ["2", 20, 2], ["5", 20, 0]], "most overdue first, what is still owed");
assert.equal(oi.overdue, 2);
assert.deepEqual(oi.overdue_amount, { usd: 70 });
// ---- appointments: counted in code, no-show rate over bookings whose time has passed
assert.deepEqual(bookingWindow(7, "next", now), { from: "2026-11-22T12:00:00.000Z", to: "2026-11-29T12:00:00.000Z" });
assert.deepEqual(bookingWindow(7, "past", now), { from: "2026-11-15T12:00:00.000Z", to: "2026-11-22T12:00:00.000Z" });
const bk = (status: string, start: string, mins: number[], loc = "LOC1") => ({ status, start_at: start, location_id: loc, appointment_segments: mins.map((m) => ({ duration_minutes: m })) });
const ap = readBookings([
  bk("ACCEPTED", "2026-11-20T15:00:00Z", [30, 15]), bk("NO_SHOW", "2026-11-20T17:00:00Z", [60]), bk("CANCELLED_BY_CUSTOMER", "2026-11-21T10:00:00Z", [30]),
  bk("DECLINED", "2026-11-21T11:00:00Z", [30]), bk("PENDING", "2026-11-23T09:00:00Z", [45], "LOC2"), bk("ACCEPTED", "2026-11-23T10:00:00Z", [30]), bk("ACCEPTED", "not a date", [30]),
], names, bookingWindow(7, "past", now), now, false);
assert.deepEqual(ap.totals, { booked: 4, cancelled: 2, no_shows: 1, pending: 1, minutes_booked: 180, no_show_rate: 0.5 }, "a no-show was booked; cancelled and declined aren't; rate over the 2 past bookings");
assert.deepEqual(ap.days, [{ date: "2026-11-20", booked: 2, cancelled: 0, no_shows: 1 }, { date: "2026-11-21", booked: 0, cancelled: 2, no_shows: 0 }, { date: "2026-11-23", booked: 2, cancelled: 0, no_shows: 0 }]);
assert.deepEqual(ap.locations, [{ location: "Main St", booked: 3, no_shows: 1 }, { location: "Market", booked: 1, no_shows: 0 }]);
assert.equal(readBookings([], names, bookingWindow(1, "next", now), now, false).totals.no_show_rate, 0);
assert.deepEqual(readCustomers({ customers: [{ id: "CUST1", company_name: "Acme" }, { id: "CUST2", given_name: "Ada" }, { id: "x" }] }), [{ id: "CUST1", label: "Acme" }, { id: "CUST2", label: "Ada" }]);

// ---- the draft's guards (Stripe's: up to 5 plain lines, whole cents, the ceiling, due in 1 to 90 days)
const ok = { currency: "usd", lines: [{ description: "Wholesale beans", amount: 120.5 }, { description: "Delivery", amount: 15 }], days_until_due: 14 };
assert.equal(refuseSquareInvoice(ok), null);
assert.match(refuseSquareInvoice({ ...ok, customer: "x" }) ?? "", /picked from Square/);
assert.ok(refuseSquareInvoice({ ...ok, lines: [{ description: "x", amount: 5000.01 }] }), "over the ceiling");
assert.ok(refuseSquareInvoice({ ...ok, lines: [{ description: "see https://evil.example", amount: 1 }] }), "no links");
assert.ok(refuseSquareInvoice({ ...ok, days_until_due: 0 }));
assert.ok(squareTarget("CUST1@L1xx") && !squareTarget("CUST1") && !squareTarget("a@b") && !squareTarget("CUST1@L1xx@x"));
assert.deepEqual(splitTarget("CUST1@L1xx"), { customerId: "CUST1", locationId: "L1xx" });
const grants = ["square_customers", SQUARE_INVOICE_GRANT];
assert.equal(refuseProposal("b_sales_1", SQUARE_INVOICE, "CUST1@L1xx", ok, 200, grants), null);
assert.ok(refuseProposal("b_sales_1", SQUARE_INVOICE, "CUST1@L1xx", ok, 200, ["square_customers"]), "not given the tool");
assert.ok(refuseProposal("b_sales_1", SQUARE_INVOICE, "CUST1", ok, 200, grants), "the target is a customer at a location");
const key = "6f1c2a9e-1b2c-4d3e-8f90-123456789abc";
const da = checkSquareDraftArgs({ customerId: "CUST1", locationId: "L1xx", requestKey: key, ...ok });
assert.ok(!("problem" in da));
assert.ok("problem" in checkSquareDraftArgs({ customerId: "CUST1", locationId: "L1xx", requestKey: key, ...ok, publish: true }), "nothing beyond the fields");
assert.ok("problem" in checkSquareDraftArgs({ customerId: "../x", locationId: "L1xx", requestKey: key, ...ok }));
assert.equal(dueDate(14, now), "2026-12-06");
if (!("problem" in da)) {
  const b = squareDraftBodies(da, now);
  assert.equal(b.order.idempotency_key, `${key}:order`);
  assert.deepEqual(b.order.order.line_items.map((l) => [l.name, l.quantity, l.base_price_money.amount, l.base_price_money.currency]), [["Wholesale beans", "1", 12050, "USD"], ["Delivery", "1", 1500, "USD"]], "ad hoc lines, whole cents");
  const ib = b.invoice("ORD1").invoice;
  assert.equal(b.invoice("ORD1").idempotency_key, `${key}:invoice`);
  assert.deepEqual([ib.order_id, ib.location_id, ib.primary_recipient.customer_id], ["ORD1", "L1xx", "CUST1"]);
  assert.deepEqual(ib.payment_requests, [{ request_type: "BALANCE", due_date: "2026-12-06" }]);
  assert.equal(JSON.stringify(b).includes("scheduled_at"), false, "never scheduled to publish");
}
assert.deepEqual(readOrder({ order: { id: "ORD1", total_money: { amount: 13550, currency: "USD" } } }), { id: "ORD1", total: 13550 });
assert.deepEqual(readInvoice({ invoice: { id: "INV1", status: "DRAFT", payment_requests: [{ computed_amount_money: { amount: 13550, currency: "USD" } }] } }), { id: "INV1", status: "DRAFT", total: 13550 });

// ---- the server, end to end, on a fake Square
type Call = { method: string; path: string; body: string };
function fakeSquare(reply: (c: Call) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    assert.equal(init?.redirect, "error", "a request carrying the token never follows a redirect");
    const h = new Headers(init?.headers);
    assert.equal(h.get("Authorization"), "Bearer tok");
    assert.equal(h.get("Square-Version"), SQUARE_VERSION);
    const u = new URL(String(input));
    assert.equal(u.origin, SQUARE_HOST);
    const c = { method: init?.method ?? "GET", path: u.pathname.replace(/^\/v2\//, "").replace(/^\/oauth2\//, "oauth2/"), body: String(init?.body ?? "") };
    calls.push(c);
    const r = reply(c);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}
const rpc = (name: string, args: unknown) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
type Reply = { result?: { isError?: boolean; structuredContent?: { result: Record<string, unknown> }; content?: { text: string }[] } };

(async () => {
  // reads: the read side serves reads only; nothing is created
  let calls = fakeSquare((c) => (c.path === "locations" ? { status: 200, json: locs } : c.path === "payments" ? { status: 200, json: { payments: pays } } : c.path === "invoices/search" ? { status: 200, json: { invoices: [inv("1", "UNPAID", "2026-11-12", 5000, 0)] } } : c.path === "bookings" ? { status: 200, json: { bookings: [bk("ACCEPTED", "2026-11-23T10:00:00Z", [30])] } } : { status: 404, json: {} }));
  const reader = squareServer({ host: SQUARE_HOST, token: "tok", write: false });
  const list = (await reader({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), [...SQUARE_READ_TOOLS]);
  assert.ok(list.result.tools.every((t) => t.annotations.readOnlyHint));
  const pr = (await reader(rpc("square_payments", { days: 7 }))) as Reply;
  assert.equal((pr.result?.structuredContent?.result.totals as { net: number }).net, 28.38);
  const open = (await reader(rpc("square_open_invoices", { limit: 5 }))) as Reply;
  assert.equal(open.result?.structuredContent?.result.locations_searched, 1, "active locations only");
  const appts = (await reader(rpc("square_appointments", { days: 3 }))) as Reply;
  assert.equal((appts.result?.structuredContent?.result.totals as { booked: number }).booked, 1);
  assert.ok(((await reader(rpc("square_appointments", { days: 60 }))) as Reply).result?.isError, "a window over 31 days is refused before Square is called");
  assert.ok(calls.every((c) => c.method === "GET" || c.path === "invoices/search"), "reads only: GETs and the invoice search");
  assert.ok(((await reader(rpc(SQUARE_DRAFT_TOOL, { customerId: "CUST1", locationId: "L1xx", requestKey: key, ...ok }))) as Reply).result?.isError, "an agent's read path can't write");

  // the write: customer and location re-read, the order, the draft invoice on it, read back
  const draftInvoice = { id: "INV1", status: "DRAFT", payment_requests: [{ computed_amount_money: { amount: 13550, currency: "USD" } }] };
  const writeReply = (orderTotal: number) => (c: Call) => {
    if (c.method === "GET" && c.path === "customers/CUST1") return { status: 200, json: { customer: { id: "CUST1" } } };
    if (c.method === "GET" && c.path === "locations/L1xx") return { status: 200, json: { location: { id: "L1xx", status: "ACTIVE", currency: "USD" } } };
    if (c.method === "POST" && c.path === "orders") return { status: 200, json: { order: { id: "ORD1", total_money: { amount: orderTotal, currency: "USD" } } } };
    if (c.method === "POST" && c.path === "invoices") return { status: 200, json: { invoice: draftInvoice } };
    if (c.method === "GET" && c.path === "invoices/INV1") return { status: 200, json: { invoice: draftInvoice } };
    return { status: 500, json: {} };
  };
  calls = fakeSquare(writeReply(13550));
  const writer = squareServer({ host: SQUARE_HOST, token: "tok", write: true });
  const wl = (await writer({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string }[] } };
  assert.deepEqual(wl.result.tools.map((t) => t.name), [SQUARE_DRAFT_TOOL], "the gateway's path serves only the write");
  const done = (await writer(rpc(SQUARE_DRAFT_TOOL, { customerId: "CUST1", locationId: "L1xx", requestKey: key, ...ok }))) as Reply;
  assert.deepEqual(done.result?.structuredContent?.result, { invoiceId: "INV1", orderId: "ORD1", currency: "usd", approved_cents: 13550, total_cents: 13550, status: "DRAFT", lines: 2 });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.path}`), ["GET customers/CUST1", "GET locations/L1xx", "POST orders", "POST invoices", "GET invoices/INV1"]);
  assert.ok(!calls.some((c) => /publish|cancel/.test(c.path)), "never published or cancelled");
  assert.ok(((await writer(rpc("square_payments", {}))) as Reply).result?.isError, "the write path reads nothing for agents");

  // an order whose total isn't the approved one: no invoice is made on it, and it says so as partly made
  calls = fakeSquare(writeReply(99999));
  const off = (await writer(rpc(SQUARE_DRAFT_TOOL, { customerId: "CUST1", locationId: "L1xx", requestKey: key, ...ok }))) as Reply;
  assert.ok(off.result?.isError && /^Partly made draft: Square's order ORD1/.test(off.result.content?.[0].text ?? ""));
  assert.ok(!calls.some((c) => c.method === "POST" && c.path === "invoices"));

  // a closed location is refused before anything is made
  calls = fakeSquare((c) => (c.path === "locations/L1xx" ? { status: 200, json: { location: { id: "L1xx", status: "INACTIVE", currency: "USD" } } } : writeReply(13550)(c)));
  const closed = (await writer(rpc(SQUARE_DRAFT_TOOL, { customerId: "CUST1", locationId: "L1xx", requestKey: key, ...ok }))) as Reply;
  assert.ok(closed.result?.isError && calls.every((c) => c.method === "GET"));

  // who a sign-in is for, and what it carries
  fakeSquare((c) => (c.path === "merchants/me" ? { status: 200, json: { merchant: { id: "MERCH1", business_name: "Corner Bike Shop", currency: "USD" } } } : { status: 200, json: { scopes: [...SQUARE_SCOPES], merchant_id: "MERCH1" } }));
  const who = await squareWho(SQUARE_HOST, "tok");
  assert.deepEqual(who, { merchantId: "MERCH1", name: "Corner Bike Shop", scopes: [...SQUARE_SCOPES] });
  console.log("square: ok");
})().catch((e) => { console.error(e); process.exit(1); });
