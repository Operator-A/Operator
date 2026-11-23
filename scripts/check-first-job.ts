// The first job (card 154, docs/setup.md): `npm run check:first-job`. Pure: reads files, no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TEMPLATES } from "../core/templates";
import { TOOLS } from "../core/tools/catalog";
import { SETUP_AGENT, SETUP_TEMPLATE, readSetupState } from "../core/setup-rules";
import { DONE_FOR_MS, builtCandidates, deptWaits, firstJobChains, firstJobPhase, laterWords, missingTiles, pickFirstJob, readFirstJobTap, runnableSteps, type JobRun } from "../core/first-job-rules";
import { mergeTemplates } from "../core/template-rules";
import { planOrgOn } from "../dashboard/orgPlan";
import type { Chain } from "../core/flow-rules";
import type { ToolTileId } from "../core/tools-step-rules";

const needsOf = (id: string): readonly string[] => (TOOLS as Record<string, { needs?: readonly string[] }>)[id]?.needs ?? [];
const kindOf = (id: string) => (TOOLS as Record<string, { kind?: string }>)[id]?.kind;
const allAgents = TEMPLATES.flatMap((t) => t.agents.map((a) => a.id));
const installed = new Set(allAgents);
// each agent's first playbook: its spec's read and calculate tools, in order (what install proposes)
const playbookOf = (id: string) => {
  const t = TEMPLATES.find((x) => x.agents.some((a) => a.id === id))!;
  return ((t.specs as Record<string, { tools?: string[] }>)[id]?.tools ?? []).filter((x) => ["read", "calculate"].includes(kindOf(x) ?? ""));
};
const pendingOf = (ids: readonly string[]) => new Map(ids.map((id) => [id, playbookOf(id)]));
const pending = pendingOf(allAgents);
const pick = (connected: ToolTileId[], o: { installed?: Set<string>; pending?: Map<string, string[]> } = {}) =>
  pickFirstJob(TEMPLATES, { setupTemplate: SETUP_TEMPLATE, installed: o.installed ?? installed, pending: o.pending ?? pending, connected: new Set(connected), needsOf, kindOf });

// a bank connected: the Bookkeeper, whose job ends in approval cards
const bank = pick(["mercury"]);
assert.equal(bank?.agentId, "bookkeeper", "with a bank connected the Bookkeeper goes first");
assert.equal(bank?.proposes, true);
assert.equal(bank?.templateId, "finance");
assert.ok(bank?.job.length, "the job is the template's mandate");
// workers before heads: the CFO is ready too, but the Bookkeeper's work comes back as approvals
assert.equal(pick(["mercury"], { pending: pendingOf(["cfo", "bookkeeper"]) })?.agentId, "bookkeeper");
// a playbook already approved isn't a first job any more
assert.equal(pick(["mercury"], { pending: pendingOf(allAgents.filter((a) => a !== "bookkeeper")) })?.agentId !== "bookkeeper", true);
// Shopify and Gmail connected: the Wholesale Hunter (it drafts emails for approval), with nothing to add later
const sg = pick(["shopify", "gmail"]);
assert.equal(sg?.agentId, "wholesale_hunter");
assert.deepEqual(sg?.later, []);
assert.deepEqual(sg?.keep, playbookOf("wholesale_hunter").map((_, i) => i), "every step can run");

// card 189: one tool is enough. Gmail alone: it starts on the leads list and drafts, without Shopify's product facts
const g = pick(["gmail"]);
assert.equal(g?.agentId, "wholesale_hunter");
assert.equal(g?.proposes, true);
assert.deepEqual(g?.later, ["Shopify"]);
assert.ok(g && g.keep.length > 0 && g.keep.length < playbookOf("wholesale_hunter").length, "only the steps that can run");
for (const i of g!.keep) assert.equal(missingTiles([playbookOf("wholesale_hunter")[i]], needsOf, new Set(["gmail"])).length, 0, "a kept step never waits on a tool");
// nothing connected: still a first job, from the steps that need no tool; it changes nothing until Gmail is connected
const none = pick([]);
assert.equal(none?.agentId, "wholesale_hunter", "the Lead finder starts from the web and its leads list");
assert.equal(none?.proposes, false, "its drafts wait on Gmail");
assert.deepEqual(none?.later, ["Shopify", "Gmail"]);
// an agent with no step that can run is never the pick
// (the playbooks a fresh business got on 2026-11-20)
const fresh = new Map([["bookkeeper", ["mercury_charges", "mercury_categories"]], ["cfo", ["calc_burn_rate", "calc_daily_snapshot"]], ["campaign_writer", ["klaviyo_campaigns", "product_facts"]], ["wholesale_hunter", ["product_facts", "leads_list"]]]);
assert.equal(pick([], { pending: new Map([...fresh].filter(([k]) => k !== "wholesale_hunter")) }), null, "Mercury, Shopify and Klaviyo all missing: nothing ready");
assert.deepEqual(pick([], { pending: fresh })?.keep, [1], "the fresh Lead finder starts on its leads list");
// a worker missing a tool still goes before a head that has every tool
assert.notEqual(pick([])?.agentId, "sales_head");
// never the Chief of Staff, even when she's the only one ready
for (const c of [[], ["mercury"], ["shopify"], ["gmail", "klaviyo", "shopify", "mercury", "analytics"]] as ToolTileId[][]) assert.notEqual(pick(c)?.agentId, SETUP_AGENT);
assert.equal(pick([], { pending: pendingOf([SETUP_AGENT]) }), null);
// only installed departments
assert.equal(pick(["mercury"], { installed: new Set([SETUP_AGENT, "cfo"]), pending: pendingOf(["cfo"]) })?.agentId, "cfo");
assert.equal(pick(["mercury"], { installed: new Set([SETUP_AGENT]) }), null, "only Avery installed: nothing ready");

// the steps that can run: a step needing only the app's data always can
assert.deepEqual(runnableSteps(["mercury_charges", "leads_list", "product_facts"], needsOf, new Set(["mercury"])), [0, 1]);
assert.deepEqual(runnableSteps(["product_facts"], needsOf, new Set()), []);
assert.match(laterWords(["Shopify", "Gmail"]), /^It starts without Shopify and Gmail; connect them later/);
assert.equal(laterWords([]), "");
// the tap approves only those steps, for the job's agent and Avery
const act = readFileSync("dashboard/actions.ts", "utf8");
assert.match(act, /runnableSteps\(p\.steps\.map\(\(s\) => s\.tool\), needsOf, pick\.connected\)/, "startFirstJob keeps only runnable steps");
assert.doesNotMatch(act, /approvePlaybook\(id, p\.id, p\.steps\.map\(\(_, i\) => i\)\)/, "never every step blindly");

// the other departments: what each waits on, the first job's department left out, Avery's never listed
const waits = deptWaits(TEMPLATES, { setupTemplate: SETUP_TEMPLATE, installed, connected: new Set(["mercury"]), needsOf }, "finance");
assert.ok(!waits.some((w) => w.templateId === "finance" || w.templateId === SETUP_TEMPLATE));
assert.deepEqual(waits.find((w) => w.templateId === "email-marketing")?.waitsOn, ["Shopify", "Klaviyo"], "the Campaign writer reads Product facts from Shopify");
assert.ok(waits.find((w) => w.templateId === "prospecting")?.waitsOn.includes("Gmail"));
assert.deepEqual(deptWaits(TEMPLATES, { setupTemplate: SETUP_TEMPLATE, installed: new Set([SETUP_AGENT, "cfo", "bookkeeper"]), connected: new Set(), needsOf }, null).map((w) => w.templateId), ["finance"], "only installed departments");

// setup state: offer and firstJob read safely
assert.deepEqual(readSetupState({ done: true, offer: true, firstJob: { agentId: "bookkeeper", at: "2026-11-19T20:00:00Z" } }, []), { done: true, stage: "business", skipped: [], plans: {}, designs: [], asked: [], leaning: [], offer: true, firstJob: { agentId: "bookkeeper", at: "2026-11-19T20:00:00Z", kind: "playbook" }, wrapUp: false });
assert.equal(readSetupState({ firstJob: { agentId: "tess", at: "2026-11-19T20:00:00Z", kind: "try" } }, []).firstJob?.kind, "try", "a first try is kept as one");
assert.equal(readSetupState({ firstJob: { agentId: "tess", at: "2026-11-19T20:00:00Z", kind: "launch" } }, []).firstJob?.kind, "playbook", "anything else reads as a playbook job");
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
const plan = planOrgOn(members, turned.chains, T, "America/Chicago");
assert.deepEqual(plan.wake.map((w) => w.id).sort(), [...ids].sort());
assert.ok(plan.wake.find((w) => w.id === SETUP_AGENT)?.firstRun, "Avery's morning summary is scheduled");

// card 194: a department Avery designed starts with a first try (its agents have no playbook yet)
{
  const readTool = Object.values(TOOLS).find((t) => t.kind === "read" && needsOf(t.id).length === 0)!;
  const shopTool = Object.values(TOOLS).find((t) => t.kind === "read" && needsOf(t.id).includes("SHOPIFY_CONNECTED"))!;
  const person = (name: string, tools: string[]) => ({ name, seat: `${name}'s seat`, job: `${name} watches the standing orders.`, tools });
  const designs = [
    { key: "money-desk", name: "Money desk", kit: "finance", draft: null },
    { key: "shop-accounts", name: "Shop accounts", kit: null, draft: { head: person("Tess", [readTool.id]), agents: [person("Ivo", [shopTool.id])] } },
    { key: "gifts", name: "Holiday boxes", kit: null, draft: { head: person("Nell", [shopTool.id]), agents: [person("Ghost", [readTool.id])] } },
  ];
  const agents = [{ id: "tess", name: "Tess" }, { id: "ivo", name: "Ivo" }, { id: "nell", name: "Nell" }];
  const built = builtCandidates(designs, agents);
  assert.deepEqual(built.map((b) => [b.agentId, b.deptId, b.head]), [["tess", "design:shop-accounts", true], ["ivo", "design:shop-accounts", false], ["nell", "design:gifts", true]], "kits are skipped; a person not installed is skipped; head first, sketch order");
  const pickB = (connected: ToolTileId[], b = built) => pickFirstJob(TEMPLATES, { setupTemplate: SETUP_TEMPLATE, installed, pending, connected: new Set(connected), needsOf, kindOf, built: b });
  const a = pickB(["mercury", "shopify"]);
  assert.equal(a?.kind, "try", "a designed department goes first, even over a template job that proposes");
  assert.equal(a?.agentId, "ivo", "workers before heads");
  assert.deepEqual([a?.templateId, a?.dept, a?.proposes, a?.keep], ["design:shop-accounts", "Shop accounts", false, []]);
  const b = pickB(["mercury"]);
  assert.equal(b?.agentId, "tess", "Ivo needs Shopify for every tool he has: not runnable; Tess reads what needs nothing");
  assert.deepEqual(b?.later, []);
  assert.equal(pickB(["mercury"], built.filter((x) => x.agentId !== "tess"))?.kind, "playbook", "no designed agent can start: a template's job is picked as before");
  assert.deepEqual(pickB([], built.filter((x) => x.agentId === "nell")), pickB([], []), "a designed agent with every tool waiting is never picked");
  const w = deptWaits(TEMPLATES, { setupTemplate: SETUP_TEMPLATE, installed: new Set(["tess", "ivo", "nell", "cfo", "bookkeeper"]), connected: new Set(), needsOf, built }, "design:shop-accounts");
  assert.deepEqual(w.map((x) => [x.templateId, x.dept, x.waitsOn.length > 0]), [["design:gifts", "Holiday boxes", true], ["finance", "Finance", true]], "designed departments are listed first, the first job's own left out");

  // a first try follows its preview run; a playbook job never counts one
  const tryStarted = { offer: true, firstJob: { agentId: "bookkeeper", at: new Date(T).toISOString(), kind: "try" as const } };
  assert.equal(firstJobPhase(tryStarted, [run({ trigger: "preview", status: "ok", ended_at: new Date(T + 9e3).toISOString() })], T + 60e3)?.phase, "done", "the try's run is the first job");
  assert.equal(firstJobPhase(tryStarted, [run({ status: "ok", ended_at: new Date(T + 9e3).toISOString() })], T + 60e3)?.phase, "running", "a manual run isn't the try");

  const acts = readFileSync("dashboard/actions.ts", "utf8");
  const sf = acts.slice(acts.indexOf("export async function startFirstJob"), acts.indexOf("function firstJobPlan"));
  assert.match(sf, /const ids = \[\.\.\.\(isTry \? \[\] : \[tap\.agentId\]\)/, "a designed agent is never put on duty by the first job: it has no approved playbook (card 188)");
  assert.match(sf, /isTry \? await startTry\(tap\.agentId, who\.name\) : await startRun\(/);
  assert.match(sf, /markFirstJob\(tap\.agentId, isTry \? "try" : "playbook"\)/);
  const tries = readFileSync("core/agent-try.ts", "utf8");
  assert.match(tries, /async function tryOnce[\s\S]*withRun\(agentId, "preview"[\s\S]*afterRun\(agentId, rid, got\)/, "a try is a preview run through withRun, and its routine is drafted by code after it");
  assert.match(tries, /async function startTry[\s\S]*tryOnce\(agentId, target, fresh, markStarted\)/, "a try can start in the background");
  assert.match(acts, /async function startTry[\s\S]*startTryRun\(agentId, t, true\)/, "the first try explores fresh, in the background");
  const card = readFileSync("dashboard/components/firstJob.tsx", "utf8");
  assert.match(card, /Start its first try/);
  assert.match(card, /href=\{`\/build\/\$\{v\.agentId\}`\}[^>]*>Review its routine/, "after the try, the founder reviews its routine on its page");
  assert.match(readFileSync("dashboard/firstJob.ts", "utf8"), /\.eq\("trigger", "preview"\)/, "the Desk reads the try's run, which its floor leaves out");
}

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
