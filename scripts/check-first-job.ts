// The first job (card 154, docs/setup.md): `npm run check:first-job`. Pure: reads files, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEMPLATES } from "../core/templates";
import { TOOLS } from "../core/tools/catalog";
import { SETUP_AGENT, SETUP_TEMPLATE, readSetupState } from "../core/setup-rules";
import { DONE_FOR_MS, deptWaits, firstJobChains, firstJobPhase, missingTiles, pickFirstJob, readFirstJobTap, type JobRun } from "../core/first-job-rules";
import { mergeTemplates } from "../core/template-rules";
import { planOrgOn } from "../dashboard/orgPlan";
import type { Chain } from "../core/flow-rules";
import type { ToolTileId } from "../core/tools-step-rules";

const needsOf = (id: string): readonly string[] => (TOOLS as Record<string, { needs?: readonly string[] }>)[id]?.needs ?? [];
const kindOf = (id: string) => (TOOLS as Record<string, { kind?: string }>)[id]?.kind;
const allAgents = TEMPLATES.flatMap((t) => t.agents.map((a) => a.id));
const installed = new Set(allAgents);
const pending = new Set(allAgents);
const pick = (connected: ToolTileId[], o: { installed?: Set<string>; pending?: Set<string> } = {}) =>
  pickFirstJob(TEMPLATES, { setupTemplate: SETUP_TEMPLATE, installed: o.installed ?? installed, pending: o.pending ?? pending, connected: new Set(connected), needsOf, kindOf });

// a bank connected: the Bookkeeper, whose job ends in approval cards
const bank = pick(["mercury"]);
assert.equal(bank?.agentId, "bookkeeper", "with a bank connected the Bookkeeper goes first");
assert.equal(bank?.proposes, true);
assert.equal(bank?.templateId, "finance");
assert.ok(bank?.job.length, "the job is the template's mandate");
// workers before heads: the CFO is ready too, but the Bookkeeper's work comes back as approvals
assert.equal(pick(["mercury"], { pending: new Set(["cfo", "bookkeeper"]) })?.agentId, "bookkeeper");
// a playbook already approved isn't a first job any more
assert.equal(pick(["mercury"], { pending: new Set(allAgents.filter((a) => a !== "bookkeeper")) })?.agentId !== "bookkeeper", true);
// no bank, Shopify and Gmail connected: the Wholesale Hunter (it drafts emails for approval)
assert.equal(pick(["shopify", "gmail"])?.agentId, "wholesale_hunter");
assert.notEqual(pick(["gmail"])?.agentId, "wholesale_hunter", "it reads product facts from Shopify, so Gmail alone isn't enough");
// nothing connected: an agent whose tools need nothing may still go; with every department needing a tool, none
const none = pick([]);
assert.ok(none === null || missingTiles((TEMPLATES.find((t) => t.id === none.templateId)!.specs as Record<string, { tools?: string[] }>)[none.agentId].tools ?? [], needsOf, new Set()).length === 0, "a pick never waits on a tool");
// never the Chief of Staff, even when she's the only one ready
for (const c of [[], ["mercury"], ["shopify"], ["gmail", "klaviyo", "shopify", "mercury", "analytics"]] as ToolTileId[][]) assert.notEqual(pick(c)?.agentId, SETUP_AGENT);
// only installed departments
assert.equal(pick(["mercury"], { installed: new Set([SETUP_AGENT, "sales_head", "wholesale_hunter"]) }), null, "finance not installed and Gmail not connected: nothing ready");

// the other departments: what each waits on, the first job's department left out, Avery's never listed
const waits = deptWaits(TEMPLATES, { setupTemplate: SETUP_TEMPLATE, installed, connected: new Set(["mercury"]), needsOf }, "finance");
assert.ok(!waits.some((w) => w.templateId === "finance" || w.templateId === SETUP_TEMPLATE));
assert.deepEqual(waits.find((w) => w.templateId === "email-marketing")?.waitsOn, ["Shopify", "Klaviyo"], "the Campaign writer reads Product facts from Shopify");
assert.ok(waits.find((w) => w.templateId === "prospecting")?.waitsOn.includes("Gmail"));
assert.deepEqual(deptWaits(TEMPLATES, { setupTemplate: SETUP_TEMPLATE, installed: new Set([SETUP_AGENT, "cfo", "bookkeeper"]), connected: new Set(), needsOf }, null).map((w) => w.templateId), ["finance"], "only installed departments");

// setup state: offer and firstJob read safely
assert.deepEqual(readSetupState({ done: true, offer: true, firstJob: { agentId: "bookkeeper", at: "2026-11-19T20:00:00Z" } }, []), { done: true, leaning: [], offer: true, firstJob: { agentId: "bookkeeper", at: "2026-11-19T20:00:00Z" } });
assert.equal(readSetupState({ firstJob: { agentId: "Bad Id!", at: "2026-11-19" } }, []).firstJob, null);
assert.equal(readSetupState({ firstJob: { agentId: "bookkeeper", at: "not a date" } }, []).firstJob, null);
assert.equal(readSetupState({ offer: "yes" }, []).offer, false, "only true offers");

// the phases over time
const T = Date.parse("2026-11-19T20:00:00Z");
const run = (p: Partial<JobRun>): JobRun => ({ agent_id: "bookkeeper", trigger: "manual", started_at: new Date(T + 5e3).toISOString(), ended_at: null, status: "running", ...p });
const started = { offer: true, firstJob: { agentId: "bookkeeper", at: new Date(T).toISOString() } };
assert.equal(firstJobPhase({ offer: false, firstJob: null }, [], T), null, "not offered: no card (started empty, or never through setup)");
assert.deepEqual(firstJobPhase({ offer: true, firstJob: null }, [], T), { phase: "offer" });
assert.equal(firstJobPhase(started, [], T + 1e3)?.phase, "running", "tapped, row not written yet");
assert.equal(firstJobPhase(started, [run({})], T + 60e3)?.phase, "running");
assert.equal(firstJobPhase(started, [run({ trigger: "preview", status: "ok", ended_at: new Date(T + 9e3).toISOString() })], T + 60e3)?.phase, "running", "a preview isn't the first job");
assert.equal(firstJobPhase(started, [run({ agent_id: "cfo", status: "ok", ended_at: new Date(T + 9e3).toISOString() })], T + 60e3)?.phase, "running", "another agent's run isn't it");
assert.equal(firstJobPhase(started, [run({ started_at: new Date(T - 3600e3).toISOString(), status: "ok", ended_at: new Date(T - 3000e3).toISOString() })], T + 60e3)?.phase, "running", "an older run isn't it");
const ended = run({ status: "ok", ended_at: new Date(T + 200e3).toISOString() });
const done = firstJobPhase(started, [ended, run({ started_at: new Date(T + 900e3).toISOString() })], T + 300e3);
assert.equal(done?.phase, "done");
assert.equal(done && "run" in done ? done.run : null, ended, "the first run after the tap, not a later one");
assert.equal(firstJobPhase(started, [ended], T + 200e3 + DONE_FOR_MS + 1), null, "gone a day after it ended");
assert.equal(firstJobPhase(started, [], T + DONE_FOR_MS + 1), null, "a run that never started stops showing after a day");

// the tap: checked against the pick made in code now
assert.deepEqual(readFirstJobTap("bookkeeper", { offer: true, firstJob: null }, bank), { agentId: "bookkeeper" });
assert.match((readFirstJobTap("cfo", { offer: true, firstJob: null }, bank) as { problem: string }).problem, /changed/);
assert.match((readFirstJobTap("bookkeeper", { offer: true, firstJob: { agentId: "bookkeeper" } }, bank) as { problem: string }).problem, /already started/);
assert.match((readFirstJobTap("bookkeeper", { offer: false, firstJob: null }, bank) as { problem: string }).problem, /wasn’t set up/);
assert.match((readFirstJobTap("bookkeeper", { offer: true, firstJob: null }, null) as { problem: string }).problem, /No agent is ready/);
assert.match((readFirstJobTap(undefined, { offer: true, firstJob: null }, bank) as { problem: string }).problem, /changed/);

// the chains the tap turns on: every chain with the first job or Avery in it, nothing else
const chains = (mergeTemplates([...TEMPLATES]).flow.chains as Chain[]).map((c) => ({ ...c, on: false }));
const ids = ["bookkeeper", SETUP_AGENT];
const turned = firstJobChains(chains, ids);
assert.deepEqual(turned.on.sort(), chains.filter((c) => c.steps.some((s) => ids.includes(s.agent))).map((c) => c.key).sort());
assert.ok(turned.on.includes("morning") && turned.on.includes("solo-bookkeeper"), "the morning chain (Avery) and the Bookkeeper's own");
const morning = turned.chains.find((c) => c.key === "morning")!;
const avStep = morning.steps.findIndex((s) => s.agent === SETUP_AGENT);
assert.ok(avStep === 0 || morning.steps[avStep].when === "any", "the CFO's step, skipped while off duty, still hands on to Avery");
assert.deepEqual(firstJobChains(turned.chains, ids).on, [], "turning on twice changes nothing");
assert.deepEqual(firstJobChains(chains, ["nobody"]).on, []);
// who wakes and when, for the reply: only the two, with Avery's summary scheduled
const members = allAgents.map((id) => ({ id, name: id, inOrg: ids.includes(id), perRun: 0.01 }));
const plan = planOrgOn(members, turned.chains, T);
assert.deepEqual(plan.wake.map((w) => w.id).sort(), [...ids].sort());
assert.ok(plan.wake.find((w) => w.id === SETUP_AGENT)?.firstRun, "Avery's morning summary is scheduled");

// the action re-checks in code and the Desk draws the card
const actions = readFileSync("dashboard/actions.ts", "utf8");
const fn = actions.slice(actions.indexOf("export async function startFirstJob"), actions.indexOf("function firstJobPlan"));
assert.match(fn, /asRole\("owner"\)/);
assert.match(fn, /controlsOn\(\)/);
assert.match(fn, /readFirstJobTap/);
assert.match(fn, /planBlock\(\{ kind: "agent_on"/);
assert.match(fn, /startRun\(/, "the first run goes through Run now's path, so withRun and the daily budget apply");
assert.ok(fn.indexOf("planBlock") < fn.indexOf("approvePlaybook"), "the plan check comes before anything changes");
assert.match(fn, /firstJobChains/);
assert.ok(fn.indexOf("setOrg(true") > fn.indexOf("saveFlowVersion"), "the switch last, after the chains");
assert.match(readFileSync("app/(room)/page.tsx", "utf8"), /FirstJobCard/);
assert.match(readFileSync("dashboard/setupActions.ts", "utf8"), /finishSetup\(true\)/, "installing in setup offers the first job");

console.log("check:first-job ok");
