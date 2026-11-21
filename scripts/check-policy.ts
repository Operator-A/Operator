// Exercises the gateway caps (core/gateway/policy.ts) with a table of cases. Run: npm run check:policy
import { ANNOTATE, CALENDAR_HOLD, CAMPAIGN_DRAFT, MAILCHIMP_DRAFT, WOO_NOTE, HUBSPOT_MOVE, DRAFT_EMAIL, SHOPIFY_TAGS, TOOLS, refuseAgent, refuseCampaignTo, type ActionDef, capChange, checkEmail, checkPurchase, effectiveCap, refuseDraftTo, refuseProposal } from "../core/gateway/policy";
let fails = 0; const t = (n: string, c: boolean) => { if (!c) { fails++; console.log("FAIL", n); } else console.log("ok  ", n); };
const vendors = [{ id: "v1", name: "Royal", mercury_recipient_id: "r1" }, { id: "v2", name: "NoRecip", mercury_recipient_id: null }];
const base = { vendors, monthSpentUsd: 0, paidVendorIds: new Set<string>(), maxPurchaseUsd: 500, maxMonthlyUsd: 1500 };
const r1 = checkPurchase({ ...base, amountUsd: 200, vendorId: "v1" });
t("ok purchase, first payment flagged", r1.ok && r1.firstPayment);
const r2 = checkPurchase({ ...base, amountUsd: 200, vendorId: "v1", paidVendorIds: new Set(["v1"]) });
t("repeat payee not first", r2.ok && !r2.firstPayment);
t("unknown payee refused", !checkPurchase({ ...base, amountUsd: 10, vendorId: "zzz" }).ok);
t("no recipient refused", !checkPurchase({ ...base, amountUsd: 10, vendorId: "v2" }).ok);
t("over per-purchase refused", !checkPurchase({ ...base, amountUsd: 500.01, vendorId: "v1" }).ok);
t("exactly 500 ok", checkPurchase({ ...base, amountUsd: 500, vendorId: "v1" }).ok);
t("over month refused", !checkPurchase({ ...base, amountUsd: 300, vendorId: "v1", monthSpentUsd: 1200.01 }).ok);
t("month exactly ok", checkPurchase({ ...base, amountUsd: 300, vendorId: "v1", monthSpentUsd: 1200 }).ok);
t("zero refused", !checkPurchase({ ...base, amountUsd: 0, vendorId: "v1" }).ok);
t("negative refused", !checkPurchase({ ...base, amountUsd: -5, vendorId: "v1" }).ok);
t("NaN refused", !checkPurchase({ ...base, amountUsd: NaN, vendorId: "v1" }).ok);
const sup = new Set(["stop@x.com"]);
t("email ok", checkEmail({ to: "a@b.com", suppressed: sup, sentToday: 0, maxPerDay: 20 }).ok);
t("suppressed refused (case)", !checkEmail({ to: " STOP@x.com ", suppressed: sup, sentToday: 0, maxPerDay: 20 }).ok);
t("cap reached refused", !checkEmail({ to: "a@b.com", suppressed: sup, sentToday: 20, maxPerDay: 20 }).ok);
t("dept cap reached refused", !checkEmail({ to: "a@b.com", suppressed: sup, sentToday: 3, maxPerDay: 20, dept: { name: "Sales", sentToday: 5, maxPerDay: 5 } }).ok);
t("dept under cap ok", checkEmail({ to: "a@b.com", suppressed: sup, sentToday: 3, maxPerDay: 20, dept: { name: "Sales", sentToday: 4, maxPerDay: 5 } }).ok);
t("dept cap never above company cap", !checkEmail({ to: "a@b.com", suppressed: sup, sentToday: 3, maxPerDay: 4, dept: { name: "Sales", sentToday: 4, maxPerDay: 50 } }).ok);
t("bad address refused",!checkEmail({ to: "nope", suppressed: sup, sentToday: 0, maxPerDay: 20 }).ok);
t("effective holds ceiling", effectiveCap("max_purchase_usd", 9999) === 500);
t("effective missing -> start", effectiveCap("max_emails_per_day", null) === 20);
t("effective string", effectiveCap("max_monthly_spend_usd", "1000") === 1000);
t("undo below floor held", effectiveCap("undo_window_minutes", 5) === 30);
t("lower purchase ok, not looser", (() => { const c = capChange("max_purchase_usd", 500, 300); return "looser" in c && !c.looser; })());
t("raise within ceiling looser", (() => { const c = capChange("max_purchase_usd", 300, 400); return "looser" in c && c.looser; })());
t("raise past ceiling refused", "refuse" in capChange("max_purchase_usd", 500, 501));
t("emails fraction refused", "refuse" in capChange("max_emails_per_day", 20, 10.5));
t("cents fraction refused", "refuse" in capChange("max_purchase_usd", 500, 100.555));
t("undo shorter than floor refused", "refuse" in capChange("undo_window_minutes", 30, 20));
t("undo longer ok, not looser", (() => { const c = capChange("undo_window_minutes", 30, 60); return "looser" in c && !c.looser; })());
t("undo back shorter looser", (() => { const c = capChange("undo_window_minutes", 60, 30); return "looser" in c && c.looser; })());
t("unknown key refused", "refuse" in capChange("max_refund_usd", 0, 5));
t("same value refused", "refuse" in capChange("max_emails_per_day", 20, 20));
// Gmail drafts (slice 7): only Rowan, a lead id, subject and body only, no links; the recipient comes from the leads list
const lead = "0b5f7a52-1c1e-4d1a-9a59-3f1f0a8c2d11";
const draft = { subject: "Coffee for Fleet", body: "Hi Ana,\n\nWould a free tasting help?\n\nSam\nAcme Coffee" };
t("draft ok for Rowan", refuseProposal("wholesale_hunter", DRAFT_EMAIL, lead, draft) === null);
t("draft refused for Quinn", refuseProposal("bookkeeper", DRAFT_EMAIL, lead, draft) !== null);
t("draft refused with a recipient field", refuseProposal("wholesale_hunter", DRAFT_EMAIL, lead, { ...draft, to: "x@y.com" }) !== null);
t("draft refused with a link", refuseProposal("wholesale_hunter", DRAFT_EMAIL, lead, { ...draft, body: "see https://evil.example" }) !== null);
t("draft refused on a non-lead target", refuseProposal("wholesale_hunter", DRAFT_EMAIL, "ana@fleet.coffee", draft) !== null);
t("draft refused with a two-line subject", refuseProposal("wholesale_hunter", DRAFT_EMAIL, lead, { ...draft, subject: "a\nb" }) !== null);
t("first emails never promoted", TOOLS[DRAFT_EMAIL].tier === "Draft" && TOOLS[DRAFT_EMAIL].promotable === false);
// Klaviyo campaign drafts (card 159b): only the Campaign writer, a Klaviyo list id, subject, preview and body only, no links or tags
const camp = { subject: "New this week", preview: "Two picks for the weekend", body: "Hi,\n\nTwo things are back in stock.\n\nSam" };
t("campaign ok for the Campaign writer", refuseProposal("campaign_writer", CAMPAIGN_DRAFT, "XZRviM", camp) === null);
t("campaign refused for Rowan", refuseProposal("wholesale_hunter", CAMPAIGN_DRAFT, "XZRviM", camp) !== null);
t("campaign refused on a non-list target", refuseProposal("campaign_writer", CAMPAIGN_DRAFT, "../lists", camp) !== null);
t("campaign refused with an extra field", refuseProposal("campaign_writer", CAMPAIGN_DRAFT, "XZRviM", { ...camp, send_at: "now" }) !== null);
t("campaign refused with a link", refuseProposal("campaign_writer", CAMPAIGN_DRAFT, "XZRviM", { ...camp, body: "shop www.evil.example" }) !== null);
t("campaign refused with a template tag", refuseProposal("campaign_writer", CAMPAIGN_DRAFT, "XZRviM", { ...camp, body: "Hi {{ first_name }}" }) !== null);
t("campaign refused with a long subject", refuseProposal("campaign_writer", CAMPAIGN_DRAFT, "XZRviM", { ...camp, subject: "x".repeat(51) }) !== null);
t("campaign refused with a long preview", refuseProposal("campaign_writer", CAMPAIGN_DRAFT, "XZRviM", { ...camp, preview: "x".repeat(91) }) !== null);
t("campaign refused without preview", refuseProposal("campaign_writer", CAMPAIGN_DRAFT, "XZRviM", { ...camp, preview: " " }) !== null);
t("campaign starts at Draft", TOOLS[CAMPAIGN_DRAFT].tier === "Draft");
// Shopify tags (docs/shopify-actions.md)
const ord = "gid://shopify/Order/5551234", tagsOk = { tags: ["VIP", "wholesale-2026"] };
const sh = (args: Record<string, unknown>, target = ord) => refuseProposal("b_ops_2", SHOPIFY_TAGS, target, args, 200, ["shopify_recent_orders", "shopify_tag"]);
t("tags start at Draft and may earn trust", TOOLS[SHOPIFY_TAGS].tier === "Draft" && TOOLS[SHOPIFY_TAGS].promotable);
t("tags refused for an agent that wasn't granted them", refuseProposal("b_ops_2", SHOPIFY_TAGS, ord, tagsOk, 200, ["shopify_recent_orders"]) !== null);
t("tags refused when the spec can't be read", refuseProposal("b_ops_2", SHOPIFY_TAGS, ord, tagsOk) !== null);
t("tags are a granted action, named by the builder's tool", TOOLS[SHOPIFY_TAGS].agents === "granted" && TOOLS[SHOPIFY_TAGS].grant === "shopify_tag");
t("tags ok on an order", sh(tagsOk) === null);
t("tags ok on a customer", sh(tagsOk, "gid://shopify/Customer/42") === null);
t("tags refused on a product", sh(tagsOk, "gid://shopify/Product/42") !== null);
t("tags refused on a raw id", sh(tagsOk, "5551234") !== null);
t("tags refused when empty", sh({ tags: [] }) !== null);
t("tags refused when more than 5", sh({ tags: ["a", "b", "c", "d", "e", "f"] }) !== null);
t("tags refused when too long", sh({ tags: ["x".repeat(41)] }) !== null);
t("tags refused with odd characters", sh({ tags: ["vip<script>"] }) !== null);
t("tags refused with a comma inside", sh({ tags: ["a,b"] }) !== null);
t("tags refused when repeated", sh({ tags: ["VIP", "vip"] }) !== null);
t("tags refused with an extra field", sh({ ...tagsOk, remove: ["old"] }) !== null);
t("tags refused when not a list", sh({ tags: "VIP" }) !== null);
t("campaign list must be the business's own", refuseCampaignTo("XZRviM", [{ id: "XZRviM" }]) === null && refuseCampaignTo("Other1", [{ id: "XZRviM" }]) !== null);
t("lead with address ok", refuseDraftTo({ email: "Ana@Fleet.coffee", stage: "new" }, new Set()) === null);
t("lead without address refused", refuseDraftTo({ email: null, stage: "new" }, new Set()) !== null);
t("suppressed lead refused", refuseDraftTo({ email: "ana@fleet.coffee", stage: "new" }, new Set(["ana@fleet.coffee"])) !== null);
t("lost lead refused", refuseDraftTo({ email: "ana@fleet.coffee", stage: "lost" }, new Set()) !== null);
// granted actions (card 250): any agent whose active spec holds the action's tool, refused otherwise
const granted: ActionDef = { agents: "granted", grant: "calendar_hold", tier: "Draft", fields: ["title"], promotable: true };
t("granted: agent holding the tool may propose", refuseAgent(granted, "calendar.hold", "b_sales_3", ["calendar_events", "calendar_hold"]) === null);
t("granted: agent without the tool refused", refuseAgent(granted, "calendar.hold", "b_sales_3", ["calendar_events"]) !== null);
t("granted: unreadable spec refused", refuseAgent(granted, "calendar.hold", "b_sales_3", null) !== null);
t("granted: no tool named refused", refuseAgent({ ...granted, grant: undefined }, "calendar.hold", "b_sales_3", ["calendar_hold"]) !== null);
t("named: grants never widen a named action", refuseAgent(TOOLS[ANNOTATE], ANNOTATE, "b_sales_3", ["mercury_propose_annotation"]) !== null);
t("named: Mercury writes stay CFO and Bookkeeper only", JSON.stringify(TOOLS[ANNOTATE].agents) === JSON.stringify(["bookkeeper", "cfo"]));
t("named: a granted spec doesn't let Rowan annotate", refuseProposal("wholesale_hunter", ANNOTATE, "00000000-0000-0000-0000-000000000000", { note: "x" }, 200, ["mercury_propose_annotation"]) !== null);
t("every action type starts at Draft", Object.values(TOOLS).every((d) => d.tier === "Draft"));
t("every granted action names its tool", Object.values(TOOLS as Record<string, ActionDef>).every((d) => d.agents !== "granted" || !!d.grant));

// calendar holds (card 251): the first granted action type
const nowMs = Date.parse("2026-11-24T14:52:00Z");
const hold = { title: "Write the newsletter", start: "2026-11-24T11:00:00-06:00", end: "2026-11-24T12:00:00-06:00" };
const holdAt = `${hold.start}/${hold.end}`;
t("hold: granted, Draft, promotable, given as calendar_hold", TOOLS[CALENDAR_HOLD].agents === "granted" && TOOLS[CALENDAR_HOLD].grant === "calendar_hold" && TOOLS[CALENDAR_HOLD].tier === "Draft" && TOOLS[CALENDAR_HOLD].promotable);
t("hold: ok for an agent given it", refuseProposal("b_ops_1", CALENDAR_HOLD, holdAt, hold, 200, ["calendar_free_time", "calendar_hold"], nowMs) === null);
t("hold: refused for an agent not given it", refuseProposal("b_ops_1", CALENDAR_HOLD, holdAt, hold, 200, ["calendar_free_time"], nowMs) !== null);
t("hold: refused when the spec can't be read", refuseProposal("bookkeeper", CALENDAR_HOLD, holdAt, hold, 200, null, nowMs) !== null);
t("hold: refused when the target isn't its own time", refuseProposal("b_ops_1", CALENDAR_HOLD, "2026-11-25T11:00:00-06:00/2026-11-25T12:00:00-06:00", hold, 200, ["calendar_hold"], nowMs) !== null);
t("hold: refused with a guest", refuseProposal("b_ops_1", CALENDAR_HOLD, holdAt, { ...hold, attendees: "x@y.example" }, 200, ["calendar_hold"], nowMs) !== null);
t("hold: refused in the past", refuseProposal("b_ops_1", CALENDAR_HOLD, holdAt, hold, 200, ["calendar_hold"], Date.parse("2026-11-24T18:00:00Z")) !== null);

// Mailchimp drafts (card 252): granted, to one of the business's audiences
t("mailchimp: granted, Draft, promotable", TOOLS[MAILCHIMP_DRAFT].agents === "granted" && TOOLS[MAILCHIMP_DRAFT].grant === "mailchimp_campaign_draft" && TOOLS[MAILCHIMP_DRAFT].tier === "Draft");
t("mailchimp: ok for an agent given it", refuseProposal("b_mkt_1", MAILCHIMP_DRAFT, "a1b2c3d4e5", camp, 200, ["mailchimp_campaign_draft"]) === null);
t("mailchimp: refused for an agent not given it", refuseProposal("campaign_writer", MAILCHIMP_DRAFT, "a1b2c3d4e5", camp, 200, []) !== null);
t("mailchimp: refused on a non-audience target", refuseProposal("b_mkt_1", MAILCHIMP_DRAFT, "../lists", camp, 200, ["mailchimp_campaign_draft"]) !== null);
t("mailchimp: refused with a merge tag", refuseProposal("b_mkt_1", MAILCHIMP_DRAFT, "a1b2c3d4e5", { ...camp, body: "Hi *|FNAME|*" }, 200, ["mailchimp_campaign_draft"]) !== null);

// WooCommerce order notes (card 254): granted, one private note on one order
t("woo: granted, Draft, promotable", TOOLS[WOO_NOTE].agents === "granted" && TOOLS[WOO_NOTE].grant === "woo_order_note" && TOOLS[WOO_NOTE].tier === "Draft" && TOOLS[WOO_NOTE].promotable);
t("woo: ok for an agent given it", refuseProposal("b_ops_1", WOO_NOTE, "1234", { note: "Ship Monday" }, 200, ["woo_order_note"]) === null);
t("woo: refused for an agent not given it", refuseProposal("b_ops_1", WOO_NOTE, "1234", { note: "Ship Monday" }, 200, ["woo_orders"]) !== null);
t("woo: refused on a non-order target", refuseProposal("b_ops_1", WOO_NOTE, "1234/refunds", { note: "x" }, 200, ["woo_order_note"]) !== null);
t("woo: refused when it would tell the customer", refuseProposal("b_ops_1", WOO_NOTE, "1234", { note: "x", customer_note: true }, 200, ["woo_order_note"]) !== null);
t("woo: refused with a link", refuseProposal("b_ops_1", WOO_NOTE, "1234", { note: "www.x.example" }, 200, ["woo_order_note"]) !== null);

// HubSpot deal moves (card 253): granted, a stage id and a note on one deal
const mv = { stage: "contractsent", note: "Signed the quote on the call." };
t("hubspot: granted, Draft, promotable", TOOLS[HUBSPOT_MOVE].agents === "granted" && TOOLS[HUBSPOT_MOVE].grant === "hubspot_move_deal" && TOOLS[HUBSPOT_MOVE].tier === "Draft" && TOOLS[HUBSPOT_MOVE].promotable);
t("hubspot: ok for an agent given it", refuseProposal("b_sales_1", HUBSPOT_MOVE, "11", mv, 200, ["hubspot_move_deal"]) === null);
t("hubspot: refused for an agent not given it", refuseProposal("b_sales_1", HUBSPOT_MOVE, "11", mv, 200, ["hubspot_deals"]) !== null);
t("hubspot: refused on a non-deal target", refuseProposal("b_sales_1", HUBSPOT_MOVE, "11/notes", mv, 200, ["hubspot_move_deal"]) !== null);
t("hubspot: refused with another field", refuseProposal("b_sales_1", HUBSPOT_MOVE, "11", { ...mv, amount: "1" }, 200, ["hubspot_move_deal"]) !== null);
t("hubspot: refused without a note", refuseProposal("b_sales_1", HUBSPOT_MOVE, "11", { stage: "contractsent" }, 200, ["hubspot_move_deal"]) !== null);

console.log(fails ? `${fails} FAILED` : "all passed");
if (fails) process.exit(1);
