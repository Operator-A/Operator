import { requireSession } from "@/dashboard/data";
import { marketData } from "@/dashboard/packMarket";
import { readFilter } from "@/core/pack-market-rules";
import { averyDeptHref } from "@/dashboard/company-rules";
import { PackMarket } from "@/dashboard/components/packMarket";

// Packs (docs/packs.md, packs slice 4; approved mockup screen 1): every pack this business can add, searchable and
// filtered by kind and by the tools it reads. Each card opens the pack's page. One read round.
export default async function Packs({ searchParams }: { searchParams: Promise<{ kind?: string; tool?: string; q?: string }> }) {
  const [sp, , data] = await Promise.all([searchParams, requireSession(), marketData()]);
  return (
    <div className="dp pm">
      <div className="pm-h">
        <span className="pm-crumb">Company › Packs</span>
        <h1 className="h1">Packs</h1>
        <span className="muted">Departments and agents you can add. Everything starts off.</span>
      </div>
      <PackMarket cards={data.cards} chips={data.chips} start={readFilter(sp, data.chips.map((c) => c.id))} averyHref={averyDeptHref()} />
    </div>
  );
}
