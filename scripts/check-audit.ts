// The audit log (docs/usage.md, slice 2): `npm run check:audit`. Pure: reads source, no database.
// Every server action is either audited (adds a row with audit(me, ...) once it has worked) or named
// below as not audited, with why. A new action fails this check until it is put in one list.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { migration } from "./lib/schema";

const AUDITED = [
  // uploaded exports (card 160)
  "exportUpload", "exportRemove",
  // approvals and the gateway
  "approve", "reject", "approveAll", "retryAction", "acceptPromotion", "declinePromotion", "trustToDraft", "cancelAction",
  // the org switch, duty, schedules and real runs (they spend money)
  "turnOrgBackOn", "startFirstJob", "turnOffOrg", "setEnabled", "setAgentTime", "realRun", "runChainNow", "tryBuilt",
  // caps, vendors, suppressions
  "setCap", "addVendor", "suppressEmail",
  // the builder and the flow
  "createBuilt", "saveSpec", "goBack", "setBuiltBudget", "goLive", "saveCrewFlow", "rollBackFlow",
  // Connections
  "mcpDisconnect", "mcpSaveKey", "claudeSaveKey", "claudeRemoveKey", "modelSaveKey", "modelRemoveKey", "vaultReseal", "klaviyoPickList", "ga4PickProperty", "metaSetTarget", "customAdd", "customScopes", "customKey", "customToolOn", "customToolOff", "customNumber", "customPause", "customRemove",
  // people and roles
  "peopleAdd", "peopleSetRole", "peopleRemove",
  // the business's own words, which every agent is told
  "saveBusinessProfile", "saveWhereThingsGo", "saveProductFacts", "saveDailyNumbers", "saveTimeZone",
  // first-run setup: facts every agent is told, and installing departments
  "setupAddFact", "setupEditFact", "setupConfirmFact", "setupRemoveFact", "setupInstall", "setupStartEmpty", "setupShopifyStore", "setupTimeZone", "setupAnswerTool", "setupSnapshot",
  // the setup check (card 281): a model run, and the founder skipping or reopening a finding
  "startSetupCheck", "skipFinding", "reopenFinding", "fixFinding",
  // the org chart: budgets, email caps, who holds a seat, drafts routing
  "orgSetDeptBudget", "orgSetDeptEmails", "placeAgent", "orgSetHolder", "orgSetLeadChecks",
  // proposals change an agent's spec or routine
  "proposalAccept", "proposalDecline",
  // a new department: the owner files it from Avery's draft, or throws the draft away
  "proposeDepartment", "discardDepartmentDraft",
  // OPERATOR's own MCP server: an app (Claude) connected or disconnected
  "allowApp", "disconnectApp",
];

// not audited: they change nothing an agent may do, spend or reach, or keep their own history
const NOT_AUDITED: Record<string, string> = {
  dryRun: "reads only, no model, nothing logged",
  setupCheckState: "reads the check's row while the card polls; changes nothing",
  setupGo: "which step of setup is on screen; changes nothing else",
  setupSkipTool: "which setup question is left for later; connects nothing",
  setupPlanClear: "takes back a setup part's plan; connects nothing",
  setupToDesk: "leaves the setup wrap-up for the Desk; changes nothing else",
  previewChain: "dry runs only",
  dryRunBuilt: "dry run only",
  applyWaiting: "applies approvals already audited",
  queueQuinn: "queues a run that withRun logs",
  react: "feedback on a run, kept as a reaction",
  editMemoryLine: "memory keeps its own timeline with the actor",
  forgetMemoryLine: "memory keeps its own timeline with the actor",
  keepLessonLine: "memory keeps its own timeline with the actor",
  discardLessonLine: "memory keeps its own timeline with the actor",
  addStandard: "memory keeps its own timeline with the actor",
  orgAddDeptRule: "memory keeps its own timeline with the actor",
  orgEditDeptRule: "memory keeps its own timeline with the actor",
  orgForgetDeptRule: "memory keeps its own timeline with the actor",
  orgAddDepartment: "labels on the chart",
  orgRenameDepartment: "labels on the chart",
  orgRemoveDepartment: "labels on the chart",
  orgAddSeat: "labels on the chart",
  orgEditSeat: "labels on the chart",
  orgRemoveSeat: "labels on the chart",
  customCheck: "reads the server's tool list; a change pauses it on its own",
  connectorAsk: "a request for a connector, no access",
  connectorClose: "closes a request, no access",
  goalCreate: "goals keep their own rows",
  goalEdit: "goals keep their own rows",
  goalSetState: "goals keep their own rows",
  planJobDone: "a to-do ticked",
  proposalCreate: "only a suggestion; accepting it is audited",
  sendToAvery: "a chat message, kept in the chat",
  sendToHead: "a chat message to a department head, kept in the department chat",
  sendSetup: "a setup message, kept in the chat; withRun logs the run",
  setupOtherTool: "a request for a connector and a note of the tool the business uses, no access",
};

const files = ["dashboard/actions.ts", "dashboard/orgActions.ts", "dashboard/connectionActions.ts", "dashboard/goalActions.ts", "dashboard/proposalActions.ts", "dashboard/chatActions.ts", "dashboard/peopleActions.ts", "dashboard/setupActions.ts", "dashboard/setupCheckActions.ts", "dashboard/mcpActions.ts"];
const seen = new Set<string>();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  const parts = src.split(/\nexport async function /).slice(1);
  for (const p of parts) {
    const name = p.match(/^(\w+)/)![1];
    const body = p.split(/\n(?:export |\/\*\*|\/\/ ----)/)[0];
    seen.add(name);
    if (AUDITED.includes(name)) {
      assert.match(body, /await audit\(me, (?:"[a-z][a-z0-9_]{1,40}"|\w+ \? "[a-z][a-z0-9_]{1,40}" : "[a-z][a-z0-9_]{1,40}")/, `${f}: ${name} adds an audit row`);
      assert.match(body, /const \{ me, no \} = await asRole\(/, `${f}: ${name} audits as the signed-in member`);
      if (!/^import \{ audit \} from "@\/core\/audit";$/m.test(src)) assert.fail(`${f} imports audit`);
    } else {
      assert.ok(name in NOT_AUDITED, `${f}: ${name} is a new action: add it to AUDITED or NOT_AUDITED in scripts/check-audit.ts`);
    }
  }
}
for (const n of [...AUDITED, ...Object.keys(NOT_AUDITED)]) assert.ok(seen.has(n), `${n} is listed but isn't an action`);

// the table is append-only and every org reads only its own rows
const sql = migration("20261208090000_audit_log.sql"); // check:baseline checks the same in the public repo
if (sql) {
  assert.match(sql, /revoke update, delete, truncate on audit_log from authenticated, anon, service_role/);
  assert.match(sql, /create policy org_rows on audit_log/);
}
console.log(`check:audit ok (${AUDITED.length} actions audited, ${Object.keys(NOT_AUDITED).length} not)`);
