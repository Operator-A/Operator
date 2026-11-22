import "server-only";
// Recent paid orders, read-only, for a refund (docs/shopify-actions.md, slice 6): read through our Shopify
// MCP server, one fixed query there. Each order says whether it can be refunded here and, if so, Shopify's
// own full refund and each item's refundable quantity and price per unit with tax. No names or addresses.
import { callMcpTool } from "@/integrations/mcp";
import { cents, refundable } from "@/core/shopify-actions";

type Money = { shopMoney: { amount: string } };
type Node = {
  id: string; name: string; createdAt: string; cancelledAt: string | null; test: boolean; displayFinancialStatus: string; currencyCode: string;
  totalPriceSet: Money; totalRefundedSet: Money;
  suggestedRefund: { amountSet: { shopMoney: { amount: string; currencyCode: string } } } | null;
  lineItems: { nodes: { id: string; name: string; quantity: number; refundableQuantity: number; discountedUnitPriceAfterAllDiscountsSet: Money; taxLines: { priceSet: Money }[] }[] };
};
/** One item that can still be refunded: its line, name, how many are left and cents per unit (after discounts, with tax). */
export type RefundItem = { id: string; name: string; left: number; unitCents: number };
export type RefundRow = { id: string; name: string; createdAt: string; totalCents: number; refundedCents: number; fullCents: number; items: RefundItem[]; not: string | null };

/** Paid or partly refunded orders from the last 60 days, newest first, up to `max`. */
export async function ordersToRefund(max = 50, now = new Date()): Promise<RefundRow[]> {
  const out: RefundRow[] = [];
  let after: string | null = null, pages = 0;
  do {
    type R = { orders: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    const r = (await callMcpTool("shopify", "shopify_orders_to_refund", { after })) as R;
    for (const o of r.orders.nodes) {
      const items: RefundItem[] = o.lineItems.nodes.filter((l) => l.refundableQuantity > 0 && l.quantity > 0).map((l) => {
        const tax = l.taxLines.reduce((n, t) => n + cents(t.priceSet.shopMoney.amount), 0);
        return { id: l.id, name: l.name, left: l.refundableQuantity, unitCents: cents(l.discountedUnitPriceAfterAllDiscountsSet.shopMoney.amount) + Math.round(tax / l.quantity) };
      });
      const full = o.suggestedRefund && o.suggestedRefund.amountSet.shopMoney.currencyCode === "USD" ? cents(o.suggestedRefund.amountSet.shopMoney.amount) : 0;
      const not = refundable(o, now) ?? (full < 1 && !items.length ? "nothing left to refund" : null);
      out.push({ id: o.id, name: o.name, createdAt: o.createdAt, totalCents: cents(o.totalPriceSet.shopMoney.amount), refundedCents: cents(o.totalRefundedSet.shopMoney.amount), fullCents: full, items, not });
    }
    after = r.orders.pageInfo.hasNextPage ? r.orders.pageInfo.endCursor : null;
  } while (after && out.length < max && ++pages < 4);
  return out.slice(0, max);
}
