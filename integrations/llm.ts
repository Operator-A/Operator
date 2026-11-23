import "server-only";
// One model interface for agent runs (docs/agent-setup.md, "Models across providers"). The runner sends
// one turn and gets the reply and its token counts back in one shape, whichever provider serves it.
//
// The transcript keeps the Claude Messages shape (text, tool_use, tool_result, thinking, server tools):
// it holds everything other providers return, so a client for another provider translates at its own
// edge and the runner never changes. Cost stays in code (costUsd), from the counts in TurnUsage.
import { Anthropic, claude, inputTokens } from "./anthropic";
import { modelDef } from "./models";

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

/** The client for a model on the list. Throws for a model whose provider isn't connected, before anything is sent. */
export function modelClient(model: string): ModelClient {
  const m = modelDef(model);
  if (!m) throw new Error(`No price for ${model} in integrations/models.ts`);
  switch (m.provider) {
    case "Anthropic": return claudeClient();
  }
}
