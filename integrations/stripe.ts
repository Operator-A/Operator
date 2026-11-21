import "server-only";
// Stripe, reads (card 240, docs/mcp-everywhere.md "Stripe"). Calls our own Stripe server through
// integrations/mcp.ts on the business's restricted read key. Each call runs one fixed request and
// the totals come back worked out in code (core/stripe-rules.ts).
import { callMcpTool } from "./mcp";
import type { MoneyIn, OpenInvoice, StripePeriod, Subscriptions } from "@/core/stripe-rules";

export const stripeBalance = async () => (await callMcpTool("stripe", "stripe_balance", {})) as { currencies: { currency: string; available: number; pending: number }[] };
export const stripeMoneyIn = async (period: StripePeriod) => (await callMcpTool("stripe", "stripe_money_in", { period })) as MoneyIn;
export const stripeSubscriptions = async (period: StripePeriod) => (await callMcpTool("stripe", "stripe_subscriptions", { period })) as Subscriptions;
export const stripeOpenInvoices = async (limit: number) =>
  (await callMcpTool("stripe", "stripe_open_invoices", { limit })) as { invoices: OpenInvoice[]; ids: string[]; open: number; overdue: number; overdue_amount: Record<string, number> };
export const stripeCustomers = async (limit: number) => (await callMcpTool("stripe", "stripe_customers", { limit })) as { customers: { id: string; label: string; currency: string | null }[] };
