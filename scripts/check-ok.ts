// Wait for my OK, a quick chain step (chains slice 3, docs/chains.md): `npm run check:ok`. Tests the rules
// (core/flow-rules.ts okProblems, core/chain-ok-rules.ts, dashboard/chain-rules.ts okFits) and reads source for the
// table, the runner, the decision, the expiry and the cards. No database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OK, afterStep, flowLooser, flowProblems, okProblems, readFlow, stepName, withAgentTime, type Chain, type Step } from "../core/flow-rules";
import { keepFacts, leftWords, okCard, okChainHref, okDept, okDoneWords, okDue, okStillHolds } from "../core/chain-ok-rules";
import { okFits, withStep } from "../dashboard/chain-rules";

const read = (p: string) => readFileSync(p, "utf8");
const crew = { ids: ["sloane", "sage", "rowan"], manualOnly: new Set<string>(), models: ["claude-haiku-5-5"] };
const chain = (steps: Step[], more: Partial<Chain> = {}): Chain => ({ key: "post", name: "Weekly post", on: true, start: { type: "schedule", days: "mondays", time: "07:00" }, steps, ...more });
const ok: Step = { ok: {}, when: "ok" };

// ---- what a chain may hold
assert.deepEqual(flowProblems({ chains: [chain([{ agent: "sloane" }, ok, { agent: "rowan", when: "ok", passAlong: true }])] }, crew), []);
assert.deepEqual(flowProblems({ chains: [chain([{ agent: "sloane" }, { ok: { note: "Check the voice." } }])] }, crew), [], "an OK can end a chain, with a note");
const why = (steps: Step[]) => flowProblems({ chains: [chain(steps)] }, crew).join(" ");
assert.match(why([ok, { agent: "rowan" }]), /needs a step before it/, "an OK never goes first: there is nothing to approve");
assert.match(why([{ agent: "sloane" }, ok, ok]), /one Wait for my OK after a step is enough/);
assert.match(why([{ agent: "sloane" }, { ok: { note: "x".repeat(OK.noteMax + 1) } }]), /at most 300 characters/);
assert.match(why([{ agent: "sloane" }, { ok: { note: "x", agent: "rowan" } } as never]), /takes a note only \(not agent\)/, "nothing else rides along");
assert.match(why([{ agent: "sloane" }, { ok: {}, agent: "rowan" } as never]), /a step is one thing/);
assert.match(why([{ agent: "sloane" }, { ok: {}, passAlong: true }]), /always shows the step before’s result/);
assert.match(why([{ agent: "sloane" }, { ok: {}, check: { metric: "orders", op: ">", value: 0 } }]), /takes no check/);
assert.deepEqual(okProblems({}), []);
assert.deepEqual(okProblems(["x"]), ["Wait for my OK takes an optional note only."]);
assert.equal(stepName(ok), "Wait for my OK");
assert.equal(readFlow({ chains: [chain([ok, { agent: "rowan" }])] }, crew).flow.chains.length, 0, "a saved chain starting with an OK is dropped, not run");

// ---- going on: approving the OK is the step "ending ok"; the next step's checks still apply
const c = chain([{ agent: "sloane" }, ok, { agent: "rowan", when: "ok", passAlong: true }]);
assert.deepEqual(afterStep(c, 0, { status: "ok" }, "America/Chicago"), { go: true, step: 1, at: null }, "the step before worked: the OK step starts (the card)");
assert.equal(afterStep(c, 0, { status: "failed" }, "America/Chicago").go, false, "a failed step never reaches the card");
assert.deepEqual(afterStep(c, 1, { status: "ok" }, "America/Chicago"), { go: true, step: 2, at: null }, "approved: the step after it");
assert.deepEqual(flowLooser({ chains: [chain([{ agent: "sloane" }, { agent: "rowan" }])] }, { chains: [c] }), [], "adding an OK is never looser");

// ---- a dropped agent never leaves an OK first or two in a row
const timed = withAgentTime({ chains: [chain([{ agent: "sloane" }, ok, { agent: "rowan" }])] }, "sloane", "Sloane", null);
assert.ok("flow" in timed && timed.flow.chains[0].steps.length === 1 && timed.flow.chains[0].steps[0].agent === "rowan", "the OK goes with the step it approved");
const mid = withAgentTime({ chains: [chain([{ agent: "sloane" }, ok, { agent: "sage" }, ok, { agent: "rowan" }])] }, "sage", "Sage", null);
assert.ok("flow" in mid && mid.flow.chains[0].steps.filter((s) => s.ok).length === 1, "two OKs in a row become one");

// ---- the lane's picker
assert.equal(okFits(c, 0), false, "not first");
assert.equal(okFits(c, 1), false, "not next to another OK");
assert.equal(okFits(c, 2), false);
assert.equal(okFits(c, 3), true, "after the last step");
const added = withStep(chain([{ agent: "sloane" }, { agent: "rowan", when: "ok", passAlong: true }]), 1, { ok: {} });
assert.deepEqual(added.steps[1], { ok: {}, when: "ok" }, "an added OK waits for the step before to work, and passes nothing itself");
assert.deepEqual(flowProblems({ chains: [added] }, crew), []);

// ---- the card
const now = Date.parse("2026-11-24T16:00:00Z");
assert.equal(okDue(now) - now, 3 * 864e5, "3 days to answer");
assert.equal(leftWords(new Date(now + 2.5 * 864e5).toISOString(), now), "in 2 days");
assert.equal(leftWords(new Date(now + 5 * 36e5).toISOString(), now), "in 5 hours");
assert.equal(leftWords(new Date(now + 20 * 6e4).toISOString(), now), "in 20 minutes");
assert.equal(leftWords(new Date(now - 1).toISOString(), now), "now");
const kept = keepFacts({ from: "sage", status: "ok", summary: "x".repeat(5000), metrics: { a: 1, b: Number.NaN, ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`m${i}`, i])) } });
assert.equal(kept.summary.length, 1500, "the summary is cut in code");
assert.equal(Object.keys(kept.metrics).length, 12);
assert.ok(!("b" in kept.metrics), "only real numbers");
assert.deepEqual(keepFacts(null), { from: "", status: "", summary: "", metrics: {} });
const deptOf = (a: string) => (a === "sage" ? "marketing" : null);
assert.equal(okDept({ ...c, owner: { dept: "sales" } }, deptOf), "sales");
assert.equal(okDept({ ...c, owner: { agent: "sage" } }, deptOf), "marketing", "an agent's chain shows in its department");
assert.equal(okDept(c, deptOf), null, "the company's chains show on the Company page");
assert.equal(okStillHolds(undefined, 1), "That chain isn’t saved any more, so nothing ran.");
assert.match(okStillHolds(chain([{ agent: "sloane" }, { agent: "rowan" }]), 1) ?? "", /changed since this card was made/, "a chain edited since never starts the wrong step");
assert.equal(okStillHolds(c, 1), null);
const row = { id: "r1", chain_key: "post", step: 1, facts: { from: "sloane", status: "ok", summary: "Three captions.", metrics: {} }, department_id: "marketing", created_at: "2026-11-24T16:00:00Z", due_at: "2026-11-27T16:00:00Z" };
const card = okCard(row, c, (a) => a[0].toUpperCase() + a.slice(1));
assert.ok(card);
assert.equal(card.fromName, "Sloane"); assert.equal(card.next, "Rowan"); assert.equal(card.steps, 3); assert.equal(card.note, null);
assert.equal(okCard(row, chain([{ agent: "sloane" }, { agent: "rowan" }]), (a) => a), null, "a stale hold isn't shown as live");
assert.equal(okChainHref({ chain: "post", dept: "marketing" }), "/dept/marketing?tab=chains&chain=post");
assert.equal(okChainHref({ chain: "post", dept: null }), "/settings/schedule?chain=post#chains");
assert.equal(okDoneWords("reject", "Weekly post", null), "Rejected. Weekly post stops here.");
assert.equal(okDoneWords("approve", "Weekly post", "Step 3 started."), "Approved. Step 3 started.");

// ---- source: the table, the runner, the decision, the expiry, the cards
const mig = read("supabase/migrations/20270108090000_chain_oks.sql");
assert.match(mig, /org_id uuid not null references orgs\(id\)/);
assert.match(mig, /create policy org_rows on chain_oks/);
assert.match(mig, /unique \(org_id, chain_id, step\)/, "one card per chain run and step");
assert.match(read("core/tenancy.ts"), /"chain_oks"/);
const runner = read("core/chain.ts");
assert.match(runner, /if \(step\.ok\) \{[\s\S]*?holdForOk\(c, ctx, await handoffFrom\(ctx\.parent\)\)[\s\S]*?return \{ outcome \};/, "an OK step keeps a hold and does not go on");
const okSrc = read("core/chain-ok.ts");
assert.match(okSrc, /\.eq\("id", id\)\.eq\("status", "pending"\)\.gt\("due_at", nowIso\)/, "decided once, and not after its time");
assert.match(okSrc, /if \(d === "reject"\) return/, "reject never goes on");
assert.match(okSrc, /okStillHolds\(c, row\.step as number\)/);
assert.match(okSrc, /\.eq\("status", "pending"\)\.lte\("due_at"/);
const act = read("dashboard/actions.ts");
assert.match(act, /export async function decideChainOk\(id: string, decision: "approve" \| "reject"\): Promise<ActionResult> \{\n  const \{ me, no \} = await asRole\("approver"\); if \(no\) return no;/, "only an approver decides");
assert.match(act, /continueChain\(origin, c, ctx, parent, \{ status: "ok" \}, flow\)/, "approve goes on from the held step, the step before's run handed on");
assert.match(act, /audit\(me, approved \? "chain_ok_approve" : "chain_ok_reject"/);
assert.match(read("app/api/dispatch/route.ts"), /expireOks\(now\)/);
assert.match(read("app/(room)/page.tsx"), /<ChainOkCard key=\{c\.id\}/);
assert.match(read("app/(room)/dept/[id]/page.tsx"), /oks = \(allOks \?\? \[\]\)\.filter\(\(c\) => c\.dept === id\)/);
assert.match(read("dashboard/components/chains.tsx"), /withStep\(draft, k, \{ ok: \{\} \}\)/, "the picker offers Wait for my OK");
assert.doesNotMatch(read("dashboard/components/chains.tsx"), /"Wait for my OK", "An approval card/, "no longer Coming soon");

console.log("check:ok passed");
