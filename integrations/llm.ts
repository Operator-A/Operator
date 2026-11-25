import "server-only";
// One model interface for agent runs (docs/agent-setup.md, "Models across providers"). The runner sends
// one turn and gets the reply and its token counts back in one shape, whichever provider serves it.
//
// The transcript keeps the Claude Messages shape (text, tool_use, tool_result, thinking, server tools):
// it holds everything other providers return, so a client for another provider translates at its own
// edge and the runner never changes. Cost stays in code (costUsd), from the counts in TurnUsage.
import { Anthropic, claude, inputTokens, ownClaude } from "./anthropic";
import { modelDef } from "./models";
import { modelKey, pauseModelKey } from "./mcp";
import { GATEWAY_URL, PROVIDER_BY_ID, budgetGone, gatewayClaudeId, keyPlace, keyRefused, type ModelProvider } from "@/core/model-key-rules";
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

/** What the Claude client needs besides the turn; tests pass stand-ins so no key or network is touched. */
export interface ClaudeDeps {
  /** The AI Gateway key, opened for this turn; null when there is none or it is paused. */
  gatewayKey: () => Promise<string | null>;
  pauseGateway: (why: string, key: string) => Promise<void>;
  /** A Messages client on the gateway key. */
  viaGateway: (key: string) => ClaudeMessages;
  /** The business's own Claude key, the backup; null when it has none. */
  own: () => Promise<ClaudeMessages | null>;
  /** The usual client: its own key, else OPERATOR credits (integrations/anthropic.ts claude()). */
  usual: () => Promise<ClaudeMessages>;
}

/** The gateway's Anthropic-compatible Messages endpoint, on the business's gateway key. Never follows a redirect. */
const gatewayMessages = (key: string): ClaudeMessages => new Anthropic({
  baseURL: GATEWAY_URL, apiKey: null, authToken: key, maxRetries: 1,
  fetch: (url: string | URL | Request, init?: RequestInit) => fetch(url, { ...init, redirect: "error" }),
});
const CLAUDE_LIVE: ClaudeDeps = {
  gatewayKey: () => modelKey("gateway"), pauseGateway: (why, key) => pauseModelKey("gateway", why, key),
  viaGateway: gatewayMessages, own: ownClaude, usual: claude,
};

/**
 * Claude. With an AI Gateway key saved (conductor ticket 1b, decided 2026-11-25), every turn goes through the gateway,
 * billed by Vercel at Anthropic's price; if the gateway can't run it (down, refused, a request it won't take), the
 * turn is sent again on the business's own Claude key when it has one, never on credits. A used-up gateway budget
 * (402) stops the run instead: the owner set that budget as a limit. Without a gateway key: the business's own key or
 * OPERATOR credits, as before. Keeps what only Claude has: prompt caching on every turn (card 200), effort, and,
 * straight to Anthropic, the server-side refusal fallback.
 */
export const claudeClient = (stand?: ClaudeMessages, deps: ClaudeDeps = CLAUDE_LIVE): ModelClient => ({
  async turn(req) {
    const body = {
      model: req.model, max_tokens: req.maxOut,
      // each turn re-sends the whole prompt, so later turns read it from the cache
      cache_control: { type: "ephemeral" },
      output_config: { effort: req.effort },
      system: req.system, tools: req.tools, messages: req.messages,
    } satisfies Anthropic.Beta.MessageCreateParamsNonStreaming;
    const direct = { ...body, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as Anthropic.Beta.MessageCreateParamsNonStreaming;
    const done = (res: Anthropic.Beta.BetaMessage, model: string): TurnResult => ({ content: res.content, stopReason: res.stop_reason ?? null, model, usage: claudeUsage(res.usage) });
    if (stand) { const res = await stand.beta.messages.create(direct); return done(res, res.model); }
    const gw = await deps.gatewayKey();
    if (!gw) { const res = await (await deps.usual()).beta.messages.create(direct); return done(res, res.model); }
    try {
      // the gateway names Claude its own way and answers with that name, so the run is billed by the model it asked for
      const res = await deps.viaGateway(gw).beta.messages.create({ ...body, model: gatewayClaudeId(req.model) } as Anthropic.Beta.MessageCreateParamsNonStreaming);
      return done(res, req.model);
    } catch (e) {
      const status = typeof (e as { status?: unknown }).status === "number" ? (e as { status: number }).status : null;
      const said = scrubSecrets(e instanceof Error ? e.message : String(e), [gw]).slice(0, 160);
      if (status !== null && budgetGone(status)) throw new Error("The AI Gateway key’s budget in Vercel is used up, so this run stopped. Raise it in Vercel under AI Gateway > API Keys, or add credits.");
      if (status !== null && keyRefused(status)) await deps.pauseGateway(`AI Gateway refused the key (${status}) during a Claude run`, gw);
      const own = await deps.own();
      if (!own) throw new Error(`The AI Gateway couldn’t run Claude (${status ?? "no answer"}: ${said}), and there’s no Claude key of your own to fall back on.`);
      const res = await own.beta.messages.create(direct);
      return done(res, res.model);
    }
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
    if (!key) throw new Error(`No ${p.name} key on ${keyPlace(p)}, or it is paused. Paste one there to run this agent on ${req.model}.`);
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
        throw new Error(`${p.name} refused the key (${res.status}), so it is paused. Paste a working key on ${keyPlace(p)}.`);
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

/** One picture back from an image model (chains slice 4): its bytes and the provider's own counts, for the cost in code. */
export interface ImageResult { bytes: Uint8Array; usage: { textIn: number; imageOut: number } }
/** A quality is sent only to a model that takes one (core/image-rules.ts takesQuality). */
export interface ImageClient { make(req: { model: string; prompt: string; size: string; quality?: string }): Promise<ImageResult> }

/** Where each provider makes pictures: OpenAI's own endpoint on the business's OpenAI key, or the AI Gateway's (conductor ticket 1). */
const IMAGE_URL: Partial<Record<ModelProvider, string>> = { openai: "https://api.openai.com/v1/images/generations", gateway: `${GATEWAY_URL}/v1/images/generations` };

/** The request body for each provider: OpenAI's own fields, or the gateway's OpenAI-compatible ones (a base64 picture back). */
const imageBody = (provider: ModelProvider, req: Parameters<ImageClient["make"]>[0]) =>
  provider === "gateway"
    ? { model: req.model, prompt: req.prompt, n: 1, size: req.size, response_format: "b64_json", ...(req.quality ? { quality: req.quality } : {}) }
    : { model: req.model, prompt: req.prompt, size: req.size, quality: req.quality, n: 1, output_format: "png" };

/**
 * An image model on the business's own key for its provider (the AI Gateway key for gateway models), opened for this
 * one request, like providerClient: never follows a redirect, never puts the key in an error, pauses a refused key. A
 * gateway key whose budget in Vercel is used up (402) isn't paused: the step stops and says so. One picture per request.
 */
export const imageClient = (provider: ModelProvider, deps: ProviderDeps = LIVE): ImageClient => ({
  async make(req) {
    const p = PROVIDER_BY_ID[provider], url = IMAGE_URL[provider];
    if (!url) throw new Error(`OPERATOR doesn’t make pictures on ${p.name} yet.`);
    const key = await deps.key(provider);
    if (!key) throw new Error(`No ${p.name} key on ${keyPlace(p)}, or it is paused. Paste one there to make pictures on ${req.model}.`);
    let res: Response;
    try {
      res = await deps.fetch(url, {
        method: "POST", headers: { [p.check.header]: `${p.check.prefix}${key}`, "content-type": "application/json" },
        body: JSON.stringify(imageBody(provider, req)),
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(240_000),
      });
    } catch (e) { throw new Error(`${p.name} couldn't be reached: ${scrubSecrets(e instanceof Error ? e.message : String(e), [key]).slice(0, 160)}`); }
    if (!res.ok) {
      const said = scrubSecrets(await res.text().catch(() => ""), [key]).slice(0, 200);
      if (keyRefused(res.status)) {
        await deps.pause(provider, `${p.name} refused the key (${res.status}) making a picture`, key);
        throw new Error(`${p.name} refused the key (${res.status}), so it is paused. Paste a working key on ${keyPlace(p)}.`);
      }
      if (provider === "gateway" && budgetGone(res.status)) throw new Error("The AI Gateway key’s budget in Vercel is used up, so no picture was made. Raise it in Vercel under AI Gateway > API Keys, or add credits.");
      throw new Error(`${p.name} answered ${res.status}: ${said}`);
    }
    const json = await res.json() as { data?: { b64_json?: string }[]; usage?: { output_tokens?: number; input_tokens?: number; input_tokens_details?: { text_tokens?: number } } };
    // some answers carry a data address (data:image/png;base64,…) rather than bare base64
    const b64 = json.data?.[0]?.b64_json?.replace(/^data:image\/[a-z]+;base64,/, "");
    if (!b64) throw new Error(`${p.name} sent no picture back.`);
    const u = json.usage ?? {};
    return { bytes: new Uint8Array(Buffer.from(b64, "base64")), usage: { textIn: u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0, imageOut: u.output_tokens ?? 0 } };
  },
});
