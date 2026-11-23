import "server-only";
// Every model an agent may use, with its price and what it can do (docs/agent-setup.md, slice 3).
// Prices live here, in code, so cost lands in agent_runs the same way for every provider.
//
// A run reaches its model through one interface (integrations/llm.ts), which picks the client by
// provider. Only Claude is connected today; other providers come with their own keys in the vault
// (docs/agent-setup.md, "Models across providers"). Check a provider's price page on the day a model
// is added. Adding a model is a pull request on purpose: the Control Room can only pick from this list.

/** What a step can ask of a model. A step's menu names what it needs; only models with all of it are offered. */
export type Cap = "structured-output" | "anthropic-web-search" | "pdf" | "reasoning";

export interface ModelDef {
  id: string;
  label: string;
  /** Who serves it; integrations/llm.ts picks the client by this. */
  provider: "Anthropic";
  /** $ per token. */
  in: number;
  out: number;
  /** Tokens. */
  context: number;
  caps: readonly Cap[];
}

const M = 1e-6;
const LIST: ModelDef[] = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "Anthropic", in: 4 * M, out: 20 * M, context: 1_000_000, caps: ["structured-output", "anthropic-web-search", "pdf", "reasoning"] },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "Anthropic", in: 2 * M, out: 10 * M, context: 1_000_000, caps: ["structured-output", "anthropic-web-search", "pdf", "reasoning"] },
  // prompts up to 100K tokens; every agent's prompt is a few thousand
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "Anthropic", in: 0.1 * M, out: 0.5 * M, context: 1_000_000, caps: ["structured-output", "anthropic-web-search", "pdf", "reasoning"] },
];

export const MODEL_LIST: readonly ModelDef[] = LIST;
export const MODEL_BY_ID: Readonly<Record<string, ModelDef>> = Object.fromEntries(LIST.map((m) => [m.id, m]));
export const modelDef = (id: string): ModelDef | null => MODEL_BY_ID[id] ?? null;

/** Model ids that can do everything a step needs, in list order. */
export const modelsFor = (needs: readonly Cap[]): string[] => LIST.filter((m) => needs.every((c) => m.caps.includes(c))).map((m) => m.id);
