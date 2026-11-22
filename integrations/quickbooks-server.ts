import "server-only";
// Our own QuickBooks Online MCP server (card 241, docs/mcp-everywhere.md "QuickBooks"). Intuit's own
// QuickBooks MCP server runs on a person's machine and can create, change and delete almost anything,
// so it can't be held to a profile; this one runs in the app and is reached only through
// integrations/mcp.ts, which opens the sign-in from the vault. One profile, "quickbooks":
// - read tools for agents (callMcpTool): each runs one fixed request (core/quickbooks-rules.ts) and
//   every total is made there.
// - one write tool for core/gateway only (callWriteTool, after an approver approves): move one
//   expense line out of Uncategorized Expense. No create, delete, void or amount change is here, and
//   none may be added (check:quickbooks fails on one).
import { MCP_PROTOCOL, MCP_SERVERS } from "@/core/mcp-rules";
import {
  QBO_CATEGORIZE_TOOL, checkCategorizeArgs, checkCategorized, checkQboArgs, companyName, planCategorize, qboRequest, queryRows, readExpenseAccounts, readProfitLoss, readUncategorized,
  realmOk, refuseAccount, sinceDate, uncategorizedId, QUERY_MAX, UNCATEGORIZED, type QboArgs, readReceivables, readUnpaidBills,
} from "@/core/quickbooks-rules";
import { errorText, qboGet, qboJson, qboPost, type QboConn } from "./quickbooks-api";

const DESCRIPTIONS: Record<string, string> = {
  quickbooks_profit_loss: "Profit and loss for a period: income, cost of goods, gross profit, expenses by account and net income.",
  quickbooks_uncategorized: "Expense lines still in Uncategorized Expense, newest first, with their count and total.",
  quickbooks_expense_accounts: "The company's active expense accounts, to pick a category from.",
  quickbooks_unpaid_bills: "Bills with money still owed, soonest due first, with what is overdue and what falls due in the next 14 days.",
  quickbooks_receivables: "What customers owe, by age (current, 1 to 30, 31 to 60, 61 to 90 and over 90 days), largest first.",
  [QBO_CATEGORIZE_TOOL]: "Moves one expense line out of Uncategorized Expense into an expense account. Changes nothing else.",
};

/** Which company a sign-in reaches: its name, read right after Connect. */
export async function quickbooksCompany(base: string, realm: string, token: string): Promise<string | null> {
  if (!realmOk(realm)) return null;
  const res = await qboGet({ base, realm, token }, qboRequest.companyInfo(realm));
  if (res.status === 401) throw new Error("QuickBooks 401: the sign-in wasn't accepted");
  if (!res.ok) throw new Error(`QuickBooks ${res.status}: ${await errorText(res)}`);
  return companyName(await res.json()) || null;
}

async function uncatIdOf(c: QboConn): Promise<string> {
  const id = uncategorizedId(await qboJson(c, qboRequest.uncategorizedAccount()));
  if (!id) throw new Error(`This QuickBooks company has no ${UNCATEGORIZED} account.`);
  return id;
}

async function read(c: QboConn, a: QboArgs): Promise<unknown> {
  switch (a.tool) {
    case "quickbooks_profit_loss": return readProfitLoss(await qboJson(c, qboRequest.profitLoss(a.period)));
    case "quickbooks_expense_accounts": return { accounts: readExpenseAccounts(queryRows(await qboJson(c, qboRequest.expenseAccounts()), "Account")) };
    case "quickbooks_uncategorized": {
      const uncat = uncategorizedId(await qboJson(c, qboRequest.uncategorizedAccount()));
      if (!uncat) return { lines: [], count: 0, total: 0, cut: false };
      const rows = queryRows(await qboJson(c, qboRequest.purchasesSince(sinceDate(a.days, Date.now()))), "Purchase");
      return readUncategorized(rows, uncat, a.limit, rows.length >= QUERY_MAX);
    }
    case "quickbooks_unpaid_bills": {
      const rows = queryRows(await qboJson(c, qboRequest.unpaidBills()), "Bill");
      return readUnpaidBills(rows, new Date().toISOString().slice(0, 10), a.limit, rows.length >= QUERY_MAX);
    }
    case "quickbooks_receivables": {
      const r = readReceivables(await qboJson(c, qboRequest.agedReceivables()), a.limit);
      if ("problem" in r) throw new Error(`QuickBooks report: ${r.problem}`);
      return r;
    }
  }
}

/** The write: the purchase and the account re-read, the line moved, then read back and checked. */
async function categorize(c: QboConn, raw: unknown): Promise<unknown> {
  const a = checkCategorizeArgs(raw);
  if ("problem" in a) throw new Error(`Input refused: ${a.problem}`);
  const uncat = await uncatIdOf(c);
  const acct = await qboGet(c, qboRequest.account(a.accountId));
  if (acct.status === 404 || acct.status === 400) throw new Error("That account isn't in the business's QuickBooks.");
  if (!acct.ok) throw new Error(`QuickBooks ${acct.status} on read account: ${await errorText(acct)}`);
  const acctJson = await acct.json();
  const no = refuseAccount(acctJson, uncat);
  if (no) throw new Error(no);
  const before = await qboJson(c, qboRequest.purchase(a.purchaseId));
  const plan = planCategorize(before, a.lineId, uncat, a.accountId);
  if ("problem" in plan) throw new Error(plan.problem);
  if ("already" in plan) return { purchaseId: a.purchaseId, lineId: a.lineId, accountId: a.accountId, amount: plan.amount, already: true };
  const res = await qboPost(c, qboRequest.updatePurchase(), plan.body);
  if (!res.ok) throw new Error(`QuickBooks ${res.status} on update expense: ${await errorText(res)}`);
  const after = await qboJson(c, qboRequest.purchase(a.purchaseId));
  const wrong = checkCategorized(before, after, a.lineId, a.accountId);
  return { purchaseId: a.purchaseId, lineId: a.lineId, accountId: a.accountId, amount: plan.amount, before: plan.before, uncategorizedId: uncat, checked: !wrong, ...(wrong ? { problem: wrong } : {}) };
}

/**
 * A JSON-RPC handler for one call, with the token the vault opened and the company it was granted for.
 * `write` (only callWriteTool passes it): the profile's write tool; otherwise its read tools only.
 */
export function quickbooksServer(o: { base: string; realm: string | null; token: string; write: boolean }) {
  const p = MCP_SERVERS.quickbooks;
  const offered: string[] = o.write ? p.writeTools.map((w) => w.tool) : [...p.readTools];
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-quickbooks", version: "1" } });
      case "tools/list":
        return reply(id, { tools: offered.map((name) => ({ name, description: DESCRIPTIONS[name], annotations: { readOnlyHint: name !== QBO_CATEGORIZE_TOOL, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!offered.includes(name)) return toolError(id, `${name || "That"} isn't a tool served here.`);
        if (!realmOk(o.realm)) return toolError(id, "QuickBooks didn't say which company this sign-in is for. Tap Sign in again on Connections.");
        const c: QboConn = { base: o.base, realm: o.realm, token: o.token };
        try {
          let result: unknown;
          if (name === QBO_CATEGORIZE_TOOL) result = await categorize(c, req.params?.arguments);
          else {
            const a = checkQboArgs(name, req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            result = await read(c, a);
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
