// Mailchimp (card 252, docs/mcp-everywhere.md "Mailchimp"). Pure, so `npm run check:mcp` and
// `npm run check:policy` can test it.
//
// Two keys on our own server (integrations/mailchimp-server.ts), the way Klaviyo has a read sign-in and
// a drafts key:
// - "Mailchimp" (a key the owner makes, used by agents): the audiences with their counts, and campaign
//   reports. Rates are worked out here, never by a model. No member list, no email address.
// - "Mailchimp campaign drafts" (a second key, held only by the gateway): one write, a draft campaign to
//   one of the business's own audiences after an approver approves. The owner sends it from Mailchimp.
// Mailchimp has no narrower key: every key reaches the whole account. So our server is the limit: it
// has exactly these calls, no send, schedule, test or delete call, and the account's data centre comes
// from the key's own suffix, checked against a fixed shape, so the host can't be steered.

import { CAMPAIGN_FIELDS, CAMPAIGN_LIMITS, refuseCampaign, type CampaignArgs } from "@/core/klaviyo-draft-rules";
import { REPORT_PERIODS } from "@/core/mcp-rules";

export const MAILCHIMP_TOOLS = ["mailchimp_audiences", "mailchimp_campaigns", "mailchimp_setup"] as const;
export const DRAFT_TOOL = "mailchimp_create_draft";
export { CAMPAIGN_FIELDS as MC_FIELDS, CAMPAIGN_LIMITS as MC_LIMITS };
export type McPeriod = (typeof REPORT_PERIODS)[number];
const DAYS: Record<McPeriod, number> = { last_7_days: 7, last_30_days: 30, last_90_days: 90, last_365_days: 365 };

/** A Mailchimp API key: 32 hex characters, a dash, and the account's data centre (us1 … us99). */
export const looksLikeMailchimpKey = (k: string) => /^[0-9a-f]{32}-us\d{1,3}$/.test(k.trim());
/** The API's base address for a key, from its own suffix only. */
export function baseOf(key: string): string {
  const k = key.trim();
  if (!looksLikeMailchimpKey(k)) throw new Error("not a Mailchimp API key");
  return `https://${k.split("-")[1]}.api.mailchimp.com/3.0`;
}

/** Mailchimp audience (list) ids are short letters and digits (for example "a1b2c3d4e5"). */
export const audienceIdOk = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9]{6,20}$/.test(s);

/** A read tool's input, checked again on our server. Anything not named here is refused. */
export function checkMailchimpArgs(tool: string, raw: unknown): { tool: "mailchimp_audiences" } | { tool: "mailchimp_setup" } | { tool: "mailchimp_campaigns"; period: McPeriod } | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed: Record<string, string[]> = { mailchimp_audiences: [], mailchimp_campaigns: ["period"], mailchimp_setup: [] };
  if (!(tool in allowed)) return { problem: `${tool || "that"} isn't a Mailchimp read tool` };
  const extra = Object.keys(a).filter((k) => !allowed[tool].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  if (tool === "mailchimp_audiences") return { tool: "mailchimp_audiences" };
  if (tool === "mailchimp_setup") return { tool: "mailchimp_setup" };
  const period = (a.period ?? "last_90_days") as McPeriod;
  if (!REPORT_PERIODS.includes(period)) return { problem: `period is one of ${REPORT_PERIODS.join(", ")}` };
  return { tool: "mailchimp_campaigns", period };
}

/** The first day a period covers, as Mailchimp's since_send_time takes it. */
export const sinceOf = (p: McPeriod, nowMs: number) => new Date(nowMs - DAYS[p] * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "+00:00");

/** What the server asks Mailchimp for: counts and names, never a member or an email address. */
export const AUDIENCE_FIELDS = "lists.id,lists.name,lists.stats.member_count,lists.stats.unsubscribe_count,lists.stats.campaign_count,total_items";
export const REPORT_FIELDS = "reports.id,reports.campaign_title,reports.subject_line,reports.list_id,reports.list_name,reports.send_time,reports.emails_sent,reports.unsubscribed,reports.opens.unique_opens,reports.clicks.unique_subscriber_clicks,reports.ecommerce.total_orders,reports.ecommerce.total_revenue";

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const plain = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
/** Per 100 sent, to one decimal, worked out here. */
export const per100 = (n: number, sent: number) => (sent > 0 ? Math.round((n / sent) * 1000) / 10 : 0);

export interface Audience { id: string; name: string; members: number; unsubscribed: number; campaigns: number }
export function readAudiences(j: unknown): Audience[] {
  const lists = ((j ?? {}) as { lists?: { id?: unknown; name?: unknown; stats?: Record<string, unknown> }[] }).lists ?? [];
  return lists.filter((l) => audienceIdOk(l.id)).slice(0, 100).map((l) => ({ id: String(l.id), name: plain(l.name, 100), members: num(l.stats?.member_count), unsubscribed: num(l.stats?.unsubscribe_count), campaigns: num(l.stats?.campaign_count) }));
}

export interface CampaignRow { id: string; title: string; subject: string; audience: string; sent_at: string; sent: number; opens: number; clicks: number; unsubscribes: number; orders: number; revenue: number; opens_per_100: number; clicks_per_100: number; unsubscribes_per_100: number }
/** Campaign reports with rates and totals worked out here. Titles and subjects were written by the business, but may quote anyone, so they are cut. */
export function readReports(j: unknown) {
  const reps = ((j ?? {}) as { reports?: Record<string, unknown>[] }).reports ?? [];
  const campaigns: CampaignRow[] = reps.slice(0, 100).map((r) => {
    const sent = num(r.emails_sent), opens = num((r.opens as Record<string, unknown> | undefined)?.unique_opens), clicks = num((r.clicks as Record<string, unknown> | undefined)?.unique_subscriber_clicks), unsubscribes = num(r.unsubscribed);
    const ecom = (r.ecommerce ?? {}) as Record<string, unknown>;
    return { id: plain(r.id, 80), title: plain(r.campaign_title, 100), subject: plain(r.subject_line, 150), audience: plain(r.list_name, 100), sent_at: plain(r.send_time, 30), sent, opens, clicks, unsubscribes, orders: num(ecom.total_orders), revenue: Math.round(num(ecom.total_revenue) * 100) / 100, opens_per_100: per100(opens, sent), clicks_per_100: per100(clicks, sent), unsubscribes_per_100: per100(unsubscribes, sent) };
  });
  const t = campaigns.reduce((s, c) => ({ sent: s.sent + c.sent, opens: s.opens + c.opens, clicks: s.clicks + c.clicks, unsubscribes: s.unsubscribes + c.unsubscribes, orders: s.orders + c.orders, revenue: s.revenue + c.revenue }), { sent: 0, opens: 0, clicks: 0, unsubscribes: 0, orders: 0, revenue: 0 });
  return { campaigns, totals: { campaigns: campaigns.length, ...t, revenue: Math.round(t.revenue * 100) / 100, opens_per_100: per100(t.opens, t.sent), clicks_per_100: per100(t.clicks, t.sent), unsubscribes_per_100: per100(t.unsubscribes, t.sent) } };
}

/** Why a Mailchimp campaign's words are refused: the Klaviyo draft's rules, plus no Mailchimp merge tags (code adds the only ones). */
export function refuseMailchimpCampaign(args: Record<string, unknown>): string | null {
  const no = refuseCampaign(args);
  if (no) return no.replace("the list is picked from Email lists", "the audience is picked from Mailchimp audiences");
  const { subject, preview, body } = args as Partial<CampaignArgs>;
  if (/\*\||\|\*/.test(`${subject}${preview}${body}`)) return "A campaign may not hold Mailchimp merge tags: code adds the unsubscribe line.";
  return null;
}

/** What the server accepts for its one write tool, checked again there. */
export function checkMcDraftArgs(raw: unknown): { audienceId: string; subject: string; preview: string; body: string } | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!audienceIdOk(a.audienceId)) return { problem: "audienceId must be a Mailchimp audience id" };
  const { audienceId, ...words } = a;
  const no = refuseMailchimpCampaign(words);
  if (no) return { problem: no };
  return { audienceId: audienceId as string, subject: String(a.subject), preview: String(a.preview), body: String(a.body) };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The campaign's HTML: the approved body, escaped, then Mailchimp's unsubscribe link and the audience's address, which code adds (never the model). */
export function mcCampaignHtml(body: string): string {
  const paras = body.trim().split(/\n\s*\n/).map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`);
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5">${paras.join("")}<p style="font-size:12px;color:#777"><a href="*|UNSUB|*">Unsubscribe</a> · *|LIST:ADDRESSLINE|*</p></body></html>`;
}
/** The draft's title in Mailchimp, so the owner can tell it came from an agent. */
export const mcCampaignTitle = (subject: string, date: string) => `Draft from OPERATOR · ${date} · ${subject}`.slice(0, 100);

/**
 * The setup check's read (card 284): three fixed GETs, settings only, never a member or an email address.
 * Classic automations (Mailchimp's API doesn't list Customer Journeys), each audience's welcome and
 * double opt-in settings, and connected stores with their abandoned cart and browse automations.
 */
export const SETUP_PATHS = {
  automations: "/automations?count=100&fields=automations.id,automations.status,automations.settings.title,automations.trigger_settings.workflow_type,automations.emails_sent,total_items",
  lists: "/lists?count=100&fields=lists.id,lists.double_optin,lists.has_welcome,lists.stats.member_count,total_items",
  stores: "/ecommerce/stores?count=20&fields=stores.id,stores.platform,stores.is_syncing,stores.automations,total_items",
} as const;
export const MAILCHIMP_SETUP_KEYS = [
  "audiences", "members", "audiences_double_optin", "audiences_with_welcome",
  "automations", "automations_sending", "automations_paused", "automations_welcome", "automations_abandoned_cart", "automations_after_purchase",
  "stores", "stores_syncing", "store_abandoned_cart_on", "store_abandoned_browse_on",
] as const;
export type McSetupNumbers = Partial<Record<(typeof MAILCHIMP_SETUP_KEYS)[number], number>>;
export interface McAutomation { title: string; status: string; type: string; sent: number }

const rows = (v: unknown, key: string): Record<string, unknown>[] => {
  const a = (v && typeof v === "object" ? (v as Record<string, unknown>)[key] : null);
  return Array.isArray(a) ? a.filter((x): x is Record<string, unknown> => !!x && typeof x === "object") : [];
};
const sub = (v: unknown) => (v && typeof v === "object" ? v as Record<string, unknown> : {});
const AFTER_PURCHASE = new Set(["firstPurchase", "purchaseFollowup", "productFollowup", "categoryFollowup", "bestCustomers"]);

/**
 * Counts from the three reads, worked out here. A part Mailchimp refused (null) leaves its keys out and
 * is listed in unread, never a zero. Automation titles are the business's own words: untrusted.
 */
export function readMcSetup(automations: unknown | null, lists: unknown | null, stores: unknown | null): { totals: McSetupNumbers; automations: McAutomation[] | null; unread: string[] } {
  const totals: McSetupNumbers = {};
  const unread: string[] = [];
  let autos: McAutomation[] | null = null;
  if (lists == null) unread.push("audiences");
  else {
    const ls = rows(lists, "lists");
    totals.audiences = ls.length;
    totals.members = ls.reduce((n, l) => n + num(sub(l.stats).member_count), 0);
    totals.audiences_double_optin = ls.filter((l) => l.double_optin === true).length;
    totals.audiences_with_welcome = ls.filter((l) => l.has_welcome === true).length;
  }
  if (automations == null) unread.push("automations");
  else {
    autos = rows(automations, "automations").slice(0, 100).map((a) => ({ title: plain(sub(a.settings).title, 80), status: plain(a.status, 12), type: plain(sub(a.trigger_settings).workflow_type, 30), sent: num(a.emails_sent) }));
    totals.automations = autos.length;
    totals.automations_sending = autos.filter((a) => a.status === "sending").length;
    totals.automations_paused = autos.filter((a) => a.status === "paused").length;
    totals.automations_welcome = autos.filter((a) => a.status === "sending" && /^welcome/i.test(a.type)).length;
    totals.automations_abandoned_cart = autos.filter((a) => a.status === "sending" && a.type === "abandonedCart").length;
    totals.automations_after_purchase = autos.filter((a) => a.status === "sending" && AFTER_PURCHASE.has(a.type)).length;
  }
  if (stores == null) unread.push("stores");
  else {
    const ss = rows(stores, "stores");
    const on = (s: Record<string, unknown>, k: string) => plain(sub(sub(s.automations)[k]).status, 12) === "sending";
    totals.stores = ss.length;
    totals.stores_syncing = ss.filter((s) => s.is_syncing === true).length;
    totals.store_abandoned_cart_on = ss.filter((s) => on(s, "abandoned_cart")).length;
    totals.store_abandoned_browse_on = ss.filter((s) => on(s, "abandoned_browse")).length;
  }
  return { totals, automations: autos, unread };
}
