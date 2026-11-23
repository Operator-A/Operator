import "server-only";
// One model interface for agent runs (docs/agent-setup.md, "Models across providers"). The runner sends
// one turn and gets the reply and its token counts back in one shape, whichever provider serves it.
//
// The transcript keeps the Claude Messages shape (text, tool_use, tool_result, thinking, server tools):
// it holds everything other providers return, so a client for another provider translates at its own
// edge and the runner never changes. Cost stays in code (costUsd), from the counts in TurnUsage.
import { Anthropic, claude, inputTokens } from "./anthropic";
import { modelDef } from "./models";
import { modelKey, pauseModelKey } from "./mcp";
import { PROVIDER_BY_ID, keyRefused, type ModelProvider } from "@/core/model-key-rules";
import { fromChat, fromResponses, toChat, toResponses, type ChatResponse, type ClaudeTurn, type ResponsesResponse } from "@/core/llm-wire";
import { scrubSecrets } from "@/core/mcp-rules";

export interface TurnRequest {
  model: string;
  maxOut: number;
  effort: "low" | "medium" | "high";
  system: Anthropic.Beta.BetaTextBlockParam[];
  tools: Anthropic.Beta.BetaToolUnion[];
  messages: Anthropic.Beta.BetaMessageParam[];
}

export interface TurnUsage {
  /** Every input token the turn billed, cache reads and writes included. */
  tokensIn: number;
  tokensOut: number;
  /** How many of tokensIn were written to or read from the prompt cache; they bill at their own rates. */
  cacheWrite: number;
  cacheRead: number;
  /** Web searches the provider ran inside the turn. */
  searches: number;
}

export interface TurnResult {
  content: Anthropic.Beta.BetaContentBlock[];
  stopReason: string | null;
  /** The model that served the turn: a refusal may be answered by another model of the same provider. */
  model: string;
  usage: TurnUsage;
}

export interface ModelClient {
  turn(req: TurnRequest): Promise<TurnResult>;
}

/** What the Claude client offers that a turn needs; tests pass a stand-in. */
export type ClaudeMessages = { beta: { messages: { create: (body: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage> } } };

/** The usage of a Claude reply in TurnUsage terms. */
export const claudeUsage = (u: Anthropic.Beta.BetaUsage): TurnUsage => ({
  tokensIn: inputTokens(u),
  tokensOut: u.output_tokens,
  cacheWrite: u.cache_creation_input_tokens ?? 0,
  cacheRead: u.cache_read_input_tokens ?? 0,
  searches: u.server_tool_use?.web_search_requests ?? 0,
});

/**
 * Claude, on the business's own key or OPERATOR credits (integrations/anthropic.ts claude()). Keeps what only
 * Claude has: prompt caching on every turn (card 200), effort, and the server-side refusal fallback.
 */
export const claudeClient = (stand?: ClaudeMessages): ModelClient => ({
  async turn(req) {
    const res = await (stand ?? (await claude())).beta.messages.create({
      model: req.model, max_tokens: req.maxOut,
      // each turn re-sends the whole prompt, so later turns read it from the cache
      cache_control: { type: "ephemeral" },
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      output_config: { effort: req.effort },
      system: req.system, tools: req.tools, messages: req.messages,
    });
    return { content: res.content, stopReason: res.stop_reason ?? null, model: res.model, usage: claudeUsage(res.usage) };
  },
});

/** What a provider client needs to send a turn; tests pass stand-ins so no key or network is touched. */
export interface ProviderDeps {
  key: (p: ModelProvider) => Promise<string | null>;
  pause: (p: ModelProvider, why: string, key: string) => Promise<void>;
  fetch: typeof fetch;
}
const LIVE: ProviderDeps = { key: modelKey, pause: pauseModelKey, fetch: (...a) => fetch(...a) };

/**
 * OpenAI, xAI or Google, only on the business's own key for that provider (core/model-key-rules.ts), opened
 * for this one request. The turn is translated at this edge (core/llm-wire.ts), so the runner's transcript
 * stays in the Claude shape. Never follows a redirect, never puts the key in an error, and pauses a key the
 * provider refuses so the next run doesn't try it again.
 */
export const providerClient = (provider: ModelProvider, deps: ProviderDeps = LIVE): ModelClient => ({
  async turn(req) {
    const p = PROVIDER_BY_ID[provider];
    const key = await deps.key(provider);
    if (!key) throw new Error(`No ${p.name} key on Connections > Other models, or it is paused. Paste one there to run this agent on ${req.model}.`);
    const t = req as unknown as ClaudeTurn;
    const body = p.turns.wire === "responses" ? toResponses(t) : toChat(t);
    let res: Response;
    try {
      res = await deps.fetch(p.turns.url, {
        method: "POST", headers: { [p.check.header]: `${p.check.prefix}${key}`, "content-type": "application/json" },
        body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(300_000),
      });
    } catch (e) { throw new Error(`${p.name} couldn't be reached: ${scrubSecrets(e instanceof Error ? e.message : String(e), [key]).slice(0, 160)}`); }
    if (!res.ok) {
      const said = scrubSecrets(await res.text().catch(() => ""), [key]).slice(0, 200);
      if (keyRefused(res.status)) {
        await deps.pause(provider, `${p.name} refused the key (${res.status}) during a run`, key);
        throw new Error(`${p.name} refused the key (${res.status}), so it is paused. Paste a working key on Connections > Other models.`);
      }
      throw new Error(`${p.name} answered ${res.status}: ${said}`);
    }
    const json = await res.json() as unknown;
    const reply = p.turns.wire === "responses" ? fromResponses(json as ResponsesResponse) : fromChat(json as ChatResponse);
    // billed by the model the run asked for: providers answer with a dated snapshot name that has no price here
    return { content: reply.content as Anthropic.Beta.BetaContentBlock[], stopReason: reply.stopReason, model: req.model, usage: reply.usage };
  },
});

/** The client for a model on the list. Throws for a model with no price before anything is sent; a provider with no key stops at the first turn. */
export function modelClient(model: string): ModelClient {
  const m = modelDef(model);
  if (!m) throw new Error(`No price for ${model} in integrations/models.ts`);
  return m.provider === "anthropic" ? claudeClient() : providerClient(m.provider);
}
