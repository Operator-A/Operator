// Checks the department pages (docs/department-pages.md): the tab in the address, the red counts and
// who works in a department, on a small chart. No database, no network. Run: npm run check:dept
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEPT_TABS, agentHref, hireHref, deptAgentIds, deptTab, headAgentId, needsByDept, sheetHref, tabHref } from "../dashboard/dept-rules";
import { dayRuns, daySet, daysOf, dayWords, isDays, onDay, withAgentTime } from "../core/flow-rules";
import { deptReach, headDirective } from "../core/head-chat-rules";
import { resolveRuleWho, deptNamed } from "../core/chat-rules";
import type { Org } from "../core/org-rules";
import { allowedGrants, hireCostLine, hireRuns, hireStage, hireWhenWords, newAgent, tryInFeed } from "../dashboard/hire-rules";
import { hireWhen, planProposal, toolInfoOf } from "../core/proposal-rules";
import { checklist, dayLabel, goalNumber, inFeed, mergeFeed, resultText, runFoot, runState, runTitle, type FeedRun } from "../dashboard/dept-feed";

const org: Org = {
  departments: [
    { id: "finance", name: "Finance", sort: 1, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false },
    { id: "sales", name: "Sales", sort: 2, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false },
  ],
  seats: [
    { id: "c", departmentId: null, parentId: null, title: "Chief of Staff", sub: "", holder: "agent", agentId: "avery", sort: 0 },
    { id: "f", departmentId: "finance", parentId: null, title: "CFO", sub: "", holder: "agent", agentId: "morgan", sort: 0 },
    { id: "f2", departmentId: "finance", parentId: "f", title: "Collections", sub: "", holder: "open", agentId: null, sort: 2 },
    { id: "f1", departmentId: "finance", parentId: "f", title: "Bookkeeper", sub: "", holder: "agent", agentId: "quinn", sort: 1 },
    { id: "f11", departmentId: "finance", parentId: "f1", title: "Receipts", sub: "", holder: "agent", agentId: "rae", sort: 0 },
    { id: "s", departmentId: "sales", parentId: null, title: "Head of sales", sub: "", holder: "owner", agentId: null, sort: 0 },
  ],
};

// tabs: Chat first and the default; anything else opens Chat
assert.equal(DEPT_TABS[0], "chat");
assert.equal(deptTab("goals"), "goals");
assert.equal(deptTab("approvals"), "approvals");
assert.equal(deptTab("agents"), "agents");
assert.equal(deptTab(undefined), "chat");
assert.equal(deptTab("chat"), "chat");
assert.equal(deptTab("<script>"), "chat");
assert.equal(tabHref("finance", "chat"), "/dept/finance");
assert.equal(tabHref("finance", "goals"), "/dept/finance?tab=goals");

// who works here: the head first, then down the chart in seat order; open and owner seats hold no agent
assert.deepEqual(deptAgentIds(org, "finance"), ["morgan", "quinn", "rae"]);
assert.deepEqual(deptAgentIds(org, "sales"), []);
assert.deepEqual(deptAgentIds(org, "nope"), []);
assert.equal(headAgentId(org, "finance"), "morgan");
assert.equal(headAgentId(org, "sales"), null, "the owner leads sales, so it has no head agent");

// red counts: every waiting card counted once, by the department stamped on it (as the Approvals page filters)
const waiting = ["finance", "finance", null, "sales", "retired_dept", "finance"];
const n = needsByDept(org.departments.map((d) => d.id), waiting);
assert.deepEqual(n.byDept, { finance: 3, sales: 1 });
assert.equal(n.none, 1);
assert.equal(n.gone, 1);
assert.equal(Object.values(n.byDept).reduce((t, x) => t + x, 0) + n.none + n.gone, waiting.length, "the parts add up to the Approvals count");
assert.deepEqual(needsByDept(["finance"], []), { byDept: { finance: 0 }, none: 0, gone: 0 });

// the head's chat: rules only for its own department and its agents, never everyone or another department
const reach = deptReach(org, "finance", { morgan: "Morgan", quinn: "Quinn", rae: "Rae" });
assert.deepEqual(reach.agents.map((a) => a.name), ["Morgan", "Quinn", "Rae"]);
assert.deepEqual(resolveRuleWho("quinn", reach), { scope: "agent", agentId: "quinn", name: "Quinn" });
assert.deepEqual(resolveRuleWho("all of Finance", reach), { scope: "department", deptId: "finance", name: "Finance" });
assert.ok("problem" in resolveRuleWho("everyone", reach), "a head can't save a rule for the whole crew");
assert.ok("problem" in resolveRuleWho("Sales", reach), "or for another department");
assert.ok("problem" in resolveRuleWho("Avery", reach), "or for an agent outside its department");
assert.ok("problem" in deptNamed("Sales", reach.departments), "a head files proposals only for its own department");
assert.deepEqual(deptNamed(undefined, reach.departments), { id: null }, "no department named: the head's own (filled in by File a proposal)");
assert.deepEqual(deptReach(org, "sales", {}).agents, []);
const dir = headDirective({ name: "Morgan", title: "CFO", dept: "Finance", business: "Corner Bike Shop", agents: ["Quinn", "Rae"] });
assert.match(dir, /You are Morgan, CFO of Finance at Corner Bike Shop/);
assert.match(dir, /Quinn, Rae/);
assert.match(dir, /never run, start, stop or change an agent, and you never send, buy or post/);
assert.match(dir, /copied from their message/);

// wiring: the menu, the page and Everyone use these counts, and the page and the Approvals page draw one card
// runs in the chat (slice 3): the checklist comes only from logged steps, labelled by code
const label = (t: string) => ({ mercury_list: "Read Mercury transactions", gmail_search: "Searched Gmail" } as Record<string, string>)[t] ?? "Used a connected tool";
const steps = [
  { kind: "model", tool: null, ok: true },
  { kind: "tool", tool: "mercury_list", ok: true },
  { kind: "tool", tool: "mercury_list", ok: true },
  { kind: "tool", tool: "mercury_list", ok: true },
  { kind: "text", tool: null, ok: true },
  { kind: "tool", tool: "gmail_search", ok: false },
  { kind: "tool", tool: "made_up_tool", ok: true },
];
assert.deepEqual(checklist(steps, label, false), [
  { label: "Read Mercury transactions · 3 times", state: "done" },
  { label: "Searched Gmail", state: "failed" },
  { label: "Used a connected tool", state: "done" },
], "one line per tool, repeats folded, a failed call marked, unknown tools get a plain label, model text never shows");
assert.deepEqual(checklist([], label, true), [{ label: "Starting", state: "now" }]);
assert.equal(checklist(steps.slice(0, 2), label, true).at(-1)?.state, "now", "a run that is going ends with a line that is still working");
assert.deepEqual(checklist([{ kind: "tool", tool: "mercury_list", ok: true }, { kind: "stop", tool: null, ok: false }], label, false).at(-1), { label: "Stopped before it finished", state: "failed" });
assert.ok(!inFeed("chat") && !inFeed("preview") && !inFeed("approval"), "chat replies, tries and approved writes don't post as runs");
assert.ok(inFeed("manual") && inFeed("schedule") && inFeed("chain") && inFeed("event"));
assert.equal(runTitle("manual"), "Run now");
assert.equal(runTitle("schedule"), "Scheduled run");
assert.deepEqual(runState("running"), { word: "Working", look: "live" });
assert.deepEqual(runState("failed"), { word: "Failed", look: "bad" });
assert.equal(runFoot(4, "2026-11-23T13:00:00Z", "2026-11-23T13:00:38Z", 0.041), "4 steps · 38 seconds · $0.04");
assert.equal(runFoot(1, "2026-11-23T13:00:00Z", "2026-11-23T13:03:10Z", 0), "1 step · 3 min · $0.00");
assert.equal(runFoot(2, "2026-11-23T13:00:00Z", null, 0.01), "2 steps · $0.01");
assert.equal(resultText("[runner, spec v2] Books are current.", null, "ok"), "Books are current.");
assert.equal(resultText("half done", "Mercury refused the sign-in", "failed"), "Mercury refused the sign-in");
assert.deepEqual(goalNumber("212 of 226 this month"), { big: "212", small: "of 226 this month" });
assert.deepEqual(goalNumber("$21,480 revenue"), { big: "$21,480", small: "revenue" });
assert.deepEqual(goalNumber("on track"), { big: "on track", small: "" });
const now = Date.parse("2026-11-23T18:00:00Z");
assert.equal(dayLabel("2026-11-23T15:00:00Z", "America/Chicago", now), "Today");
assert.equal(dayLabel("2026-11-22T15:00:00Z", "America/Chicago", now), "Yesterday");
assert.equal(dayLabel("2026-11-23T03:00:00Z", "America/Chicago", now), "Yesterday", "days are counted in the business's time zone");
const run = (id: string, at: string, status: FeedRun["status"]): FeedRun => ({ id, agentId: "quinn", name: "Quinn", role: "Bookkeeper", at, endedAt: null, trigger: "manual", status, lines: [], steps: 0, costUsd: 0, result: "", drafts: [] });
const feed = mergeFeed([{ id: "t1", role: "owner", text: "hi", notes: [], runId: null, at: "2026-11-23T14:00:00Z" }], [run("r1", "2026-11-23T13:00:00Z", "running"), run("r1", "2026-11-23T13:00:00Z", "ok"), run("r2", "2026-11-23T15:00:00Z", "ok")]);
assert.deepEqual(feed.map((f) => f.id), ["r1", "t1", "r2"], "time order, oldest first");
assert.equal(feed[0].kind === "run" && feed[0].status, "ok", "a run seen twice keeps its newest copy");

const read = (p: string) => readFileSync(p, "utf8");
const layout = read("app/(room)/layout.tsx"), page = read("app/(room)/dept/[id]/page.tsx"), approvals = read("app/(room)/approvals/page.tsx"), everyone = read("app/(room)/everyone/page.tsx");
assert.ok(/needsByDept\(/.test(layout) && /href: `\/dept\/\$\{d\.id\}`/.test(layout), "the side menu lists each department with its red count");
assert.ok(/href="\/everyone"/.test(layout), "the bell opens Everyone");
assert.ok(/needsByDept\(/.test(page) && /needsByDept\(/.test(everyone), "the page and Everyone count with needsByDept");
assert.ok(/<ApprovalCard /.test(page) && /<ApprovalCard /.test(approvals), "a department's Approvals tab and the Approvals page draw the same card");
assert.ok(!/approve\.bind/.test(page) && !/approve\.bind/.test(approvals), "only ApprovalCard binds Approve, so approving is one path");
assert.ok(!/opened\.goals|opened\.rules|<Feed runs=\{d\.runs\.filter\(\(r\) => ids/.test(read("dashboard/components/OrgCanvas.tsx")), "the Crew canvas no longer has its own department panel");

const headChat = read("core/head-chat.ts"), actions = read("dashboard/chatActions.ts");
assert.ok(/withRun\(headId, "chat"/.test(headChat), "every message to a head is one logged run through withRun");
assert.ok(/crewNowTool\(org, deptId\)/.test(headChat) && /fileProposalTool\(reach, deptId\)/.test(headChat), "the head sees and files for its own department only");
assert.ok(!/callWriteTool|core\/gateway/.test(headChat), "the head's chat never reaches the gateway");
assert.ok(/export async function sendToHead[\s\S]*?asRole\("approver"\)[\s\S]*?controlsOn\(\)[\s\S]*?cleanMessage/.test(actions), "sendToHead checks the role, real runs and the message");
assert.ok(/<HeadChat /.test(page) && /send=\{sendToHead\}/.test(page), "the Chat tab talks through sendToHead");
assert.ok(/"dept_chat"/.test(read("core/tenancy.ts")), "dept_chat is a tenant table");

const live = read("app/(room)/dept/[id]/live/route.ts"), feedSrv = read("dashboard/deptFeed.ts"), chat = read("dashboard/components/headChat.tsx");
assert.ok(/look="chat"/.test(page) && /look="tab"/.test(page), "drafts in the chat and on the Approvals tab are the same ApprovalCard");
assert.ok(/memberFromCookie/.test(live) && /getRoster/.test(live), "the live route checks who is signed in and that the department exists");
assert.ok(/run_steps/.test(feedSrv) && /checklist\(/.test(feedSrv) && !/output|reply|messages/.test(feedSrv.match(/from\("run_steps"\)\.select\("([^"]+)"/)?.[1] ?? "x"), "the checklist reads only which tool ran and whether it worked");
assert.ok(/if \(opts\.runId\) \{/.test(read("core/runner.ts")), "every logged run saves its steps as they happen, so a run you start shows live");
assert.ok(/refresh-ok/.test(chat) && !/\bapprove\b(?! ?card)/i.test(chat.replace(/\/\/.*$/gm, "")) && !/approve\(/.test(chat), "the chat draws approval cards from the server and never approves itself");

// the agent sheet (slice 4): in the address, old links open it, any set of days, and the same checks as before
assert.equal(sheetHref("finance", "agents", "quinn"), "/dept/finance?tab=agents&agent=quinn");
assert.equal(sheetHref("finance", "chat", "quinn"), "/dept/finance?agent=quinn");
assert.equal(agentHref(org, "quinn"), "/dept/finance?tab=agents&agent=quinn", "an old agent link opens its sheet in its department");
assert.equal(agentHref(org, "avery"), "/everyone?agent=avery", "an agent in no department opens on Everyone");
assert.equal(agentHref(null, "quinn"), "/everyone?agent=quinn");
assert.equal(daysOf([0, 1, 2, 3, 4, 5, 6]), "daily");
assert.equal(daysOf([5, 1, 2, 3, 4]), "weekdays");
assert.equal(daysOf([1]), "mondays");
assert.equal(daysOf([5, 1, 3, 3]), "on:135");
assert.equal(daysOf([]), null, "no days is no schedule");
assert.deepEqual(daySet("on:135"), [1, 3, 5]);
assert.ok(isDays("on:135") && isDays("weekdays") && !isDays("on:531") && !isDays("on:113") && !isDays("on:7") && !isDays("on:"), "a day set is unique weekdays 0-6 in order");
assert.equal(dayWords("on:135"), "on Mondays, Wednesdays and Fridays");
assert.equal(dayWords("on:6"), "on Saturdays");
assert.equal(dayRuns("on:135"), 13);
assert.equal(dayRuns("weekdays"), 22);
assert.ok(onDay("on:135", "2026-11-23") && !onDay("on:135", "2026-11-24"), "Nov 23 2026 is a Monday");
const one = withAgentTime({ chains: [] }, "quinn", "Quinn", { days: "on:135", time: "07:00" });
assert.ok("flow" in one && one.flow.chains.length === 1 && one.flow.chains[0].steps.length === 1, "a schedule from the sheet writes exactly one one-step chain");
const again = "flow" in one ? withAgentTime(one.flow, "quinn", "Quinn", { days: "daily", time: "07:15" }) : one;
assert.ok("flow" in again && again.flow.chains.length === 1, "moving it changes that chain, never adds one");
assert.ok("refuse" in withAgentTime({ chains: [] }, "quinn", "Quinn", { days: "on:9" as never, time: "07:00" }));

const sheet = read("dashboard/components/agentSheet.tsx"), sheetFor = read("dashboard/components/agentSheetFor.tsx"), actionsSrc = read("dashboard/actions.ts");
assert.ok(/saveSpec\.bind\(null, id\)/.test(sheetFor) && /goLive\.bind\(null, id\)/.test(sheetFor) && /setAgentTime\.bind\(null, id\)/.test(sheetFor) && /setEnabled\.bind\(null, id\)/.test(sheetFor), "the sheet uses the same actions the old pages did");
assert.ok(!/activateSpecVersion|agent_defs|db\(\)/.test(sheet + sheetFor), "the sheet never writes a version or the database itself");
assert.ok(/export async function saveSpec[\s\S]*?asRole\("owner"\)[\s\S]*?saveSpecVersion/.test(actionsSrc), "a changed job, model, reads or can do (grants) saves a draft, and only the owner can");
assert.ok(/export async function goLive[\s\S]*?lastTry[\s\S]*?if \(!t\.clean\)/.test(actionsSrc), "a draft goes live only after a clean try");
assert.ok(/disabled=\{busy \|\| !controls \|\| !d\.tried\?\.clean\}/.test(sheet), "Go live stays locked in the sheet until the try is clean");
assert.ok(/redirect\(agentHref\(roster\.chart, id\)\)/.test(read("app/(room)/agents/[id]/page.tsx")), "old agent pages open the sheet");
const build = read("app/(room)/build/[id]/page.tsx");
assert.ok(/redirect\(agentHref\(org, id\)\)/.test(build) && !/TryLive|goLive|tryBuilt/.test(build), "the builder page keeps only the step editor; the rest is in the sheet");
assert.ok(/<AgentSheetFor id=\{sp\.agent\}/.test(page) && /<AgentSheetFor id=\{sp\.agent\}/.test(everyone), "the department page and Everyone open the sheet");

// hiring in the chat (slice 5): the head suggests, code counts, only the owner's taps grant, a new agent starts off duty
const tools = toolInfoOf({
  stripe_invoices: { id: "stripe_invoices", kind: "read", label: "Stripe invoices" },
  stripe_draft_invoice: { id: "stripe_draft_invoice", kind: "action", label: "Draft invoice in Stripe", agents: "granted" },
  mercury_send: { id: "mercury_send", kind: "action", label: "Send money", agents: ["cfo"] },
});
const hire = { kind: "hire", why: "Five invoices are more than 14 days late.", name: "Ivy", seat: "Collections", job: "Finds late invoices and tells you who owes what.", each_run: "Read open invoices, find the ones over 14 days, list them.", good_result: "A short list with amounts.", tools: "stripe_invoices" };
const planned = planProposal({ ...hire, days: "weekdays", time: "08:00", can: "stripe_draft_invoice" }, tools);
assert.ok("plan" in planned && planned.plan.kind === "hire" && planned.plan.days === "weekdays" && planned.plan.time === "08:00" && planned.plan.can?.[0] === "stripe_draft_invoice", "a hire carries when it runs and the actions it suggests");
assert.ok("plan" in planned && planned.plan.kind === "hire" && !planned.plan.tools.includes("stripe_draft_invoice"), "a suggested action is never one of its tools until someone turns it on");
assert.ok("problem" in planProposal({ ...hire, can: "mercury_send" }, tools), "a hire can't suggest an action code gives only to named agents");
assert.ok("problem" in planProposal({ ...hire, can: "stripe_invoices" }, tools), "a read tool goes in tools, not can");
assert.ok("problem" in planProposal({ ...hire, tools: "stripe_invoices, stripe_draft_invoice" }, tools), "a hire's tools still can't hold an action");
const noWhen = planProposal(hire, tools);
assert.ok("plan" in noWhen && noWhen.plan.kind === "hire" && noWhen.plan.days === null && noWhen.plan.can?.length === 0, "no days means only when asked, nothing suggested");
assert.deepEqual(hireWhen("mon, wed, fri", "07:30"), { days: "on:135", time: "07:30" });
assert.deepEqual(hireWhen("every day", "06:00"), { days: "daily", time: "06:00" });
assert.deepEqual(hireWhen("only when asked", ""), { days: null, time: null });
assert.ok("problem" in hireWhen("weekdays", "8am") && "problem" in hireWhen("someday", "08:00"));
assert.deepEqual(allowedGrants(["stripe_draft_invoice", "mercury_send", "stripe_draft_invoice"], ["stripe_draft_invoice"], (id) => tools[id]?.granted === true), ["stripe_draft_invoice"], "a Hire tap grants only what was suggested and an approver may give");
assert.deepEqual(allowedGrants(["mercury_send"], ["mercury_send"], (id) => tools[id]?.granted === true), [], "even a suggested action code doesn't let approvers give stays off");
assert.equal(hireRuns("weekdays"), 22); assert.equal(hireRuns(null), 0);
assert.equal(hireWhenWords("weekdays", "08:00"), "Weekdays at 08:00");
assert.equal(hireWhenWords(null, null), "Only when you ask");
const month = (perRun: number | null, n: number) => ({ perRun, atMostPerRun: 0.1, runsPerMonth: n, month: perRun == null ? 0 : perRun * n, atMost: 0.1 * n, basis: "estimate" as const, runs: 0, billing: "own_key" as const });
assert.deepEqual(hireCostLine(month(0.08, 22), { name: "Finance", budget: 30 }), { big: "$1.76", small: "a month · about $0.08 a run, 22 runs. Inside Finance’s $30." }, "the cost on the card is worked out in code");
assert.equal(hireCostLine(month(0.08, 0), null).big, "$0.08");
assert.equal(hireCostLine(month(null, 22), null).big, "Cost unknown");
assert.equal(hireStage(null), "hired"); assert.equal(hireStage({ clean: false, status: "running" }), "trying");
assert.equal(hireStage({ clean: true, status: "ok" }), "clean"); assert.equal(hireStage({ clean: false, status: "ok" }), "failed");
assert.ok(newAgent({ enabled: false, approvedRoutine: false, hasSpec: true }) && !newAgent({ enabled: true, approvedRoutine: false, hasSpec: true }) && !newAgent({ enabled: false, approvedRoutine: true, hasSpec: true }), "a card stays only until the agent has been put on duty");
assert.ok(tryInFeed("preview", "ivy", new Set(["ivy"])) && !tryInFeed("preview", "quinn", new Set(["ivy"])) && !inFeed("preview"), "only a new agent's first try posts in the chat");
assert.equal(runTitle("preview"), "First try");
assert.equal(hireHref("finance", { title: "Collections", sub: "late invoices" }), `/dept/finance?say=${encodeURIComponent("Hire an agent for the Collections seat: late invoices.")}`);

const proposalsSrc = read("core/proposals.ts"), pActs = read("dashboard/proposalActions.ts"), hireCard = read("dashboard/components/hireCard.tsx");
assert.ok(/createBuiltAgent\(d\.spec/.test(proposalsSrc) && /enabled: false/.test(read("core/agent-spec.ts")), "a hire is created off duty");
assert.ok(/export function hireDraft[\s\S]*?p\.can \?\? \[\]\)\.includes\(g\) && TOOLS\[g\]\?\.kind === "action" && TOOLS\[g\]\?\.agents === "granted"/.test(proposalsSrc), "the server keeps only grants the hire suggested and an approver may give");
assert.ok(/export async function hireInChat[\s\S]*?asRole\("owner"\)[\s\S]*?acceptProposal\(id, \{ grants: asked \}\)/.test(pActs), "Hire is the owner's tap and goes through the proposal's own path");
assert.ok(!/tryBuilt|runExplore|withRun/.test(pActs.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "")), "hiring itself runs no model; the first try is the existing tryBuilt");
assert.ok(/acts\.goLive\([\s\S]*?acts\.duty\(/.test(hireCard) && /stage === "clean" && <button/.test(hireCard), "Put on duty is offered only after a clean try, through Go live then on duty");
assert.ok(!/db\(\)|agent_defs|activateSpecVersion/.test(hireCard + read("dashboard/components/headChat.tsx")), "the card never writes the database itself");
for (const f of ["app/(room)/crew/page.tsx", "app/(room)/dept/[id]/page.tsx", "app/(room)/proposals/[id]/page.tsx", "dashboard/org.ts"]) assert.ok(!/build\/new/.test(read(f)), `${f} has no link to the old new-agent screens`);
assert.ok(!/agentId: string \| null|p\.create|templates/.test(read("dashboard/components/Flow.tsx")), "the step editor only edits an existing agent");
assert.ok(/ask at most two short questions/.test(headDirective({ name: "Morgan", title: "CFO", dept: "Finance", business: "Shop", agents: [] })), "the head asks at most two questions before it files a hire");

console.log("check:dept ok");
