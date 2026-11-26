// Chains where they live (chains slice 1, card 430): `npm run check:chains`. Pure: tests core/flow-rules.ts (an owner
// on each chain, up to 8 steps, "after another chain finishes") and dashboard/chain-rules.ts (which chains each place
// lists, the lane's words, editing steps), and reads source. No database, no network.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { MAX_HOPS, MAX_STEPS, chainOwner, flowProblems, followersOf, readFlow, withAgentTime, type Chain, type Flow } from "../core/flow-rules";
import { afterChoices, boardGroups, chainHref, linkWords, moveStep, newChain, newChainHref, newKey, placeOf, roomFor, startWords, withStep, withoutStep } from "../dashboard/chain-rules";
import { chainPayload, readChainPayload } from "../core/job-rules";

const read = (p: string) => readFileSync(p, "utf8");
const crew = { ids: ["sloane", "sage", "rowan", "morgan", "avery", "a1", "a2", "a3", "a4", "a5", "a6"], manualOnly: new Set<string>() };
const sched = { type: "schedule" as const, days: "mondays" as const, time: "07:00" };
const chain = (key: string, more: Partial<Chain> = {}): Chain => ({ key, name: key, on: true, start: sched, steps: [{ agent: "sloane" }], ...more });

// ---- up to 8 steps
assert.equal(MAX_STEPS, 8);
const eight = chain("eight", { steps: ["sloane", "sage", "rowan", "morgan", "a1", "a2", "a3", "a4"].map((agent) => ({ agent })) });
assert.deepEqual(flowProblems({ chains: [eight] }, crew), [], "8 steps fit");
assert.match(flowProblems({ chains: [{ ...eight, steps: [...eight.steps, { agent: "a5" }] }] }, crew).join(" "), /at most 8 steps/);
assert.equal(roomFor(eight), false);

// ---- an owner: an agent, a department, or none (the company)
assert.deepEqual(flowProblems({ chains: [chain("a", { owner: { agent: "sloane" } }), chain("b", { owner: { dept: "marketing" } }), chain("c")] }, crew), []);
assert.match(flowProblems({ chains: [chain("a", { owner: { agent: "nobody" } })] }, crew).join(" "), /isn’t an agent/);
assert.match(flowProblems({ chains: [chain("a", { owner: { agent: "sloane", dept: "x" } as never })] }, crew).join(" "), /an agent or a department/);
assert.match(flowProblems({ chains: [chain("a", { owner: { dept: "<b>" } })] }, crew).join(" "), /can’t own a chain/);
assert.deepEqual(chainOwner(chain("solo-sage", { steps: [{ agent: "sage" }] })), { agent: "sage" }, "an agent's own one-step chain is its own");
assert.equal(chainOwner(chain("morning")), null, "a chain with no owner is the company's");
const solo = withAgentTime({ chains: [] }, "sage", "Sage", { days: "weekdays", time: "09:00" });
assert.ok("flow" in solo && solo.flow.chains[0].owner && "agent" in solo.flow.chains[0].owner && solo.flow.chains[0].owner.agent === "sage", "a new one-step schedule is saved with its agent as owner");

// ---- after another chain finishes
const post = chain("post", { owner: { dept: "marketing" } });
const thanks = chain("thanks", { start: { type: "after", chain: "post" }, steps: [{ agent: "rowan", passAlong: true }] });
assert.deepEqual(flowProblems({ chains: [post, thanks] }, crew), []);
assert.match(flowProblems({ chains: [thanks] }, crew).join(" "), /isn’t in the flow/);
assert.match(flowProblems({ chains: [chain("self", { start: { type: "after", chain: "self" } })] }, crew).join(" "), /after itself/);
const x = chain("x", { start: { type: "after", chain: "y" } }), y = chain("y", { start: { type: "after", chain: "x" } });
assert.match(flowProblems({ chains: [x, y] }, crew).join(" "), /can’t start itself/, "a circle of chains is refused");
assert.match(flowProblems({ chains: [chain("w", { start: { type: "after", chain: "post", when: "never" as never } }), post] }, crew).join(" "), /either way/);
// reading a saved flow: a chain after a dropped chain is dropped, and so is a circle
const broken = readFlow({ chains: [{ ...post, steps: [{ agent: "nobody" }] }, thanks] }, crew);
assert.deepEqual(broken.flow.chains, []);
assert.match(broken.problems.join(" "), /starts after a chain that was dropped/);
assert.deepEqual(readFlow({ chains: [x, y, post] }, crew).flow.chains.map((c) => c.key), ["post"]);
// who starts when a chain finishes
const any = chain("any", { start: { type: "after", chain: "post", when: "any" } });
const off = chain("off", { on: false, start: { type: "after", chain: "post" } });
const f: Flow = { chains: [post, thanks, any, off] };
assert.deepEqual(followersOf(f, "post", "ok").map((c) => c.key), ["thanks", "any"], "on, after it");
assert.deepEqual(followersOf(f, "post", "failed").map((c) => c.key), ["any"], "\"ok\" waits for the last step to work");
assert.deepEqual(followersOf(f, "post", "skipped"), [], "a skipped step stops everything after it");
assert.ok(MAX_HOPS >= 2 && MAX_HOPS <= 10);
assert.deepEqual(readChainPayload(chainPayload({ chainId: "00000000-0000-4000-8000-000000000000", key: "thanks", step: 0, parent: "00000000-0000-4000-8000-000000000001", hops: 2 })), { chainId: "00000000-0000-4000-8000-000000000000", key: "thanks", step: 0, parent: "00000000-0000-4000-8000-000000000001", hops: 2 });
assert.equal(readChainPayload({ chainId: "00000000-0000-4000-8000-000000000000", key: "k", step: 0, hops: -1 }), null);
assert.equal(readChainPayload({ chainId: "00000000-0000-4000-8000-000000000000", key: "k", step: 7 })?.step, 7, "step 8 of 8 is a valid job");

// ---- where each chain is listed
const deptOf = { sloane: "marketing", sage: "marketing", rowan: "marketing", morgan: "finance", avery: null };
const flow: Flow = { chains: [
  chain("weekly-post", { owner: { dept: "marketing" } }),
  chain("solo-sloane", { steps: [{ agent: "sloane" }] }),
  chain("morgan-close", { owner: { agent: "morgan" }, steps: [{ agent: "morgan" }, { agent: "sloane" }] }),
  chain("morning", { steps: [{ agent: "avery" }, { agent: "morgan" }] }),
  chain("gone", { owner: { dept: "old" } }),
] };
const depts = [{ id: "marketing", name: "Marketing" }, { id: "finance", name: "Finance" }];
assert.deepEqual(placeOf(flow.chains[1], deptOf), { kind: "dept", dept: "marketing", via: "agent", agent: "sloane" });
assert.deepEqual(placeOf(flow.chains[3], deptOf), { kind: "company" });
assert.deepEqual(placeOf(chain("avery-own", { owner: { agent: "avery" } }), deptOf), { kind: "company" }, "an agent in no department: the company's");
const mk = boardGroups(flow, { dept: "marketing" }, deptOf, depts);
assert.deepEqual(mk.map((g) => [g.title, g.chains.map((c) => c.key)]), [["This department’s chains", ["weekly-post"]], ["Its agents’ chains", ["solo-sloane"]]]);
assert.deepEqual(boardGroups({ chains: [] }, { dept: "marketing" }, deptOf, depts).map((g) => g.id), ["dept"], "the department's own list always shows");
assert.deepEqual(boardGroups(flow, "all", deptOf, depts).map((g) => [g.id, g.chains.map((c) => c.key)]), [["company", ["morning", "gone"]], ["marketing", ["weekly-post", "solo-sloane"]], ["finance", ["morgan-close"]]], "Settings: the company's (and any whose department is gone), then each department in the chart's order");
assert.equal(chainHref(flow.chains[0], deptOf), "/dept/marketing?tab=chains&chain=weekly-post");
assert.equal(chainHref(flow.chains[3], deptOf), "/settings/schedule?chain=morning#chains");
assert.equal(newChainHref("sloane", "marketing"), "/dept/marketing?tab=chains&new=sloane");
assert.equal(newChainHref("avery", null), "/settings/schedule?new=avery#chains");

// ---- the lane's words
const names = { chain: (k: string) => (k === "post" ? "Weekly post" : k), tool: (t: string) => t };
assert.equal(startWords(sched, names), "Mondays at 7:00 AM");
assert.equal(startWords({ type: "schedule", days: "on:135", time: "18:30" }, names), "Mondays, Wednesdays and Fridays at 6:30 PM");
assert.equal(startWords({ type: "after", chain: "post" }, names), "After Weekly post finishes");
assert.equal(startWords({ type: "after", chain: "post", when: "any" }, names), "After Weekly post finishes, either way");
assert.equal(startWords({ type: "button" }, names), "When you press Run chain");
assert.equal(linkWords({ agent: "sage", passAlong: true }), "passes its result if it worked");
assert.equal(linkWords({ agent: "sage", when: "any" }), "then");
assert.equal(linkWords({ agent: "sage", when: "failed", notBefore: "09:00" }), "then if it failed · not before 9:00 AM");

// ---- making and editing a chain
assert.equal(newKey(flow, "Weekly post!"), "weekly-post-2", "never a key the flow has");
const made = newChain(flow, { dept: "marketing" }, "sloane", "  ");
assert.deepEqual(made, { key: "new-chain", name: "New chain", on: false, start: { type: "button" }, steps: [{ agent: "sloane" }], owner: { dept: "marketing" } }, "a new chain is off and starts with Run chain");
assert.equal(newChain(flow, null, "avery", "Company thing").owner, undefined);
const two = withStep(made, 1, "sage");
assert.deepEqual(two.steps, [{ agent: "sloane" }, { agent: "sage", when: "ok", passAlong: true }], "a step added after another waits for it to work and gets its result");
const front = withStep(two, 0, "rowan");
assert.deepEqual(front.steps.map((s) => s.agent), ["rowan", "sloane", "sage"]);
assert.deepEqual(front.steps[1], { agent: "sloane", when: "ok", passAlong: true }, "the step it pushed down now waits for it");
assert.deepEqual(withoutStep({ ...two, steps: [{ agent: "a1" }, { agent: "sage", when: "any", notBefore: "09:00", passAlong: true }] }, 0).steps, [{ agent: "sage", passAlong: true }], "the new first step drops what only applies after a step");
assert.deepEqual(moveStep(two, 1, -1).steps, [{ agent: "sage", passAlong: true }, { agent: "sloane" }]);
assert.deepEqual(moveStep(two, 0, -1), two, "nothing above the first step");
assert.deepEqual(flowProblems({ chains: [front] }, crew), []);
assert.deepEqual(afterChoices({ chains: [post, thanks, any, chain("other")] }, "post").map((c) => c.key), ["other"], "a chain can't start after one that starts after it");

// ---- source: the runner, the server actions and the places
const runner = read("core/chain.ts");
assert.match(runner, /async function startFollowers[\s\S]*MAX_HOPS[\s\S]*orgOn\(\)/, "chains after a chain start only while the org is on, and only so many in a row");
assert.match(runner, /!c\.steps\[ctx\.step \+ 1\] && flow/, "followers start when the last step ends");
assert.match(runner, /continueChain\(origin, c, ctx, res\.runId, \{[^}]*\}, flow\.flow\)/);
const actions = read("dashboard/actions.ts");
const body = (fn: string) => actions.slice(actions.indexOf(`export async function ${fn}`), actions.indexOf("\n}\n", actions.indexOf(`export async function ${fn}`)));
assert.match(body("saveChain"), /asRole\("owner"\)[\s\S]*chainInFlow\(key, raw\)[\s\S]*flowLooser[\s\S]*controlsOn\(\)[\s\S]*!confirmed/, "only the owner saves a chain, merged into the saved flow; looser needs Controls and a confirm");
assert.match(body("deleteChain"), /asRole\("owner"\)/);
assert.match(read("core/chain-save.ts"), /start\$\{after\.length === 1 \? "s" : ""\} after/, "a chain another chain starts after can't be deleted out from under it");
assert.match(body("previewChain"), /chainInFlow\(key, raw\)/, "Try it checks the chain as it would be saved");
assert.doesNotMatch(actions, /export async function saveCrewFlow/, "one chain at a time replaces saving the whole canvas");
assert.ok(!existsSync("dashboard/components/CrewCanvas.tsx"), "the Settings canvas editor is gone");
const schedPage = read("app/(room)/settings/schedule/page.tsx");
assert.match(schedPage, /<ChainsBoard d=\{d\} scope="all"/);
assert.doesNotMatch(schedPage, /CrewCanvas/);
const dept = read("app/(room)/dept/[id]/page.tsx");
assert.match(dept, /tab === "chains"\) return <Chains/);
assert.match(dept, /<ChainsBoard d=\{d\} scope=\{\{ dept: id \}\}/);
assert.match(read("dashboard/dept-rules.ts"), /\["overview", "agents", "goals", "chains", "approvals"\]/);
const sheet = read("dashboard/components/agentSheet.tsx");
assert.match(sheet, /href=\{d\.newChain\}>\+ New chain starting with \{d\.name\}/, "the agent sheet starts a new chain with this agent");
assert.match(sheet, /href=\{c\.href\}>Open</, "each chain on the sheet opens where it lives");
assert.doesNotMatch(read("package.json"), /@xyflow/, "the canvas library went with the canvas");

console.log("check:chains ok");
