// check:on-duty (card 188, docs/org-schedule.md): no path puts an agent on duty without an approved
// playbook. The rule is tested here, and every write that turns agents.enabled on is one of the two
// reviewed paths: setEnabled (which checks the rule) and the first job (which approves first).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { linkedOnDutyProblem, onDutyProblem } from "../core/on-duty-rules";

assert.equal(onDutyProblem("Morgan", [{ status: "approved" }]), null);
assert.equal(onDutyProblem("Morgan", [{ status: "proposed" }, { status: "approved" }]), null);
assert.match(onDutyProblem("Morgan", [])!, /no approved playbook/);
assert.match(onDutyProblem("Morgan", [{ status: "proposed" }, { status: "retired" }])!, /no approved playbook/);
assert.match(onDutyProblem("Morgan", null)!, /can't be read/, "unreadable playbooks keep it off duty");

// every place code turns an agent on duty
const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
const hits: string[] = [];
for (const f of ["app", "dashboard", "core", "ee", "agents", "integrations"].flatMap(walk)) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/update\(\{\s*enabled:\s*(true|on)\b/g)) {
    const fn = [...src.slice(0, m.index).matchAll(/export async function (\w+)/g)].pop()?.[1] ?? "?";
    hits.push(`${f}:${fn}`);
  }
}
assert.deepEqual(hits.sort(), ["dashboard/actions.ts:setEnabled", "dashboard/actions.ts:startFirstJob"].sort(), "a new path turns agents on duty: it must check onDutyProblem");
const actions = readFileSync("dashboard/actions.ts", "utf8");
const setEnabled = actions.slice(actions.indexOf("export async function setEnabled"), actions.indexOf("\n}\n", actions.indexOf("export async function setEnabled")));
assert.match(setEnabled, /onDutyProblem\(/, "setEnabled checks the playbook before putting an agent on duty");
const first = actions.slice(actions.indexOf("export async function startFirstJob"), actions.indexOf("\n}\n", actions.indexOf("export async function startFirstJob")));
assert.ok(first.indexOf("approvePlaybook(") > 0 && first.indexOf("approvePlaybook(") < first.indexOf("enabled: true"), "the first job approves the playbook before the agent goes on duty");
assert.doesNotMatch(actions, /export async function turnOnOrg/, "the bulk turn-on is gone");
// live events slice 2: an agent that runs in Claude goes on duty only with its routine connected and not paused
assert.equal(linkedOnDutyProblem("Drew", { connected: true, paused: null }), null);
assert.match(linkedOnDutyProblem("Drew", { connected: false, paused: null })!, /paste its routine id and token/);
assert.match(linkedOnDutyProblem("Drew", { connected: true, paused: "refused" })!, /paused/);
assert.match(linkedOnDutyProblem("Drew", null)!, /can't be read/);
assert.match(setEnabled, /linkedOnDutyProblem\(who\.name, await routineState\(agentId\)\.catch\(\(\) => null\)\)/, "setEnabled checks the routine of an agent that runs in Claude");
console.log("check:on-duty ok");
