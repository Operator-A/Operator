import "server-only";
// QuickBooks Online, reads (card 241, docs/mcp-everywhere.md "QuickBooks"). Calls our own QuickBooks
// server through integrations/mcp.ts on the business's Intuit sign-in. Each call runs one fixed request
// and the totals come back worked out in code (core/quickbooks-rules.ts).
import { callMcpTool } from "./mcp";
import type { ExpenseAccount, ProfitLoss, QboPeriod, UncategorizedLine } from "@/core/quickbooks-rules";

export const qboProfitLoss = async (period: QboPeriod) => (await callMcpTool("quickbooks", "quickbooks_profit_loss", { period })) as ProfitLoss;
export const qboUncategorized = async (days: number, limit: number) =>
  (await callMcpTool("quickbooks", "quickbooks_uncategorized", { days, limit })) as { lines: UncategorizedLine[]; count: number; total: number; cut: boolean };
export const qboExpenseAccounts = async () => (await callMcpTool("quickbooks", "quickbooks_expense_accounts", {})) as { accounts: ExpenseAccount[] };
