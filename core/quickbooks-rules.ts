// QuickBooks Online (card 241, docs/mcp-everywhere.md "QuickBooks"). Pure, so `npm run check:quickbooks`
// can test it with no network.
//
// Intuit's QuickBooks MCP server runs on a person's own machine and can create, change and delete
// almost anything, so it can't be held to a profile. We run our own small server
// (integrations/quickbooks-server.ts) over the QuickBooks Online Accounting API, signed in on Intuit's
// own page with the app's Intuit OAuth client (QUICKBOOKS_CLIENT_ID, QUICKBOOKS_CLIENT_SECRET).
// Intuit has one accounting scope and it reads and writes, so what may be done is held here, in code:
// - read tools: each one runs one fixed request written here, takes only a period or a row limit,
//   and every total is added up here.
// - one write tool, used only by core/gateway after an approver approves: move one expense line that
//   sits in Uncategorized Expense to one of the business's own expense accounts. The amount, payee,
//   date and every other line are sent back exactly as read, and checked again after the write.
//   The server has no code to create, delete or void anything, or to touch an amount.

export const QBO_READ_TOOLS = ["quickbooks_profit_loss", "quickbooks_uncategorized", "quickbooks_expense_accounts"] as const;
export type QboReadTool = (typeof QBO_READ_TOOLS)[number];
export const QBO_CATEGORIZE_TOOL = "quickbooks_categorize_expense";
/** The gateway action type: an expense line moved out of Uncategorized Expense. */
export const QBO_CATEGORIZE = "quickbooks.categorize_expense";
/** Intuit's accounting scope: the only one asked for. It can read and write; the limits are in this file. */
export const QBO_SCOPE = "com.intuit.quickbooks.accounting";

export const QBO_BASE = "https://quickbooks.api.intuit.com/v3/company";
/** Intuit's test companies, for an app still on its development keys (QUICKBOOKS_SANDBOX=1 in Vercel). */
export const QBO_SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com/v3/company";
/** Pinned so a change on Intuit's side can't change what a call returns. */
export const QBO_MINOR_VERSION = "75";
/** The account QuickBooks puts bank-feed expenses in until someone picks a category. */
export const UNCATEGORIZED = "Uncategorized Expense";

/** Periods for the profit and loss, as Intuit's own date macros, so the company's fiscal year and time zone apply. */
export const QBO_PERIODS = ["this_month", "last_month", "this_quarter", "last_quarter", "year_to_date", "last_year"] as const;
export type QboPeriod = (typeof QBO_PERIODS)[number];
const MACRO: Record<QboPeriod, string> = {
  this_month: "This Month", last_month: "Last Month", this_quarter: "This Fiscal Quarter", last_quarter: "Last Fiscal Quarter",
  year_to_date: "This Fiscal Year-to-date", last_year: "Last Fiscal Year",
};

/** Rows a read returns at most, and how far back the uncategorized list looks. */
export const MAX_ROWS = 50;
export const MAX_DAYS = 365;
/** Purchases read per request (QuickBooks' own maximum). */
export const QUERY_MAX = 1000;

/** A company (realm) id or an entity id: digits only, so it can sit in a path or query with nothing else. */
export const QBO_ID = /^\d{1,20}$/;
export const realmOk = (s: unknown): s is string => typeof s === "string" && QBO_ID.test(s);

export type QboArgs =
  | { tool: "quickbooks_profit_loss"; period: QboPeriod }
  | { tool: "quickbooks_uncategorized"; days: number; limit: number }
  | { tool: "quickbooks_expense_accounts" };

/** A read tool's input, checked again on our server. Anything not named here is refused. */
export function checkQboArgs(tool: string, raw: unknown): QboArgs | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed: Record<QboReadTool, string[]> = { quickbooks_profit_loss: ["period"], quickbooks_uncategorized: ["days", "limit"], quickbooks_expense_accounts: [] };
  if (!(tool in allowed)) return { problem: `${tool || "that"} isn't a QuickBooks read tool` };
  const t = tool as QboReadTool;
  const extra = Object.keys(a).filter((k) => !allowed[t].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  if (t === "quickbooks_expense_accounts") return { tool: t };
  if (t === "quickbooks_profit_loss") {
    const period = (a.period ?? "last_month") as QboPeriod;
    if (!QBO_PERIODS.includes(period)) return { problem: `period is one of ${QBO_PERIODS.join(", ")}` };
    return { tool: t, period };
  }
  const days = a.days === undefined ? 90 : Number(a.days);
  const limit = a.limit === undefined ? 25 : Number(a.limit);
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) return { problem: `days is a whole number from 1 to ${MAX_DAYS}` };
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS) return { problem: `limit is a whole number from 1 to ${MAX_ROWS}` };
  return { tool: t, days, limit };
}

/** YYYY-MM-DD, `days` before `now` (ms), in UTC. */
export function sinceDate(days: number, now: number): string {
  return new Date(now - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * The fixed requests. A path is a report or `query`; a query's text is written here, and the only
 * values in it are a date code made and a fixed account name. Nothing an agent or a reply wrote is put in one.
 */
export const qboRequest = {
  profitLoss: (p: QboPeriod) => ({ path: "reports/ProfitAndLoss", query: { date_macro: MACRO[p] } }),
  uncategorizedAccount: () => ({ path: "query", query: { query: `SELECT * FROM Account WHERE Name = '${UNCATEGORIZED}'` } }),
  purchasesSince: (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("not a date");
    return { path: "query", query: { query: `SELECT * FROM Purchase WHERE TxnDate >= '${date}' ORDERBY TxnDate DESC MAXRESULTS ${QUERY_MAX}` } };
  },
  expenseAccounts: () => ({ path: "query", query: { query: `SELECT * FROM Account WHERE Classification = 'Expense' AND Active = true MAXRESULTS ${QUERY_MAX}` } }),
  companyInfo: (realm: string) => ({ path: `companyinfo/${checkedId(realm)}`, query: {} }),
  purchase: (id: string) => ({ path: `purchase/${checkedId(id)}`, query: {} }),
  account: (id: string) => ({ path: `account/${checkedId(id)}`, query: {} }),
  /** The one write: a sparse update of one purchase. */
  updatePurchase: () => ({ path: "purchase", query: {} }),
} as const;

function checkedId(id: string): string {
  if (!QBO_ID.test(id)) throw new Error("not a QuickBooks id");
  return id;
}

// ---- Reading QuickBooks' replies. Amounts are decimal strings or numbers; every sum is made here, in cents.

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown, max = 120) => (typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

/** A money amount in cents, or null when it isn't one. */
export function toCents(x: unknown): number | null {
  if (typeof x === "number") return Number.isFinite(x) ? Math.round(x * 100) : null;
  if (typeof x !== "string" || !x.trim()) return null;
  const n = Number(x.replace(/,/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
const usd = (cents: number) => Math.round(cents) / 100;

/** The rows of a `query` reply for one entity. */
export function queryRows(reply: unknown, entity: "Account" | "Purchase"): Json[] {
  return arr(obj(obj(reply).QueryResponse)[entity]).map(obj);
}

/** The company's name, from a CompanyInfo reply. */
export function companyName(reply: unknown): string {
  const c = obj(obj(reply).CompanyInfo);
  return str(c.CompanyName, 80) || str(c.LegalName, 80);
}

/** The Uncategorized Expense account's id, or null when the company has none. */
export function uncategorizedId(reply: unknown): string | null {
  const a = queryRows(reply, "Account").find((r) => r.Name === UNCATEGORIZED && QBO_ID.test(String(r.Id ?? "")));
  return a ? String(a.Id) : null;
}

const GROUPS = { Income: "income", COGS: "cost_of_goods", GrossProfit: "gross_profit", Expenses: "expenses", NetOperatingIncome: "net_operating_income", OtherIncome: "other_income", OtherExpenses: "other_expenses", NetOtherIncome: "net_other_income", NetIncome: "net_income" } as const;
type Group = (typeof GROUPS)[keyof typeof GROUPS];

export interface ProfitLoss {
  from: string; to: string; currency: string;
  totals: Record<Group, number>;
  /** The top-level expense accounts and their totals, largest first. */
  expense_lines: { account: string; amount: number }[];
  /** Net income worked out here from the parts, and whether it matches QuickBooks' own line. */
  net_income_checked: boolean;
}

const colValue = (row: Json, i: number) => obj(arr(obj(row).ColData)[i]).value;

/** A ProfitAndLoss report, read into totals in code. Section totals are QuickBooks' own summary lines. */
export function readProfitLoss(reply: unknown): ProfitLoss {
  const r = obj(reply);
  const h = obj(r.Header);
  const cents = Object.fromEntries(Object.values(GROUPS).map((g) => [g, 0])) as Record<Group, number>;
  const lines: { account: string; cents: number }[] = [];
  for (const row of arr(obj(r.Rows).Row).map(obj)) {
    const g = GROUPS[String(row.group ?? "") as keyof typeof GROUPS];
    if (!g) continue;
    cents[g] = toCents(colValue(obj(row.Summary), 1)) ?? 0;
    if (g !== "expenses") continue;
    for (const child of arr(obj(row.Rows).Row).map(obj)) {
      // a plain account line, or a parent account with sub-accounts (its summary is the parent's total)
      const name = child.type === "Section" ? str(colValue(obj(child.Header), 0), 80) : str(colValue(child, 0), 80);
      const amount = child.type === "Section" ? toCents(colValue(obj(child.Summary), 1)) : toCents(colValue(child, 1));
      if (name && amount !== null) lines.push({ account: name, cents: amount });
    }
  }
  const worked = cents.income - cents.cost_of_goods - cents.expenses + cents.other_income - cents.other_expenses;
  const totals = Object.fromEntries(Object.entries(cents).map(([k, v]) => [k, usd(v)])) as Record<Group, number>;
  return {
    from: str(h.StartPeriod, 10), to: str(h.EndPeriod, 10), currency: str(h.Currency, 3) || "USD",
    totals,
    expense_lines: lines.sort((a, b) => b.cents - a.cents).slice(0, MAX_ROWS).map((l) => ({ account: l.account, amount: usd(l.cents) })),
    net_income_checked: Math.abs(worked - cents.net_income) <= 1,
  };
}

export interface UncategorizedLine {
  purchaseId: string; lineId: string; date: string;
  /** Who was paid, as QuickBooks has it (from a bank feed): untrusted text. */
  payee: string;
  amount: number; currency: string;
  /** The line's own description, as QuickBooks has it: untrusted text. */
  description: string;
  paid_from: string;
}

/** Expense lines still in Uncategorized Expense, newest first, with their count and total worked out here. */
export function readUncategorized(purchases: Json[], uncatId: string, limit: number, cut: boolean) {
  const found: (UncategorizedLine & { cents: number })[] = [];
  for (const p of purchases) {
    const id = String(p.Id ?? "");
    if (!QBO_ID.test(id)) continue;
    for (const l of arr(p.Line).map(obj)) {
      const d = obj(l.AccountBasedExpenseLineDetail);
      if (l.DetailType !== "AccountBasedExpenseLineDetail" || String(obj(d.AccountRef).value ?? "") !== uncatId) continue;
      const lineId = String(l.Id ?? "");
      const cents = toCents(l.Amount);
      if (!QBO_ID.test(lineId) || cents === null) continue;
      found.push({
        purchaseId: id, lineId, date: str(p.TxnDate, 10), payee: str(obj(p.EntityRef).name, 80) || "Unknown payee",
        amount: usd(cents), cents, currency: str(obj(p.CurrencyRef).value, 3) || "USD", description: str(l.Description, 120), paid_from: str(obj(p.AccountRef).name, 80),
      });
    }
  }
  found.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : Number(b.purchaseId) - Number(a.purchaseId)));
  const total = found.reduce((s, f) => s + f.cents, 0);
  const lines: UncategorizedLine[] = found.slice(0, limit).map((f) => ({ purchaseId: f.purchaseId, lineId: f.lineId, date: f.date, payee: f.payee, amount: f.amount, currency: f.currency, description: f.description, paid_from: f.paid_from }));
  return { lines, count: found.length, total: usd(total), cut };
}

export interface ExpenseAccount { id: string; name: string; type: string; subtype: string }

/** The company's active expense accounts (cost of goods included), never Uncategorized Expense itself. */
export function readExpenseAccounts(rows: Json[]): ExpenseAccount[] {
  return rows
    .filter((r) => QBO_ID.test(String(r.Id ?? "")) && r.Active !== false && r.Classification === "Expense" && r.Name !== UNCATEGORIZED)
    .map((r) => ({ id: String(r.Id), name: str(r.FullyQualifiedName, 100) || str(r.Name, 100), type: str(r.AccountType, 40), subtype: str(r.AccountSubType, 60) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ---- The one write: an expense line moved out of Uncategorized Expense (core/gateway only).

/** The proposal's fields: the account picked from an expense accounts result, and its name for the card. */
export const CATEGORIZE_FIELDS = ["accountId", "account"] as const;
export interface CategorizeArgs { accountId: string; account: string }

/** The target: `purchaseId:lineId`, from an uncategorized expenses result. */
export const expenseTarget = (t: string) => /^\d{1,20}:\d{1,20}$/.test(t);

/** Why a proposal's fields are refused. */
export function refuseCategorize(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => !(CATEGORIZE_FIELDS as readonly string[]).includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A categorize action holds only the account, picked from QuickBooks; the expense is the target.`;
  if (typeof args.accountId !== "string" || !QBO_ID.test(args.accountId)) return "The account is not a QuickBooks account id.";
  if (typeof args.account !== "string" || !args.account.trim() || args.account.length > 100) return "The account needs its name, from an expense accounts result.";
  if (args.account.trim() === UNCATEGORIZED) return `Moving an expense into ${UNCATEGORIZED} isn't a categorization.`;
  return null;
}

/** The write tool's input, checked again on our server. */
export function checkCategorizeArgs(raw: unknown): { purchaseId: string; lineId: string; accountId: string } | { problem: string } {
  const a = obj(raw);
  const extra = Object.keys(a).filter((k) => !["purchaseId", "lineId", "accountId"].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  for (const k of ["purchaseId", "lineId", "accountId"] as const) if (typeof a[k] !== "string" || !QBO_ID.test(a[k] as string)) return { problem: `${k} is a QuickBooks id` };
  return { purchaseId: a.purchaseId as string, lineId: a.lineId as string, accountId: a.accountId as string };
}

/** Why an account can't take an expense: it must be the company's own, active, and an expense account. */
export function refuseAccount(reply: unknown, uncatId: string): string | null {
  const a = obj(obj(reply).Account);
  if (!QBO_ID.test(String(a.Id ?? ""))) return "That account isn't in the business's QuickBooks.";
  if (String(a.Id) === uncatId || a.Name === UNCATEGORIZED) return `Moving an expense into ${UNCATEGORIZED} isn't a categorization.`;
  if (a.Active === false) return "That account is inactive in QuickBooks.";
  if (a.Classification !== "Expense") return "That account isn't an expense account.";
  return null;
}

export type CategorizePlan =
  | { problem: string }
  | { already: true; amount: number }
  | { body: Json; amount: number; before: string };

/**
 * The sparse update for one line of a purchase: the whole Line list as read, with only that line's
 * account changed. Refused unless the line is an account-based expense line in Uncategorized Expense.
 * `already` when it is in the target account already (a retry after a write that went through).
 */
export function planCategorize(reply: unknown, lineId: string, uncatId: string, accountId: string): CategorizePlan {
  const p = obj(obj(reply).Purchase);
  if (!QBO_ID.test(String(p.Id ?? "")) || typeof p.SyncToken !== "string") return { problem: "That expense isn't in the business's QuickBooks any more." };
  const lines = arr(p.Line).map(obj);
  const line = lines.find((l) => String(l.Id ?? "") === lineId);
  if (!line) return { problem: "That line isn't on the expense any more." };
  const d = obj(line.AccountBasedExpenseLineDetail);
  if (line.DetailType !== "AccountBasedExpenseLineDetail") return { problem: "That line isn't an account-based expense line." };
  const cents = toCents(line.Amount);
  if (cents === null) return { problem: "That line has no amount." };
  const current = String(obj(d.AccountRef).value ?? "");
  if (current === accountId) return { already: true, amount: usd(cents) };
  if (current !== uncatId) return { problem: `That line isn't in ${UNCATEGORIZED} any more (someone categorized it), so it is left as is.` };
  const Line = lines.map((l) => (l === line ? { ...l, AccountBasedExpenseLineDetail: { ...d, AccountRef: { value: accountId } } } : l));
  return { body: { Id: p.Id, SyncToken: p.SyncToken, sparse: true, PaymentType: p.PaymentType, AccountRef: p.AccountRef, Line }, amount: usd(cents), before: UNCATEGORIZED };
}

/** After the write: the total and every line's amount unchanged, the one line in its new account, the others where they were. */
export function checkCategorized(before: unknown, after: unknown, lineId: string, accountId: string): string | null {
  const b = obj(obj(before).Purchase), a = obj(obj(after).Purchase);
  if (toCents(b.TotalAmt) !== toCents(a.TotalAmt)) return "QuickBooks changed the expense's total.";
  const bl = arr(b.Line).map(obj), al = arr(a.Line).map(obj);
  if (bl.length !== al.length) return "QuickBooks changed the expense's lines.";
  const acct = (l: Json) => String(obj(obj(l.AccountBasedExpenseLineDetail).AccountRef).value ?? "");
  for (const l of bl) {
    const m = al.find((x) => String(x.Id ?? "") === String(l.Id ?? ""));
    if (!m || toCents(m.Amount) !== toCents(l.Amount)) return "QuickBooks changed a line's amount.";
    if (String(l.Id) === lineId ? acct(m) !== accountId : acct(m) !== acct(l)) return "QuickBooks put a line in a different account than approved.";
  }
  return null;
}
