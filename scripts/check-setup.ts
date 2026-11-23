// First-run setup, step 1 (card 151, docs/setup.md): `npm run check:setup`. Pure: reads files, no database.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  FACT_MAX, FACT_TOPICS, MAX_FACTS, SETUP_AGENT, SETUP_TEMPLATE, STAGES, STAGE_WORDS,
  shownStage, wrapScreen, INTERVIEW_AREAS, SETUP_EFFORT, SETUP_MODEL, coverage, leaningOf, type Fact,
  SETUP_HANDOFF, SETUP_MAX_OUT, SETUP_STOPPED, setupLimits, cleanFact, factProblem, factsLine, needsSetup, nextStage, prevStage, readSetupState, readStage, stageProgress, setupDirective, setupPrompt, stateFor,
} from "../core/setup-rules";
import { MAX_DESIGNS, REASON_MAX, applyDesign, saidLine, unquote, designGaps, designKey, pickId, readDesigns, type Design, type Kit } from "../core/design-rules";
import { peopleOf, type DraftCtx } from "../core/department-rules";
import { TOOLS } from "../core/tools/catalog";
import { MEASURES } from "../core/goal-rules";
import { isCustomToolId } from "../core/custom-mcp-rules";
import { businessLines } from "../core/business-rules";
import { installRows, ontoSetup } from "../core/install-rules";
import { mergeTemplates, templateProblems, type Template } from "../core/template-rules";
import { DEPT_STATUS_WORDS, agentsOf, bespokeDept, companyDepts, companyTotals, deptMonth, deptStatus, initialPick, readPick, runsFor } from "../core/company-rules";
import { monthCost, runCost } from "../core/cost-rules";
import { TEMPLATES } from "../core/templates";
import { modelDef } from "../integrations/models";
import { CACHE_READ, CACHE_WRITE, costUsd } from "../integrations/anthropic";

const read = (f: string) => readFileSync(f, "utf8");
const tpl = (id: string) => JSON.parse(read(`templates/${id}.json`)) as Template;
const deptIds = readdirSync("templates").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => id !== SETUP_TEMPLATE);

// facts: a topic from the list, one short line, at most MAX_FACTS
assert.equal(factProblem("sells", "Coffee blends", 0), null);
assert.match(factProblem("price", "x", 0)!, /topic/);
assert.match(factProblem("sells", "   ", 0)!, /needs words/);
assert.match(factProblem("sells", "x".repeat(FACT_MAX + 5), 0)!, /at most/);
// card 197: setup ends on code's own hand-off line, kept once, never a model's words
assert.ok(!/https?:|Shopify|Klaviyo|Mercury/.test(SETUP_HANDOFF) && SETUP_HANDOFF.length < 200);
{
  const src = read("core/setup.ts");
  const fin = src.slice(src.indexOf("export async function finishSetup"), src.indexOf("export async function endWrapUp"));
  assert.match(fin, /const was = await setupState\(\)/);
  assert.match(fin, /if \(!was\.done\) await keepChat\(\{ role: "avery", text: SETUP_HANDOFF \}\)\.catch\(/, "only the first time setup ends, and a missing chat table never stops it");
}
// card 199: setup on a phone
{
  const css = read("app/globals.css"), ui = read("dashboard/components/setup.tsx"), src = read("core/setup.ts");
  assert.match(ui, /\{tot\.agents === 1 \? "agent" : "agents"\}/, "1 agent, 2 agents");
  assert.ok(!src.includes("on the right"), "facts sit below the chat on a phone");
  assert.match(src, /Edit or remove any under What I’ve learned so far\./);
  const phone = css.slice(css.indexOf("setup on a phone (card 199)"));
  for (const rule of ["scroll-padding-bottom", ".wg-name", ".signout-word { display: none; }", "100svh", ".wg-nav-bar", "textarea:focus, .wg-card input:focus) .wg-nav { visibility: hidden; }"]) assert.ok(phone.includes(rule), rule);
  assert.match(css, /\.wg-av-chat \{ display: none; \}/);
  assert.match(css, /\.wg-tool \{ padding: 8px 6px; font-size: 14px; overflow-wrap: normal;/, "tool names break between words only");
  assert.match(ui, /className="stack wg-nav"/);
}
// card 200: prompt caching is billed at its own rates, a setup turn writes at most SETUP_MAX_OUT, and the shared brain is asked in code
{
  const m = modelDef(SETUP_MODEL)!;
  assert.equal(CACHE_WRITE, 1.25); assert.equal(CACHE_READ, 0.1);
  assert.equal(costUsd(SETUP_MODEL, 10000, 0), Number((10000 * m.in).toFixed(4)));
  assert.equal(costUsd(SETUP_MODEL, 10000, 1000, 0, { read: 9000 }), Number(((1000 + 9000 * 0.1) * m.in + 1000 * m.out).toFixed(4)));
  assert.equal(costUsd(SETUP_MODEL, 10000, 0, 0, { write: 10000 }), Number((10000 * 1.25 * m.in).toFixed(4)));
  assert.ok(costUsd(SETUP_MODEL, 18000, 1600, 0, { read: 16000 }) < costUsd(SETUP_MODEL, 18000, 1600) / 2, "a cached turn costs less than half");
  assert.ok(SETUP_MAX_OUT >= 4000 && SETUP_MAX_OUT < 8000, "room for thinking and a long design call, below the runner's 8000");
  const runner = read("core/runner.ts"), setup = read("core/setup.ts"), llm = read("integrations/llm.ts");
  assert.match(llm, /cache_control: \{ type: "ephemeral" \}/);
  assert.match(llm, /max_tokens: req\.maxOut,/);
  assert.match(runner, /const worst = lastCached \? costUsd\(spec\.model, lastIn \+ added, maxOut, 0, \{ read: lastIn, write: added \}\) : costUsd\(spec\.model, lastIn \+ 3000, maxOut\)/, "the cost check uses the same output limit as the call");
  assert.match(runner, /llm\.turn\(\{ model: spec\.model, maxOut,/, "the call uses the same output limit as the cost check");
  assert.match(runner, /costUsd\(billed, tin, tout, res\.usage\.searches, \{ write: res\.usage\.cacheWrite, read: res\.usage\.cacheRead \}\)/);
  assert.match(setup, /maxOut: SETUP_MAX_OUT/);
  assert.match(setup, /const upFront = ready \? await similarUpFront\("starting"\)/);
  assert.match(setup, /\[ready \? null : similarTool\(heldSimilar\), kindTool\(heldKind\)\]/, "no tool turn for the brain once she can sketch");
}
// card 196: a fact cut off mid-sentence is refused, so Avery sends the whole line
assert.match(factProblem("goals", "Greg doesn't know whether the van pays for itself and wants to", 0)!, /stops mid-sentence/);
for (const end of ["and", "or", "the", "a", "of", "for", "with", "because"]) assert.ok(factProblem("other", `Something about ${end}`, 0), `ends on "${end}"`);
// card 198: "that" can end a whole sentence
assert.equal(factProblem("other", "Tried a winter tune-up flyer once, nothing beyond that", 0), null);
// card 198: a sketch reply has room for the shared brain, three departments and finish; an interview reply stays small
{
  const talk = setupLimits(false), sketch = setupLimits(true);
  assert.deepEqual(talk, { maxSteps: 6, maxCostUsd: 0.3 });
  assert.ok(sketch.maxSteps >= 2 + 3 * 3 + 1, "brain tools, about/head/goal for three departments, a fact");
  // the runner refuses a turn when spent + its worst case (input + 3000, 8000 out) passes the limit
  const m = modelDef(SETUP_MODEL)!, turn = (tin: number, tout: number) => tin * m.in + tout * m.out;
  let spent = 0, turns = 0;
  for (let i = 0; i < 10; i++) { const tin = 9000 + i * 1500; if (spent + turn(tin + 3000, SETUP_MAX_OUT) > sketch.maxCostUsd) break; spent += turn(tin, 1600); turns++; }
  assert.ok(turns >= 5, `a sketch reply affords ${turns} model turns, needs at least 5`);
  // a stopped reply says so in code's words, never the runner's summary
  assert.ok(!/\$|cost limit|tool calls/.test(SETUP_STOPPED));
  const src = read("core/setup.ts");
  assert.match(src, /limits: setupLimits\(ready\)/);
  assert.match(src, /res\.status === "ok" && !finished \? SETUP_STOPPED/);
}
assert.equal(factProblem("goals", "Wants to know whether the van pays", 0), null, "a whole line is fine");
assert.equal(factProblem("sells", "Sells a monthly membership", 0), null);
assert.match(factProblem("sells", "ok", MAX_FACTS)!, /at most 40 facts/);
assert.equal(cleanFact("  Sells   coffee.\n "), "Sells coffee");
assert.equal(cleanFact("a\u0000b"), "a b", "control characters go");
assert.equal(cleanFact(""), null);

// a run that read a web page saves only suggestions (in code, never the model's say)
assert.equal(stateFor(true), "suggested");
assert.equal(stateFor(false), "known");

// the stored sketch reads back checked; the leaning is derived from it (a kit Avery chose is a strong fit)
assert.ok(deptIds.length >= 2, "there are department templates to start from");
const EMPTY = { done: false, stage: "business", skipped: [], plans: {}, designs: [], asked: [], leaning: [], offer: false, firstJob: null, wrapUp: false };
assert.deepEqual(readSetupState(null, deptIds), EMPTY);
assert.deepEqual(readSetupState({ done: true, designs: [{ key: "x", name: "Shop accounts", purpose: "p", reason: "You said so.", kit: "nope", draft: null }] }, deptIds), { ...EMPTY, done: true }, "a stored design with a kit that isn't on the list is dropped, not trusted");
assert.deepEqual(readSetupState({ leaning: [{ id: deptIds[0], fit: "strong" }] }, deptIds).leaning, [], "an old stored leaning isn't read: only the sketch counts");

// one guided flow (card 181): the step is kept in the setup state, and only a step on the list counts
assert.deepEqual([...STAGES], ["business", "company", "first"], "card 195: tools are asked inside the interview, not a step of their own");
assert.equal(readStage("tools"), "business", "a business saved on the old tools step opens on the interview");
for (const bad of [undefined, null, "", "credits", "TOOLS", 2, { stage: "tools" }]) assert.equal(readStage(bad), "business", `an unknown step (${String(bad)}) opens on the first one`);
assert.equal(readSetupState({ stage: "company" }, deptIds).stage, "company", "the saved state keeps its step");
assert.equal(readSetupState({ stage: "nope" }, deptIds).stage, "business");
assert.equal(prevStage("business"), null, "nothing before the first step");
assert.equal(nextStage("first"), null, "nothing after the last step");
assert.deepEqual(STAGES.map((s) => nextStage(s)), ["company", "first", null]);
assert.deepEqual(STAGES.map((s) => prevStage(s)), [null, "business", "company"]);
assert.deepEqual(STAGES.map(stageProgress), [33, 67, 100]);
for (const s of STAGES) assert.ok(STAGE_WORDS[s], `${s} has a name`);
{
  const page = read("app/start/page.tsx"), parts = read("dashboard/components/setup.tsx"), acts = read("dashboard/setupActions.ts");
  assert.ok(!/#step-|href="#tools"/.test(page + parts), "no anchor steps: one step is on screen at a time");
  assert.ok(!/DASHBOARD_CONTROLS/.test(page + parts), "no setting names in what a founder reads in setup");
  assert.ok(!/DASHBOARD_CONTROLS/.test(acts.replace(/^\/\/.*$/gm, "")), "nor in what setup's actions answer");
  assert.match(acts, /export async function setupGo[\s\S]{0,200}asRole\("approver"\)[\s\S]{0,120}isStage\(stage\)/, "moving a step checks the role, then the step");
  assert.match(page, /state\.stage === "business"/, "the page shows the saved step");
  assert.equal(read("core/tools-step-rules.ts").includes('"/start#'), false, "a sign-in comes back to /start, which opens on the saved step");
}

// who goes to setup: a new business, never one with a crew
assert.equal(needsSetup({ done: false, departments: 0, agentIds: [] }), true, "a brand-new business");
assert.equal(needsSetup({ done: false, departments: 0, agentIds: [SETUP_AGENT] }), true, "only Avery, from setup");
assert.equal(needsSetup({ done: false, departments: 2, agentIds: [SETUP_AGENT, "cfo"] }), false, "a business with a crew never");
assert.equal(needsSetup({ done: false, departments: 0, agentIds: ["scratch"] }), false, "an agent the owner built: not new");
assert.equal(needsSetup({ done: true, departments: 0, agentIds: [SETUP_AGENT] }), false, "started empty: done");

// agents read known facts only, as background
const facts = [{ topic: "sells" as const, text: "Coffee blends", state: "known" as const }, { topic: "channels" as const, text: "From a page", state: "suggested" as const }];
const line = factsLine(facts)!;
assert.match(line, /Sells: Coffee blends/);
assert.doesNotMatch(line, /From a page/, "a suggestion counts only after Confirm");
assert.match(line, /never a claim about a product/);
assert.equal(factsLine([facts[1]]), null);
assert.match(businessLines({ name: "Acme", about: null, ownerName: null, facts: line }), /You work for Acme\. What the business has told us/);
assert.doesNotMatch(businessLines({ name: "Acme", about: null, ownerName: null }), /told us/);

// card 192: the interview comes first. Six areas, counted in code from known facts; the sketch needs 5, always the week.
const k = (topic: string) => ({ topic, text: topic, state: "known" }) as unknown as Fact;
assert.deepEqual(coverage([]), { covered: [], missing: [...INTERVIEW_AREAS], ready: false });
assert.equal(coverage(["business", "sells", "customers", "channels", "goals"].map(k)).ready, false, "five areas without the founder's week isn't enough");
assert.equal(coverage(["business", "sells", "customers", "channels", "hand_off"].map(k)).ready, true, "five with the week is");
assert.equal(coverage([{ topic: "hand_off", text: "x", state: "suggested" }, ...["business", "sells", "customers", "channels"].map(k)] as Fact[]).ready, false, "a fact read from a site counts only once confirmed");
assert.equal(coverage(["other", "other", "business", "sells", "customers", "channels"].map(k)).covered.length, 4, "other is not an area");
const early = setupDirective("Avery", [k("business")], deptIds.map((id) => ({ id, name: id, about: "x" })));
assert.doesNotMatch(early, /Lean toward|Suggest a department/, "no department talk before the interview is done");
assert.match(early, /Don't propose departments yet[\s\S]*how it makes money/, "she is told what to ask next");
assert.match(early, /grounded in what the founder just said/, "follow-ups, not a checklist");
assert.match(early, /what they would happily never do again/, "she asks about their week");
assert.equal(SETUP_MODEL, "claude-opus-5-5", "setup thinks with the best model");
assert.equal(SETUP_EFFORT, "high");
{
  const st = read("core/setup.ts");
  assert.match(st, /model: SETUP_MODEL,\s*effort: SETUP_EFFORT/, "the setup run uses them");
  assert.match(st, /\.\.\.\(ready \? \[designTool\(heldDesign\)\] : \[\]\)/, "Design a department only once the interview is covered");
  assert.match(read("app/start/page.tsx"), /<Coverage facts=\{facts\} \/>/, "the founder sees what Avery still needs");
}
const full = ["business", "sells", "customers", "channels", "hand_off", "goals"].map(k);

// Avery's setup instructions: the list comes from code, pages are untrusted, she changes nothing
const dir = setupDirective("Avery", [...facts, ...full], deptIds.map((id) => ({ id, name: id, about: "x" })));
for (const id of deptIds) assert.ok(dir.includes(`- ${id}:`), `${id} is on her list`);
assert.match(dir, /untrusted data/);
assert.match(dir, /don't hire, connect, change or send anything/);
assert.match(dir, /channels: From a page \(suggested, not confirmed\)/);
assert.match(setupPrompt([{ role: "owner", text: "hi" }], "We sell tea", "https://tea.example.com/"), /The founder's site: https:\/\/tea\.example\.com\/\n\nThe founder says:\nWe sell tea$/);

// installing departments beside the Avery setup installed: her rows stay, the flow gets a new version
for (const id of [SETUP_TEMPLATE, ...deptIds]) assert.deepEqual(templateProblems(tpl(id)), [], `${id} is a valid template`);
let n = 0;
const all = installRows("x", mergeTemplates([tpl(SETUP_TEMPLATE), tpl(deptIds[0])]), () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
const onto = ontoSetup(all, { agent: SETUP_AGENT, flowVersion: 3 });
assert.ok(all.agents.some((a) => a.id === SETUP_AGENT));
assert.ok(!onto.agents.some((a) => a.id === SETUP_AGENT), "her agent isn't inserted again");
assert.ok(!onto.agent_defs.some((d) => d.agent_id === SETUP_AGENT) && !onto.agent_playbooks.some((p) => p.agent_id === SETUP_AGENT) && !onto.seats.some((s) => s.agent_id === SETUP_AGENT));
assert.equal(onto.agents.length, all.agents.length - 1);
assert.equal(onto.crew_flow[0].version, 4, "the merged chains go in as the next version");
assert.ok(onto.seats.every((s) => s.parent_id === null || onto.seats.some((p) => p.id === s.parent_id)), "no seat hangs from one that isn't inserted");

// the code paths the rules depend on
const runs = read("core/runs.ts");
assert.match(runs, /if \(trigger === "setup"\) \{[\s\S]*?if \(agentId !== SETUP_AGENT \|\| count\) return/, "a setup run: only the Chief of Staff, only before departments");
const setup = read("core/setup.ts");
assert.match(setup, /allowedDomains: \[host\]/, "Read a web page is held to the founder's own host");
assert.match(setup, /const state = stateFor\(readAPage\);/, "facts are saved in the state code decides");
assert.match(setup, /if \(res\.status === "ok" && finished\)/, "facts are saved only after a run that finished");
assert.match(setup, /checkAddress\(/, "the site address is checked before it is used");
// card 302: the Desk reads setup state with its other loads, then redirects before drawing anything
assert.match(read("app/(room)/page.tsx"), /const \[f, setup[^\]]*\] = await Promise\.all\(\[getFloor\(\), inSetup\(\)[\s\S]*?if \(setup\) redirect\("\/start"\);/, "the Desk sends a new business to setup");
assert.doesNotMatch(read("app/(room)/page.tsx"), /TemplatePicker|Start your crew/, "the picker moved to setup");

// ---- Your company (card 153): the chart is drawn in code from Avery's sketch, never by the model
const fake = (t: Template, id: string, runs: number) => monthCost({ run: runCost(null, id.length / 100), cap: 0.5, runsPerMonth: runs, billing: "own_key" });
const label = (id: string) => `[${id}]`;
const depts = companyDepts(TEMPLATES, { leaning: [{ id: "finance", fit: "strong" }, { id: "email-marketing", fit: "likely" }], setupTemplate: "chief-of-staff", toolLabel: label, costOf: fake, waitsOn: { finance: ["Mercury"] } });
assert.deepEqual(depts.map((d) => d.id), ["finance", "prospecting", "email-marketing", "store-analytics"], "every department template, in order, without the company seat");
assert.deepEqual(depts.map((d) => d.fit), ["strong", null, "likely", null]);
assert.deepEqual(initialPick(depts), ["finance", "email-marketing"], "the chart starts with what Avery leaned toward, strong or likely");
const fin = depts[0];
assert.deepEqual(fin.agents.map((a) => [a.id, a.head, a.runsPerMonth]), [["cfo", true, 30], ["bookkeeper", false, 22]], "heads first; runs from the template's routines");
assert.match(fin.agents[0].job, /numbers/i, "the job is the template's mandate");
assert.ok(fin.agents[0].tools.every((t) => /^\[[a-z_]+\]$/.test(t)), "tools are labels from the tool list");
assert.deepEqual(fin.waitsOn, ["Mercury"]);
assert.deepEqual(depts[2].openSeats, ["Retention lead", "Growth ops lead"]);
assert.deepEqual(depts[3].agents.map((a) => [a.id, a.head, a.runsPerMonth]), [["analytics_head", true, 4]], "card 159: the store analytics head runs Mondays");
assert.equal(depts[1].agents.every((a) => a.runsPerMonth === 0), true, "by hand only: $0 a month");
assert.equal(runsFor("chief_of_staff", TEMPLATES.find((t) => t.id === "chief-of-staff")!.chains, false), 22, "a step's own days win over the chain's");
assert.equal(runsFor("cfo", [], false), 0);
const avery = agentsOf(TEMPLATES.find((t) => t.id === "chief-of-staff")!, { toolLabel: label, costOf: fake });
const tot = companyTotals(depts, ["finance"], avery);
assert.equal(tot.agents, 3, "the company seat plus the picked departments' agents");
assert.ok(Math.abs(tot.month - [...avery, ...fin.agents].reduce((s, a) => s + a.cost.month, 0)) < 1e-6, "the total is the sum of its agents");
assert.ok(Math.abs(tot.atMost - (0.5 * 22 + 0.5 * 30 + 0.5 * 22)) < 1e-6, "at most: caps × runs");
assert.deepEqual(readPick(["email-marketing", "finance", "finance"], depts), { ids: ["finance", "email-marketing"] }, "picks in template order, each once");
assert.match((readPick(["chief-of-staff"], depts) as { problem: string }).problem, /isn't a department on the chart/, "the company seat isn't a department to pick");
assert.match((readPick(["made-up"], depts) as { problem: string }).problem, /isn't a department/);
assert.match((readPick([], depts) as { problem: string }).problem, /at least one/);
const actions = read("dashboard/setupActions.ts");
assert.match(actions, /export async function setupInstall[\s\S]*?readPick\([\s\S]*?startCompany\(ids, me\.email\)/, "Start this company receives exactly the checked picks");
assert.match(read("app/start/page.tsx"), /<CompanyChart /, "step 3 is the company chart");
assert.doesNotMatch(read("dashboard/components/client.tsx"), /TemplatePicker/, "the old picker is gone");

// ---- Meet your company (card 184): each department's status and month, worked out in code
const ds = (waitsOn: string[], waitKinds: Record<string, "guide" | "export"> = {}) => deptStatus({ waitsOn, waitKinds });
assert.equal(ds([]), "ready");
assert.equal(ds(["Klaviyo"], { Klaviyo: "guide" }), "after", "planned for Avery to set up");
assert.equal(ds(["Mercury"], { Mercury: "export" }), "export");
assert.equal(ds(["Klaviyo", "Mercury"], { Klaviyo: "guide", Mercury: "export" }), "export", "an export outranks a guide");
assert.equal(ds(["Klaviyo", "Shopify"], { Klaviyo: "guide" }), "waiting", "a tool with no plan outranks both");
assert.deepEqual(Object.values(DEPT_STATUS_WORDS), ["Ready", "After setup", "From an export", "Waiting on a tool"]);
const planned = companyDepts(TEMPLATES, { leaning: [], setupTemplate: "chief-of-staff", toolLabel: label, costOf: fake, waitsOn: { finance: ["Mercury"], "email-marketing": ["Klaviyo", "Shopify"] }, waitKinds: { Mercury: "export", Klaviyo: "guide", Gmail: "export" } });
assert.deepEqual(planned.map((d) => [d.id, deptStatus(d)]), [["finance", "export"], ["prospecting", "ready"], ["email-marketing", "waiting"], ["store-analytics", "ready"]], "kinds only for tools the department waits on");
assert.deepEqual(planned[0].waitKinds, { Mercury: "export" });
const fm = deptMonth(fin);
assert.ok(Math.abs(fm.month - fin.agents.reduce((s, a) => s + a.cost.month, 0)) < 1e-6, "a department's month is the sum of its agents");
const unknownCost = monthCost({ run: runCost(null, null), cap: null, runsPerMonth: 4, billing: "own_key" });
assert.deepEqual(deptMonth({ agents: [{ ...fin.agents[0], name: "X", cost: unknownCost }] }).unknown, ["X"], "an agent with no estimate is named, not counted as zero");
const page184 = read("app/start/page.tsx");
assert.match(page184, /Meet your company\./, "step 3 is the reveal");
assert.match(page184, /back=\{setupGo\.bind\(null, "business"\)\}/, "Change something goes back to the conversation");
assert.match(page184, /empty=\{<ActionButton[^>]*action=\{setupStartEmpty\}/, "Start empty stays, as a quiet link");
assert.doesNotMatch(read("dashboard/components/setup.tsx"), /role="tree"/, "the old tree chart is gone");

// card 193: Avery designs the company. Each department is a kit under the business's own name, or bespoke,
// built part by part with the card 156 checks; every one carries the founder's words as its reason.
{
  const ctx: DraftCtx = {
    tools: Object.fromEntries(Object.values(TOOLS).map((t) => [t.id, { kind: t.kind, label: t.label }])),
    isCustom: isCustomToolId,
    measures: Object.fromEntries(MEASURES.filter((m) => m.available).map((m) => [m.key, { label: m.label }])),
    departments: [], agentNames: ["Avery"],
  };
  const kits: Kit[] = TEMPLATES.filter((t) => t.id !== SETUP_TEMPLATE).map((t) => ({ id: t.id, name: t.name, agentNames: t.agents.map((a) => a.name) }));
  const o = { ctx, kits, now: "2026-11-20T12:00:00.000Z" };
  const yes = (ds: Design[], input: Record<string, unknown>) => { const r = applyDesign(ds, input, o); if ("problem" in r) assert.fail(`${JSON.stringify(input)}: ${r.problem}`); return r; };
  const no = (ds: Design[], input: Record<string, unknown>, re: RegExp) => { const r = applyDesign(ds, input, o); assert.ok("problem" in r, `${JSON.stringify(input)} is refused`); assert.match(r.problem, re); };
  const readTool = Object.values(TOOLS).find((t) => t.kind === "read")!, action = Object.values(TOOLS).find((t) => t.kind === "action")!;
  const person = (name: string, extra: Record<string, unknown> = {}) => ({ name, seat: "Order watcher", job: "Watches standing orders and flags the late ones.", each_run: "Reads the open orders and lists which shop accounts are late this week.", good_result: "A short list of late accounts, with numbers.", tools: readTool.id, ...extra });
  const finKit = kits.find((k) => k.id === "finance")!;

  // a kit, under this business's name
  let ds = yes([], { part: "about", dept: "Money desk", purpose: "Keeps the books and the cash in view.", reason: "You said the books eat your Sundays.", kit: "finance" }).designs;
  assert.deepEqual(ds[0], { key: "money-desk", name: "Money desk", purpose: "Keeps the books and the cash in view.", reason: "You said the books eat your Sundays.", kit: "finance", draft: null });
  assert.deepEqual(designGaps(ds[0]), [], "a kit brings its own people and goals");
  // card 196: one pair of quote marks on the card, never two
  assert.equal(yes([], { part: "about", dept: "Van and books", purpose: "Shows whether the van pays.", reason: "\u201C\"Mostly evenings.\"\u201D", kit: "none" }).designs[0].reason, "Mostly evenings.", "outer quote marks are dropped when saved");
  assert.equal(saidLine("Mostly evenings."), "\u201CMostly evenings.\u201D");
  assert.equal(saidLine("\"Mostly evenings.\" Greg does the books late."), "\"Mostly evenings.\" Greg does the books late.", "a reason that quotes inside shows as it is");
  assert.equal(unquote("'It's late'"), "It's late");
  assert.match(read("dashboard/components/setup.tsx"), /You said: \{saidLine\(d\.reason\)\}/, "the card shows the reason through saidLine");
  no(ds, { part: "about", dept: "Cash", purpose: "x", reason: "You said so, twice.", kit: "finance" }, /already in the sketch/);
  no(ds, { part: "about", dept: "Astro", purpose: "x", reason: "You said so, twice.", kit: "astrology" }, /isn't a starting kit/);
  no(ds, { part: "head", dept: "Money desk", ...person("Tess") }, /starts from a kit/);
  no(ds, { part: "about", dept: "Money desk", kit: "prospecting" }, /keeps its kit/);

  // bespoke: about, then people with read tools only, then goals
  no(ds, { part: "about", dept: "Shop accounts", purpose: "Keeps the cafés' standing orders on time.", reason: "", kit: "none" }, /reason/);
  no(ds, { part: "about", dept: "Shop accounts", purpose: "Keeps orders on time.", reason: "See https://evil.example/now", kit: "none" }, /link/);
  no(ds, { part: "about", dept: "Shop accounts", purpose: "Keeps orders on time.", reason: "x".repeat(REASON_MAX + 5), kit: "none" }, /under 200/);
  no(ds, { part: "about", dept: "Shop accounts", reason: "You said cafés keep asking." }, /purpose/);
  no(ds, { part: "goal", dept: "Shop accounts", title: "x" }, /about first/);
  ds = yes(ds, { part: "about", dept: "Shop accounts", purpose: "Keeps the cafés' standing orders on time.", reason: "You said cafés keep asking for bags and you lose track.", kit: "none" }).designs;
  const shop = () => ds.find((d) => d.name === "Shop accounts")!;
  assert.equal(shop().kit, null);
  assert.equal(shop().draft!.name, "Shop accounts", "the draft keeps the department's name in step");
  assert.deepEqual(designGaps(shop()), ["a head", "at least one goal"]);
  no(ds, { part: "head", dept: "Shop accounts", ...person("Tess", { tools: action.id }) }, /is an action/);
  no(ds, { part: "head", dept: "Shop accounts", ...person(finKit.agentNames[0]) }, /already|taken|another/i);
  ds = yes(ds, { part: "head", dept: "Shop accounts", ...person("Tess") }).designs;
  ds = yes(ds, { part: "agent", dept: "shop accounts", ...person("Ivo") }).designs;
  ds = yes(ds, { part: "goal", dept: "Shop accounts", title: "No standing order goes out late", measure: "none" }).designs;
  assert.deepEqual(designGaps(shop()), [], "a head and a goal: ready to start");
  assert.deepEqual(peopleOf(shop().draft!).map((p) => p.name), ["Tess", "Ivo"]);
  ds = yes(ds, { part: "remove", dept: "Shop accounts", name: "Ivo" }).designs;
  assert.equal(shop().draft!.agents.length, 0);

  // a second bespoke department can't reuse a name from the first
  ds = yes(ds, { part: "about", dept: "Gift season", purpose: "Gets the holiday boxes planned.", reason: "You said December is chaos every year.", kit: "none" }).designs;
  no(ds, { part: "head", dept: "Gift season", ...person("Tess") }, /already|taken|another/i);
  // rename keeps the key and the draft's name in step
  ds = yes(ds, { part: "about", dept: "Gift season", name: "Holiday boxes" }).designs;
  const gift = ds.find((d) => d.name === "Holiday boxes")!;
  assert.equal(gift.key, "gift-season", "the key is the first name it had");
  assert.equal(gift.draft!.name, "Holiday boxes");
  no(ds, { part: "about", dept: "Holiday boxes", name: "Money desk" }, /already a Money desk/);

  // at most MAX_DESIGNS, and drop
  ds = yes(ds, { part: "about", dept: "Leads", purpose: "Finds cafés to pitch.", reason: "You said you never have time to find cafés.", kit: "prospecting" }).designs;
  assert.equal(ds.length, MAX_DESIGNS);
  no(ds, { part: "about", dept: "Reviews", purpose: "Reads reviews.", reason: "You said reviews matter a lot.", kit: "none" }, /at most 4/);
  ds = yes(ds, { part: "drop", dept: "Leads" }).designs;
  assert.equal(ds.length, MAX_DESIGNS - 1);
  no(ds, { part: "drop", dept: "Leads" }, /no Leads/);
  no(ds, { part: "launch", dept: "Leads" }, /part must be/);
  no(ds, { part: "about", dept: "x" }, /2 to 40/);

  // the stored sketch: well-shaped entries only, each name, key and kit once
  const stored = readDesigns([...ds, { ...ds[0] }, { key: "y", name: "Bad", purpose: "p", reason: "r", kit: null, draft: null }, "junk"], kits.map((k) => k.id));
  assert.deepEqual(stored.map((d) => d.name), ["Money desk", "Shop accounts", "Holiday boxes"], "repeats, bespoke ones without a draft and junk are dropped");
  assert.deepEqual(readDesigns(ds, kits.map((k) => k.id)), ds, "a good sketch reads back unchanged");
  assert.deepEqual(leaningOf(ds), [{ id: "finance", fit: "strong" }]);
  assert.equal(pickId(ds[0]), "finance", "a kit is picked by its template id");
  assert.equal(pickId(shop()), "design:shop-accounts");
  assert.equal(designKey("Shop accounts & Cafés!"), "shop-accounts-caf-s");

  // the chart: a kit under Avery's name and reason; a bespoke department from its draft, by hand
  const chart = companyDepts(TEMPLATES, { leaning: leaningOf(ds), designs: ds, setupTemplate: SETUP_TEMPLATE, toolLabel: label, costOf: fake, waitsOn: {} });
  const money = chart.find((d) => d.id === "finance")!;
  assert.deepEqual([money.name, money.reason, money.kind], ["Money desk", "You said the books eat your Sundays.", "kit"]);
  assert.equal(chart.find((d) => d.id === "prospecting")!.kind, "template");
  const fakeP = () => monthCost({ run: runCost(null, 0.02), cap: 0.5, runsPerMonth: 0, billing: "own_key" });
  const b = bespokeDept(shop(), { toolLabel: label, costOf: fakeP, waitsOn: ["Shopify"] });
  assert.deepEqual([b.id, b.name, b.kind, b.reason], ["design:shop-accounts", "Shop accounts", "bespoke", shop().reason]);
  assert.deepEqual(b.agents.map((a) => [a.name, a.head, a.runsPerMonth]), [["Tess", true, 0]], "by hand until its playbook is approved");
  assert.deepEqual(b.waitsOn, ["Shopify"]);
  assert.deepEqual(initialPick([b, ...chart]), ["design:shop-accounts", "finance"], "the chart starts with Avery's sketch");

  // the directive: design for this business, a reason each, kits only when they fit
  const dir193 = setupDirective("Avery", full, kits.map((k) => ({ id: k.id, name: k.name, about: "x" })), "Tools: (list)", ds);
  assert.match(dir193, /Use Design a department/);
  assert.match(dir193, /needs a reason: the founder's own words/);
  assert.match(dir193, /Start from a kit only when it truly fits/);
  assert.match(dir193, /only read and calculate; they never send, buy or post/);
  assert.match(dir193, /Shop accounts \(bespoke\)[\s\S]*People: Tess/, "she sees her sketch so far");
  assert.doesNotMatch(dir193, /Lean toward|from this list only|Suggest a department/i, "no fixed list to lean toward, no one-off idea");
}
{
  const st = read("core/setup.ts"), acts = read("dashboard/setupActions.ts"), page = read("app/start/page.tsx"), parts = read("dashboard/components/setup.tsx");
  assert.match(st, /id: "design_department"[\s\S]*kind: "report"/, "Design a department is a report tool, so the run builds nothing");
  assert.match(st, /export async function startCompany[\s\S]*designGaps\(d\)[\s\S]*throw[\s\S]*installTemplates\(kitIds\)[\s\S]*buildDepartment\(d\.draft!, "setup: designed by Avery", by, null\)/, "a gap stops it before anything is written; kits install, bespoke ones are built from their checked draft");
  assert.match(read("core/departments.ts"), /export async function buildDepartment[\s\S]*proposalId \? await sourcesNow\(d\) : \[\]/, "a department from setup asks for no sources");
  assert.match(acts, /asRole\("owner"\)[\s\S]{0,40}[\s\S]*startCompany\(/, "Start this company is the owner's");
  assert.match(page, /Avery’s sketch|Avery's sketch/, "the page shows her sketch");
  assert.match(parts, /You said:/, "each department shows the founder's words it answers");
  assert.match(parts, /Designed for you by Avery/);
  for (const gone of ["dashboard/components/idea.tsx", "dashboard/setup.ts"]) assert.throws(() => read(gone), `${gone} is gone`);
  assert.doesNotMatch(read("app/(room)/page.tsx"), /IdeaCard|ideaOffer/, "the Desk no longer offers a one-off idea");
  assert.doesNotMatch(st + acts, /suggest_department|lean_departments|ideaSeed|seedDraft/, "the old lean and idea tools are gone");
}

// card 186: the wrap-up after Start this company: credits, then the first job, inside setup
assert.equal(readSetupState({ done: true, offer: true, wrapUp: true }, deptIds).wrapUp, true, "the wrap-up is kept");
assert.equal(readSetupState({ done: false, offer: true, wrapUp: true }, deptIds).wrapUp, false, "only after the departments are installed");
assert.equal(readSetupState({ done: true, offer: false, wrapUp: true }, deptIds).wrapUp, false, "never after Start empty");
assert.equal(wrapScreen({ firstJob: null, needCredits: true, jobReady: true }), "credits", "credits come first when a run would wait on them");
assert.equal(wrapScreen({ firstJob: null, needCredits: false, jobReady: true }), "job", "then the first job");
assert.equal(wrapScreen({ firstJob: null, needCredits: false, jobReady: false }), "waits", "with no agent ready, what each department waits on");
assert.equal(wrapScreen({ firstJob: { agentId: "x", at: "y" }, needCredits: true, jobReady: false }), "working", "once it started, the company at work");
assert.equal(shownStage({ stage: "business", wrapUp: true }), "first", "the wrap-up is always the last step");
assert.equal(shownStage({ stage: "first", wrapUp: false }), "company", "the last step before installing is the company");
assert.equal(shownStage({ stage: "business", wrapUp: false }), "business");
const setup186 = read("core/setup.ts"), page186 = read("app/start/page.tsx"), acts186 = read("dashboard/setupActions.ts");
assert.match(setup186, /wrapUp: offer/, "Start this company opens the wrap-up; Start empty doesn't");
assert.match(page186, /if \(!setup && !state\.wrapUp\) redirect\("\/"\)/, "/start keeps the founder for the wrap-up");
assert.match(page186, /planBlock\(\{ kind: "run"/, "credits are asked of the paid layer through planBlock; core never reads ee");
assert.match(page186, /firstJobView\(await jobFloor\(health\)\)/, "the wrap-up reads a small floor, not getFloor");
assert.match(page186, /action=\{setupToDesk\}/, "Go to your Desk ends the wrap-up");
assert.doesNotMatch(page186, /Credits for your crew’s work/, "the old second credits panel is gone");
assert.match(acts186, /href: "\/start", text: `Started:/, "Start this company stays in setup");

// the table: its topics are the code's
const mig = readdirSync("supabase/migrations").find((f) => f.endsWith("_business_facts.sql"))!;
const topics = [...(/topic in \(([^)]*)\)/.exec(read(`supabase/migrations/${mig}`))?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
assert.deepEqual(topics, [...FACT_TOPICS], "business_facts.topic allows exactly FACT_TOPICS");

// card 189 walk: the chat follows its newest message, Next stays on screen, a by-hand department isn't "$0.00 a month"
{
  const parts = read("dashboard/components/setup.tsx");
  assert.match(parts, /scrollTo\(\{ top: el\.scrollHeight \}\)/, "the setup chat scrolls to its newest message");
  assert.match(parts, /aria-label="Setup steps"[^>]*position: "sticky"/, "Back and Next stay on screen");
  assert.match(parts, /runs only when you press Run/, "a department with no schedule says it runs when you press Run");
  const finder = JSON.parse(read("templates/prospecting.json")).specs.wholesale_hunter as { tools: string[] };
  for (const t of ["web_search", "web_fetch"]) assert.ok(finder.tools.includes(t), `the lead finder can ${t === "web_search" ? "search the web" : "read a page"}: its directive says to`);
  for (const f of ["prospecting", "email-marketing"]) assert.doesNotMatch(read(`templates/${f}.json`), /"Head of (sales|marketing):/, `${f}: the head's mandate names its own department`);
}

console.log("check:setup ok");
