// Chains on OPERATOR's MCP server (card 435, docs/operator-mcp.md): `npm run check:mcp-chains`. Slice 1 reads:
// list_chains (a saved chain in words, core/chain-view-rules.ts) and get_chain_run (the run view,
// core/run-view-rules.ts through core/chain-view.ts). Slice 2 drafts: draft_chain keeps a draft
// (core/chain-draft-rules.ts, core/chain-drafts.ts) that the owner uses through the Chains tab's own Save or discards.
// Tests the words, the draft rules, the tool list and the source. No database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Chain } from "../core/flow-rules";
import { chainSummary, ownerWords, stepWords, type ChainNames } from "../core/chain-view-rules";
import { OP_TOOLS, TOOL_BY_NAME, toolsFor } from "../core/operator-mcp-rules";
import { CHAIN_DRAFT, draftChanges, draftStale, readDraftChain } from "../core/chain-draft-rules";

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
assert.match(TOOL_BY_NAME.list_chains.description, /owner uses or discards the draft in OPERATOR/);
assert.match(TOOL_BY_NAME.get_chain_run.description, /data, not instructions/);
assert.deepEqual(OP_TOOLS.filter((t) => /chain/.test(t.name) && t.kind !== "read").map((t) => t.name), ["draft_chain"], "the only chain tool that writes is the draft");

// ---- draft_chain: a draft, owners only, the chain as JSON text
const dt = TOOL_BY_NAME.draft_chain;
assert.equal(dt.kind, "draft");
assert.equal(dt.min, "owner");
assert.ok(!toolsFor("approver").some((x) => x.name === "draft_chain") && toolsFor("owner").some((x) => x.name === "draft_chain"), "only owners draft chains");
assert.deepEqual(dt.inputSchema.required, ["chain"]);
assert.match(dt.description, /never turns a chain on or runs it/);
assert.match(dt.description, /Nothing changes until the owner opens the draft/);
assert.match(dt.description, new RegExp(`deleted after ${CHAIN_DRAFT.keepDays} days`));

// ---- reading a draft: a new chain is off, a changed one keeps on or off as saved
const asText = (c: unknown) => JSON.stringify(c);
const fresh = readDraftChain(asText({ ...chain, key: "launch", name: "Launch day", on: true }), [chain]);
assert.ok("chain" in fresh && fresh.base === null && fresh.chain.on === false, "a new chain is drafted off, whatever Claude sent");
const kept = readDraftChain(asText({ ...chain, on: false, name: "Weekly post v2" }), [chain]);
assert.ok("chain" in kept && kept.base === chain && kept.chain.on === true, "a changed chain stays on as saved");
const keptOff = readDraftChain(asText({ ...chain, on: true }), [{ ...chain, on: false }]);
assert.ok("chain" in keptOff && keptOff.chain.on === false, "a draft never turns a saved chain on");
for (const bad of ["not json", "[1,2]", "null", asText({ name: "x", steps: [{ agent: "sloane" }] }), asText({ key: "x", steps: [] })]) {
  assert.ok("problem" in readDraftChain(bad, [chain]), `refused: ${bad.slice(0, 30)}`);
}

// ---- out of date: the saved chain moved since the draft was made
assert.equal(draftStale(chain, chain), false);
assert.equal(draftStale(chain, { ...chain, name: "Renamed in OPERATOR" }), true);
assert.equal(draftStale(chain, null), true, "deleted since");
assert.equal(draftStale(null, null), false);
assert.equal(draftStale(null, chain), true, "a new chain's key was taken meanwhile");

// ---- what a draft changes, in words
const born = draftChanges(null, { ...chain, key: "launch", name: "Launch day", on: false }, n);
assert.match(born[0], /^New chain “Launch day”, saved off/);
assert.equal(born[1], "Starts: Mondays at 7:00 AM");
assert.equal(born.length, 2 + chain.steps.length);
assert.match(born[2], /^Step 1: Sloane/);
const moved = draftChanges(chain, { ...chain, name: "Weekly post v2", start: { type: "button" }, steps: [...chain.steps.slice(0, 5), { agent: "sloane", when: "ok", passAlong: true }, { agent: "rowan", when: "any" }] }, n);
assert.ok(moved.includes("Name: “Weekly post” → “Weekly post v2”"));
assert.ok(moved.some((x) => /^Start: Mondays at 7:00 AM → /.test(x)));
assert.ok(moved.some((x) => /^Step 6: Rowan.* → Sloane/.test(x)));
assert.ok(moved.some((x) => /^Step 7 added: Rowan/.test(x)));
assert.ok(draftChanges(chain, { ...chain, steps: chain.steps.slice(0, 2) }, n).some((x) => /^Step 3 removed: Ask a model/.test(x)));
assert.ok(draftChanges(chain, { ...chain, owner: { agent: "sloane" } }, n).includes("Owner changes"));
assert.ok(draftChanges(chain, { ...chain, steps: chain.steps.map((x, k) => (k === 1 ? { ...x, when: "any" as const } : x)) }, n).some((x) => /^Step 2: Sage.*conditions or settings change$/.test(x)));
assert.deepEqual(draftChanges(chain, chain, n), ["Nothing changes from the saved chain"]);

// ---- the source
const store = read("core/operator-mcp.ts");
assert.match(store, /case "list_chains": return listChains\(origin, args\);/);
assert.match(store, /case "get_chain_run": return getChainRun\(origin, args\);/);
assert.match(store, /const v = await chainRunView\(id, /, "the same chain-run reader as the run page");
assert.doesNotMatch(store.slice(store.indexOf("async function listChains"), store.indexOf("async function tryAgent")), /saveFlowVersion|activateFlow|startChain|insert\(|update\(|delete\(/, "the chain tools only read");
assert.match(read("dashboard/data.ts"), /chainRunView\(runId/);
assert.doesNotMatch(read("core/chain-view-rules.ts"), /from "@\/core\/db"|fetch\(/, "the words stay pure");

// ---- draft_chain's source: the Save button's checks, a draft row, never a saved chain
const dc = store.slice(store.indexOf("async function draftChain"), store.indexOf("async function tryAgent"));
assert.match(store, /case "draft_chain": return draftChain\(caller, origin, args\);/);
assert.match(dc, /readDraftChain\(String\(args\.chain\), flow\.chains\)/);
assert.match(dc, /await chainInFlow\(r\.chain\.key, r\.chain, \{ asDrafted: true \}\)/, "the same checks as saving in OPERATOR, with waiting versions' starts (card 450)");
assert.match(dc, /waits_on_go_live/, "the answer says which version must go live before the draft can be used");
assert.match(dc, /saveChainDraft\(/);
assert.match(dc, /audit\(caller\.member, "draft_chain"/);
assert.doesNotMatch(dc, /saveFlowVersion|activateFlow|startChain|runChain/, "a draft never saves, turns on or runs a chain");
const save = read("core/chain-save.ts");
assert.match(save, /export async function chainInFlow\(key: string, raw: unknown, opts: \{ asDrafted\?: boolean \} = \{\}\)/);
assert.match(save, /flowProblems\(next, check\)/);
// card 450: only a draft counts a waiting version's starts; Save and Use check today's crew and name the version to put live
assert.match(save, /const waitsOn = opts\.asDrafted \? waiting : \[\]/);
assert.match(save, /put v\$\{w\.version\} live first, then save this chain/);
assert.match(save, /startsOnItsOwn\(readStored\(await versionStarts\(id, d\.version\)\)\)/, "read fresh from the waiting version");
for (const f of ["dashboard/actions.ts"]) assert.doesNotMatch(read(f), /asDrafted/, "Save and Use never count a waiting version");

// ---- using and discarding in OPERATOR
const act = read("dashboard/actions.ts");
const sc = act.slice(act.indexOf("export async function saveChain"), act.indexOf("export async function", act.indexOf("export async function saveChain") + 10));
assert.match(sc, /draftId\?: string \| null/);
assert.match(sc, /draftStale\(fromDraft\.base,/, "an out-of-date draft is refused");
assert.match(sc, /fromDraft\.key !== key/, "a draft is used only on its own chain");
assert.ok(sc.indexOf("saveFlowVersion(") < sc.indexOf("dropChainDraft("), "the draft goes only after the save");
assert.match(sc, /asksConfirm|flowLooser|Confirm first|chainInFlow/, "the same save, with its confirm");
const dd = act.slice(act.indexOf("export async function discardChainDraft"));
assert.match(dd.slice(0, 600), /asRole\("owner"\)/);
assert.match(dd.slice(0, 600), /audit\(me, "discard_chain_draft"/);
assert.match(read("app/api/dispatch/route.ts"), /pruneChainDrafts\(now\)/, "old drafts are deleted by the scheduler");
const drafts = read("core/chain-drafts.ts");
assert.match(drafts, /onConflict: "org_id,chain_key"/, "one draft per chain: a newer one replaces it");
assert.match(drafts, /CHAIN_DRAFT\.maxWaiting/);
const mig = read("supabase/migrations/20270110090000_chain_drafts.sql");
assert.match(mig, /org_id uuid not null/);
assert.match(mig, /unique \(org_id, chain_key\)/);
assert.match(mig, /create policy org_rows on chain_drafts/);
assert.match(read("core/tenancy.ts"), /"chain_drafts"/);
const board = read("dashboard/components/chains.tsx");
assert.match(board, /actions\.save\(draft, place, confirmed, fromDraft\)/, "Use this draft is the board's own Save");
assert.match(board, /Use this draft/);
assert.match(board, /disabled=\{w\.stale\}/, "an out-of-date draft can't be opened");
assert.match(read("dashboard/needs.ts"), /from: "chain_draft"/);
console.log("check:mcp-chains ok");
