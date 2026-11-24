// Where an agent runs (card 405, the Runs on picker): `npm run check:runs-on`. Pure: tests dashboard/runs-on-rules.ts
// and reads source, no database, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAKERS, MATCH_WORD, fillClaudeTools, makerOf, matchClaudeTools, modelGroups, readRunsOn, switchConfirm, switchKind, switchWords, type PickModel,
} from "../dashboard/runs-on-rules";
import { MODEL_LIST } from "../integrations/models";

const read = (p: string) => readFileSync(p, "utf8");
const problem = (r: unknown) => (r as { problem: string }).problem;

const MODELS: PickModel[] = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", ready: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", ready: true },
  { id: "gpt-6.2-sol", label: "GPT-6.2 Sol", provider: "openai", ready: true },
  { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", provider: "google", ready: false },
  { id: "grok-4.7", label: "Grok 4.7", provider: "xai", ready: false },
];

// ---- every model OPERATOR lists has a maker the picker groups by
for (const m of MODEL_LIST) assert.ok(makerOf(m.provider), `${m.id}: its maker (${m.provider}) is in MAKERS`);
assert.deepEqual(MAKERS.map((m) => m.name), ["Claude", "OpenAI", "Gemini", "Grok"], "the picker's order");

// ---- groups: by maker, in order; a maker with no key is marked so the picker links to Connections
const g = modelGroups(MODELS);
assert.deepEqual(g.map((x) => x.maker.name), ["Claude", "OpenAI", "Gemini", "Grok"]);
assert.deepEqual(g.map((x) => x.noKey), [false, false, true, true]);
assert.deepEqual(modelGroups(MODELS.filter((m) => m.provider === "anthropic")).map((x) => x.maker.name), ["Claude"], "a maker with no models is left out");

// ---- reading the choice from the browser
assert.deepEqual(readRunsOn({ on: "operator", model: "gpt-6.2-sol" }, MODELS), { on: "operator", model: "gpt-6.2-sol" });
assert.match(problem(readRunsOn({ on: "operator", model: "grok-4.7" }, MODELS)), /Grok key on Connections/, "a model without its key is refused");
assert.deepEqual(readRunsOn({ on: "operator", model: "grok-4.7" }, MODELS, "grok-4.7"), { on: "operator", model: "grok-4.7" }, "the model it already runs on still saves after its key went away");
assert.match(problem(readRunsOn({ on: "operator", model: "gpt-9" }, MODELS)), /isn’t one OPERATOR runs/);
assert.deepEqual(readRunsOn({ on: "claude", tools: ["Gmail", " Slack ", "Gmail"] }, MODELS), { on: "claude", tools: ["Gmail", "Slack"] });
assert.match(problem(readRunsOn({ on: "claude", tools: [] }, MODELS)), /^Name the Claude connectors/, "a routine names at least one connector");
assert.match(problem(readRunsOn({ on: "claude", tools: ["<script>"] }, MODELS)), /isn’t a connector name/);
assert.match(problem(readRunsOn({ on: "openai_workspace" }, MODELS)), /Pick where it runs/, "only OPERATOR or a Claude routine (decided 2026-11-24)");
assert.match(problem(readRunsOn(null, MODELS)), /Pick where it runs/);

// ---- what saving does
const op = { on: "operator" as const, model: "claude-sonnet-5-5" };
assert.equal(switchKind(op, { on: "operator", model: "claude-sonnet-5-5" }), "same");
assert.equal(switchKind(op, { on: "operator", model: "gpt-6.2-sol" }), "model", "a new model is a draft, not a switch");
assert.equal(switchKind(op, { on: "claude", tools: ["Gmail"] }), "to_claude");
const cl = { on: "claude" as const, model: "claude-sonnet-5-5" };
assert.equal(switchKind(cl, { on: "operator", model: "claude-sonnet-5-5" }), "to_operator", "back into OPERATOR on the model it had");
assert.equal(switchKind(cl, { on: "claude", tools: ["Slack"] }), "same");
assert.equal(switchWords("model", "Morgan"), null);
assert.equal(switchWords("same", "Morgan"), null);
const toC = switchWords("to_claude", "Morgan")!;
assert.match(toC.stops, /outside approval cards and caps/, "the sheet says what happens in Claude is outside the gateway");
assert.match(toC.then, /Off duty/);
assert.match(switchWords("to_operator", "Sage", "GPT-6.2 Sol")!.title, /into OPERATOR on GPT-6\.2 Sol/);
assert.match(switchWords("to_operator", "Sage")!.stops, /forgets the token/);
assert.match(switchConfirm("to_claude", "Morgan")!, /^Confirm first: Morgan goes off duty/, "the sheet's confirm pattern");
assert.match(switchConfirm("to_operator", "Sage")!, /^Confirm first: Sage goes off duty/);
assert.equal(switchConfirm("model", "Morgan"), null);

// ---- "Uses in Claude", filled from its reads' tools
assert.deepEqual(fillClaudeTools(["Mercury", "Shopify", "mercury", "", "Shopify"]), ["Mercury", "Shopify"]);
assert.equal(fillClaudeTools(Array.from({ length: 12 }, (_, i) => `Tool ${i}`)).length, 8, "at most CLAUDE_TOOLS.max");
assert.deepEqual(fillClaudeTools(["<b>"]), [], "not a connector name");

// ---- matching Claude connector labels to OPERATOR's tools
const CONNS = [
  { id: "gmail", name: "Gmail", connected: true },
  { id: "mercury", name: "Mercury", connected: false },
  { id: "calendar", name: "Google Calendar", connected: true },
  { id: "ga4", name: "Google Analytics", connected: false },
];
const m = matchClaudeTools(["Gmail", "Mercury", "Calendar", "Slack", "Google"], CONNS);
assert.deepEqual(m.map((x) => x.state), ["ok", "warn", "ok", "none", "none"], "connected, can be connected, none; a bare maker name matches nothing");
assert.deepEqual(m.map((x) => x.conn), ["gmail", "mercury", "calendar", null, null]);
assert.equal(MATCH_WORD.none, "None here");

// ---- source: the server action, the sheet and the old button
const actions = read("dashboard/actions.ts");
const body = actions.slice(actions.indexOf("export async function setRunsOn"), actions.indexOf("\n}\n", actions.indexOf("export async function setRunsOn")));
assert.match(body, /await asRole\("owner"\)/, "only the owner switches where an agent runs");
assert.match(body, /readRunsOn\(raw, models, current\)/, "the choice is checked on the server");
assert.match(body, /update\(\{ enabled: false \}\)/, "switching sides takes it off duty");
assert.match(body, /switchConfirm\(kind, who\.name\)[\s\S]*!confirmed/, "a switch asks once");
assert.doesNotMatch(actions, /export async function moveIntoOperator/, "the Runs on picker replaces Move into OPERATOR");
const sheet = read("dashboard/components/agentSheet.tsx");
assert.match(sheet, /<RunsOnPicker /, "the Edit tab uses the picker");
assert.doesNotMatch(sheet, /id="ag-model"/, "the old model dropdown is gone");
assert.doesNotMatch(sheet, /Move into OPERATOR/, "the old button is gone");
assert.doesNotMatch(read("dashboard/components/runsOn.tsx"), /router\.refresh\(/);

console.log("check:runs-on ok");
