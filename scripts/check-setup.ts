// First-run setup, step 1 (card 151, docs/setup.md): `npm run check:setup`. Pure: reads files, no database.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  FACT_MAX, FACT_TOPICS, MAX_FACTS, MAX_LEANING, SETUP_AGENT, SETUP_TEMPLATE, STAGES, STAGE_WORDS,
  IDEA_LIMITS, ideaOffer, ideaSeed, readIdea,
  cleanFact, factProblem, factsLine, needsSetup, nextStage, prevStage, readLeaning, readSetupState, readStage, stageProgress, setupDirective, setupPrompt, stateFor,
} from "../core/setup-rules";
import { businessLines } from "../core/business-rules";
import { installRows, ontoSetup } from "../core/install-rules";
import { mergeTemplates, templateProblems, type Template } from "../core/template-rules";
import { DEPT_STATUS_WORDS, agentsOf, companyDepts, companyTotals, deptMonth, deptStatus, initialPick, readPick, runsFor } from "../core/company-rules";
import { monthCost, runCost } from "../core/cost-rules";
import { TEMPLATES } from "../core/templates";

const read = (f: string) => readFileSync(f, "utf8");
const tpl = (id: string) => JSON.parse(read(`templates/${id}.json`)) as Template;
const deptIds = readdirSync("templates").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).filter((id) => id !== SETUP_TEMPLATE);

// facts: a topic from the list, one short line, at most MAX_FACTS
assert.equal(factProblem("sells", "Coffee blends", 0), null);
assert.match(factProblem("price", "x", 0)!, /topic/);
assert.match(factProblem("sells", "   ", 0)!, /needs words/);
assert.match(factProblem("sells", "x".repeat(FACT_MAX + 5), 0)!, /at most/);
assert.match(factProblem("sells", "ok", MAX_FACTS)!, /at most 40 facts/);
assert.equal(cleanFact("  Sells   coffee.\n "), "Sells coffee");
assert.equal(cleanFact("a\u0000b"), "a b", "control characters go");
assert.equal(cleanFact(""), null);

// a run that read a web page saves only suggestions (in code, never the model's say)
assert.equal(stateFor(true), "suggested");
assert.equal(stateFor(false), "known");

// leaning: only department template ids, at most MAX_LEANING, each once, strong or likely
assert.ok(deptIds.length >= 2, "there are department templates to lean toward");
assert.deepEqual(readLeaning([{ id: deptIds[0], fit: "strong" }], deptIds), { leaning: [{ id: deptIds[0], fit: "strong" }] });
assert.match((readLeaning([{ id: "astrology", fit: "strong" }], deptIds) as { problem: string }).problem, /isn't a department/);
assert.match((readLeaning([{ id: SETUP_TEMPLATE, fit: "strong" }], deptIds) as { problem: string }).problem, /isn't a department/, "the Chief of Staff isn't a department to lean toward");
assert.match((readLeaning([{ id: deptIds[0], fit: "perfect" }], deptIds) as { problem: string }).problem, /strong or likely/);
assert.match((readLeaning([{ id: deptIds[0], fit: "strong" }, { id: deptIds[0], fit: "likely" }], deptIds) as { problem: string }).problem, /twice/);
assert.match((readLeaning(Array.from({ length: MAX_LEANING + 1 }, () => ({ id: deptIds[0], fit: "strong" })), deptIds) as { problem: string }).problem, /at most/);
assert.deepEqual(readSetupState({ done: true, leaning: [{ id: "nope", fit: "strong" }] }, deptIds), { done: true, stage: "business", skipped: [], plans: {}, leaning: [], idea: null, offer: false, firstJob: null }, "a stored list with a bad id is dropped, not trusted");
assert.deepEqual(readSetupState(null, deptIds), { done: false, stage: "business", skipped: [], plans: {}, leaning: [], idea: null, offer: false, firstJob: null });

// one guided flow (card 181): the step is kept in the setup state, and only a step on the list counts
assert.deepEqual([...STAGES], ["business", "tools", "company", "first"]);
assert.equal(readStage("tools"), "tools");
for (const bad of [undefined, null, "", "credits", "TOOLS", 2, { stage: "tools" }]) assert.equal(readStage(bad), "business", `an unknown step (${String(bad)}) opens on the first one`);
assert.equal(readSetupState({ stage: "company" }, deptIds).stage, "company", "the saved state keeps its step");
assert.equal(readSetupState({ stage: "nope" }, deptIds).stage, "business");
assert.equal(prevStage("business"), null, "nothing before the first step");
assert.equal(nextStage("first"), null, "nothing after the last step");
assert.deepEqual(STAGES.map((s) => nextStage(s)), ["tools", "company", "first", null]);
assert.deepEqual(STAGES.map((s) => prevStage(s)), [null, "business", "tools", "company"]);
assert.deepEqual(STAGES.map(stageProgress), [25, 50, 75, 100]);
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

// Avery's setup instructions: the list comes from code, pages are untrusted, she changes nothing
const dir = setupDirective("Avery", facts, deptIds.map((id) => ({ id, name: id, about: "x" })));
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
assert.match(read("app/(room)/page.tsx"), /if \(await inSetup\(\)\) redirect\("\/start"\);/, "the Desk sends a new business to setup");
assert.doesNotMatch(read("app/(room)/page.tsx"), /TemplatePicker|Start your crew/, "the picker moved to setup");

// ---- Your company (card 153): the chart is drawn in code from Avery's leaning, never by the model
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
assert.match(actions, /export async function setupInstall[\s\S]*?readPick\([\s\S]*?installTemplates\(ids\)/, "install receives exactly the checked picks");
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
assert.match(page184, /back=\{setupGo\.bind\(null, "tools"\)\}/, "Change something goes back to the tools questions");
assert.match(page184, /empty=\{<ActionButton[^>]*action=\{setupStartEmpty\}/, "Start empty stays, as a quiet link");
assert.doesNotMatch(read("dashboard/components/setup.tsx"), /role="tree"/, "the old tree chart is gone");

// card 185: Avery's department idea, checked in code before it is kept
const taken = TEMPLATES.flatMap((t) => [t.id, t.name]);
assert.deepEqual(readIdea({ name: "Wholesale department", why: "You said cafés keep asking for bags.", roles: "Shop finder, Follow-up writer, Shop finder" }, taken),
  { name: "Wholesale", why: "You said cafés keep asking for bags.", roles: ["Shop finder", "Follow-up writer"] }, "roles come as a comma list; ' department' is dropped; repeats go");
assert.deepEqual(readIdea({ name: "Events", why: "Pop-ups.", roles: ["Booker"] }, taken), { name: "Events", why: "Pop-ups.", roles: ["Booker"] }, "a stored list of roles reads back");
assert.ok("problem" in readIdea({ name: "", why: "x" }, taken), "a name is needed");
assert.ok("problem" in readIdea({ name: "Wholesale", why: "" }, taken), "a reason is needed");
assert.ok("problem" in readIdea({ name: "x".repeat(IDEA_LIMITS.name + 1), why: "y" }, taken), "the name is short");
assert.ok("problem" in readIdea({ name: "Wholesale", why: "y", roles: "a1, b2, c3, d4, e5".replace(/\d/g, "") }, taken), "at most four roles");
assert.ok("problem" in readIdea({ name: "Wholesale", why: "see https://evil.example" }, taken), "no links in why");
assert.ok("problem" in readIdea({ name: "Wholesale", why: "write to buyer@shop.com" }, taken), "no addresses");
assert.ok("problem" in readIdea({ name: "1 Wholesale", why: "y" }, taken), "the name starts with a letter");
const tpl185 = TEMPLATES.find((t) => t.id !== SETUP_TEMPLATE)!;
assert.ok("problem" in readIdea({ name: tpl185.name, why: "y" }, taken), "an idea is never a department already on the list");
const idea = { name: "Wholesale", why: "Cafés ask.", roles: [], want: true, started: false };
assert.deepEqual(readSetupState({ done: true, idea }, deptIds).idea, idea, "the idea and the founder's answer are kept");
assert.equal(readSetupState({ idea: { name: "", why: "x", want: true } }, deptIds).idea, null, "a bad stored idea is dropped");
assert.equal(ideaOffer({ done: true, firstJob: { agentId: "a1", at: "x" }, idea }), true, "the Desk offers it after the first job");
assert.equal(ideaOffer({ done: true, firstJob: null, idea }), false, "not before the first job");
assert.equal(ideaOffer({ done: true, firstJob: { agentId: "a1", at: "x" }, idea: { ...idea, want: false } }), false, "not when the founder said Not now");
assert.equal(ideaOffer({ done: true, firstJob: { agentId: "a1", at: "x" }, idea: { ...idea, started: true } }), false, "only once");
assert.deepEqual(ideaSeed({ name: "Wholesale", why: "Cafés ask." }), { name: "Wholesale", purpose: "Cafés ask." }, "the draft gets the name and purpose, nothing else");
assert.match(setupDirective("Avery", [], []), /Suggest a department/i, "Avery is told when to suggest one");
const setupTs = read("core/setup.ts");
assert.match(setupTs, /id: "suggest_department"[\s\S]*kind: "report"/, "the idea is a report tool, so it builds nothing");
assert.match(read("dashboard/components/idea.tsx"), /Build it with Avery/, "the reveal offers Build it with Avery");
assert.match(read("app/(room)/page.tsx"), /<IdeaCard /, "the Desk shows the idea after the first job");
assert.match(read("core/departments.ts"), /export async function seedDraft[\s\S]*if \(await loadDraft\(\)\) return false/, "Start with Avery never overwrites an open draft");

// the table: its topics are the code's
const mig = readdirSync("supabase/migrations").find((f) => f.endsWith("_business_facts.sql"))!;
const topics = [...(/topic in \(([^)]*)\)/.exec(read(`supabase/migrations/${mig}`))?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
assert.deepEqual(topics, [...FACT_TOPICS], "business_facts.topic allows exactly FACT_TOPICS");

console.log("check:setup ok");
