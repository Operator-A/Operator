import "server-only";
// Runs one Ask a model step (chains slice 2, docs/chains.md) inside withRun: one turn, no tools, text back, cost
// worked out in code from the model's price and stopped at the step's cap. The rules are in core/ask-rules.ts.
import { ASK, type Ask } from "@/core/flow-rules";
import { askMessages, keepText, maxOutFor, tokensIn, type AskFacts } from "@/core/ask-rules";
import type { RunResult } from "@/core/runs";
import { costUsd } from "@/integrations/anthropic";
import { modelClient, type ModelClient } from "@/integrations/llm";
import { modelDef } from "@/integrations/models";

export async function runAsk(a: Ask, facts: AskFacts | null, client?: ModelClient): Promise<RunResult> {
  const m = modelDef(a.model);
  if (!m) return { status: "skipped", summary: `Ask a model: ${a.model} isn’t on OPERATOR’s model list any more. Pick another model on the chain.` };
  const { system, user } = askMessages(a, facts);
  const maxOut = maxOutFor(m, tokensIn(system + user), a.maxUsd, ASK.outMax);
  if (maxOut < 50) return { status: "skipped", summary: `Ask a model: the instruction and facts alone would reach the $${a.maxUsd.toFixed(2)} cap on ${m.label}. Raise the cap or pick a cheaper model.` };
  const res = await (client ?? modelClient(a.model)).turn({
    model: a.model, maxOut, effort: "low", tools: [],
    system: [{ type: "text", text: system }],
    messages: [{ role: "user", content: [{ type: "text", text: user }] }],
  });
  const text = keepText(res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"));
  const cost = costUsd(a.model, res.usage.tokensIn, res.usage.tokensOut, 0, { write: res.usage.cacheWrite, read: res.usage.cacheRead });
  const base = { tokensIn: res.usage.tokensIn, tokensOut: res.usage.tokensOut, costUsd: cost };
  if (!text) return { ...base, status: "skipped", summary: `Ask a model: ${m.label} answered with no text${res.stopReason === "max_tokens" ? " before the cap ran out" : ""}.` };
  return { ...base, status: "ok", summary: res.stopReason === "max_tokens" ? `${text}\n(cut at the step’s $${a.maxUsd.toFixed(2)} cap)` : text };
}
