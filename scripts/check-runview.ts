// Run view (chains slice 5, docs/chains.md): `npm run check:runview`. Tests dashboard/run-view-rules.ts, which turns
// one chain run's rows into a timeline (where each step ran, how it went, what it cost, what it passed on, and why the
// chain stopped), and reads source for where the run page draws it. No database, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Step } from "../core/flow-rules";
import type { Img } from "../core/image-rules";
import { STATE_LOOK, timeline, type ItemState, type TimelineOk, type TimelineRun } from "../dashboard/run-view-rules";

const read = (p: string) => readFileSync(p, "utf8");
const names = {
  agent: (id: string) => ({ sloane: "Sloane", sage: "Sage", rowan: "Rowan" })[id] ?? id,
  claude: (id: string) => id === "sage",
  agentModel: (id: string) => (id === "sloane" ? "Claude Sonnet 5.5" : id === "rowan" ? "Claude Haiku 5.5" : null),
  model: (id: string) => (id === "gpt-6.2-sol" ? "GPT-6.2 Sol" : id),
};
const tz = (iso: string) => `at ${iso.slice(11, 16)}`;
const img: Img = { model: "gpt-image-2.5-flare", prompt: "Three new products on a wood counter.", quality: "medium", size: "1024x1024" };
// the chain of the approved mockup: an agent, a Claude routine, Ask a model, Make an image, Wait for my OK, an agent
const steps: Step[] = [
  { agent: "sloane" },
  { agent: "sage", when: "ok", passAlong: true },
  { ask: { model: "gpt-6.2-sol", prompt: "Write three captions." }, when: "ok", passAlong: true } as Step,
  { image: img, when: "ok", passAlong: true },
  { ok: {}, when: "ok" },
  { agent: "rowan", when: "ok", passAlong: true },
];
const run = (step: number, agentId: string, status: TimelineRun["status"], costUsd: number, summary: string | null, id = `r${step}`): TimelineRun =>
  ({ id, step, agentId, status, startedAt: `2026-11-30T13:0${step}:00Z`, endedAt: null, costUsd, summary });
const ok = (status: TimelineOk["status"], extra: Partial<TimelineOk> = {}): TimelineOk =>
  ({ step: 4, status, decidedBy: null, decidedAt: null, createdAt: "2026-11-30T13:05:00Z", dueAt: "2026-12-03T13:05:00Z", ...extra });

// ---- a whole run: every step ran
const all = [run(0, "sloane", "ok", 0.12, "Picked the linen tote, angle: weekend trips."), run(1, "sage", "ok", 0, "Found 4 photos."), run(2, "sloane", "ok", 0.004, "1. Morning, sorted."), run(3, "sloane", "ok", 0.013, "Made one square picture."), run(5, "rowan", "ok", 0.02, "Drafted the campaign.")];
const t = timeline(steps, all, [ok("approved", { decidedBy: "Dana", decidedAt: "2026-11-30T15:00:00Z" })], names, tz);
assert.equal(t.items.length, 6);
assert.deepEqual(t.items.map((i) => i.kind), ["agent", "claude", "ask", "image", "ok", "agent"]);
assert.deepEqual(t.items.map((i) => i.where), ["OPERATOR · Claude Sonnet 5.5", "Your Claude routine", "Ask GPT-6.2 Sol", "GPT Image 2.5 Flare · your key", "Approvals", "OPERATOR · Claude Haiku 5.5"], "where each step ran");
assert.deepEqual(t.items.map((i) => i.title), ["Sloane", "Sage", "Ask a model", "Make an image: square, medium quality", "Wait for my OK", "Rowan"]);
assert.deepEqual(t.items.map((i) => i.agentId), ["sloane", "sage", null, null, null, "rowan"], "only agent steps carry an agent");
assert.equal(t.items[4].state, "approved");
assert.equal(t.items[4].said, "Approved by Dana, at 15:00.");
assert.equal(t.items[4].runId, null, "an OK has no run of its own");
assert.equal(t.items[4].costUsd, 0, "an OK costs nothing");
assert.ok(Math.abs(t.totalUsd - 0.157) < 1e-9, "the total is the steps' costs added in code");
assert.equal(t.ran, 6);
assert.equal(t.ending, "Every step ran.");

// ---- what each step passed on
assert.equal(t.items[0].passed, "Its result, as above", "the words are on the card; the link says they went on");
assert.equal(timeline([{ agent: "sloane" }, { agent: "rowan", when: "ok" }], [run(0, "sloane", "ok", 0, "a"), run(1, "rowan", "ok", 0, "b")], [], names, tz).items[0].passed, "Nothing: the next step doesn’t get this result", "a step whose next step doesn't pass along hands on nothing");
assert.equal(t.items[1].passed, "Its result, as above");
assert.match(t.items[3].passed!, /^Its result went on the OK card$/, "before an OK, the result goes on the card");
assert.equal(timeline([{ agent: "sloane" }, { agent: "rowan", when: "ok", passAlong: true }], [run(0, "sloane", "ok", 0, null), run(1, "rowan", "ok", 0, "b")], [], names, tz).items[0].passed, "Nothing: it had no result to hand on");
assert.equal(t.items[4].passed, "Let the step before’s result through", "an approved OK lets the step before through");
assert.equal(t.items[5].passed, null, "the last step hands on nothing");
const pic = timeline([{ agent: "sloane" }, { image: img, when: "ok", passAlong: true }, { agent: "rowan", when: "ok", passAlong: true }], [run(0, "sloane", "ok", 0, "x"), run(1, "sloane", "ok", 0.01, "Made one."), run(2, "rowan", "ok", 0, "y")], [], names, tz);
assert.match(pic.items[1].passed!, /^A line saying a picture was made \(the picture stays in OPERATOR 90 days\)$/, "a picture is never handed on, only a line about it");
const long = timeline([{ agent: "sloane" }, { agent: "rowan", when: "ok", passAlong: true }], [run(0, "sloane", "ok", 0, "z".repeat(900)), run(1, "rowan", "ok", 0, null)], [], names, tz);
assert.ok(long.items[0].said!.length <= 220, "words are cut in code");

// ---- where and why a chain stopped
const waiting = timeline(steps, all.slice(0, 4), [ok("pending")], names, tz);
assert.equal(waiting.items[4].state, "waiting");
assert.match(waiting.items[4].said!, /^Waiting for your OK on Approvals\. It stops by itself at 13:05 if nobody answers\.$/);
assert.equal(waiting.items[5].state, "not_run");
assert.equal(waiting.items[3].passed, "Its result went on the OK card");
assert.equal(waiting.items[4].passed, null, "nothing has passed an OK still waiting");
assert.equal(waiting.ending, "Waiting for your OK at step 5.");
assert.equal(timeline(steps, all.slice(0, 4), [ok("rejected", { decidedBy: "Dana" })], names, tz).ending, "Stopped at step 5: you rejected it.");
assert.equal(timeline(steps, all.slice(0, 4), [ok("expired")], names, tz).ending, "Stopped at step 5: nobody answered in 3 days.");
assert.equal(timeline(steps, all.slice(0, 4), [ok("expired")], names, tz).items[4].said, "Nobody answered in 3 days, so the chain stopped.");
const failed = timeline(steps, [run(0, "sloane", "ok", 0.1, "a"), run(1, "sage", "failed", 0, "The routine refused the token.")], [], names, tz);
assert.equal(failed.ending, "Stopped after step 2 failed.");
assert.equal(failed.items[0].passed, "Its result, as above", "the step before a failed one still shows what it handed on");
assert.equal(failed.items[1].passed, null, "nothing reached a step that didn't run");
assert.deepEqual(failed.items.slice(2).map((i) => i.state), ["not_run", "not_run", "not_run", "not_run"]);
assert.match(timeline(steps, [run(0, "sloane", "skipped", 0, "Off duty.")], [], names, tz).ending, /^Stopped after step 1: it was skipped/);
assert.equal(timeline(steps, [run(0, "sloane", "running", 0, null)], [], names, tz).ending, "Step 1 is running now.");
assert.match(timeline(steps, [run(0, "sloane", "ok", 0, "a")], [], names, tz).ending, /^Stopped after step 1: step 2’s conditions didn’t pass/);
assert.equal(timeline(steps, [], [], names, tz).ending, "Nothing has run yet.");
assert.equal(timeline([{ agent: "sloane" }], [run(0, "sloane", "failed", 0, "x")], [], names, tz).ending, "Every step ran; the last one failed.");

// ---- a retried step shows its latest run; the chain unreadable shows the runs alone
const retried = timeline([{ agent: "sloane" }], [run(0, "sloane", "failed", 0.01, "first", "a"), run(0, "sloane", "ok", 0.02, "second", "b")], [], names, tz);
assert.equal(retried.items[0].runId, "b");
assert.equal(retried.items[0].said, "second");
const bare = timeline([], [run(0, "sloane", "ok", 0, "a"), run(1, "rowan", "ok", 0, "b")], [], names, tz);
assert.deepEqual(bare.items.map((i) => [i.title, i.where]), [["Sloane", "OPERATOR · Claude Sonnet 5.5"], ["Rowan", "OPERATOR · Claude Haiku 5.5"]]);
assert.equal(timeline([{ agent: "nobody" }], [run(0, "nobody", "ok", 0, null)], [], names, tz).items[0].where, "OPERATOR", "an agent with no model shown says OPERATOR alone");

// ---- every state has words and a tone
for (const s of ["running", "ok", "failed", "skipped", "waiting", "approved", "rejected", "expired", "not_run"] as ItemState[]) assert.ok(STATE_LOOK[s]?.label, `${s} has a label`);

// ---- source: the data and the page
const data = read("dashboard/data.ts");
assert.match(data, /export async function getChainRuns\(runId: string, tz: string\)/);
assert.match(data, /from\("chain_oks"\)\.select\("step, status, decided_by, decided_at, created_at, due_at"\)\.eq\("chain_id", me\.chain_id\)/, "the OK holds of this chain run, by its id");
assert.match(data, /imageLink\(i\.runId!\)/, "pictures through short signed links");
const page = read("app/(room)/runs/[id]/page.tsx");
assert.match(page, /<RunView name=\{chain\.name\} timeline=\{chain\.timeline\}/);
assert.doesNotMatch(page, /chain-steps/, "the old step grid is gone");
assert.doesNotMatch(read("app/globals.css"), /\.chain-step\b/, "and its styles");
assert.doesNotMatch(read("dashboard/run-view-rules.ts"), /from "@\/core\/db"|fetch\(/, "the rules stay pure");
console.log("check:runview ok");
