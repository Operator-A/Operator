import "server-only";
// The Claude client, the Claude model ids agents use in code, and cost from the price list in
// integrations/models.ts (every provider's prices live there).
import Anthropic from "@anthropic-ai/sdk";
import { modelDef } from "./models";
import { claudeKey, hasClaudeKey, modelKeysReady } from "./mcp";
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
  // Claude runs go through the AI Gateway key first when it is saved (conductor ticket 1b), billed by Vercel
  const [own, keys] = await Promise.all([hasClaudeKey(), modelKeysReady().catch(() => null)]);
  return billingFor({ ownKey: own || !!keys?.gateway, edition: edition() });
}

/**
 * The business's own Claude key as a client, or null: the backup when the AI Gateway can't run a Claude turn
 * (integrations/llm.ts). Never the hosted key, since a run on the gateway was not billed to credits.
 */
export async function ownClaude(): Promise<Anthropic | null> {
  const own = await claudeKey();
  return own ? new Anthropic({ apiKey: own }) : null;
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

/** Prompt caching (card 200): a cache write costs 1.25x the input price (5-minute cache), a cache read 0.1x. */
export const CACHE_WRITE = 1.25;
export const CACHE_READ = 0.1;

/**
 * Cost in code from the price list, for any provider. Throws for a model without a price: an agent checks
 * before it calls one. `tokensIn` counts every input token; `cache` says how many of them were written to or
 * read from the prompt cache, which bill at their own rates.
 */
export function costUsd(model: string, tokensIn: number, tokensOut: number, searches = 0, cache: { write?: number; read?: number } = {}) {
  const m = modelDef(model);
  if (!m) throw new Error(`No price for ${model} in integrations/models.ts`);
  const write = Math.max(0, cache.write ?? 0), read = Math.max(0, cache.read ?? 0), plain = Math.max(0, tokensIn - write - read);
  // a provider with its own cached price charges nothing extra to write the cache
  const inUsd = m.cacheIn != null ? (plain + write) * m.in + read * m.cacheIn : (plain + write * CACHE_WRITE + read * CACHE_READ) * m.in;
  return Number((inUsd + tokensOut * m.out + searches * WEB_SEARCH_USD).toFixed(4));
}

/** The cache part of a response's usage, for costUsd. */
export const cacheTokens = (u: Anthropic.Beta.BetaUsage | Anthropic.Usage) => ({ write: u.cache_creation_input_tokens ?? 0, read: u.cache_read_input_tokens ?? 0 });
