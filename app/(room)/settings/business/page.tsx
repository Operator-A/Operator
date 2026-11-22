// Settings > Business (docs/settings.md): what every agent is told, where things go, what agents may
// say about the products, and where daily numbers come from. Owners edit; everyone else reads.
import { requireSession } from "@/dashboard/data";
import { listMembers } from "@/core/members";
import { BusinessForm, DailyNumbersForm, ProductFactsForm, WhereForm } from "@/dashboard/components/settingsForms";
import { SectionHead } from "@/dashboard/components/settingsHead";
import { saveBusinessProfile, saveDailyNumbers, saveProductFacts, saveWhereThingsGo } from "@/dashboard/orgActions";
import { ownMeasureDefs } from "@/core/goals";
import { settings } from "@/core/settings";
import { NO_SETTINGS } from "@/core/settings-rules";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS } from "@/core/business-rules";

export default async function Business() {
  const [me, members, biz, own, ownNumbers] = await Promise.all([requireSession(), listMembers().catch(() => null), loadBusiness().catch(() => UNKNOWN_BUSINESS), settings().catch(() => NO_SETTINGS), ownMeasureDefs().catch(() => [])]);
  const owner = me.role === "owner";
  const where = { ownerEmail: own.ownerEmail ?? "", siteUrl: own.siteUrl ?? "", shopifyDomain: own.shopifyDomain ?? "", shopifyClientId: own.shopifyClientId ?? "", mercuryAccountIds: own.mercuryAccountIds.join(", "), notionBriefParent: own.notionBriefParent ?? "", notionBriefsDb: own.notionBriefsDb ?? "", notionLeadsParent: own.notionLeadsParent ?? "", notionBooksParent: own.notionBooksParent ?? "" };
  return (
    <>
      <SectionHead title="Business" sub="What your agents know about the business, and where their work goes." />
      <div className="card set-card pad" id="profile">
        <span className="card-t">The business</span>
        <span className="sub">What every agent is told about who it works for, at the top of each run. Keep it to facts you’d put on your website.</span>
        <BusinessForm initial={{ name: biz.name, about: biz.about ?? "", ownerName: biz.ownerName ?? "" }} canEdit={owner} save={saveBusinessProfile} />
      </div>

      <div className="card set-card pad" id="where">
        <span className="card-t">Where things go</span>
        <span className="sub">This business’s own addresses: where the brief and alerts are emailed, its website, its Shopify store and Mercury accounts, and the Notion pages reports go under. Sign-ins and keys stay on Connections.</span>
        <WhereForm initial={where} owners={(members ?? []).filter((m) => m.role === "owner").map((m) => m.email)} canEdit={owner} save={saveWhereThingsGo} />
      </div>

      <div className="card set-card pad" id="products">
        <span className="card-t">What agents may say about your products</span>
        <span className="sub">The only facts about your products an agent may put in an outside message, like a first email to a lead: the products in these Shopify collections, these product fields, and your offer terms. Nothing else is read from Shopify for it.</span>
        <ProductFactsForm initial={{ productCollections: own.productCollections.join(", "), productFields: own.productFields.join(", "), offerTerms: own.offerTerms ?? "" }} canEdit={owner} save={saveProductFacts} />
      </div>

      <div className="card set-card pad" id="numbers">
        <span className="card-t">Daily numbers</span>
        <span className="sub">Each morning code works out yesterday’s revenue, orders, average order, repeat rate and cash, for the brief and goals. Pick where cost of goods comes from, so margin can be worked out too.</span>
        <DailyNumbersForm initial={{ costSource: own.costSource, costNumber: own.costNumber ?? "" }} numbers={ownNumbers.filter((d) => d.unit === "usd").map((d) => ({ key: d.key, label: d.label }))} canEdit={owner} save={saveDailyNumbers} />
      </div>
    </>
  );
}
