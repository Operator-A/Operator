import "server-only";
// One chain put into the saved flow and checked (chains slice 1, card 430), for the Chains tab's Save and Delete
// (dashboard/actions.ts) and for drafts from Claude (draft_chain, card 435): the same checks either way.
import { loadCrew } from "@/agents/registry";
import { flowProblems, loadFlow, type Chain, type Flow } from "@/core/flow";
import { billedBy } from "@/core/ask-rules";
import { imageModel } from "@/core/image-rules";
import { loadOrg } from "@/core/org";
import { NO_MODEL_KEYS, modelReady } from "@/core/agent-spec";
import { modelDef } from "@/integrations/models";
import { modelKeysReady } from "@/integrations/mcp";

/**
 * The saved flow with one chain from the browser put in (by key: replaced, or added) or taken out (`raw` null),
 * checked against the crew. A chain that starts after it is taken out with it, said in the refusal instead.
 */
export async function chainInFlow(key: string, raw: unknown): Promise<{ now: Awaited<ReturnType<typeof loadFlow>>; next: Flow } | { problem: string }> {
  const crew = await loadCrew();
  const now = await loadFlow(crew);
  if (raw === null) {
    const c = now.flow.chains.find((x) => x.key === key);
    if (!c) return { problem: "That chain isn’t saved." };
    const after = now.flow.chains.filter((x) => x.start.type === "after" && x.start.chain === key);
    if (after.length) return { problem: `${after.map((x) => x.name).join(", ")} start${after.length === 1 ? "s" : ""} after ${c.name}. Change ${after.length === 1 ? "its" : "their"} start first.` };
    return { now, next: { chains: now.flow.chains.filter((x) => x.key !== key) } };
  }
  const c = raw as Chain;
  if (!c || typeof c !== "object" || c.key !== key) return { problem: "That isn’t a chain." };
  const has = now.flow.chains.some((x) => x.key === key);
  const next: Flow = { chains: has ? now.flow.chains.map((x) => (x.key === key ? c : x)) : [...now.flow.chains, c] };
  const problems = flowProblems(next, crew);
  if (problems.length) return { problem: `Not saved: ${problems.slice(0, 5).join(" ")}` };
  // Ask a model steps (chains slice 2): an agent must be there to pay, and the model must be able to run here
  // and Make an image steps (slice 4): the same, on the image model's provider key
  const asks = c.steps.flatMap((s) => (s.ask ? [s.ask] : []));
  const images = c.steps.flatMap((s) => (s.image ? [s.image] : []));
  if (asks.length || images.length) {
    const payer = billedBy(c, await loadOrg());
    if ("problem" in payer) return { problem: `Not saved: ${asks.length ? payer.problem : payer.problem.replace("Ask a model", "Make an image")}` };
    const keys = await modelKeysReady().catch(() => NO_MODEL_KEYS);
    const off = asks.find((a) => !modelReady(a.model, keys));
    if (off) return { problem: `Not saved: ${modelDef(off.model)?.label ?? off.model} needs its provider’s key on Connections > Other models.` };
    const offImg = images.find((i) => { const m = imageModel(i.model); return !m || !keys[m.provider]; });
    if (offImg) return { problem: `Not saved: ${imageModel(offImg.model)?.label ?? offImg.model} needs its provider’s key on Connections > Other models.` };
  }
  return { now, next };
}

