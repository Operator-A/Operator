import "server-only";
// The Claude client, the Claude model ids agents use in code, and cost from the price list in
// integrations/models.ts (every provider's prices live there).
import Anthropic from "@anthropic-ai/sdk";
import { modelDef } from "./models";
import { claudeKey, hasClaudeKey } from "./mcp";
import { edition, pooledKey } from "@/core/extensions";
import { billingFor, type Billing } from "@/core/cost-rules";

export { Anthropic };

export const MODELS = {
  opus: "claude-opus-5-5",
  sonnet: "claude-sonnet-5-5",
  haiku: "claude-haiku-5-5",
} as const;
export type Model = (typeof MODELS)[keyof typeof MODELS];
/** True for a model id with a price in integrations/models.ts, so its cost can be computed. */
export const isModel = (id: string): boolean => !!modelDef(id);

export const WEB_SEARCH_USD = 0.01; // per search
/** $ per token in and out, for estimates shown in the Control Room. Null for a model without a price. */
export const priceOf = (id: string): { in: number; out: number } | null => { const m = modelDef(id); return m ? { in: m.in, out: m.out } : null; };

export const NO_CLAUDE_KEY = "This business has no Claude API key yet. Paste one on Connections > Claude API.";
export const NO_CREDITS = "This business has no Claude key of its own and no Claude credits to run on. Buy credits on Settings > Billing, or paste your own key on Connections > Claude API.";

/** Who pays the current business's runs (core/cost-rules.ts billingFor). */
export async function billingNow(): Promise<Billing> {
  return billingFor({ ownKey: await hasClaudeKey(), edition: edition() });
}

/**
 * The Claude client for the current business (docs/tenancy.md, slice 8.1c): its own key from the
 * vault, so Anthropic bills it directly. Without one, the hosted edition's key when the business is on
 * managed credits with a balance (card 128 slice 4; the paid layer decides, and charges each run in
 * withRun); otherwise the run is refused, the same for every business (card 135).
 */
export async function claude(): Promise<Anthropic> {
  const own = await claudeKey();
  if (own) return new Anthropic({ apiKey: own });
  if (edition() === "open") throw new Error(NO_CLAUDE_KEY);
  const pooled = await pooledKey();
  if (!pooled) throw new Error(NO_CREDITS);
  return new Anthropic({ apiKey: pooled });
}

/** Every input token a response billed, cache reads and writes included. */
export const inputTokens = (u: Anthropic.Beta.BetaUsage | Anthropic.Usage) =>
  u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);

/** Cost in code from the price list, for any provider. Throws for a model without a price: an agent checks before it calls one. */
export function costUsd(model: string, tokensIn: number, tokensOut: number, searches = 0) {
  const m = modelDef(model);
  if (!m) throw new Error(`No price for ${model} in integrations/models.ts`);
  return Number((tokensIn * m.in + tokensOut * m.out + searches * WEB_SEARCH_USD).toFixed(4));
}
