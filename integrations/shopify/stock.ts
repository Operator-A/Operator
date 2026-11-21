import "server-only";
// Stock of tracked items by location, read-only, for store actions (docs/shopify-actions.md, slice 2):
// read through our Shopify MCP server, one fixed query there. Each row carries the ids a stock change
// names and the available count the change is staged against.
import { callMcpTool } from "@/integrations/mcp";

type Level = { location: { id: string; name: string }; quantities: { name: string; quantity: number }[] };
type Item = { id: string; tracked: boolean; sku: string | null; variant: { title: string; product: { title: string; status: string } | null } | null; inventoryLevels: { nodes: Level[] } };

export type StockRow = { item: string; location: string; locationName: string; name: string; sku: string | null; available: number; onHand: number | null };

/** "Product · Variant", or the product alone when it has only Shopify's default variant. */
export const variantName = (v: { title: string; product: { title: string } | null }) => {
  const p = v.product?.title ?? "", t = v.title === "Default Title" ? "" : v.title;
  return [p, t].filter(Boolean).join(" · ") || "Item";
};

/** Tracked items of active products, one row per location, up to `max` rows. */
export async function stockLevels(max = 200): Promise<StockRow[]> {
  const out: StockRow[] = [];
  let after: string | null = null, pages = 0;
  do {
    type R = { inventoryItems: { nodes: Item[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    const r = (await callMcpTool("shopify", "shopify_stock_levels", { after })) as R;
    for (const it of r.inventoryItems.nodes) {
      if (!it.tracked || !it.variant || (it.variant.product && it.variant.product.status !== "ACTIVE")) continue;
      for (const l of it.inventoryLevels.nodes) {
        const q = (n: string) => l.quantities.find((x) => x.name === n)?.quantity;
        const available = q("available");
        if (typeof available !== "number") continue;
        out.push({ item: it.id, location: l.location.id, locationName: l.location.name, name: variantName(it.variant), sku: it.sku, available, onHand: q("on_hand") ?? null });
      }
    }
    after = r.inventoryItems.pageInfo.hasNextPage ? r.inventoryItems.pageInfo.endCursor : null;
  } while (after && out.length < max && ++pages < 10);
  return out.slice(0, max);
}
