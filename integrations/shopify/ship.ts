import "server-only";
// Open, unshipped orders, read-only, for marking an order shipped (docs/shopify-actions.md, slice 5): read
// through our Shopify MCP server, one fixed query there. Each order says whether it can be marked shipped
// here and, if so, the fulfillment orders a ship change names. No names or addresses.
import { callMcpTool } from "@/integrations/mcp";
import { shippable, type ShipOrder } from "@/core/shopify-actions";

export type ShipRow = { id: string; name: string; createdAt: string | null; fos: string[]; items: number; from: string | null; not: string | null };

/** Open, unshipped orders, newest first, up to `max`. */
export async function ordersToShip(max = 50): Promise<ShipRow[]> {
  const out: ShipRow[] = [];
  let after: string | null = null, pages = 0;
  do {
    type R = { orders: { nodes: ShipOrder[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    const r = (await callMcpTool("shopify", "shopify_orders_to_ship", { after })) as R;
    for (const o of r.orders.nodes) {
      const s = shippable(o);
      out.push("not" in s
        ? { id: o.id, name: o.name, createdAt: o.createdAt ?? null, fos: [], items: 0, from: null, not: s.not }
        : { id: o.id, name: o.name, createdAt: o.createdAt ?? null, fos: s.fos, items: s.items, from: s.from, not: null });
    }
    after = r.orders.pageInfo.hasNextPage ? r.orders.pageInfo.endCursor : null;
  } while (after && out.length < max && ++pages < 4);
  return out.slice(0, max);
}
