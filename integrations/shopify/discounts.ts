import "server-only";
// Discount codes, read-only, for staging a new one (docs/shopify-actions.md, slice 4): read through our
// Shopify MCP server, one fixed query there. Each row says whether an agent made it, so a new code isn't a
// duplicate and the live cap can be seen. No customer data.
import { callMcpTool } from "@/integrations/mcp";
import { DISCOUNT_TAG } from "@/core/shopify-actions";

type Node = { id: string; codeDiscount: {
  __typename: string; title?: string; status?: string; startsAt?: string | null; endsAt?: string | null;
  usageLimit?: number | null; asyncUsageCount?: number; tags?: string[]; codes?: { nodes: { code: string }[] };
  customerGets?: { value: { __typename: string; percentage?: number; amount?: { amount: string; currencyCode: string } } };
} | null };

export type DiscountRow = { code: string | null; title: string; kind: string; status: string; starts: string | null; ends: string | null; off: string | null; usesLimit: number | null; used: number | null; byAgent: boolean };

const KIND: Record<string, string> = { DiscountCodeBasic: "amount or percent off", DiscountCodeBxgy: "buy X get Y", DiscountCodeFreeShipping: "free shipping", DiscountCodeApp: "app" };

/** Discount codes, newest first, up to `max`. */
export async function discountCodes(max = 100): Promise<DiscountRow[]> {
  const out: DiscountRow[] = [];
  let after: string | null = null, pages = 0;
  do {
    type R = { codeDiscountNodes: { nodes: Node[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } };
    const r = (await callMcpTool("shopify", "shopify_discount_codes", { after })) as R;
    for (const n of r.codeDiscountNodes.nodes) {
      const d = n.codeDiscount;
      if (!d) continue;
      const v = d.customerGets?.value;
      const off = v?.__typename === "DiscountPercentage" && typeof v.percentage === "number" ? `${Math.round(v.percentage * 1000) / 10}%` : v?.amount ? `${v.amount.amount} ${v.amount.currencyCode}` : null;
      out.push({
        code: d.codes?.nodes[0]?.code ?? null, title: d.title ?? "", kind: KIND[d.__typename] ?? d.__typename, status: (d.status ?? "").toLowerCase(),
        starts: d.startsAt?.slice(0, 10) ?? null, ends: d.endsAt?.slice(0, 10) ?? null, off,
        usesLimit: d.usageLimit ?? null, used: typeof d.asyncUsageCount === "number" ? d.asyncUsageCount : null, byAgent: (d.tags ?? []).includes(DISCOUNT_TAG),
      });
    }
    after = r.codeDiscountNodes.pageInfo.hasNextPage ? r.codeDiscountNodes.pageInfo.endCursor : null;
  } while (after && out.length < max && ++pages < 2);
  return out.slice(0, max);
}
