// First-run setup, step 1 (card 151, docs/setup.md): `npm run check:setup`. Pure: reads files, no database.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  FACT_MAX, FACT_TOPICS, MAX_FACTS, MAX_LEANING, SETUP_AGENT, SETUP_TEMPLATE,
  cleanFact, factProblem, factsLine, needsSetup, readLeaning, readSetupState, setupDirective, setupPrompt, stateFor,
} from "../core/setup-rules";
import { businessLines } from "../core/business-rules";
import { installRows, ontoSetup } from "../core/install-rules";
import { mergeTemplates, templateProblems, type Template } from "../core/template-rules";
import { agentsOf, companyDepts, companyTotals, initialPick, readPick, runsFor } from "../core/company-rules";
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
assert.deepEqual(readSetupState({ done: true, leaning: [{ id: "nope", fit: "strong" }] }, deptIds), { done: true, leaning: [], offer: false, firstJob: null }, "a stored list with a bad id is dropped, not trusted");
assert.deepEqual(readSetupState(null, deptIds), { done: false, leaning: [], offer: false, firstJob: null });

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

// the table: its topics are the code's
const mig = readdirSync("supabase/migrations").find((f) => f.endsWith("_business_facts.sql"))!;
const topics = [...(/topic in \(([^)]*)\)/.exec(read(`supabase/migrations/${mig}`))?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
assert.deepEqual(topics, [...FACT_TOPICS], "business_facts.topic allows exactly FACT_TOPICS");

console.log("check:setup ok");
