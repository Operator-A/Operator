// The QuickBooks Online integration (card 241, docs/mcp-everywhere.md "QuickBooks"): `npm run check:quickbooks`.
// No network: QuickBooks' API is a fake `fetch` that records every request.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { INTUIT_AUTH, MCP_SERVERS, authorizeUrl, checkedTools, isAppSignIn, isGoogle, isHosted, mayCall, mayReport, mayWrite, usesConnect } from "../core/mcp-rules";
import {
  QBO_CATEGORIZE, QBO_CATEGORIZE_TOOL, QBO_READ_TOOLS, QBO_SCOPE, UNCATEGORIZED, checkCategorizeArgs, checkCategorized, checkQboArgs, companyName, expenseTarget, planCategorize, qboRequest,
  readExpenseAccounts, readProfitLoss, readUncategorized, realmOk, refuseAccount, refuseCategorize, sinceDate, toCents, uncategorizedId,
} from "../core/quickbooks-rules";
import { TOOLS, refuseProposal } from "../core/gateway/policy";
import { SCOPE_WORDS, TILE_BY_ID, permissionsOf } from "../core/tools-step-rules";
import { quickbooksCompany, quickbooksServer } from "../integrations/quickbooks-server";

// ---- the profile: one Intuit sign-in, reads for agents, one write for the gateway only
const p = MCP_SERVERS.quickbooks;
assert.equal(p.auth, "intuit");
assert.ok(isAppSignIn("quickbooks") && usesConnect("quickbooks") && !isHosted("quickbooks") && !isGoogle("quickbooks"));
assert.ok(isAppSignIn("gmail") && isAppSignIn("ga4") && !isAppSignIn("stripe") && !isAppSignIn("mercury"), "Google sign-ins take the same path");
assert.deepEqual([...p.scopes], [QBO_SCOPE], "Intuit's one accounting scope, nothing else (no payments, payroll or OpenID)");
assert.deepEqual([...p.readTools], [...QBO_READ_TOOLS]);
assert.deepEqual(p.writeTools, [{ tool: QBO_CATEGORIZE_TOOL, actionType: QBO_CATEGORIZE }]);
assert.deepEqual(p.reportTools, []);
for (const t of QBO_READ_TOOLS) assert.ok(mayCall("quickbooks", t) && !mayWrite("quickbooks", t), t);
assert.ok(mayWrite("quickbooks", QBO_CATEGORIZE_TOOL) && !mayCall("quickbooks", QBO_CATEGORIZE_TOOL) && !mayReport("quickbooks", QBO_CATEGORIZE_TOOL), "only the gateway's callWriteTool reaches the write");
for (const bad of ["create_invoice", "delete_purchase", "void_invoice", "create_bill_payment", "create_purchase", "update_customer", "query"]) assert.ok(!mayWrite("quickbooks", bad) && !mayCall("quickbooks", bad), `never ${bad}`);
assert.deepEqual(checkedTools("quickbooks"), [...QBO_READ_TOOLS, QBO_CATEGORIZE_TOOL]);
assert.equal(TOOLS[QBO_CATEGORIZE].tier, "Draft", "a new action type starts at Draft");
assert.equal(TOOLS[QBO_CATEGORIZE].agents, "granted", "no agent is named in code: an approver gives it on the Tools step");
assert.ok(permissionsOf(TILE_BY_ID.quickbooks).every((x) => x.words === SCOPE_WORDS[x.scope]) && SCOPE_WORDS[QBO_SCOPE], "the scope has plain words");

// ---- sign-in: Intuit's fixed addresses, the profile's one scope
for (const u of [INTUIT_AUTH.authorization_endpoint, INTUIT_AUTH.token_endpoint, INTUIT_AUTH.revocation_endpoint!]) assert.match(u, /^https:\/\/[a-z.]+\.intuit\.com\//);
const au = new URL(authorizeUrl(INTUIT_AUTH, { clientId: "abc", redirectUri: "https://x.example/connections/quickbooks/callback", challenge: "c", state: "s", scope: p.scopes.join(" ") }));
assert.equal(au.searchParams.get("scope"), QBO_SCOPE);
assert.equal(au.searchParams.get("redirect_uri"), "https://x.example/connections/quickbooks/callback");
assert.ok(realmOk("4620816365231234567") && !realmOk("12a") && !realmOk("") && !realmOk(null) && !realmOk("1/../2"));

// ---- importers: one API file, one server, reached only through the MCP client
const files = (d: string): string[] => readdirSync(d).flatMap((f) => { const q = join(d, f); return statSync(q).isDirectory() ? (f === "node_modules" ? [] : files(q)) : /\.tsx?$/.test(f) ? [q] : []; });
const all = ["core", "agents", "templates", "dashboard", "app", "integrations"].flatMap(files);
const importers = (mod: string) => all.filter((f) => new RegExp(`from "[^"]*/${mod}"`).test(readFileSync(f, "utf8")));
assert.deepEqual(importers("quickbooks-api"), ["integrations/quickbooks-server.ts"]);
assert.deepEqual(importers("quickbooks-server"), ["integrations/mcp.ts"]);
const callers = all.filter((f) => !["core/quickbooks-rules.ts", "core/mcp-rules.ts"].includes(f) && readFileSync(f, "utf8").includes("quickbooks.api.intuit.com"));
assert.deepEqual(callers, [], "QuickBooks' address lives only in the rules and the profile");
const server = (readFileSync("integrations/quickbooks-server.ts", "utf8") + readFileSync("integrations/quickbooks-api.ts", "utf8")).replace(/^\s*\/\/.*$/gm, "");
assert.doesNotMatch(server, /operation=delete|operation=void|"DELETE"|include=void|\bdelete\b\s*\(|createPurchase|qboRequest\.(?!profitLoss|uncategorizedAccount|purchasesSince|expenseAccounts|companyInfo|purchase|account|updatePurchase)\w+/, "no create, delete or void call");
assert.equal((server.match(/qboPost\(/g) ?? []).length, 2, "POSTs: the definition and the one sparse update");
const rules = readFileSync("core/quickbooks-rules.ts", "utf8");
assert.equal((rules.match(/`SELECT /g) ?? []).length, 3, "three fixed queries");
assert.doesNotMatch(rules, /operation=|DELETE FROM|"Deposit"|"BillPayment"|"Payment"/);

// ---- inputs
assert.deepEqual(checkQboArgs("quickbooks_profit_loss", {}), { tool: "quickbooks_profit_loss", period: "last_month" });
assert.ok("problem" in checkQboArgs("quickbooks_profit_loss", { period: "all_time" }));
assert.ok("problem" in checkQboArgs("quickbooks_profit_loss", { query: "SELECT * FROM Purchase" }), "no query text from outside");
assert.deepEqual(checkQboArgs("quickbooks_uncategorized", { days: 30 }), { tool: "quickbooks_uncategorized", days: 30, limit: 25 });
assert.ok("problem" in checkQboArgs("quickbooks_uncategorized", { days: 400 }) && "problem" in checkQboArgs("quickbooks_uncategorized", { limit: 51 }));
assert.ok("problem" in checkQboArgs(QBO_CATEGORIZE_TOOL, {}), "the write isn't a read");
assert.equal(sinceDate(30, Date.parse("2026-11-21T12:00:00Z")), "2026-10-22");
assert.throws(() => qboRequest.purchasesSince("2026-01-01' OR 1=1 --"));
assert.throws(() => qboRequest.purchase("1 OR 1"));
assert.equal(toCents("1,234.56"), 123456);
assert.equal(toCents(-12.5), -1250);
assert.equal(toCents(""), null);

// ---- readers: sums in code
const pl = {
  Header: { StartPeriod: "2026-10-01", EndPeriod: "2026-10-31", Currency: "USD" },
  Rows: { Row: [
    { type: "Section", group: "Income", Summary: { ColData: [{ value: "Total Income" }, { value: "10000.00" }] } },
    { type: "Section", group: "COGS", Summary: { ColData: [{ value: "Total Cost of Goods Sold" }, { value: "4000.00" }] } },
    { type: "Section", group: "GrossProfit", Summary: { ColData: [{ value: "Gross Profit" }, { value: "6000.00" }] } },
    { type: "Section", group: "Expenses", Rows: { Row: [
      { type: "Data", ColData: [{ value: "Rent", id: "7" }, { value: "1500.00" }] },
      { type: "Section", Header: { ColData: [{ value: "Software" }, { value: "" }] }, Rows: { Row: [] }, Summary: { ColData: [{ value: "Total Software" }, { value: "320.10" }] } },
      { type: "Data", ColData: [{ value: UNCATEGORIZED, id: "31" }, { value: "179.90" }] },
    ] }, Summary: { ColData: [{ value: "Total Expenses" }, { value: "2000.00" }] } },
    { type: "Section", group: "NetOperatingIncome", Summary: { ColData: [{ value: "Net Operating Income" }, { value: "4000.00" }] } },
    { type: "Section", group: "NetIncome", Summary: { ColData: [{ value: "Net Income" }, { value: "4000.00" }] } },
  ] },
};
const r = readProfitLoss(pl);
assert.equal(r.totals.income, 10000);
assert.equal(r.totals.gross_profit, 6000);
assert.equal(r.totals.net_income, 4000);
assert.ok(r.net_income_checked);
assert.deepEqual(r.expense_lines, [{ account: "Rent", amount: 1500 }, { account: "Software", amount: 320.1 }, { account: UNCATEGORIZED, amount: 179.9 }]);
assert.equal(readProfitLoss({ ...pl, Rows: { Row: [...pl.Rows.Row.slice(0, 5), { type: "Section", group: "NetIncome", Summary: { ColData: [{}, { value: "9.99" }] } }] } }).net_income_checked, false, "a net income that doesn't add up is flagged");

const accts = { QueryResponse: { Account: [
  { Id: "31", Name: UNCATEGORIZED, Classification: "Expense", Active: true, AccountType: "Expense" },
  { Id: "7", Name: "Rent", FullyQualifiedName: "Rent", Classification: "Expense", Active: true, AccountType: "Expense", AccountSubType: "RentOrLeaseOfBuildings" },
  { Id: "8", Name: "Old", Classification: "Expense", Active: false },
  { Id: "9", Name: "Beans", FullyQualifiedName: "Cost of Goods Sold:Beans", Classification: "Expense", Active: true, AccountType: "Cost of Goods Sold" },
] } };
assert.equal(uncategorizedId(accts), "31");
assert.equal(uncategorizedId({ QueryResponse: {} }), null);
assert.deepEqual(readExpenseAccounts(accts.QueryResponse.Account).map((a) => a.id), ["9", "7"], "active expense accounts, never Uncategorized itself");
assert.equal(companyName({ CompanyInfo: { CompanyName: "Acme Roasters" } }), "Acme Roasters");

const purchase = (id: string, date: string, lines: { id: string; amt: string; acct: string }[], payee = "Bean Co\u0007 https://evil.example") => ({
  Id: id, SyncToken: "3", TxnDate: date, PaymentType: "CreditCard", AccountRef: { value: "41", name: "Amex" }, EntityRef: { name: payee }, CurrencyRef: { value: "USD" },
  TotalAmt: lines.reduce((s, l) => s + Number(l.amt), 0),
  Line: lines.map((l) => ({ Id: l.id, Amount: Number(l.amt), DetailType: "AccountBasedExpenseLineDetail", AccountBasedExpenseLineDetail: { AccountRef: { value: l.acct, name: "x" } }, Description: "card swipe" })),
});
const ps = [purchase("100", "2026-11-01", [{ id: "1", amt: "12.34", acct: "31" }, { id: "2", amt: "5.00", acct: "7" }]), purchase("101", "2026-11-05", [{ id: "1", amt: "40.00", acct: "31" }])];
const u = readUncategorized(ps as unknown as Record<string, unknown>[], "31", 25, false);
assert.equal(u.count, 2);
assert.equal(u.total, 52.34);
assert.deepEqual(u.lines.map((l) => `${l.purchaseId}:${l.lineId}`), ["101:1", "100:1"], "newest first, only lines in Uncategorized");
assert.ok(!/[\u0000-\u001f]/.test(u.lines[0].payee), "control characters are stripped from untrusted text");

// ---- the write's guards
assert.ok(expenseTarget("100:1") && !expenseTarget("100") && !expenseTarget("a:1"));
assert.equal(refuseCategorize({ accountId: "7", account: "Rent" }), null);
assert.ok(refuseCategorize({ accountId: "7", account: "Rent", amount: 1 }), "an amount is never a field");
assert.ok(refuseCategorize({ accountId: "31", account: UNCATEGORIZED }));
assert.ok(refuseCategorize({ accountId: "7; drop", account: "Rent" }));
const grants = ["quickbooks_uncategorized", "quickbooks_categorize_expense"];
assert.equal(refuseProposal("b_books_1", QBO_CATEGORIZE, "100:1", { accountId: "7", account: "Rent" }, 200, grants), null);
assert.ok(refuseProposal("b_books_1", QBO_CATEGORIZE, "100:1", { accountId: "7", account: "Rent" }, 200, ["quickbooks_uncategorized"]), "not given the tool");
assert.ok(refuseProposal("b_books_1", QBO_CATEGORIZE, "100", { accountId: "7", account: "Rent" }, 200, grants), "the target is an expense line");
assert.deepEqual(checkCategorizeArgs({ purchaseId: "100", lineId: "1", accountId: "7" }), { purchaseId: "100", lineId: "1", accountId: "7" });
assert.ok("problem" in checkCategorizeArgs({ purchaseId: "100", lineId: "1", accountId: "7", amount: "1" }));
assert.equal(refuseAccount({ Account: accts.QueryResponse.Account[1] }, "31"), null);
assert.ok(refuseAccount({ Account: accts.QueryResponse.Account[0] }, "31") && refuseAccount({ Account: accts.QueryResponse.Account[2] }, "31"));
assert.ok(refuseAccount({ Account: { Id: "50", Name: "Sales", Classification: "Revenue", Active: true } }, "31"), "never an income account");
const plan = planCategorize({ Purchase: ps[0] }, "1", "31", "7");
assert.ok("body" in plan);
if ("body" in plan) {
  const lines = plan.body.Line as { Id: string; Amount: number; AccountBasedExpenseLineDetail: { AccountRef: { value: string } } }[];
  assert.deepEqual(lines.map((l) => [l.Id, l.Amount, l.AccountBasedExpenseLineDetail.AccountRef.value]), [["1", 12.34, "7"], ["2", 5, "7"]], "only that line moves; amounts as read");
  assert.equal(plan.body.sparse, true);
  assert.equal(plan.body.SyncToken, "3");
  assert.equal(plan.body.TotalAmt, undefined, "the total is never sent");
}
assert.ok("problem" in planCategorize({ Purchase: ps[0] }, "2", "31", "9"), "a line someone already categorized is left as is");
assert.ok("already" in planCategorize({ Purchase: ps[0] }, "2", "31", "7"), "a retry after it went through");
assert.ok("problem" in planCategorize({ Purchase: ps[0] }, "9", "31", "7"));
const after = JSON.parse(JSON.stringify(ps[0]));
after.Line[0].AccountBasedExpenseLineDetail.AccountRef.value = "7";
assert.equal(checkCategorized({ Purchase: ps[0] }, { Purchase: after }, "1", "7"), null);
const changed = JSON.parse(JSON.stringify(after)); changed.Line[1].Amount = 6; changed.TotalAmt = 18.34;
assert.ok(checkCategorized({ Purchase: ps[0] }, { Purchase: changed }, "1", "7"));
const moved = JSON.parse(JSON.stringify(after)); moved.Line[1].AccountBasedExpenseLineDetail.AccountRef.value = "9";
assert.ok(checkCategorized({ Purchase: ps[0] }, { Purchase: moved }, "1", "7"), "another line moved");

// ---- the server, end to end, on a fake QuickBooks
type Call = { method: string; url: string; body: string };
function fakeQbo(reply: (c: Call) => { status: number; json: unknown }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    assert.equal(init?.redirect, "error", "a request carrying the token never follows a redirect");
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer tok");
    const c = { method: init?.method ?? "GET", url: String(input), body: String(init?.body ?? "") };
    assert.match(c.url, /^https:\/\/quickbooks\.api\.intuit\.com\/v3\/company\/123\/[^?]+\?(.+&)?minorversion=75$/);
    calls.push(c);
    const r = reply(c);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return calls;
}
const BASE = "https://quickbooks.api.intuit.com/v3/company";
const rpc = (name: string, args: unknown) => ({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });
type Reply = { result?: { isError?: boolean; structuredContent?: { result: Record<string, unknown> }; content?: { text: string }[] } };
const q = (c: Call) => decodeURIComponent(new URL(c.url).searchParams.get("query") ?? "");

(async () => {
  // reads: the read side serves reads only; every request is a GET
  let calls = fakeQbo((c) => (q(c).includes("FROM Account WHERE Name") ? { status: 200, json: accts } : { status: 200, json: { QueryResponse: { Purchase: ps } } }));
  const reader = quickbooksServer({ base: BASE, realm: "123", token: "tok", write: false });
  const list = (await reader({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
  assert.deepEqual(list.result.tools.map((t) => t.name), [...QBO_READ_TOOLS]);
  assert.ok(list.result.tools.every((t) => t.annotations.readOnlyHint));
  const un = (await reader(rpc("quickbooks_uncategorized", { days: 30, limit: 10 }))) as Reply;
  assert.equal(un.result?.structuredContent?.result.count, 2);
  assert.ok(calls.every((c) => c.method === "GET"));
  assert.ok(((await reader(rpc(QBO_CATEGORIZE_TOOL, { purchaseId: "100", lineId: "1", accountId: "7" }))) as Reply).result?.isError, "an agent's read path can't write");
  assert.ok(((await quickbooksServer({ base: BASE, realm: null, token: "tok", write: false })(rpc("quickbooks_expense_accounts", {}))) as Reply).result?.isError, "no company, no call");

  // the write: account and purchase re-read, one sparse update, read back
  let stored = JSON.parse(JSON.stringify(ps[0]));
  calls = fakeQbo((c) => {
    if (q(c).includes("FROM Account WHERE Name")) return { status: 200, json: accts };
    if (c.method === "GET" && /\/account\/7\?/.test(c.url)) return { status: 200, json: { Account: accts.QueryResponse.Account[1] } };
    if (c.method === "GET" && /\/purchase\/100\?/.test(c.url)) return { status: 200, json: { Purchase: stored } };
    if (c.method === "POST" && /\/purchase\?/.test(c.url)) { const b = JSON.parse(c.body); stored = { ...stored, Line: b.Line, SyncToken: "4" }; return { status: 200, json: { Purchase: stored } }; }
    return { status: 500, json: {} };
  });
  const writer = quickbooksServer({ base: BASE, realm: "123", token: "tok", write: true });
  const wl = (await writer({ jsonrpc: "2.0", id: 1, method: "tools/list" })) as { result: { tools: { name: string }[] } };
  assert.deepEqual(wl.result.tools.map((t) => t.name), [QBO_CATEGORIZE_TOOL], "the gateway's path serves only the write");
  const done = (await writer(rpc(QBO_CATEGORIZE_TOOL, { purchaseId: "100", lineId: "1", accountId: "7" }))) as Reply;
  assert.deepEqual(done.result?.structuredContent?.result, { purchaseId: "100", lineId: "1", accountId: "7", amount: 12.34, before: UNCATEGORIZED, uncategorizedId: "31", checked: true });
  assert.deepEqual(calls.map((c) => `${c.method} ${c.url.replace(`${BASE}/123/`, "").split("?")[0]}`), ["GET query", "GET account/7", "GET purchase/100", "POST purchase", "GET purchase/100"]);
  assert.ok(((await writer(rpc("quickbooks_profit_loss", {}))) as Reply).result?.isError, "the write path reads nothing for agents");

  // a retry after it went through writes nothing
  calls.length = 0;
  const again = (await writer(rpc(QBO_CATEGORIZE_TOOL, { purchaseId: "100", lineId: "1", accountId: "7" }))) as Reply;
  assert.equal(again.result?.structuredContent?.result.already, true);
  assert.ok(calls.every((c) => c.method === "GET"));

  // an income account is refused before the purchase is read or written
  calls = fakeQbo((c) => (q(c).includes("FROM Account WHERE Name") ? { status: 200, json: accts } : { status: 200, json: { Account: { Id: "50", Name: "Sales", Classification: "Revenue", Active: true } } }));
  const bad = (await writer(rpc(QBO_CATEGORIZE_TOOL, { purchaseId: "100", lineId: "1", accountId: "50" }))) as Reply;
  assert.ok(bad.result?.isError && calls.every((c) => c.method === "GET") && !calls.some((c) => c.url.includes("/purchase/")));

  // who a sign-in is for
  fakeQbo(() => ({ status: 200, json: { CompanyInfo: { CompanyName: "Acme Roasters" } } }));
  assert.equal(await quickbooksCompany(BASE, "123", "tok"), "Acme Roasters");
  assert.equal(await quickbooksCompany(BASE, "12x", "tok"), null);
  console.log("quickbooks: ok");
})().catch((e) => { console.error(e); process.exit(1); });
