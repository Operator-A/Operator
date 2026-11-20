// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Managed Claude credits (card 128 slice 4): the ledger (ee_credit_ledger, through db(), scoped to
// the org), the hosted key for a business on credits, a run's charge, and buying a pack on Stripe
// Checkout. The rules are in ee/credit-rules.ts.
//
// The hosted key (OPERATOR_CLAUDE_KEY) is app infrastructure, like the deployment's Claude settings:
// it is read only here, handed only to integrations/anthropic.ts for one client, and never shown.
import "server-only";
import { db } from "@/core/db";
import { orgId, withOrg } from "@/core/tenancy";
import type { Billing } from "@/core/cost-rules";
import { stripe } from "./stripe";
import { currentPlan } from "./plan";
import { planBlockFor } from "./plan-rules";
import { balanceOf, creditFromSession, isPack, mayUsePooledKey, runCharge, type PaidSession } from "./credit-rules";

export const LEDGER_MISSING = "The credits migration (20261224090000_ee_credit_ledger.sql) isn’t applied yet.";
const missing = (m: string) => (/ee_credit_ledger|relation|schema cache/.test(m) ? LEDGER_MISSING : m);
const hostedKey = () => process.env.OPERATOR_CLAUDE_KEY?.trim() ?? "";
/** True when this deployment has a Claude key for businesses on credits. */
export const creditsReady = () => /^sk-ant-/.test(hostedKey());

/** The current business's credit balance in dollars: every ledger row added up, in code. */
export async function creditBalance(): Promise<number> {
  const { data, error } = await db().from("ee_credit_ledger").select("amount_usd").limit(100_000);
  if (error) throw new Error(missing(error.message));
  return balanceOf((data ?? []) as { amount_usd: number | string }[]);
}

/** The latest ledger rows, newest first, for the Billing card. */
export async function creditRows(limit = 8): Promise<{ kind: "pack" | "run"; amount_usd: number; created_at: string }[]> {
  const { data, error } = await db().from("ee_credit_ledger").select("kind, amount_usd, created_at").order("created_at", { ascending: false }).limit(limit);
  if (error) throw new Error(missing(error.message));
  return (data ?? []).map((r) => ({ kind: r.kind as "pack" | "run", amount_usd: Number(r.amount_usd), created_at: r.created_at as string }));
}

/** The pooledKey slot: the hosted key, only for a business with a plan that allows runs and enough credits. */
export async function pooledKey(): Promise<string | null> {
  if (!creditsReady()) return null;
  const [balance, plan] = await Promise.all([creditBalance(), currentPlan()]);
  const planBlocked = planBlockFor(plan, { kind: "run", agentId: "", trigger: "manual" }) !== null;
  return mayUsePooledKey({ balance, planBlocked, keySet: true }) ? hostedKey() : null;
}

/** The afterRun slot: a run on credits is charged its cost plus the margin, once per run (run_id is unique). */
export async function chargeRun(run: { runId: string; costUsd: number; billing: Billing }): Promise<void> {
  if (run.billing !== "credits") return;
  const charge = runCharge(run.costUsd);
  if (!charge) return;
  const { error } = await db().from("ee_credit_ledger").insert({ kind: "run", amount_usd: -charge, cost_usd: run.costUsd, run_id: run.runId });
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(missing(error.message));
}

/** A Stripe Checkout page for one credit pack, paid once (not a subscription). */
export async function creditCheckoutUrl(pack: unknown, base: string): Promise<string> {
  if (!isPack(pack)) throw new Error("Pick one of the credit packs.");
  if (!creditsReady()) throw new Error("Credits aren’t set up on this deployment yet.");
  const org = await orgId();
  const s = await stripe<{ url?: string }>("POST", "/v1/checkout/sessions", {
    mode: "payment",
    line_items: { 0: { quantity: 1, price_data: { currency: "usd", unit_amount: pack * 100, product_data: { name: `OPERATOR Claude credits ($${pack})` } } } },
    client_reference_id: org,
    metadata: { org_id: org, kind: "credits", pack: String(pack) },
    payment_intent_data: { metadata: { org_id: org, kind: "credits", pack: String(pack) } },
    success_url: `${base}/settings?credits=added#billing`,
    cancel_url: `${base}/settings#billing`,
  });
  if (!s.url?.startsWith("https://checkout.stripe.com/")) throw new Error("Stripe didn’t return a checkout page.");
  return s.url;
}

/** From the signed webhook: a paid pack adds its credit to the org we put on the session, once per session. */
export async function recordCredit(session: PaidSession): Promise<string> {
  const c = creditFromSession(session);
  if ("skip" in c) return c.skip;
  return withOrg(c.org, async () => {
    const { data: exists } = await db().from("orgs").select("id").maybeSingle();
    if (!exists) return "unknown org";
    const { error } = await db().from("ee_credit_ledger").insert({ kind: "pack", amount_usd: c.usd, stripe_session_id: c.session });
    if (error) {
      if (/duplicate|unique/i.test(error.message)) return "already added";
      throw new Error(missing(error.message));
    }
    return `added $${c.usd} of credits`;
  });
}
