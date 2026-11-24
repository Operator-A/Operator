// Where an agent runs (card 405, the Runs on picker): `npm run check:runs-on`. Pure: tests dashboard/runs-on-rules.ts
// and reads source, no database, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAKERS, makerOf, modelGroups, readRunsOn, switchConfirm, switchKind, switchWords, type PickModel,
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
assert.deepEqual(readRunsOn({ on: "claude" }, MODELS), { on: "claude" }, "a routine names no connectors (decided 2026-11-24)");
assert.deepEqual(readRunsOn({ on: "claude", tools: ["Gmail"] }, MODELS), { on: "claude" }, "old connector labels are ignored");
assert.match(problem(readRunsOn({ on: "openai_workspace" }, MODELS)), /Pick where it runs/, "only OPERATOR or a Claude routine (decided 2026-11-24)");
assert.match(problem(readRunsOn(null, MODELS)), /Pick where it runs/);

// ---- what saving does
const op = { on: "operator" as const, model: "claude-sonnet-5-5" };
assert.equal(switchKind(op, { on: "operator", model: "claude-sonnet-5-5" }), "same");
assert.equal(switchKind(op, { on: "operator", model: "gpt-6.2-sol" }), "model", "a new model is a draft, not a switch");
assert.equal(switchKind(op, { on: "claude" }), "to_claude");
const cl = { on: "claude" as const, model: "claude-sonnet-5-5" };
assert.equal(switchKind(cl, { on: "operator", model: "claude-sonnet-5-5" }), "to_operator", "back into OPERATOR on the model it had");
assert.equal(switchKind(cl, { on: "claude" }), "same");
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
const ro = read("dashboard/components/runsOn.tsx");
assert.doesNotMatch(ro, /router\.refresh\(/);
// a routine takes only its trigger id and key; what it uses is set in Claude (decided 2026-11-24)
assert.match(ro, /export function RoutineFields/);
assert.match(ro, /Routine trigger id/);
assert.match(ro, /type="password"/, "the key field hides what's typed");
for (const f of ["dashboard/components/runsOn.tsx", "dashboard/components/agentSheet.tsx", "dashboard/components/newAgentSheet.tsx"]) {
  assert.doesNotMatch(read(f), /Uses in Claude|claudeTools|ClaudeToolsField/, `${f} asks for no connector labels`);
  assert.doesNotMatch(read(f), /up to 3 agents/, `${f} says a chain holds 8`);
}
assert.match(read("dashboard/components/newAgentSheet.tsx"), /<RoutineFields /, "the new agent sheet takes the routine's id and key");

console.log("check:runs-on ok");
