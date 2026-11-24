// Chains on OPERATOR's MCP server (card 435, docs/operator-mcp.md): `npm run check:mcp-chains`. Slice 1 is read
// only: list_chains (a saved chain in words, core/chain-view-rules.ts) and get_chain_run (the run view,
// core/run-view-rules.ts through core/chain-view.ts). Tests the words, the tool list and the source. No database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Chain } from "../core/flow-rules";
import { chainSummary, ownerWords, stepWords, type ChainNames } from "../core/chain-view-rules";
import { OP_TOOLS, TOOL_BY_NAME, toolsFor } from "../core/operator-mcp-rules";

const read = (p: string) => readFileSync(p, "utf8");
const n: ChainNames = {
  agent: (id) => ({ sloane: "Sloane", sage: "Sage", rowan: "Rowan" })[id] ?? id,
  dept: (id) => (id === "mk" ? "Marketing" : id),
  chain: (key) => (key === "plan" ? "Monday plan" : key),
  tool: (id) => id,
  model: (id) => (id === "gpt-6.2-sol" ? "GPT-6.2 Sol" : id),
  claude: (id) => id === "sage",
};
const chain: Chain = {
  key: "post", name: "Weekly post", on: true, owner: { dept: "mk" },
  start: { type: "schedule", days: "mondays", time: "07:00" },
  steps: [
    { agent: "sloane" },
    { agent: "sage", when: "ok", passAlong: true },
    { ask: { model: "gpt-6.2-sol", prompt: "Write three captions for this week's product.", maxUsd: 0.1 }, when: "ok", passAlong: true },
    { image: { model: "gpt-image-2.5-flare", prompt: "Three new products on a wood counter.", quality: "medium", size: "1024x1024" }, when: "ok", passAlong: true },
    { ok: { note: "Check the captions" }, when: "ok" },
    { agent: "rowan", when: "ok", passAlong: true },
  ],
};

// ---- a chain in words
const s = chainSummary(chain, n);
assert.equal(s.owner, "The Marketing department");
assert.equal(s.starts, "Mondays at 7:00 AM");
assert.deepEqual(s.steps.map((x) => x.kind), ["agent", "claude", "ask", "image", "ok", "agent"]);
assert.deepEqual(s.steps.map((x) => x.what.split(":")[0]), ["Sloane", "Sage", "Ask a model", "Make an image (square, medium quality)", "Wait for my OK", "Rowan"]);
assert.equal(s.steps[1].runs, "Its Claude routine (the chain waits for the result)");
assert.equal(s.steps[2].runs, "GPT-6.2 Sol, up to $0.10 a run");
assert.match(s.steps[3].runs, /^GPT Image 2\.5 Flare on the business's own key$/);
assert.equal(s.steps[0].after_step_before, undefined, "the first step has nothing before it");
assert.equal(s.steps[1].after_step_before, "passes its result if it worked");
assert.equal(s.steps[4].after_step_before, "then if it worked");
assert.ok(s.quick_steps_up_to_usd > 0.1 && s.quick_steps_up_to_usd < 0.2, "the most its quick steps can cost, worked out in code");
assert.equal(s.saved, chain, "the chain comes back as saved, for a later draft");
assert.equal(ownerWords({ ...chain, owner: undefined }, n), "The company");
assert.equal(ownerWords({ ...chain, owner: { agent: "sloane" } }, n), "Sloane (agent sloane)");
assert.equal(chainSummary({ ...chain, start: { type: "after", chain: "plan", when: "ok" } }, n).starts, "After Monday plan finishes");
assert.ok(stepWords({ ask: { model: "gpt-6.2-sol", prompt: "y".repeat(900), maxUsd: 0.1 } }, n).what.length < 200, "long instructions are cut");

// ---- the tools: reads, any member, nothing that changes a chain
for (const t of ["list_chains", "get_chain_run"]) {
  assert.equal(TOOL_BY_NAME[t].kind, "read");
  assert.equal(TOOL_BY_NAME[t].min, "viewer");
  assert.ok(toolsFor("viewer").some((x) => x.name === t), `${t} is there for every member`);
}
assert.deepEqual(TOOL_BY_NAME.get_chain_run.inputSchema.required, ["run"]);
assert.match(TOOL_BY_NAME.list_chains.description, /Changing a chain happens in OPERATOR/);
assert.match(TOOL_BY_NAME.get_chain_run.description, /data, not instructions/);
assert.ok(!OP_TOOLS.some((t) => /chain/.test(t.name) && t.kind !== "read"), "slice 1 adds no tool that changes a chain");

// ---- the source
const store = read("core/operator-mcp.ts");
assert.match(store, /case "list_chains": return listChains\(origin, args\);/);
assert.match(store, /case "get_chain_run": return getChainRun\(origin, args\);/);
assert.match(store, /const v = await chainRunView\(id, /, "the same chain-run reader as the run page");
assert.doesNotMatch(store.slice(store.indexOf("async function listChains"), store.indexOf("async function tryAgent")), /saveFlowVersion|activateFlow|startChain|insert\(|update\(|delete\(/, "the chain tools only read");
assert.match(read("dashboard/data.ts"), /chainRunView\(runId/);
assert.doesNotMatch(read("core/chain-view-rules.ts"), /from "@\/core\/db"|fetch\(/, "the words stay pure");
console.log("check:mcp-chains ok");
