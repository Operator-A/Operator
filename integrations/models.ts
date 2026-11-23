import "server-only";
import type { ModelProvider } from "@/core/model-key-rules";
// Every model an agent may use, with its price and what it can do (docs/agent-setup.md, slice 3).
// Prices live here, in code, so cost lands in agent_runs the same way for every provider.
//
// A run reaches its model through one interface (integrations/llm.ts), which picks the client by
// provider: Claude on the business's own key or credits, the others only on the business's own key for
// that provider (docs/agent-setup.md, "Models across providers"). Check a provider's price page on the
// day a model is added (the ones below: 2026-11-23). Adding a model is a pull request on purpose: the
// Control Room can only pick from this list.

/** What a step can ask of a model. A step's menu names what it needs; only models with all of it are offered. */
export type Cap = "structured-output" | "anthropic-web-search" | "pdf" | "reasoning";

export interface ModelDef {
  id: string;
  label: string;
  /** Who serves it; integrations/llm.ts picks the client by this. */
  provider: "anthropic" | ModelProvider;
  /** $ per token. */
  in: number;
  out: number;
  /** $ per cached input token, for providers that price a cache read on their own (not as a share of `in`)
   *  and charge nothing extra to write one. Claude's cache rates are in integrations/anthropic.ts. */
  cacheIn?: number;
  caps: readonly Cap[];
}

const M = 1e-6;
const LIST: ModelDef[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", in: 4 * M, out: 20 * M, caps: ["structured-output", "anthropic-web-search", "pdf", "reasoning"] },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", in: 2 * M, out: 10 * M, caps: ["structured-output", "anthropic-web-search", "pdf", "reasoning"] },
  // prompts up to 100K tokens; every agent's prompt is a few thousand
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", in: 0.1 * M, out: 0.5 * M, caps: ["structured-output", "anthropic-web-search", "pdf", "reasoning"] },
  // Other providers: no Claude web search (server tools run on Claude's side), no PDFs through our wire
  { id: "gpt-6.2-sol", label: "GPT-6.2 Sol", provider: "openai", in: 2 * M, cacheIn: 0.1 * M, out: 10 * M, caps: ["structured-output", "reasoning"] },
  { id: "grok-4.7", label: "Grok 4.7", provider: "xai", in: 2 * M, cacheIn: 0.5 * M, out: 6 * M, caps: ["structured-output", "reasoning"] },
  { id: "grok-4.3", label: "Grok 4.3", provider: "xai", in: 1.25 * M, cacheIn: 0.2 * M, out: 2.5 * M, caps: ["structured-output", "reasoning"] },
  // prompts up to 200K tokens; preview models can be withdrawn by Google
  { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (preview)", provider: "google", in: 2 * M, cacheIn: 0.2 * M, out: 12 * M, caps: ["structured-output", "reasoning"] },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", provider: "google", in: 0.25 * M, cacheIn: 0.025 * M, out: 1.5 * M, caps: ["structured-output", "reasoning"] },
];

export const MODEL_LIST: readonly ModelDef[] = LIST;
export const MODEL_BY_ID: Readonly<Record<string, ModelDef>> = Object.fromEntries(LIST.map((m) => [m.id, m]));
export const modelDef = (id: string): ModelDef | null => MODEL_BY_ID[id] ?? null;

/** Model ids that can do everything a step needs, in list order. */
export const modelsFor = (needs: readonly Cap[]): string[] => LIST.filter((m) => needs.every((c) => m.caps.includes(c))).map((m) => m.id);
