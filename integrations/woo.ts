import "server-only";
// WooCommerce, reads (card 254, docs/mcp-everywhere.md). Calls our own WooCommerce server through
// integrations/mcp.ts on the agents' Read key. The one write, a private order note, is the gateway's
// (core/gateway, "WooCommerce order notes" key), never called here.
import { callMcpTool } from "./mcp";
import type { OrderRow, WooPeriod } from "@/core/woo-rules";

export const wooOrders = async (period: WooPeriod) =>
  (await callMcpTool("woo", "woo_orders", { period })) as { orders: OrderRow[]; totals: Record<string, number>; best_sellers: { product: string; quantity: number; revenue: number }[]; truncated: boolean };

export const wooLowStock = async (atOrBelow: number) =>
  (await callMcpTool("woo", "woo_low_stock", { at_or_below: atOrBelow })) as { products: { product: string; sku: string; in_stock: number; status: string }[]; at_or_below: number; truncated: boolean };
