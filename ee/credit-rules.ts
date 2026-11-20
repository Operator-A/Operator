// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Managed Claude credits (card 128 slice 4, decided on 2026-11-18): a business with no Claude key of
// its own runs on the hosted edition's key and pays for it from prepaid credits, at Anthropic's list
// price plus 20%. Pure: no database, no network and no clock, so ee/check.ts tests every case.
//
// Credits only pay for the model. They never change what the crew may do: caps, budgets, approval
// cards and the hard rules are the same on credits and on a business's own key.
import { CREDITS_MARGIN, type Billing } from "@/core/cost-rules";

/** The packs a business can buy, in dollars, and the balance below which credit runs pause. */
export const PACKS_USD = [10, 25, 50] as const;
export type Pack = (typeof PACKS_USD)[number];
export const MIN_BALANCE_USD = 0.5;
/** The ledger keeps dollars to the millionth, so a run that costs a fraction of a cent is charged exactly. */
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

export const isPack = (v: unknown): v is Pack => (PACKS_USD as readonly number[]).includes(Number(v)) && String(Number(v)) === String(v).trim();

/** What a run costs on credits: its cost from the price list (worked out in code) times the margin. */
export const runCharge = (costUsd: number): number => (Number.isFinite(costUsd) && costUsd > 0 ? r6(costUsd * CREDITS_MARGIN) : 0);

/** The balance: every ledger row added up (packs in, runs out). */
export const balanceOf = (rows: readonly { amount_usd: number | string }[]): number => r6(rows.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0));

/** Runs that think (call Claude). A gateway apply ("approval") doesn't, so credits never hold up a tapped approval. */
const THINKS = new Set(["cron", "manual", "chain", "setup", "preview"]);

/** Why a run on credits can't start, or null. Only credit runs that call Claude are held to the balance. */
export function creditBlock(o: { billing: Billing | undefined; trigger: string; balance: number }): string | null {
  if (o.billing !== "credits" || !THINKS.has(o.trigger)) return null;
  if (o.balance >= MIN_BALANCE_USD) return null;
  return `Claude credits are at ${usdWords(o.balance)}, under the ${usdWords(MIN_BALANCE_USD)} a run needs. Runs are paused: buy credits on Settings > Billing, or paste your own Claude key on Connections. Nothing has been deleted.`;
}

/** The pooled key may be used only for a business on credits with enough balance and a plan that allows runs. */
export const mayUsePooledKey = (o: { balance: number; planBlocked: boolean; keySet: boolean }) => o.keySet && !o.planBlocked && o.balance >= MIN_BALANCE_USD;

/** A Stripe Checkout session that paid for a pack, from the signed webhook. */
export interface PaidSession { mode?: unknown; payment_status?: unknown; amount_total?: unknown; currency?: unknown; metadata?: Record<string, unknown> | null; id?: unknown; client_reference_id?: unknown }
const SESSION = /^cs_(test|live)_[A-Za-z0-9]{6,200}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The credit a paid Checkout session adds, or why it adds none. It must be a paid one-time payment we
 * started ourselves (kind "credits"), for one of our packs, in dollars, with the amount charged exactly
 * the pack: the pack named in metadata alone never decides how much is added.
 */
export function creditFromSession(s: PaidSession): { org: string; session: string; usd: Pack } | { skip: string } {
  if (s.mode !== "payment") return { skip: "not a one-time payment" };
  if (s.metadata?.kind !== "credits") return { skip: "not a credit pack" };
  if (s.payment_status !== "paid") return { skip: "not paid yet" };
  const org = s.metadata?.org_id;
  if (typeof org !== "string" || !UUID.test(org) || (s.client_reference_id != null && s.client_reference_id !== org)) return { skip: "no org on the session" };
  if (typeof s.id !== "string" || !SESSION.test(s.id)) return { skip: "no session id" };
  if (s.currency !== "usd") return { skip: "not in dollars" };
  const pack = Number(s.metadata?.pack);
  if (!isPack(pack) || s.amount_total !== pack * 100) return { skip: "the amount isn’t one of the packs" };
  return { org, session: s.id, usd: pack };
}

/** Dollars as words: cents shown, and a fraction of a cent rounded up to one. */
export function usdWords(n: number): string {
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  return `${sign}$${(a > 0 && a < 0.01 ? 0.01 : a).toFixed(2)}`;
}

/** One line for the Billing card. */
export function creditWords(o: { billing: Billing; balance: number }): string {
  if (o.billing === "own_key") return "Runs use your own Claude key, billed by Anthropic. Credits are only used if you remove it.";
  const low = o.balance < MIN_BALANCE_USD;
  return `Claude credits: ${usdWords(o.balance)}. Each run is charged its model cost plus ${Math.round((CREDITS_MARGIN - 1) * 100)}%.${low ? " Runs are paused until you buy credits." : ""}`;
}
