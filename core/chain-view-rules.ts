// A saved chain in words, for OPERATOR's MCP server (list_chains, docs/operator-mcp.md): who owns it, how it starts,
// each step and what links it to the one before. Pure: no database, no network, so `npm run check:mcp-chains` tests
// it. The chain itself goes back too, as saved, so a later draft can start from it.
import { chainOwner, quickCap, type Chain, type Step } from "@/core/flow-rules";
import { SIZE_LABEL, imageModel } from "@/core/image-rules";
import { linkWords, startWords } from "@/dashboard/chain-rules";

/** The labels a chain needs that live outside it. */
export interface ChainNames { agent: (id: string) => string; dept: (id: string) => string; chain: (key: string) => string; tool: (id: string) => string; model: (id: string) => string; claude: (id: string) => boolean }

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** One step in words: what it is and where it runs. */
export function stepWords(s: Step, n: ChainNames): { kind: "agent" | "claude" | "ask" | "image" | "ok"; what: string; runs: string } {
  if (s.ok) return { kind: "ok", what: `Wait for my OK${s.ok.note ? `: ${clip(s.ok.note, 120)}` : ""}`, runs: "An approval card in OPERATOR, up to 3 days" };
  if (s.image) return { kind: "image", what: `Make an image (${SIZE_LABEL[s.image.size].toLowerCase()}, ${s.image.quality} quality): ${clip(s.image.prompt, 160)}`, runs: `${imageModel(s.image.model)?.label ?? s.image.model} on the business's own key` };
  if (s.ask) return { kind: "ask", what: `Ask a model: ${clip(s.ask.prompt, 160)}`, runs: `${n.model(s.ask.model)}, up to $${s.ask.maxUsd.toFixed(2)} a run` };
  const id = s.agent ?? "?";
  return n.claude(id) ? { kind: "claude", what: n.agent(id), runs: "Its Claude routine (the chain waits for the result)" } : { kind: "agent", what: n.agent(id), runs: "OPERATOR" };
}

/** Whose chain it is, in words. */
export function ownerWords(c: Chain, n: ChainNames): string {
  const o = chainOwner(c);
  return !o ? "The company" : "dept" in o ? `The ${n.dept(o.dept)} department` : `${n.agent(o.agent)} (agent ${o.agent})`;
}

/** A saved chain as list_chains returns it. */
export function chainSummary(c: Chain, n: ChainNames) {
  return {
    key: c.key, name: c.name, on: c.on, owner: ownerWords(c, n),
    starts: startWords(c.start, n),
    steps: c.steps.map((s, k) => ({ step: k + 1, ...stepWords(s, n), ...(k > 0 ? { after_step_before: linkWords(s) } : {}) })),
    quick_steps_up_to_usd: Math.round(c.steps.reduce((t, s) => t + quickCap(s), 0) * 100) / 100,
    saved: c,
  };
}
