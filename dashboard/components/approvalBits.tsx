// An approval card's parts (docs/department-pages.md, slice 1): what each kind of change shows, the
// lead's note, the department tag, and the whole card. The Approvals page and a department's Approvals
// tab draw the same card, so approving in either place is the same tap.
import Link from "next/link";
import { approve, reject } from "@/dashboard/actions";
import type { ApprovalItem, ApprovalsView, ReactRules } from "@/dashboard/data";
import type { CrewMember } from "@/dashboard/crew";
import { m2, md, when } from "@/dashboard/format";
import { ActionButton } from "@/dashboard/components/client";
import { RejectButton } from "@/dashboard/components/react";
import { Avatar } from "@/dashboard/components/ui";
import { CALENDAR_HOLD, CAMPAIGN_DRAFT, MAILCHIMP_DRAFT, WOO_NOTE, HUBSPOT_MOVE, META_PAUSE, DRAFT_EMAIL, INVOICE_DRAFT, QBO_CATEGORIZE, SQUARE_INVOICE, SHOPIFY_COPY, SHOPIFY_DISCOUNT, SHOPIFY_REFUND, SHOPIFY_SHIP, SHOPIFY_STOCK, SHOPIFY_TAGS } from "@/core/gateway";

export const ACTION_LOOK: Record<string, [string, string]> = {
  proposed: ["Waiting on you", "var(--yel)"], approved: ["Approved, not applied", "var(--acc)"], executing: ["Applying", "var(--acc)"],
  applied: ["Applied", "var(--mint)"], partial: ["Partly applied", "var(--mint)"], failed: ["Failed", "var(--red)"],
  rejected: ["Rejected", "var(--mut2)"], expired: ["Expired (stale)", "var(--mut2)"], refused: ["Refused by the gateway", "var(--red)"],
  sent_back: ["Sent back by its lead", "var(--mut2)"], scheduled: ["In its undo window", "var(--acc)"], cancelled: ["Cancelled", "var(--mut2)"],
};
export const Tag = ({ s }: { s: string }) => {
  const [l, c] = ACTION_LOOK[s] ?? [s, "var(--mut2)"];
  return <span className="row" style={{ gap: 6, fontSize: 12.5, whiteSpace: "nowrap" }}><span style={{ width: 7, height: 7, borderRadius: 999, background: c }} />{l}</span>;
};

/** A Gmail draft (Rowan): who it goes to, from the leads list, and the exact words. Approving puts it in Gmail; the owner still sends it there. */
function Draft({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {([["To", p.to ?? "?"], ["Subject", p.subject ?? "?"]] as [string, string][]).map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      <div className="rule" style={{ padding: "10px 0", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.body ?? ""}</div>
    </div>
  );
}

/** A Klaviyo campaign (the Campaign writer): the list, subject, preview text and exact body. Approving makes a draft in Klaviyo; the owner sends it there. */
function Campaign({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {([["List", p.list ?? "?"], ["Subject", p.subject ?? "?"], ["Preview text", p.preview_text ?? "?"]] as [string, string][]).map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      <div className="rule" style={{ padding: "10px 0", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.body ?? ""}</div>
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>Code adds an unsubscribe line. Approving makes a draft in {i.tool === MAILCHIMP_DRAFT ? "Mailchimp" : "Klaviyo"}; you send it from there.</div>
    </div>
  );
}

/** A Stripe invoice (any agent the owner gave the action): customer, lines and total as code added them. Approving makes a draft in Stripe; the owner finalizes and sends it there. */
function Invoice({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  const sq = i.tool === SQUARE_INVOICE;
  const cur = (p.currency ?? "?").toUpperCase();
  const rows: [string, string][] = [["Customer", p.customer ?? "?"], ...(sq ? [["Location", p.location ?? "?"] as [string, string]] : []), ...(p.lines ?? []).map((l): [string, string] => [l.description, `${cur} ${l.amount.toFixed(2)}`]), ["Total", `${cur} ${p.total ?? "?"}`], ["Due", p.days_until_due != null ? (sq ? `${p.days_until_due} days from when it is made` : `${p.days_until_due} days after you send it`) : "?"]];
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {rows.map(([k, v], n) => <div key={n} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13, fontWeight: k === "Total" ? 600 : undefined }}><span className={k === "Total" ? undefined : "muted"} style={{ minWidth: 0, overflowWrap: "anywhere" }}>{k}</span><span style={{ fontWeight: 500, textAlign: "right", whiteSpace: "nowrap" }}>{v}</span></div>)}
      {p.memo && <div className="rule" style={{ padding: "10px 0", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.memo}</div>}
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>{sq ? "Approving makes a draft in Square. Nothing is published, sent or charged: you do that from Square." : "Approving makes a draft in Stripe. Nothing is finalized, sent or charged: you do that from Stripe."}</div>
    </div>
  );
}

/** A QuickBooks category (card 241): the expense as code read it, and where it moves. Approving changes the category only. */
function Category({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  const rows: [string, string][] = [["Expense", p.record ?? "?"], ["From", "Uncategorized Expense"], ["To", p.category ?? "?"]];
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {rows.map(([k, v], n) => <div key={n} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      {p.why && <div className="rule" style={{ padding: "10px 0", fontSize: 13, lineHeight: 1.55, overflowWrap: "anywhere" }}>{p.why}</div>}
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>Approving moves this one line in QuickBooks. The amount, payee, date and other lines stay exactly as they are.</div>
    </div>
  );
}

/** A calendar hold (card 251): the title and the exact time. Approving adds a private event with no guests; no one is emailed. */
function Hold({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {([["Title", p.title ?? "?"], ["When", p.slot ? `${String(p.slot).split(" to ")[0]}, ${p.minutes ?? "?"} min` : "?"]] as [string, string][]).map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>A private, busy event on your Google Calendar with no guests. No one is invited or emailed. The gateway checks the time is still free first.</div>
    </div>
  );
}

/** A HubSpot deal move (card 253): the deal, the stage it moves to and the note. */
function DealMove({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {([["Deal", p.deal ?? "?"], ["Moves to", p.stage ?? "?"]] as [string, string][]).map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      <div className="rule" style={{ padding: "10px 0", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.note ?? ""}</div>
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>Approving moves the deal in HubSpot and logs this note on it. No one is emailed.</div>
    </div>
  );
}

const PERIOD_WORDS: Record<string, string> = { last_7_days: "the last 7 days", last_30_days: "the last 30 days", last_90_days: "the last 90 days" };
/** A Meta ad pause (card 255): the ad, what it is judged on, and that only a fresh check against the owner's target pauses it. */
function AdPause({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {([["Ad", p.ad ?? "?"], ["Judged on", `cost per ${p.result ?? "result"} over ${PERIOD_WORDS[p.period ?? ""] ?? p.period ?? "?"}`]] as [string, string][]).map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>Approving pauses this ad in Meta, but only if it is still running and still over your cost target (Connections, Meta Ads pauses) when the numbers are read again. Budgets are never changed. You can turn it back on in Ads Manager.</div>
    </div>
  );
}

/** A WooCommerce order note (card 254): the order and the exact words. Approving adds a private note the customer doesn't see. */
function OrderNote({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">Order</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{p.order ?? "?"}</span></div>
      <div className="rule" style={{ padding: "10px 0", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{p.note ?? ""}</div>
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>A private note: store staff see it in WooCommerce, the customer doesn’t.</div>
    </div>
  );
}

/** A Shopify tag change: the order or customer, and the exact tags it adds. */
function Tags({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {([["Record", p.record ?? "?"], ["Add tags", (p.tags ?? []).join(", ") || "?"]] as [string, string][]).map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>Adds only, never removes a tag. A tag already there is left as it is.</div>
    </div>
  );
}

export const KIND_LABEL: Record<string, string> = { [DRAFT_EMAIL]: "Gmail draft", [CAMPAIGN_DRAFT]: "Klaviyo campaign draft", [CALENDAR_HOLD]: "Calendar hold", [SHOPIFY_TAGS]: "Shopify tags", [SHOPIFY_STOCK]: "Shopify stock", [SHOPIFY_COPY]: "Shopify product copy", [SHOPIFY_SHIP]: "Shopify shipped", [SHOPIFY_DISCOUNT]: "Shopify discount code", [SHOPIFY_REFUND]: "Shopify refund", [INVOICE_DRAFT]: "Stripe invoice draft", [SQUARE_INVOICE]: "Square invoice draft", [MAILCHIMP_DRAFT]: "Mailchimp campaign draft", [WOO_NOTE]: "WooCommerce order note", [HUBSPOT_MOVE]: "HubSpot deal move", [META_PAUSE]: "Meta ad pause", [QBO_CATEGORIZE]: "QuickBooks category" };

/** A Shopify stock change: the item at its location, the count before and after, and Shopify's reason. */
function Stock({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  const ch = typeof p.change === "number" ? ` (${p.change > 0 ? "+" : ""}${p.change})` : "";
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {([["Item", p.record ?? "?"], ["Available", p.from != null && p.available != null ? `${p.from} → ${p.available}${ch}` : "?"], ["Reason", (p.reason ?? "?").replace(/_/g, " ")]] as [string, string][]).map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>Refused if the count in Shopify isn’t {p.from ?? "the count above"} when you approve. Stock changes always wait for you.</div>
    </div>
  );
}

/** A Shopify product copy change: the product, then each field's words before and after, exactly as they'll be saved. */
function Copy({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  const box = { whiteSpace: "pre-wrap" as const, overflowWrap: "anywhere" as const, fontSize: 13, lineHeight: 1.5 };
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      <div className="row" style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">Product</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{p.record ?? "?"}</span></div>
      {(p.copy ?? []).map((c) => (
        <div key={c.field} className="rule" style={{ padding: "9px 0", display: "grid", gap: 6 }}>
          <span className="muted" style={{ fontSize: 12 }}>{c.field}</span>
          <div className="muted" style={{ ...box, textDecoration: c.before ? "line-through" : undefined }}>{c.before || "(empty)"}</div>
          <div style={{ ...box, fontWeight: 500 }}>{c.after}</div>
        </div>
      ))}
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>Refused if the copy in Shopify changes before this is applied, or if the text states a number or certification that isn’t in the product’s Shopify data.</div>
    </div>
  );
}

/** A Shopify discount code: the code, the percent off, the use limit and the dates, and that anyone with it can use it. */
function Discount({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  const rows: [string, string][] = [["Code", p.record ?? "?"], ["Off", p.percent != null ? `${p.percent}% off every product, once per customer` : "?"], ["Uses", p.uses != null ? `at most ${p.uses} in all` : "?"], ["Runs", p.starts && p.ends ? `${p.starts} to ${p.ends}` : "?"], ["Name in Shopify", p.title ?? "?"]];
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {rows.map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>Approving makes the code live in Shopify: anyone who has it can use it until it ends or runs out. It doesn’t combine with other discounts. To end it early, deactivate it in Shopify. Always waits for you.</div>
    </div>
  );
}

/** A Shopify order marked shipped: the order, the carrier and tracking number, and that Shopify emails the customer. */
function Ship({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  const rows: [string, string][] = [["Order", p.record ?? "?"], ["Items", p.items != null ? `all ${p.items} left to ship` : "all left to ship"], ["Carrier", p.carrier ?? "?"], ["Tracking", p.tracking ?? "?"]];
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {rows.map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>Approving marks the order shipped in Shopify, and Shopify emails the customer its shipping confirmation with this tracking number. Check the number against the label. Refused if the order changed in Shopify since. Always waits for you.</div>
    </div>
  );
}

function Refund({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  const rows: [string, string][] = [["Order", p.record ?? "?"], ["Refund", p.whole ? "the whole order, with shipping" : (p.refund_items ?? []).join(", ") || "?"], ["Amount", p.amount ? `$${p.amount}` : "?"], ["Refunded before", p.refunded_before ? `$${p.refunded_before}` : "?"]];
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {rows.map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
      <div className="rule muted" style={{ padding: "9px 0", fontSize: 12 }}>Approving refunds this money to the customer&rsquo;s original payment, and Shopify emails the customer its refund confirmation. Items aren&rsquo;t restocked. Shopify works out the amount again right before; it&rsquo;s refused if that is more than shown here, over your refund caps, or the order was refunded since. A refund can&rsquo;t be undone. Always waits for you.</div>
    </div>
  );
}

export function Change({ i }: { i: ApprovalItem }) {
  const p = i.preview;
  if (i.tool === DRAFT_EMAIL) return <Draft i={i} />;
  if (i.tool === CAMPAIGN_DRAFT || i.tool === MAILCHIMP_DRAFT) return <Campaign i={i} />;
  if (i.tool === INVOICE_DRAFT || i.tool === SQUARE_INVOICE) return <Invoice i={i} />;
  if (i.tool === QBO_CATEGORIZE) return <Category i={i} />;
  if (i.tool === CALENDAR_HOLD) return <Hold i={i} />;
  if (i.tool === SHOPIFY_TAGS) return <Tags i={i} />;
  if (i.tool === SHOPIFY_STOCK) return <Stock i={i} />;
  if (i.tool === SHOPIFY_COPY) return <Copy i={i} />;
  if (i.tool === SHOPIFY_SHIP) return <Ship i={i} />;
  if (i.tool === SHOPIFY_DISCOUNT) return <Discount i={i} />;
  if (i.tool === SHOPIFY_REFUND) return <Refund i={i} />;
  if (i.tool === WOO_NOTE) return <OrderNote i={i} />;
  if (i.tool === HUBSPOT_MOVE) return <DealMove i={i} />;
  if (i.tool === META_PAUSE) return <AdPause i={i} />;
  const lines: [string, React.ReactNode][] = [
    p.charge && !p.merchant ? ["Charge", p.charge] : ["Charge", `${p.merchant ?? "?"} · ${p.amount_usd != null ? m2(p.amount_usd) : "?"} · ${p.date ? md(`${p.date}T12:00:00Z`, "UTC") : "?"}`],
    ...(p.receipt_path ? [["Attach receipt", i.receipt_url ? <a key="r" href={i.receipt_url} target="_blank" rel="noopener noreferrer">{p.receipt_path.split("/").pop()} (open)</a> : p.receipt_path.split("/").pop()] as [string, React.ReactNode]] : []),
    ...(p.category ? [["Set category", p.category] as [string, React.ReactNode]] : []),
    ...(p.note ? [["Set memo", p.note] as [string, React.ReactNode]] : []),
  ];
  return (
    <div style={{ borderRadius: 16, background: "var(--soft)", padding: "6px 16px" }}>
      {lines.map(([k, v], n) => <div key={k} className={"row" + (n ? " rule" : "")} style={{ justifyContent: "space-between", gap: 16, padding: "9px 0", fontSize: 13 }}><span className="muted">{k}</span><span style={{ fontWeight: 500, textAlign: "right", minWidth: 0, overflowWrap: "anywhere" }}>{v}</span></div>)}
    </div>
  );
}

/** The department a card's agent sat in, and the lead's check (slice 4): a note, or that it wasn't checked in time. */
export function LeadBits({ i, view, tz }: { i: ApprovalItem; view: ApprovalsView; tz: string }) {
  const lead = i.reviewer_agent_id ? view.names[i.reviewer_agent_id] ?? i.reviewer_agent_id : null;
  if (!lead || !i.review_status) return null;
  if (i.review_status === "waiting") return <span className="sub">{lead} checks this first. It comes to you by {i.review_due ? when(i.review_due, tz) : "tomorrow"}; you can decide it now anyway.</span>;
  if (i.review_status === "skipped") return <span className="sub">{lead} didn’t check this in time, so it came straight to you.</span>;
  if (i.review_status === "noted") return (
    <div className="soft-box" style={{ flexDirection: "column", alignItems: "stretch", gap: 4, borderLeft: "3px solid var(--acc)" }}>
      <span className="ted-k">{lead}’s note · their words, not an approval</span>
      <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>{i.review_note}</span>
    </div>
  );
  return null;
}

export function DeptTag({ i, view }: { i: ApprovalItem; view: ApprovalsView }) {
  const d = view.departments.find((x) => x.id === i.department_id);
  return d ? <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{d.name}</span> : null;
}

const NO_RULES: ReactRules = { deptName: null, agent: [], department: [], crew: [] };

/**
 * One card waiting on an approver: who made it, what it changes, Approve and Reject. The department page
 * draws it in the approved mockup's look: `chat` under the run that staged it, `tab` on its Approvals tab.
 * Every look binds the same approve and reject actions, so approving anywhere is one path.
 */
export function ApprovalCard({ i, view, byId, tz, rules, look = "page", chatHref }: { i: ApprovalItem; view: ApprovalsView | null; byId: Record<string, CrewMember>; tz: string; rules: Record<string, ReactRules>; look?: "page" | "chat" | "tab"; chatHref?: string }) {
  const a = byId[i.agent_id];
  const name = a?.name ?? view?.names[i.agent_id] ?? i.agent_id;
  const buttons = (
    <div className="dp-btns">
      <ActionButton className="dp-btn go" action={approve.bind(null, i.id)}>Approve</ActionButton>
      <RejectButton reject={reject.bind(null, i.id)} agentName={name} rules={rules[i.agent_id] ?? NO_RULES} label="Not this" className="dp-btn" />
    </div>
  );
  const notes = (
    <>
      {view && <LeadBits i={i} view={view} tz={tz} />}
      {i.brain_note && <span className="dp-note">{i.brain_note}</span>}
    </>
  );
  if (look === "chat") return (
    <div className="dp-glass dp-card">
      <span className="dp-card-k amber">● Waiting for your OK</span>
      <h4>{i.title}</h4>
      <div className="dp-draft"><Change i={i} /></div>
      {buttons}
      {i.reasoning && <span className="dp-note">{i.reasoning}</span>}
      {notes}
    </div>
  );
  if (look === "tab") return (
    <div className="dp-ap">
      <div className="dp-ap-h"><b>{name}</b>{a?.role ? `${a.role} · ` : ""}{when(i.created_at, tz)}<span className="kind">{KIND_LABEL[i.tool] ?? "Mercury change"}</span></div>
      <h4>{i.title}</h4>
      <div className="dp-draft"><Change i={i} /></div>
      {buttons}
      <span className="dp-note">{i.reasoning}{chatHref && <>{i.reasoning ? " " : ""}<Link href={chatHref} style={{ fontWeight: 600, color: "var(--ink2)", textDecoration: "underline" }}>See it in the chat</Link></>}</span>
      {notes}
    </div>
  );
  return (
    <div className="card" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 22, padding: 22 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="row wrap">{a && <Avatar a={a} size={32} />}<span style={{ fontSize: 13.5, fontWeight: 600, flex: 1 }}>{name} · {KIND_LABEL[i.tool] ?? "Mercury change"}</span>{view && <DeptTag i={i} view={view} />}<span className="muted" style={{ fontSize: 12 }}>{when(i.created_at, tz)}</span></div>
        <span style={{ fontSize: 17, fontWeight: 600 }}>{i.title}</span>
        {i.reasoning && <span style={{ fontSize: 13, lineHeight: 1.5 }} className="ink2">{i.reasoning}</span>}
        {view && <LeadBits i={i} view={view} tz={tz} />}
        {i.brain_note && <span className="sub">{i.brain_note}</span>}
        <div className="row" style={{ gap: 8, marginTop: 6 }}>
          <ActionButton className="btn primary" action={approve.bind(null, i.id)}>Approve</ActionButton>
          <RejectButton reject={reject.bind(null, i.id)} agentName={name} rules={rules[i.agent_id] ?? NO_RULES} />
        </div>
      </div>
      <Change i={i} />
    </div>
  );
}
