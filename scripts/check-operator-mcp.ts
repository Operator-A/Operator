// OPERATOR's own MCP server (docs/operator-mcp.md): `npm run check:operator-mcp`. Pure: no network, no
// database. Tests the tool list, the JSON-RPC answers, the sign-in rules (registration, PKCE, tokens) and
// reads the source for the rules that keep the server to reads and to one business.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONSENT_NEVER, LIMITS, MCP_PATH, OP_TOOLS, PROTOCOL_VERSIONS, answerText, authServerMetadata, bearerOf, challenge, checkArgs, clientIdOf, clientOf, dispatch,
  hashSecret, hashesMatch, isResponse, newToken, nextWindow, originOf, pickProtocol, pkceOk, readAuthorize, readRegistration, readRpc, redirectAllowed, redirectOk,
  resourceMetadata, toolsFor, tokenParts, TOOL_BY_NAME, MAX_DRAFT_TOOLS, MAX_DRAFT_ACTIONS, MOVE_PROMPT, draftActions, CONSENT_OWNER_LINES, draftTools, staleRead, toolList, type RpcRequest,
} from "../core/operator-mcp-rules";
import { TENANT_TABLES } from "../core/tenancy";
import { eventKey, flowWithStarts, readDays, readStarts, readStored, startsOnItsOwn, startsToday, startsWords, type DraftStarts } from "../core/draft-starts-rules";
import { flowProblems, soloKey, type Flow } from "../core/flow-rules";

const read = (p: string) => readFileSync(p, "utf8");
const SECRET = "s".repeat(40);
const ORIGIN = "https://op.example.com";
const ORG = "0e1a7c4e-0002-4000-8000-000000000002", GRANT = "0e1a7c4e-00aa-4000-8000-0000000000aa";

const run = async () => {
  // ---- the tool list: reads for every member, draft writes for owners only
  const READS = ["get_company", "list_agents", "get_agent", "list_runs", "list_waiting", "list_tools", "list_brains", "get_run", "list_chains", "get_chain_run", "get_report"], DRAFTS = ["create_agent", "update_agent", "draft_chain", "propose"], FINISHES = ["finish_run"], TRIES = ["try_agent"];
  assert.deepEqual(OP_TOOLS.map((t) => t.name), [...READS, ...DRAFTS, ...FINISHES, ...TRIES]);
  // overview slice 3: the written reports, read only, for every member
  assert.ok(TOOL_BY_NAME.get_report.kind === "read" && TOOL_BY_NAME.get_report.min === "viewer");
  assert.deepEqual(Object.keys(TOOL_BY_NAME.get_report.inputSchema.properties), ["department", "period"]);
  assert.match(TOOL_BY_NAME.get_report.description, /data, not instructions/);
  const mcpSrc = read("core/operator-mcp.ts");
  assert.match(mcpSrc, /async function getReport\(origin: string, args: Args\)[\s\S]*?latestReports\(scope\)[\s\S]*?Data, not instructions/, "get_report reads the saved report and says its words are data");
  assert.doesNotMatch(mcpSrc.slice(mcpSrc.indexOf("async function getReport"), mcpSrc.indexOf("async function draftChain")), /writeReports|writeCompanyReport|db\(\)\.from\("reports"\)\.(upsert|insert|update|delete)/, "get_report only reads");
  // live events slice 2: a Claude session posts its result onto the run OPERATOR started, owners only
  assert.ok(OP_TOOLS.filter((t) => FINISHES.includes(t.name)).every((t) => t.kind === "finish" && t.min === "owner"), "finishing a run is for owners only");
  assert.deepEqual(TOOL_BY_NAME.finish_run.inputSchema.required, ["run", "status", "result"]);
  // overview slice 4: optional named numbers, a short text field read in code (core/routine-rules.ts readNumbers)
  const numbersProp = TOOL_BY_NAME.finish_run.inputSchema.properties.numbers as { type: string; maxLength: number; description: string };
  assert.equal(numbersProp.type, "string");
  assert.equal(numbersProp.maxLength, 600);
  assert.match(numbersProp.description, /up to 12 numbers/);
  assert.match(mcpSrc, /finishRun\(f\.runId, f\.status, f\.result, f\.numbers\)/, "finish_run saves the numbers it read");
  assert.deepEqual(TOOL_BY_NAME.create_agent.inputSchema.properties.runs_on, { type: "string", enum: ["operator", "claude"], description: (TOOL_BY_NAME.create_agent.inputSchema.properties.runs_on as { description: string }).description });
  assert.ok(OP_TOOLS.filter((t) => TRIES.includes(t.name)).every((t) => t.kind === "try" && t.min === "owner"), "a try is for owners only");
  assert.deepEqual(TOOL_BY_NAME.try_agent.inputSchema.required, ["agent", "based_on_version"], "a try names the version it was read at");
  assert.match(TOOL_BY_NAME.try_agent.description, /sends nothing/);
  assert.ok(OP_TOOLS.filter((t) => READS.includes(t.name)).every((t) => t.kind === "read" && t.min === "viewer"), "read tools, any member");
  assert.ok(OP_TOOLS.filter((t) => DRAFTS.includes(t.name)).every((t) => t.kind === "draft" && t.min === "owner"), "draft tools, owners only");
  assert.deepEqual(toolsFor("viewer").map((t) => t.name), READS);
  assert.deepEqual(toolsFor("approver").map((t) => t.name), READS, "an approver drafts in OPERATOR, not from an app");
  assert.equal(toolsFor("owner").length, OP_TOOLS.length);
  for (const t of OP_TOOLS) assert.equal(t.inputSchema.additionalProperties, false, `${t.name} takes only the arguments it names`);
  const banned = /approve|reject|go_live|golive|enable|grant|cap|budget|delete|remove|connect|schedule|turn_on|run_now|send/;
  assert.ok(OP_TOOLS.every((t) => !banned.test(t.name)), "no tool approves, puts on duty, grants, changes caps or deletes");

  // ---- arguments: known keys only, capped
  const agent = TOOL_BY_NAME.get_agent, runs = TOOL_BY_NAME.list_runs;
  assert.deepEqual(checkArgs(agent, { agent: "  Morgan  " }), { args: { agent: "Morgan" } });
  assert.match((checkArgs(agent, {}) as { problem: string }).problem, /needs agent/);
  assert.match((checkArgs(agent, { agent: "x", sql: "drop" }) as { problem: string }).problem, /no argument "sql"/);
  assert.match((checkArgs(agent, { agent: "x".repeat(81) }) as { problem: string }).problem, /longer than 80/);
  assert.match((checkArgs(agent, { agent: 5 }) as { problem: string }).problem, /must be text/);
  assert.match((checkArgs(runs, { limit: 50 }) as { problem: string }).problem, /from 1 to 20/);
  assert.deepEqual(checkArgs(runs, { limit: 3 }), { args: { limit: 3 } });
  assert.match((checkArgs(runs, ["x"]) as { problem: string }).problem, /must be an object/);
  const create = TOOL_BY_NAME.create_agent, update = TOOL_BY_NAME.update_agent, prop = TOOL_BY_NAME.propose;
  assert.match((checkArgs(create, { name: "Pat", job: "j", directive: "d", good_result: "g", tools: "x", effort: "max" }) as { problem: string }).problem, /effort must be one of low, medium, high/);
  assert.match((checkArgs(create, { name: "Pat", job: "j", directive: "d", good_result: "g", tools: "x", enabled: true }) as { problem: string }).problem, /no argument "enabled"/, "create_agent can't put an agent on duty");
  for (const k of ["enabled", "on_duty", "daily_budget_usd", "schedule", "limits", "maxCostUsd", "actions", "readsFrom", "reportPage"]) assert.ok(!(k in create.inputSchema.properties) && !(k in update.inputSchema.properties), `drafts never take ${k}`);
  const dir = checkArgs(create, { name: "Pat", job: "j", directive: "1. read\n2. sum", good_result: "g", tools: "a, b" }) as { args: Record<string, string> };
  assert.equal(dir.args.directive, "1. read\n2. sum", "a directive keeps its line breaks");
  assert.match((checkArgs(update, { agent: "pat" }) as { problem: string }).problem, /needs based_on_version/, "a change names the version it was based on");
  assert.match((checkArgs(prop, { kind: "promote", why: "because it is good" }) as { problem: string }).problem, /kind must be one of/);

  // ---- the move guide: every step is a tool on this server, and it stops before duty and actions
  for (const t of ["get_company", "list_tools", "list_brains", "create_agent", "try_agent", "get_run"]) assert.ok(MOVE_PROMPT.includes(t), `the move guide uses ${t}`);
  assert.match(MOVE_PROMPT, /wait for my OK/);
  assert.match(MOVE_PROMPT, /Stop there\. I put it on duty, give it actions and set its schedule in OPERATOR\./);
  assert.ok(CONSENT_OWNER_LINES.some((l) => /Try an agent once: it sends nothing/.test(l)), "the consent page says what a try is");

  // ---- what a draft from Claude may put on an agent: reads and calculations; everything else carries over
  const kinds: Record<string, string> = { r1: "read", r2: "read", c1: "calculate", rep: "report", act: "action", "srv__t": "custom" };
  const k = (id: string) => kinds[id];
  assert.deepEqual(toolList(" r1, r2  r1,"), ["r1", "r2"]);
  assert.deepEqual(draftTools(["r1", "c1"], [], k), { tools: ["r1", "c1"] });
  assert.match((draftTools(["act"], [], k) as { problem: string }).problem, /only an approver grants actions/);
  assert.match((draftTools(["rep"], [], k) as { problem: string }).problem, /report tool/);
  assert.match((draftTools(["srv__t"], [], k) as { problem: string }).problem, /owner added/);
  assert.match((draftTools(["nope"], [], k) as { problem: string }).problem, /isn't on the tool list/);
  assert.match((draftTools(Array.from({ length: MAX_DRAFT_TOOLS + 1 }, (_, i) => `r${i}`), [], k) as { problem: string }).problem, /at most 8/);
  assert.deepEqual(draftTools(["r2"], ["r1", "act", "rep", "srv__t"], k), { tools: ["r2", "act", "rep", "srv__t"] }, "dropping a read is fine; actions, reports and added-server tools stay as they were");
  assert.deepEqual(draftTools([], ["r1", "act"], k), { tools: ["act"] });
  assert.deepEqual(draftTools(null, ["r1", "act"], k), { tools: ["r1", "act"] }, "no tools argument leaves them as they are");
  // ---- actions in a draft (decided 2026-11-23): only granted, connected actions; they wait for Go live
  const acts: Record<string, { kind: string; label: string; granted: boolean; connected: boolean }> = {
    tag: { kind: "action", label: "Tag an order", granted: true, connected: true },
    off: { kind: "action", label: "Hold on the calendar", granted: true, connected: false },
    fixed: { kind: "action", label: "Pay a vendor", granted: false, connected: true },
    r1: { kind: "read", label: "Read orders", granted: false, connected: true },
  };
  const ai = (id: string) => acts[id];
  assert.deepEqual(draftActions(["r1"], ["tag"], [], ai), { tools: ["r1", "tag"], added: ["tag"], dropped: [] });
  assert.deepEqual(draftActions(["r1", "tag"], ["tag"], [], ai), { tools: ["r1", "tag"], added: [], dropped: [] }, "an action it has already isn't added again");
  assert.deepEqual(draftActions(["r1", "tag", "fixed"], [], ["tag"], ai), { tools: ["r1", "fixed"], added: [], dropped: ["tag"] }, "taking an action away keeps the rest");
  assert.match((draftActions([], ["off"], [], ai) as { problem: string }).problem, /isn't connected/);
  assert.match((draftActions([], ["fixed"], [], ai) as { problem: string }).problem, /code names the agents/);
  assert.match((draftActions([], ["r1"], [], ai) as { problem: string }).problem, /isn't an action/);
  assert.match((draftActions([], ["nope"], [], ai) as { problem: string }).problem, /isn't on the tool list/);
  assert.match((draftActions(["tag"], ["tag"], ["tag"], ai) as { problem: string }).problem, /both add_actions and drop_actions/);
  assert.match((draftActions(["r1"], [], ["r1"], ai) as { problem: string }).problem, /isn't one of its actions/);
  const many = Object.fromEntries(Array.from({ length: MAX_DRAFT_ACTIONS + 1 }, (_, i) => [`a${i}`, { kind: "action", label: `A${i}`, granted: true, connected: true }]));
  assert.match((draftActions(Object.keys(many).slice(0, MAX_DRAFT_ACTIONS), [`a${MAX_DRAFT_ACTIONS}`], [], (id) => many[id]) as { problem: string }).problem, /at most 8 actions/);
  for (const k of ["add_actions", "drop_actions"]) assert.ok(k in update.inputSchema.properties && !(k in create.inputSchema.properties), `only update_agent takes ${k}; a new agent has no actions`);
  assert.match(update.description, /Go live lists every action the draft adds/);
  assert.match(CONSENT_NEVER, /put a draft live/);
  const upd = read("core/operator-mcp.ts");
  assert.match(upd, /specLooser\(base\.spec, \{ \.\.\.got\.spec, tools: got\.spec\.tools\.filter\(\(x\) => !a\.added\.includes\(x\)\) \}\)/, "only the actions Claude named are let past specLooser; reports, custom tools and higher limits still refuse the draft");
  assert.match(upd, /saveSpecVersion\(id, got\.spec,/, "an action lands in a draft version, never the live one");
  assert.ok(!/activateSpecVersion|goLive|setAgentTime|setEnabled/.test(upd), "the server never makes a draft live, sets a schedule or puts an agent on duty");
  assert.match(read("dashboard/actions.ts"), /const looser = target\.active \? \[\] : specLooser\(now\?\.spec \?\? null, target\.spec\);\n    const asks = \[\.\.\.looser,/, "Go live asks to confirm each action a draft adds");
  assert.match(read("CLAUDE.md"), /They change nothing\n  until the owner's Go live, after a clean try, on a confirm that lists each one\./, "the hard rule says drafted actions wait for Go live");

  // ---- when an agent starts, in a draft (slice 4 part 2): applied to today's flow only at Go live
  assert.equal(readDays("weekdays"), "weekdays");
  assert.equal(readDays("mon, wed, fri"), "on:135");
  assert.equal(readDays("Monday"), "mondays");
  assert.equal(readDays("sun sat"), "on:06");
  assert.equal(readDays("someday"), null);
  const agentOf = (r: string) => ({ quinn: "quinn", morgan: "morgan", avery: "avery" } as Record<string, string>)[r.toLowerCase()] ?? null;
  const rs = (a: Record<string, string | number>) => readStarts(a, "quinn", agentOf);
  assert.deepEqual(rs({}), { starts: null }, "no start arguments, no starts");
  assert.deepEqual(rs({ days: "weekdays", time: "08:00" }), { starts: { when: { days: "weekdays", time: "08:00" } } });
  assert.deepEqual(rs({ by_hand: "yes" }), { starts: { when: "by_hand" } });
  assert.match((rs({ days: "weekdays", time: "08:10" }) as { problem: string }).problem, /quarter hour/);
  assert.match((rs({ days: "weekdays" }) as { problem: string }).problem, /time must be/);
  assert.match((rs({ by_hand: "yes", days: "daily", time: "09:00" }) as { problem: string }).problem, /pick one/);
  assert.deepEqual(rs({ start_on_event: "shopify.order_created", min_total: 50 }), { starts: { event: { type: "event", event: "shopify.order_created", minTotal: 50 } } });
  assert.match((rs({ start_on_event: "gmail.new" }) as { problem: string }).problem, /start_on_event must be one of/);
  assert.match((rs({ min_total: 5 }) as { problem: string }).problem, /goes with start_on_event/);
  assert.match((rs({ by_hand: "yes", start_on_event: "stripe.invoice_paid" }) as { problem: string }).problem, /only by hand/);
  assert.deepEqual(rs({ run_after: "Morgan", after_result: "any" }), { starts: { after: { agent: "morgan", when: "any" } } });
  assert.match((rs({ run_after: "quinn" }) as { problem: string }).problem, /after itself/);
  assert.match((rs({ run_after: "nobody" }) as { problem: string }).problem, /exactly one agent/);
  assert.deepEqual(rs({ run_after: "none" }), { starts: { after: "none" } });
  const crew = { ids: ["avery", "morgan", "quinn", "rowan"], manualOnly: new Set<string>() };
  const today: Flow = { chains: [
    { key: "solo-morgan", name: "Morgan", on: true, start: { type: "schedule", days: "weekdays", time: "07:00" }, steps: [{ agent: "morgan" }] },
    { key: "morning", name: "Morning", on: true, start: { type: "schedule", days: "daily", time: "06:00" }, steps: [{ agent: "rowan" }, { agent: "avery" }] },
  ] };
  const frozen = JSON.stringify(today);
  const apply = (st: DraftStarts, manual = true) => flowWithStarts(today, manual, "quinn", "Quinn", st);
  const sched = apply({ when: { days: "weekdays", time: "08:00" } }) as { flow: Flow; manual: boolean };
  assert.equal(sched.manual, false);
  assert.deepEqual(sched.flow.chains.find((c) => c.key === soloKey("quinn"))?.start, { type: "schedule", days: "weekdays", time: "08:00" }, "a schedule makes its own chain");
  assert.deepEqual(flowProblems(sched.flow, crew), []);
  assert.equal(JSON.stringify(today), frozen, "working out a draft's starts never changes today's flow");
  const ev = apply({ event: { type: "event", event: "shopify.order_created", minTotal: 50 } }) as { flow: Flow; manual: boolean };
  assert.equal(ev.manual, false, "starting on an event means it no longer runs only by hand");
  assert.deepEqual(ev.flow.chains.find((c) => c.key === eventKey("quinn"))?.start, { type: "event", event: "shopify.order_created", minTotal: 50 });
  assert.deepEqual(flowProblems(ev.flow, crew), []);
  const evOff = flowWithStarts(ev.flow, false, "quinn", "Quinn", { event: "none" }) as { flow: Flow };
  assert.ok(!evOff.flow.chains.some((c) => c.key === eventKey("quinn")), "none drops its event chain");
  const aft = apply({ after: { agent: "morgan", when: "ok" } }) as { flow: Flow; manual: boolean };
  assert.deepEqual(aft.flow.chains.find((c) => c.key === "solo-morgan")?.steps, [{ agent: "morgan" }, { agent: "quinn", when: "ok" }], "run after: the next step of that agent's own chain");
  assert.deepEqual(flowProblems(aft.flow, crew), []);
  const out = flowWithStarts(aft.flow, false, "quinn", "Quinn", { after: "none" }) as { flow: Flow };
  assert.deepEqual(out.flow.chains.find((c) => c.key === "solo-morgan")?.steps, [{ agent: "morgan" }]);
  assert.deepEqual((apply({ after: { agent: "avery", when: "ok" } }) as { flow: Flow }).flow.chains.find((c) => c.key === "morning")?.steps.map((x) => x.agent), ["rowan", "avery", "quinn"], "a shared chain that ends with that agent and has room takes it");
  const full: Flow = { chains: [{ key: "big", name: "Big", on: true, start: { type: "schedule", days: "daily", time: "06:00" }, steps: ["rowan", "avery", "x1", "x2", "x3", "x4", "x5", "morgan"].map((agent) => ({ agent })) }] };
  assert.match((flowWithStarts(full, true, "quinn", "Quinn", { after: { agent: "morgan", when: "ok" } }) as { refuse: string }).refuse, /already has 8 agents/);
  assert.match((apply({ after: { agent: "quinn", when: "ok" } }) as { refuse: string }).refuse, /nothing to follow/);
  const hand = flowWithStarts(sched.flow, false, "quinn", "Quinn", { when: "by_hand" }) as { flow: Flow; manual: boolean };
  assert.equal(hand.manual, true);
  assert.ok(!hand.flow.chains.some((c) => c.steps.some((x) => x.agent === "quinn") && c.start.type !== "button"), "by hand: out of every chain that starts on its own");
  assert.deepEqual(startsWords({ when: { days: "weekdays", time: "08:00" }, event: { type: "event", event: "shopify.order_created", minTotal: 50 }, after: { agent: "morgan", when: "any" } }, { morgan: "Morgan" }),
    ["Runs on weekdays at 08:00", "Also starts on each Shopify: new order of 50 or more", "Runs after Morgan finishes, however it went"]);
  assert.deepEqual(startsToday(aft.flow, "quinn", false, { morgan: "Morgan" }), ["After Morgan in Morgan"]);
  assert.deepEqual(startsToday(today, "quinn", true, {}), ["When someone presses Run now"]);
  assert.deepEqual(readStored({ when: { days: "weekdays", time: "08:00" }, after: { agent: "Bad Id!", when: "ok" } }), { when: { days: "weekdays", time: "08:00" } }, "a malformed part of a stored starts is dropped");
  assert.equal(readStored(null), null);
  // card 450: which waiting starts take an agent off "only by hand" at Go live (draft_chain counts them as scheduled)
  assert.equal(startsOnItsOwn({ when: { days: "mondays", time: "07:45" } }), true, "its own schedule");
  assert.equal(startsOnItsOwn({ event: { type: "event", event: "shopify.order_created" } }), true, "a live event");
  assert.equal(startsOnItsOwn({ after: { agent: "cfo", when: "ok" } }), true, "after another agent");
  assert.equal(startsOnItsOwn({ when: "by_hand" }), false);
  assert.equal(startsOnItsOwn({ event: "none", after: "none" }), false, "dropping starts never schedules");
  assert.equal(startsOnItsOwn(null), false, "a draft saved in OPERATOR carries no starts");
  for (const k of ["days", "time", "by_hand", "start_on_event", "min_total", "run_after", "after_result"]) assert.ok(k in update.inputSchema.properties && !(k in create.inputSchema.properties), `only update_agent takes ${k}`);
  const srv = read("core/operator-mcp.ts");
  assert.ok(!/saveFlowVersion|activateFlow|manual_only/.test(srv), "the server never changes the flow or by-hand: starts wait on the draft");
  assert.match(srv, /saveSpecVersion\(id, got\.spec, .*, byOf\(caller\), starts\)/, "starts are saved on the draft version");
  const golive = read("dashboard/actions.ts");
  assert.match(golive, /const starts = target\.active \? null : readStored\(await versionStarts\(agentId, version\)\);/, "Go live reads the version's starts");
  assert.match(golive, /const asks = \[\.\.\.looser, \.\.\.\(plan\?\.lines \?\? \[\]\)\];\n    if \(asks\.length && !confirmed\) return \{ ok: false, text: `Confirm first/, "Go live's confirm lists each start change");
  assert.match(golive, /if \(problems\.length\) return \{ ok: false, text: `Go live is locked: /, "a flow that doesn't check out locks Go live");
  const mig = read("supabase/migrations/20270107090000_draft_starts.sql");
  assert.match(mig, /alter table agent_defs add column starts jsonb/);

  assert.equal(staleRead(3, 3), null);
  assert.match(staleRead(2, 3)!, /changed since you read it \(you read v2, the newest is v3\)/);

  // ---- answers are scrubbed and cut
  const leaked = answerText({ note: "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 here" }, `${ORIGIN}/crew`);
  assert.ok(!leaked.includes("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"), "a secret-looking value never reaches Claude");
  assert.match(leaked, /Open in OPERATOR: https:\/\/op\.example\.com\/crew$/);
  assert.match(answerText("x".repeat(LIMITS.answerChars + 50), null), /cut at 24000 characters/);

  // ---- JSON-RPC
  assert.equal(pickProtocol("2025-06-18"), "2025-06-18");
  assert.equal(pickProtocol("1999-01-01"), PROTOCOL_VERSIONS[0]);
  assert.ok(isResponse(readRpc([{ jsonrpc: "2.0", id: 1, method: "ping" }])), "batches are refused");
  assert.ok(isResponse(readRpc({ id: 1, method: "ping" })), "jsonrpc 2.0 only");
  const req = (method: string, params?: Record<string, unknown>, id: number | "none" = 1) => readRpc(id === "none" ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id, method, params }) as RpcRequest;
  const calls: string[] = [];
  const call = async (t: { name: string }, a: Record<string, string | number>) => { calls.push(`${t.name}:${JSON.stringify(a)}`); if (t.name === "list_tools") throw new Error("boom token=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"); return { text: "ok" }; };
  const init = await dispatch(req("initialize", { protocolVersion: "2025-06-18" }), "viewer", call);
  assert.equal((init!.result as { protocolVersion: string }).protocolVersion, "2025-06-18");
  assert.match(JSON.stringify(init!.result), /source of truth/);
  assert.equal(await dispatch(req("notifications/initialized", {}, "none"), "viewer", call), null, "a notification gets no answer");
  const list = await dispatch(req("tools/list"), "viewer", call);
  assert.equal((list!.result as { tools: unknown[] }).tools.length, READS.length);
  assert.ok((list!.result as { tools: { annotations: { readOnlyHint: boolean } }[] }).tools.every((t) => t.annotations.readOnlyHint), "a viewer is offered reads only");
  const ownerList = (await dispatch(req("tools/list"), "owner", call))!.result as { tools: { name: string; annotations: { readOnlyHint: boolean; destructiveHint: boolean } }[] };
  assert.ok(ownerList.tools.filter((t) => DRAFTS.includes(t.name)).every((t) => !t.annotations.readOnlyHint && !t.annotations.destructiveHint));
  const refused = await dispatch(req("tools/call", { name: "create_agent", arguments: { name: "Pat", job: "j", directive: "d", good_result: "g", tools: "r1" } }), "approver", call);
  assert.match(JSON.stringify(refused), /needs the owner role/);
  assert.equal(calls.length, 0, "a draft tool never runs for a role below owner");
  const got = await dispatch(req("tools/call", { name: "get_agent", arguments: { agent: "cfo" } }), "viewer", call);
  assert.deepEqual(got!.result, { isError: false, content: [{ type: "text", text: "ok" }] });
  assert.deepEqual(calls, ['get_agent:{"agent":"cfo"}']);
  const bad = await dispatch(req("tools/call", { name: "get_agent", arguments: {} }), "viewer", call);
  assert.equal((bad!.result as { isError: boolean }).isError, true);
  assert.equal(calls.length, 1, "a call with bad arguments never reaches the tool");
  assert.equal((await dispatch(req("tools/call", { name: "approve_card" }), "owner", call))!.error!.code, -32602, "a tool not on the list does nothing");
  const boom = await dispatch(req("tools/call", { name: "list_tools" }), "viewer", call);
  assert.ok(!JSON.stringify(boom).includes("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"), "errors are scrubbed");
  assert.equal((await dispatch(req("resources/list"), "owner", call))!.error!.code, -32601);

  // ---- sign-in metadata
  assert.equal(resourceMetadata(ORIGIN).resource, `${ORIGIN}${MCP_PATH}`);
  assert.deepEqual(resourceMetadata(ORIGIN).authorization_servers, [ORIGIN]);
  const as = authServerMetadata(ORIGIN);
  assert.equal(as.issuer, ORIGIN);
  assert.deepEqual(as.code_challenge_methods_supported, ["S256"], "PKCE S256 only");
  assert.deepEqual(as.token_endpoint_auth_methods_supported, ["none"]);
  assert.equal(as.authorization_endpoint, `${ORIGIN}/oauth/authorize`);
  assert.match(challenge(ORIGIN), /resource_metadata="https:\/\/op\.example\.com\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
  assert.match(challenge(ORIGIN, "invalid_token"), /error="invalid_token"/);

  // ---- registration: nothing stored, the client id is signed
  assert.equal(redirectOk("https://claude.ai/api/mcp/auth_callback"), "https://claude.ai/api/mcp/auth_callback");
  assert.equal(redirectOk("http://localhost:6274/cb"), "http://localhost:6274/cb");
  for (const b of ["http://evil.example/cb", "https://x.example/cb#frag", "https://u:p@x.example/cb", "javascript:alert(1)", "", "https://x.example/" + "a".repeat(500)]) assert.equal(redirectOk(b), null, b.slice(0, 40));
  const reg = readRegistration({ client_name: "Claude", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" });
  assert.ok("client" in reg);
  assert.match((readRegistration({ redirect_uris: [] }) as { problem: string }).problem, /at least one/);
  assert.match((readRegistration({ redirect_uris: ["http://evil.example/cb"] }) as { problem: string }).problem, /https/);
  assert.match((readRegistration({ redirect_uris: ["https://a.example/cb"], token_endpoint_auth_method: "client_secret_basic" }) as { problem: string }).problem, /none/);
  assert.match((readRegistration({ redirect_uris: ["https://a.example/cb"], grant_types: ["client_credentials"] }) as { problem: string }).problem, /grant_types/);
  assert.match((readRegistration({ redirect_uris: Array.from({ length: 6 }, (_, i) => `https://a.example/${i}`) }) as { problem: string }).problem, /at most 5/);
  assert.equal((readRegistration({ client_name: "<b>x</b>", redirect_uris: ["https://a.example/cb"] }) as { client: { name: string } }).client.name, "bx/b", "names lose angle brackets");
  const client = (reg as { client: { name: string; redirectUris: string[] } }).client;
  const id = clientIdOf(client, SECRET);
  assert.deepEqual(clientOf(id, SECRET), client);
  assert.equal(clientOf(id, "t".repeat(40)), null, "another deployment's secret fails");
  assert.equal(clientOf(id, "short"), null);
  const [v, payload, mac] = id.split(".");
  const forged = Buffer.from(JSON.stringify({ n: "Claude", r: ["https://evil.example/cb"] })).toString("base64url");
  assert.equal(clientOf(`${v}.${forged}.${mac}`, SECRET), null, "a changed redirect fails the signature");
  assert.ok(payload && redirectAllowed(client, "https://claude.ai/api/mcp/auth_callback") && !redirectAllowed(client, "https://claude.ai/other"));

  // ---- the authorize request
  const challengeOf = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"; // RFC 7636 appendix B
  const q = { client_id: id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", response_type: "code", code_challenge: challengeOf, code_challenge_method: "S256", state: "xyz", resource: `${ORIGIN}/api/mcp` };
  const ok = readAuthorize(q, SECRET, ORIGIN);
  assert.ok("ask" in ok && ok.ask.state === "xyz" && ok.ask.client.name === "Claude");
  const noClient = readAuthorize({ ...q, client_id: "nope" }, SECRET, ORIGIN) as { problem: string; redirect?: string };
  assert.ok(noClient.problem && !noClient.redirect, "an unknown app is never redirected to");
  const elsewhere = readAuthorize({ ...q, redirect_uri: "https://evil.example/cb" }, SECRET, ORIGIN) as { problem: string; redirect?: string };
  assert.ok(elsewhere.problem && !elsewhere.redirect, "an address the app didn't register is never redirected to");
  const plain = readAuthorize({ ...q, code_challenge_method: "plain" }, SECRET, ORIGIN) as { redirect: string };
  assert.match(plain.redirect, /error=invalid_request&state=xyz/);
  assert.match((readAuthorize({ ...q, response_type: "token" }, SECRET, ORIGIN) as { redirect: string }).redirect, /unsupported_response_type/);
  assert.match((readAuthorize({ ...q, resource: "https://other.example/mcp" }, SECRET, ORIGIN) as { redirect: string }).redirect, /invalid_target/);
  assert.ok("ask" in readAuthorize({ ...q, resource: undefined }, SECRET, ORIGIN), "resource is optional");

  // ---- PKCE
  assert.ok(pkceOk("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", challengeOf));
  assert.ok(!pkceOk("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXX", challengeOf));
  assert.ok(!pkceOk("short", challengeOf) && !pkceOk(undefined, challengeOf));

  // ---- tokens: name the org and grant, only the hash is kept
  const a = newToken("a", ORG, GRANT);
  const p = tokenParts(a.token, "a")!;
  assert.deepEqual([p.orgId, p.grantId], [ORG, GRANT]);
  assert.ok(hashesMatch(a.hash, p.hash) && a.hash.length === 64 && !a.token.includes(a.hash));
  assert.equal(tokenParts(a.token, "r"), null, "an access token isn't a refresh token");
  assert.equal(tokenParts(a.token.replace(ORG, "0e1a7c4e-0001-4000-8000-000000000001"), "a")!.hash, p.hash, "the org in a token only says where to look");
  assert.ok(!hashesMatch(newToken("a", ORG, GRANT).hash, p.hash), "every token is new");
  assert.equal(tokenParts(`${a.token}x`, "a"), null);
  assert.ok(!hashesMatch(null, p.hash) && hashSecret("a") !== hashSecret("b"));
  assert.throws(() => newToken("a", "home", GRANT), /org and a grant/);
  assert.equal(bearerOf(`Bearer ${a.token}`), a.token);
  assert.equal(bearerOf("Basic abc"), null);

  // ---- 60 calls a minute
  const t0 = Date.parse("2026-11-23T12:00:00Z");
  let w = nextWindow(null, 0, t0);
  for (let i = 1; i < LIMITS.callsPerMinute; i++) w = nextWindow(w.start, w.calls, t0 + i * 100);
  assert.ok(w.ok && w.calls === 60);
  assert.equal(nextWindow(w.start, w.calls, t0 + 59_000).ok, false, "the 61st call in a minute waits");
  assert.deepEqual(nextWindow(w.start, w.calls, t0 + 60_000), { start: new Date(t0 + 60_000).toISOString(), calls: 1, ok: true });

  assert.equal(originOf("http://internal:3000/api/mcp", "op.example.com", "https"), ORIGIN);
  assert.equal(originOf("https://op.example.com/x", null, null), ORIGIN);
  assert.match(CONSENT_NEVER, /can't approve cards, put a draft live .*put an agent on duty/);

  // ---- the source: one business per call, drafts only through the builder's and proposals' code
  const store = read("core/operator-mcp.ts");
  for (const w of ["activateSpecVersion", "acceptProposal", "declineProposal", "callWriteTool", "@/core/gateway", "withRun", "setEnabled", "enabled: true", "@/dashboard/"]) assert.ok(!store.includes(w), `core/operator-mcp.ts never uses ${w}: no going live, deciding, acting, duty or budgets`);
  assert.match(store, /await createBuiltAgent\(got\.spec, byOf\(caller\), linked \? "Created from Claude, runs in Claude" : "Created from Claude"\)/, "a new agent is made by the builder's own code (off duty)");
  assert.match(store, /if \(toolList\(args\.tools\)\.length\) return no\("Not created: an agent that runs in Claude has no OPERATOR tools/, "an agent that runs in Claude gets no OPERATOR tools");
  assert.match(read("core/claude-agents.ts"), /\.is\("claude_session->>finished_at", null\)/, "a run takes its result once");
  assert.match(store, /await saveSpecVersion\(id, got\.spec,/, "a change is saved as a draft version");
  assert.match(store, /fileProposal\(input, \{ agentId: null, source: "claude", deptId \}\)/, "a proposal is filed as from Claude");
  assert.match(store, /const stale = staleRead\(Number\(args\.based_on_version\), newest\.version\);/, "a change made since the read is refused");
  const tryFn = store.slice(store.indexOf("async function tryAgent"), store.indexOf("/** Runs a tool for a caller"));
  assert.match(tryFn, /^async function tryAgent[\s\S]*if \(!controlsOn\(\)\) return no\(/, "a try is refused when real runs are switched off");
  assert.match(tryFn, /const stale = staleRead\(Number\(args\.based_on_version\), newest\);/, "a try runs the version Claude read");
  assert.match(tryFn, /await startTry\(id, target, args\.fresh === "yes"\)/, "a try is the builder's own try");
  const tries = read("core/agent-try.ts");
  assert.match(tries, /withRun\(agentId, "preview",/, "a try goes through withRun as a preview");
  assert.match(tries, /trying: true/, "the runner knows it is a try: nothing is sent or queued");
  assert.ok(!/callWriteTool|@\/core\/gateway|activateSpecVersion|enabled: true/.test(tries), "a try never acts, goes live or puts an agent on duty");
  assert.match(read("app/api/mcp/route.ts"), /export const maxDuration = 300;/, "a try has time to finish after its answer");
  assert.match(read("core/agent-spec.ts"), /insert\(\{ id, name: spec\.name, model: spec\.model, enabled: false,/, "createBuiltAgent makes agents off duty");
  const writes = [...store.matchAll(/from\("(\w+)"\)\.(insert|update|upsert|delete)\(/g)].map((m) => m[1]);
  assert.ok(writes.length >= 4 && writes.every((t) => t === "mcp_grants"), `the server writes only its own grants (saw ${writes.join(", ")})`);
  for (const t of OP_TOOLS) assert.match(store, new RegExp(`case "${t.name}":`), `runTool runs ${t.name}`);
  assert.match(store, /return withOrg\(caller\.orgId, \(\) => \{/, "tools run inside the caller's business");
  assert.match(store, /const m = await memberById\(g\.member_id\);/, "the member is read again on every call");
  const route = read("app/api/mcp/route.ts");
  assert.ok(route.indexOf("verifyAccess(") < route.indexOf("req.json()"), "the token is checked before the body is read");
  assert.match(route, /export const GET = notOffered;/);
  assert.match(read("proxy.ts"), /\\\\\.well-known\//, "the sign-in metadata isn't behind the Control Room sign-in");
  assert.match(read("next.config.ts"), /\/\.well-known\/oauth-protected-resource\/:path\*/);
  assert.match(read("next.config.ts"), /\/\.well-known\/oauth-authorization-server/);
  const sql = read("supabase/migrations/20270103090000_mcp_grants.sql");
  assert.match(sql, /org_id uuid not null references orgs\(id\)/);
  assert.match(sql, /member_id uuid not null references members\(id\) on delete cascade/);
  assert.match(sql, /create policy org_rows on mcp_grants/);
  assert.ok(!/\b(access_token|refresh_token|code) text\b/.test(sql), "no token is stored, only hashes");
  assert.ok((TENANT_TABLES as readonly string[]).includes("mcp_grants"));
  assert.match(read("app/oauth/authorize/page.tsx"), /requireSession\(\)/, "the consent page needs a signed-in member");
  assert.match(read("dashboard/mcpActions.ts"), /const r = readAuthorize\(q, clientSecret\(\), await selfOrigin\(\)\);/, "Allow checks the request again");
  assert.match(read("CLAUDE.md"), /OPERATOR's own MCP server/, "the hard rules name the server");

  console.log(`check:operator-mcp ok (${READS.length} read tools, ${DRAFTS.length} draft tools, ${TRIES.length} try tool)`);
};
run().catch((e) => { console.error(e); process.exit(1); });
