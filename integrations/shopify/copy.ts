import "server-only";
// Active products with their copy, read-only, for copy changes (docs/shopify-actions.md, slice 3): read
// through our Shopify MCP server, one fixed query there. Each product carries the fingerprint of its copy
// (so a change knows what it was written against) and the facts its own Shopify data allows.
import { callMcpTool } from "@/integrations/mcp";
import { factsOf, printOf, type CopyFacts, type CopyProduct } from "@/core/shopify-actions";

export type CopyRow = {
  id: string; title: string; type: string | null; vendor: string | null; tags: string[];
  description: string; seoTitle: string; seoDescription: string; print: string; facts: CopyFacts;
};

/** Active products, up to `max`, by title. */
export async function productCopy(max = 50): Promise<CopyRow[]> {
  const out: CopyRow[] = [];
  let after: string | null = null, pages = 0;
  do {
    type R = { products: { nodes: CopyProduct[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    const r = (await callMcpTool("shopify", "shopify_product_copy", { after })) as R;
    for (const p of r.products.nodes) {
      out.push({
        id: p.id, title: p.title, type: p.productType || null, vendor: p.vendor || null, tags: p.tags,
        description: (p.description ?? "").trim(), seoTitle: p.seo?.title ?? "", seoDescription: p.seo?.description ?? "",
        print: printOf(p), facts: factsOf(p),
      });
    }
    after = r.products.pageInfo.hasNextPage ? r.products.pageInfo.endCursor : null;
  } while (after && out.length < max && ++pages < 4);
  return out.slice(0, max);
}
