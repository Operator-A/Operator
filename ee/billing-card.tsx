// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Settings > Billing (the settingsSections slot): where the business stands, what it pays, and for the
// owner the buttons to Stripe's own pages (Checkout to add a card, the portal to change or cancel).
import { orgTz } from "@/core/tz";
import "server-only";
import { listMembers } from "@/core/members";
import { requireSession } from "@/dashboard/data";
import { currentPlan, subscription } from "./plan";
import { PLAN, planWords } from "./plan-rules";
import { CODE_DAYS } from "./signup-rules";
import { stripeReady } from "./stripe";
import { addCard, buyCredits, manageBilling } from "./billing-actions";
import { creditBalance, creditRows, creditsReady } from "./credits";
import { PACKS_USD, creditWords, usdWords } from "./credit-rules";
import { billingNow } from "@/integrations/anthropic";
import { createSignupCode, revokeSignupCode } from "./signup-actions";
import { listCodes } from "./signup";
import { adminOrgId } from "./admin";

export async function BillingCard({ query }: { query: Readonly<Record<string, string | undefined>> }) {
  const [me, plan, sub, people, billing, credits] = await Promise.all([
    requireSession(),
    currentPlan().then((p) => ({ p, problem: null as string | null }), (e: unknown) => ({ p: null, problem: e instanceof Error ? e.message : String(e) })),
    subscription().catch(() => null),
    listMembers().then((m) => Math.max(1, m.length), () => 1),
    billingNow().catch(() => "own_key" as const),
    Promise.all([creditBalance(), creditRows()]).then(([balance, rows]) => ({ balance, rows, problem: null as string | null }), (e: unknown) => ({ balance: 0, rows: [], problem: e instanceof Error ? e.message : String(e) })),
  ]);
  const billed = plan.p && plan.p.kind !== "comped";
  // the admin business makes the sign-up codes (sign-up is invite-only, ee/admin.ts)
  const codes = me.orgId === adminOrgId() && me.role === "owner" ? await listCodes().then((rows) => ({ rows, problem: null as string | null }), (e: unknown) => ({ rows: [], problem: e instanceof Error ? e.message : String(e) })) : null;
  const tz = await orgTz();
  const when = (at: string) => new Date(at).toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" });
  const codeState = (c: { used_at: string | null; expires_at: string; open: boolean }) => (c.used_at ? `used ${when(c.used_at)}` : c.open ? `open until ${when(c.expires_at)}` : "ended");
  const hasCard = !!sub?.hasCard && sub.status !== "canceled";
  return (
    <div className="card" id="billing" style={{ padding: "16px 22px", gap: 8 }}>
      <span className="card-t">Billing</span>
      <span className="sub">{plan.p ? planWords(plan.p, people) : plan.problem}</span>
      {query.billing === "added" && <span className="sub" style={{ color: "var(--mint-ink)" }}>Thanks, the card is on file. It can take a minute to show here.</span>}
      {query.billing_problem && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{query.billing_problem.slice(0, 200)}</span>}
      {billed && me.role === "owner" && (stripeReady()
        ? <form action={hasCard ? manageBilling : addCard}><button className="btn sm">{hasCard ? "Manage billing" : "Add a card"}</button></form>
        : <span className="muted" style={{ fontSize: 12 }}>Billing isn’t set up on this deployment yet.</span>)}
      <div className="stack" style={{ gap: 6, paddingTop: 6 }}>
        <span className="card-t" style={{ fontSize: 14 }}>Claude credits</span>
        <span className="sub">{credits.problem ?? creditWords({ billing, balance: credits.balance })}</span>
        {query.credits === "added" && <span className="sub" style={{ color: "var(--mint-ink)" }}>Thanks, your credits are on the way. They can take a minute to show here.</span>}
        {me.role === "owner" && (stripeReady() && creditsReady()
          ? <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>{PACKS_USD.map((p) => (
              <form key={p} action={buyCredits}><input type="hidden" name="pack" value={p} /><button className="btn ghost sm">Buy ${p}</button></form>
            ))}</div>
          : <span className="muted" style={{ fontSize: 12 }}>Credits aren’t set up on this deployment yet.</span>)}
        {credits.rows.map((r, i) => (
          <div key={i} className="row rule" style={{ justifyContent: "space-between", gap: 8, padding: "4px 0", fontSize: 13 }}>
            <span>{r.kind === "pack" ? "Credits bought" : "A run"} <span className="muted">· {when(r.created_at)}</span></span>
            <span>{r.amount_usd > 0 ? "+" : ""}{usdWords(r.amount_usd)}</span>
          </div>
        ))}
      </div>
      {codes && (
        <div className="stack" style={{ gap: 6, paddingTop: 6 }}>
          <span className="card-t" style={{ fontSize: 14 }}>Sign-up codes</span>
          <span className="sub">Sign-up is by invitation. Each code makes one business at /signup with a {PLAN.trialDays}-day trial, and works for {CODE_DAYS} days. A code is shown once.</span>
          {query.new_code && <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 1 }}>New code: {query.new_code.slice(0, 20)}</span>}
          <form action={createSignupCode} className="row" style={{ gap: 8 }}>
            <input className="input" name="note" maxLength={120} placeholder="Who it’s for (only you see this)" style={{ flex: 1, minWidth: 0 }} />
            <button className="btn sm">Make a code</button>
          </form>
          {codes.problem && <span className="sub">{codes.problem}</span>}
          {codes.rows.map((c) => (
            <div key={c.id} className="row rule" style={{ justifyContent: "space-between", gap: 8, padding: "6px 0", fontSize: 13 }}>
              <span>{c.note || "No note"} <span className="muted">· {codeState(c)}</span></span>
              {c.open && <form action={revokeSignupCode}><input type="hidden" name="id" value={c.id} /><button className="btn ghost sm">End it</button></form>}
            </div>
          ))}
        </div>
      )}
      {billed && <span className="muted" style={{ fontSize: 12 }}>Adding or removing people changes the bill from the next day, prorated. A plan never changes what the crew may do: caps, approval cards and the hard rules are the same on every plan.</span>}
    </div>
  );
}
