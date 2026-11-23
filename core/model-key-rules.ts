// Model providers other than Claude (docs/agent-setup.md, "Models across providers"; decided 2026-11-23):
// each business pastes its own key for a provider, sealed in the vault like the Claude key, and OPERATOR
// calls that provider directly. Pure rules here; the vault code is in integrations/mcp.ts.
// A provider key reaches every model on that account and carries no scopes, so there is nothing narrower
// to ask for; what a run may do stays limited by the runner and the gateway, the same as on Claude.

export type ModelProvider = "openai" | "xai" | "google";

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
}

export const MODEL_PROVIDERS: readonly ModelProviderDef[] = [
  {
    id: "openai", name: "OpenAI", vaultId: "openai_key",
    where: "platform.openai.com > Settings > API keys > Create new secret key",
    placeholder: "sk-…", shape: /^sk-[A-Za-z0-9_-]{20,300}$/,
    check: { url: "https://api.openai.com/v1/models", header: "authorization", prefix: "Bearer " },
    // function tools on current OpenAI models work only on the Responses API
    turns: { url: "https://api.openai.com/v1/responses", wire: "responses" },
  },
  {
    id: "xai", name: "xAI (Grok)", vaultId: "xai_key",
    where: "console.x.ai > API Keys > Create API Key",
    placeholder: "xai-…", shape: /^xai-[A-Za-z0-9_-]{20,300}$/,
    check: { url: "https://api.x.ai/v1/models", header: "authorization", prefix: "Bearer " },
    turns: { url: "https://api.x.ai/v1/responses", wire: "responses" },
  },
  {
    id: "google", name: "Google (Gemini)", vaultId: "google_ai_key",
    where: "aistudio.google.com > Get API key > Create API key",
    placeholder: "AIza…", shape: /^AIza[A-Za-z0-9_-]{30,60}$/,
    check: { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", header: "x-goog-api-key", prefix: "" },
    // Google's OpenAI-compatible endpoint
    turns: { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", wire: "chat" },
  },
];

export const PROVIDER_BY_ID: Readonly<Record<ModelProvider, ModelProviderDef>> = Object.fromEntries(MODEL_PROVIDERS.map((p) => [p.id, p])) as Record<ModelProvider, ModelProviderDef>;

export const isModelProvider = (v: unknown): v is ModelProvider => typeof v === "string" && v in PROVIDER_BY_ID;

/** The pasted key, trimmed, or why it is refused before the provider is asked. */
export function readModelKey(p: ModelProviderDef, pasted: unknown): { key: string } | { problem: string } {
  const key = typeof pasted === "string" ? pasted.trim() : "";
  if (!key || key.length > 300) return { problem: "That isn’t a key." };
  if (!p.shape.test(key)) return { problem: `That doesn’t look like a key from ${p.name} (it starts with ${p.placeholder.replace("…", "")}).` };
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
