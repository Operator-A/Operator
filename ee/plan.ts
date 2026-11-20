// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The current business's plan, read from its ee_subscriptions row through db() (scoped to the org).
import "server-only";
import { db } from "@/core/db";
import type { PlanAsk } from "@/core/extension-types";
import { creditBlock } from "./credit-rules";
import { planBlockFor, planState, type PlanState, type SubStatus, type Subscription } from "./plan-rules";

export async function subscription(): Promise<Subscription | null> {
  const { data, error } = await db().from("ee_subscriptions").select("status, trial_ends_at, past_due_since, seats, current_period_end, stripe_subscription_id").maybeSingle();
  if (error) throw new Error(/ee_subscriptions|relation|schema cache/.test(error.message) ? "The billing migration (20261212090000_ee_subscriptions.sql) isn’t applied yet." : error.message);
  if (!data) return null;
  return {
    status: data.status as SubStatus, trialEndsAt: data.trial_ends_at, pastDueSince: data.past_due_since,
    seats: Number(data.seats), currentPeriodEnd: data.current_period_end, hasCard: !!data.stripe_subscription_id,
  };
}

/** The current business's plan, from its row; a comped row means no charge and no limits. */
export async function currentPlan(now = Date.now()): Promise<PlanState> {
  return planState(await subscription(), { now });
}

/** The planBlock slot: the plan first, then, for a run that thinks on credits, the credit balance. */
export async function planBlock(ask: PlanAsk): Promise<string | null> {
  const plan = planBlockFor(await currentPlan(), ask);
  if (plan || ask.kind !== "run" || ask.billing !== "credits") return plan;
  // imported here, since ee/credits.ts reads the plan too
  const { creditBalance } = await import("./credits");
  return creditBlock({ billing: ask.billing, trigger: ask.trigger, balance: await creditBalance() });
}
