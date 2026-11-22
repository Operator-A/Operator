import "server-only";
// QuickBooks Online, reads (card 241, docs/mcp-everywhere.md "QuickBooks"). Calls our own QuickBooks
// server through integrations/mcp.ts on the business's Intuit sign-in. Each call runs one fixed request
// and the totals come back worked out in code (core/quickbooks-rules.ts).
import { callMcpTool } from "./mcp";
import type { ExpenseAccount, ProfitLoss, QboPeriod, Receivables, UncategorizedLine, UnpaidBill } from "@/core/quickbooks-rules";

export const qboProfitLoss = async (period: QboPeriod) => (await callMcpTool("quickbooks", "quickbooks_profit_loss", { period })) as ProfitLoss;
export const qboUncategorized = async (days: number, limit: number) =>
  (await callMcpTool("quickbooks", "quickbooks_uncategorized", { days, limit })) as { lines: UncategorizedLine[]; count: number; total: number; cut: boolean };
export const qboExpenseAccounts = async () => (await callMcpTool("quickbooks", "quickbooks_expense_accounts", {})) as { accounts: ExpenseAccount[] };
export const qboUnpaidBills = async (limit: number) =>
  (await callMcpTool("quickbooks", "quickbooks_unpaid_bills", { limit })) as { bills: UnpaidBill[]; open: number; owed: number; overdue: number; overdue_amount: number; due_soon: number; due_soon_amount: number; due_soon_days: number; cut: boolean };
export const qboReceivables = async (limit: number) => (await callMcpTool("quickbooks", "quickbooks_receivables", { limit })) as Receivables;
