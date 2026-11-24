import "server-only";
// One chain put into the saved flow and checked (chains slice 1, card 430), for the Chains tab's Save and Delete
// (dashboard/actions.ts) and for drafts from Claude (draft_chain, card 435): the same checks either way.
import { loadCrew } from "@/agents/registry";
import { flowProblems, loadFlow, type Chain, type Flow } from "@/core/flow";
import { billedBy } from "@/core/ask-rules";
import { imageModel } from "@/core/image-rules";
import { agentNames, loadOrg } from "@/core/org";
import { NO_MODEL_KEYS, draftOf, listSpecVersions, modelReady, versionStarts } from "@/core/agent-spec";
import { readStored, startsOnItsOwn } from "@/core/draft-starts-rules";
import { modelDef } from "@/integrations/models";
import { modelKeysReady } from "@/integrations/mcp";

/** An agent in a chain that runs only by hand today, whose waiting version starts it on its own at Go live. */
export interface WaitsOnGoLive { agent: string; name: string; version: number }

/**
 * Of these agents, the ones whose waiting draft (from Claude's update_agent) takes them off "only by hand" at Go
 * live (card 450). Read fresh; a draft saved in OPERATOR carries no starts, so it never counts.
 */
async function waitingSchedules(ids: readonly string[]): Promise<WaitsOnGoLive[]> {
  if (!ids.length) return [];
  const names = await agentNames([...ids]).catch(() => ({} as Record<string, string>));
  const out: WaitsOnGoLive[] = [];
  for (const id of ids) {
    const d = draftOf(await listSpecVersions(id));
    if (d && startsOnItsOwn(readStored(await versionStarts(id, d.version)))) out.push({ agent: id, name: names[id] ?? id, version: d.version });
  }
  return out;
}

/**
 * The saved flow with one chain from the browser put in (by key: replaced, or added) or taken out (`raw` null),
 * checked against the crew. A chain that starts after it is taken out with it, said in the refusal instead.
 * `asDrafted` (draft_chain only, card 450): an agent whose waiting version starts it on its own counts as
 * scheduled, and comes back in `waitsOn`; Save and Use still check today's crew and say which version to put live.
 */
export async function chainInFlow(key: string, raw: unknown, opts: { asDrafted?: boolean } = {}): Promise<{ now: Awaited<ReturnType<typeof loadFlow>>; next: Flow; waitsOn: WaitsOnGoLive[] } | { problem: string }> {
  const crew = await loadCrew();
  const now = await loadFlow(crew);
  if (raw === null) {
    const c = now.flow.chains.find((x) => x.key === key);
    if (!c) return { problem: "That chain isn’t saved." };
    const after = now.flow.chains.filter((x) => x.start.type === "after" && x.start.chain === key);
    if (after.length) return { problem: `${after.map((x) => x.name).join(", ")} start${after.length === 1 ? "s" : ""} after ${c.name}. Change ${after.length === 1 ? "its" : "their"} start first.` };
    return { now, next: { chains: now.flow.chains.filter((x) => x.key !== key) }, waitsOn: [] };
  }
  const c = raw as Chain;
  if (!c || typeof c !== "object" || c.key !== key) return { problem: "That isn’t a chain." };
  const has = now.flow.chains.some((x) => x.key === key);
  const next: Flow = { chains: has ? now.flow.chains.map((x) => (x.key === key ? c : x)) : [...now.flow.chains, c] };
  // agents that run only by hand today, in a chain that starts on its own: a waiting version may change that
  const byHand = c.start?.type !== "button" && Array.isArray(c.steps) ? [...new Set(c.steps.flatMap((s) => (s?.agent && crew.manualOnly.has(s.agent) ? [s.agent] : [])))] : [];
  const waiting = await waitingSchedules(byHand);
  const waitsOn = opts.asDrafted ? waiting : [];
  const check = waitsOn.length ? { ...crew, manualOnly: new Set([...crew.manualOnly].filter((id) => !waitsOn.some((w) => w.agent === id))) } : crew;
  const problems = flowProblems(next, check);
  if (problems.length) {
    const live = !opts.asDrafted && waiting.length ? ` ${waiting.map((w) => `${w.name}’s v${w.version} gives ${w.name} a start of its own: put v${w.version} live first, then save this chain.`).join(" ")}` : "";
    return { problem: `Not saved: ${problems.slice(0, 5).join(" ")}${live}` };
  }
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
  return { now, next, waitsOn };
}

