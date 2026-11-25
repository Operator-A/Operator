// Model providers other than Claude (docs/agent-setup.md, "Models across providers"; decided 2026-11-23):
// each business pastes its own key for a provider, sealed in the vault like the Claude key, and OPERATOR
// calls that provider directly. Pure rules here; the vault code is in integrations/mcp.ts.
// A provider key reaches every model on that account and carries no scopes, so there is nothing narrower
// to ask for; what a run may do stays limited by the runner and the gateway, the same as on Claude.
//
// The Vercel AI Gateway (conductor ticket 1, decided 2026-11-25) is one more key of the same kind: one key
// reaches every maker's models through Vercel, billed by Vercel at each maker's own price. It has its own
// card on Connections (`ownCard`), and its picture models are listed in core/image-rules.ts. Its key reaches
// only models; it can't change the Vercel account, and its budget is set on the key in Vercel.

export type ModelProvider = "openai" | "xai" | "google" | "gateway";

export interface ModelProviderDef {
  id: ModelProvider;
  name: string;
  /** The connection row the key is sealed on (mcp_connections.id). */
  vaultId: string;
  /** Where the owner makes a key, said click by click. */
  where: string;
  placeholder: string;
  /** A rough shape check before the provider is asked, so a pasted secret from somewhere else is refused. */
  shape: RegExp;
  /** One read-only call that only succeeds with a working key. Never follows a redirect. */
  check: { url: string; header: string; prefix: string };
  /** Where agent turns go, and in which shape (core/llm-wire.ts): the Responses API, or OpenAI-style chat
   *  completions. Same header as the check. Never follows a redirect. */
  turns: { url: string; wire: "responses" | "chat" };
  /** How a key from this provider starts, said when a pasted key doesn't fit; none when its keys have no fixed start. */
  starts?: string;
  /** Shown on a card of its own on Connections, not in the Other models list. */
  ownCard?: boolean;
}

export const MODEL_PROVIDERS: readonly ModelProviderDef[] = [
  {
    id: "openai", name: "OpenAI", vaultId: "openai_key",
    where: "platform.openai.com > Settings > API keys > Create new secret key",
    placeholder: "sk-…", starts: "sk-", shape: /^sk-[A-Za-z0-9_-]{20,300}$/,
    check: { url: "https://api.openai.com/v1/models", header: "authorization", prefix: "Bearer " },
    // function tools on current OpenAI models work only on the Responses API
    turns: { url: "https://api.openai.com/v1/responses", wire: "responses" },
  },
  {
    id: "xai", name: "xAI (Grok)", vaultId: "xai_key",
    where: "console.x.ai > API Keys > Create API Key",
    placeholder: "xai-…", starts: "xai-", shape: /^xai-[A-Za-z0-9_-]{20,300}$/,
    check: { url: "https://api.x.ai/v1/models", header: "authorization", prefix: "Bearer " },
    turns: { url: "https://api.x.ai/v1/responses", wire: "responses" },
  },
  {
    id: "google", name: "Google (Gemini)", vaultId: "google_ai_key",
    where: "aistudio.google.com > Get API key > Create API key",
    placeholder: "AIza…", starts: "AIza", shape: /^AIza[A-Za-z0-9_-]{30,60}$/,
    check: { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", header: "x-goog-api-key", prefix: "" },
    // Google's OpenAI-compatible endpoint
    turns: { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", wire: "chat" },
  },
  {
    id: "gateway", name: "AI Gateway", vaultId: "ai_gateway_key",
    where: "vercel.com > your team > AI Gateway > API Keys > Create key",
    placeholder: "Paste the key", shape: /^[A-Za-z0-9_-]{20,300}$/, ownCard: true,
    // the model list answers without a key, so the key is checked on the credits call, which needs one and changes nothing
    check: { url: "https://ai-gateway.vercel.sh/v1/credits", header: "authorization", prefix: "Bearer " },
    turns: { url: "https://ai-gateway.vercel.sh/v1/chat/completions", wire: "chat" },
  },
];

/** The AI Gateway's address, for its picture endpoint (integrations/llm.ts). */
export const GATEWAY_URL = "https://ai-gateway.vercel.sh";

export const PROVIDER_BY_ID: Readonly<Record<ModelProvider, ModelProviderDef>> = Object.fromEntries(MODEL_PROVIDERS.map((p) => [p.id, p])) as Record<ModelProvider, ModelProviderDef>;

export const isModelProvider = (v: unknown): v is ModelProvider => typeof v === "string" && v in PROVIDER_BY_ID;

/** Where the owner pastes this provider's key, for messages. */
export const keyPlace = (p: ModelProviderDef) => (p.ownCard ? `Connections > ${p.name}` : "Connections > Other models");

/** The pasted key, trimmed, or why it is refused before the provider is asked. */
export function readModelKey(p: ModelProviderDef, pasted: unknown): { key: string } | { problem: string } {
  const key = typeof pasted === "string" ? pasted.trim() : "";
  if (!key || key.length > 300) return { problem: "That isn’t a key." };
  if (!p.shape.test(key)) return { problem: p.starts ? `That doesn’t look like a key from ${p.name} (it starts with ${p.starts}).` : `That doesn’t look like an ${p.name} key.` };
  return { key };
}

/** What the provider's answer to the check call means. */
export function checkAnswer(p: ModelProviderDef, status: number): { ok: true } | { problem: string } {
  if (status >= 200 && status < 300) return { ok: true };
  if (status === 400 || status === 401 || status === 403) return { problem: `${p.name} didn’t accept that key.` };
  return { problem: `${p.name} answered ${status} when checking the key. Try again in a minute.` };
}

/** What a refused turn means for the key: a key the provider no longer accepts is paused until the owner pastes a new one. */
export const keyRefused = (status: number) => status === 401 || status === 403;

/** The gateway's answer when the key's budget in Vercel is used up (402): the step stops and says so, and the key isn't paused. */
export const budgetGone = (status: number) => status === 402;
