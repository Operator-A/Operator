// Checks the department pages (docs/department-pages.md): the tab in the address, the red counts and
// who works in a department, on a small chart. No database, no network. Run: npm run check:dept
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { COMPANY_TABS, companyTab, companyHref, companyAskHref, addDeptHref, approvalsHistoryHref, ADD_DEPT_SAY, goalsWord, deptView, deptViewHref, SCHEDULE_HREF } from "../dashboard/company-rules";
import { readFileSync } from "node:fs";
import { DEPT_TABS, agentHref, askHref, asksOpen, goalHref, hireHref, settingsHref, deptAgentIds, deptTab, headAgentId, needsByDept, sheetHref, tabHref } from "../dashboard/dept-rules";
import { dayRuns, daySet, daysOf, dayWords, isDays, onDay, withAgentTime } from "../core/flow-rules";
import { deptReach, headDirective } from "../core/head-chat-rules";
import { resolveRuleWho, deptNamed } from "../core/chat-rules";
import type { Org } from "../core/org-rules";
import { NOTHING_READ, nothingReadNext, allowedGrants, hireCostLine, hireRuns, hireStage, hireWhenWords, linkedCostLine, LINKED_READS, linkedStep, newAgent, tryInFeed } from "../dashboard/hire-rules";
import { hireWhen, planProposal, toolInfoOf } from "../core/proposal-rules";
import { changeRows, changeStage, goalRows, goalTitle, keepDecided, moveRows, savedVersionOf } from "../dashboard/change-rules";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
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

// tabs: Overview first and the default (overview slice 1); anything else, the old Chat tab too, opens Overview
assert.equal(DEPT_TABS[0], "overview");
assert.ok(!(DEPT_TABS as readonly string[]).includes("chat"), "chat is no longer a tab: it opens from the Ask button");
assert.equal(deptTab("goals"), "goals");
assert.equal(deptTab("approvals"), "approvals");
assert.equal(deptTab("agents"), "agents");
assert.equal(deptTab(undefined), "overview");
assert.equal(deptTab("chat"), "overview");
assert.equal(deptTab("<script>"), "overview");
assert.equal(tabHref("finance", "overview"), "/dept/finance");
// the chat in the Ask sheet: in the address over any tab, and words to type in open it too
assert.equal(askHref("finance"), "/dept/finance?ask=1");
assert.equal(askHref("finance", "approvals"), "/dept/finance?tab=approvals&ask=1");
assert.ok(asksOpen({ ask: "1" }) && asksOpen({ say: "Set a goal: " }) && !asksOpen({}) && !asksOpen({ say: "" }));
assert.ok(asksOpen(new URL(`http://x${goalHref("finance")}`).searchParams.get("say") ? { say: "x" } : {}), "a set-a-goal link opens the chat");
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
assert.match(dir, /never run, start or stop an agent, or change one yourself, and you never send, buy or post/);
assert.match(dir, /change_agent/, "a change is asked for as a change card");
assert.match(dir, /never gives an action or picks a model/);
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
const layout = read("app/(room)/layout.tsx"), page = read("app/(room)/dept/[id]/page.tsx"), company = read("app/(room)/page.tsx");
assert.ok(/needsByDept\(/.test(layout) && /href: `\/dept\/\$\{d\.id\}`/.test(layout), "the side menu lists each department with its red count");
assert.ok(!existsSync("app/(room)/everyone/page.tsx") && !/\/everyone/.test(layout), "Everyone is gone (slice 9): the bell is a drop-down");
assert.ok(/needsByDept\(/.test(page) && /needsByDept\(/.test(company), "the department page and the Company page count with needsByDept");
assert.ok(/<ApprovalCard /.test(page) && /<ApprovalCard /.test(company), "a department's Approvals tab and the Company page's draw the same card");
assert.ok(!/approve\.bind/.test(page) && !/approve\.bind/.test(company), "only ApprovalCard binds Approve, so approving is one path");
assert.ok(!/opened\.goals|opened\.rules|<Feed runs=\{d\.runs\.filter\(\(r\) => ids/.test(read("dashboard/components/OrgCanvas.tsx")), "the Crew canvas no longer has its own department panel");

const headChat = read("core/head-chat.ts"), actions = read("dashboard/chatActions.ts");
assert.ok(/withRun\(headId, "chat"/.test(headChat), "every message to a head is one logged run through withRun");
assert.ok(/crewNowTool\(org, deptId\)/.test(headChat) && /fileProposalTool\(reach, deptId\)/.test(headChat), "the head sees and files for its own department only");
assert.ok(!/callWriteTool|core\/gateway/.test(headChat), "the head's chat never reaches the gateway");
assert.ok(/export async function sendToHead[\s\S]*?asRole\("approver"\)[\s\S]*?controlsOn\(\)[\s\S]*?cleanMessage/.test(actions), "sendToHead checks the role, real runs and the message");
assert.ok(/<HeadChat /.test(page) && /send=\{sendToHead\.bind\(null, id\)\}/.test(page), "the Chat tab talks through sendToHead");
assert.ok(/"dept_chat"/.test(read("core/tenancy.ts")), "dept_chat is a tenant table");

const live = read("app/(room)/dept/[id]/live/route.ts"), feedSrv = read("dashboard/deptFeed.ts"), chat = read("dashboard/components/headChat.tsx");
assert.ok(/look="chat"/.test(page) && /look="tab"/.test(page), "drafts in the chat and on the Approvals tab are the same ApprovalCard");
assert.ok(/memberFromCookie/.test(live) && /getRoster/.test(live), "the live route checks who is signed in and that the department exists");
assert.ok(/run_steps/.test(feedSrv) && /checklist\(/.test(feedSrv) && !/output|reply|messages/.test(feedSrv.match(/from\("run_steps"\)\.select\("([^"]+)"/)?.[1] ?? "x"), "the checklist reads only which tool ran and whether it worked");
assert.ok(/if \(opts\.runId\) \{/.test(read("core/runner.ts")), "every logged run saves its steps as they happen, so a run you start shows live");
assert.ok(/refresh-ok/.test(chat) && !/\bapprove\b(?! ?card)/i.test(chat.replace(/\/\/.*$/gm, "")) && !/approve\(/.test(chat), "the chat draws approval cards from the server and never approves itself");

// the agent sheet (slice 4): in the address, old links open it, any set of days, and the same checks as before
assert.equal(sheetHref("finance", "agents", "quinn"), "/dept/finance?tab=agents&agent=quinn");
assert.equal(sheetHref("finance", "overview", "quinn"), "/dept/finance?agent=quinn");
assert.equal(agentHref(org, "quinn"), "/dept/finance?tab=agents&agent=quinn", "an old agent link opens its sheet in its department");
assert.equal(agentHref(org, "avery"), "/?tab=departments&agent=avery", "an agent in no department opens on Company > Departments");
assert.equal(agentHref(null, "quinn"), "/?tab=departments&agent=quinn");
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
for (const f of ["app/(room)/agents/[id]/page.tsx"]) assert.ok(/redirect\(agentHref\(roster\.chart, id, sp\.edit != null\)\)/.test(read(f)), `${f} opens the sheet, on Edit when asked`);
assert.ok(/<AgentSheetFor id=\{sp\.agent\}/.test(page) && /<AgentSheetFor id=\{sp\.agent\}/.test(company), "the department page and the Company page open the sheet");

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
// a try that read nothing is not "worked": the card says why in plain words and names the next step, never "routine"
assert.equal(hireStage({ clean: false, status: "ok" }), "failed");
assert.ok(!/routine/i.test(NOTHING_READ) && !/routine/i.test(nothingReadNext("Ada")));
assert.match(nothingReadNext("Ada"), /Try again/); assert.match(nothingReadNext("Ada"), /Change something/);
assert.ok(newAgent({ enabled: false, approvedRoutine: false, hasSpec: true }) && !newAgent({ enabled: true, approvedRoutine: false, hasSpec: true }) && !newAgent({ enabled: false, approvedRoutine: true, hasSpec: true }), "a card stays only until the agent has been put on duty");
assert.ok(tryInFeed("preview", "ivy", new Set(["ivy"])) && !tryInFeed("preview", "quinn", new Set(["ivy"])) && !inFeed("preview"), "only a new agent's first try posts in the chat");
assert.equal(runTitle("preview"), "First try");
// an agent that runs in Claude (decided 2026-11-24): no try and no cost a run on its card; connect the routine, then on duty
assert.deepEqual(linkedStep(null), { step: "connect", paused: null }, "a routine that can't be read asks to connect");
assert.deepEqual(linkedStep({ connected: false, paused: null }), { step: "connect", paused: null });
assert.deepEqual(linkedStep({ connected: true, paused: "Token refused." }), { step: "paused", paused: "Token refused." });
assert.deepEqual(linkedStep({ connected: true, paused: null }), { step: "ready", paused: null });
assert.ok(!/\$\d/.test(linkedCostLine().big + linkedCostLine().small), "the card of an agent that runs in Claude shows no price a run");
assert.deepEqual([...LINKED_READS], ["Its routine’s connectors, set in Claude"], "a card names no connectors for a routine");
assert.equal(hireHref("finance", { title: "Collections", sub: "late invoices" }), `/dept/finance?say=${encodeURIComponent("Hire an agent for the Collections seat: late invoices.")}`);

const proposalsSrc = read("core/proposals.ts"), pActs = read("dashboard/proposalActions.ts"), hireCard = read("dashboard/components/hireCard.tsx");
assert.ok(/createBuiltAgent\(d\.spec/.test(proposalsSrc) && /enabled: false/.test(read("core/agent-spec.ts")), "a hire is created off duty");
assert.ok(/export function hireDraft[\s\S]*?p\.can \?\? \[\]\)\.includes\(g\) && TOOLS\[g\]\?\.kind === "action" && TOOLS\[g\]\?\.agents === "granted"/.test(proposalsSrc), "the server keeps only grants the hire suggested and an approver may give");
assert.ok(/export async function hireInChat[\s\S]*?asRole\("owner"\)[\s\S]*?acceptProposal\(id, \{ grants: asked \}\)/.test(pActs), "Hire is the owner's tap and goes through the proposal's own path");
assert.ok(!/tryBuilt|runExplore|withRun/.test(pActs.replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "")), "hiring itself runs no model; the first try is the existing tryBuilt");
assert.ok(/acts\.goLive\([\s\S]*?acts\.duty\(/.test(hireCard) && /stage === "clean" && <button/.test(hireCard), "Put on duty is offered only after a clean try, through Go live then on duty");
assert.ok(/lc \? \(c\.fromApp[\s\S]*?\{!lc && !done && !later && \(/.test(hireCard) && !/onClick=\{linkedOnDuty\}[^\n]*tryOnce/.test(hireCard), "a card of an agent that runs in Claude offers no Try once");
assert.ok(/const linkedOnDuty = \(\) => run\(async \(\) => \{\s*const d = await acts\.duty\(c\.agentId!, true\)/.test(hireCard) && /lc\.step === "ready"\s*\? <button[^\n]*onClick=\{linkedOnDuty\}/.test(hireCard), "Put on duty of an agent that runs in Claude goes through setEnabled (which checks its routine), only once the routine is connected");
assert.ok(/inClaude\.has\(d\.agent_id\) \? null : lastTry/.test(read("dashboard/hireCards.ts")) && /linked \? linkedCostLine\(\)/.test(read("dashboard/hireCards.ts")), "hire cards read the routine, not a try or a price, for an agent that runs in Claude");
assert.ok(!/db\(\)|agent_defs|activateSpecVersion/.test(hireCard + read("dashboard/components/headChat.tsx")), "the card never writes the database itself");
for (const f of ["app/(room)/crew/page.tsx", "app/(room)/dept/[id]/page.tsx", "app/(room)/proposals/[id]/page.tsx", "dashboard/org.ts"]) assert.ok(!/build\/new/.test(read(f)), `${f} has no link to the old new-agent screens`);

// slice 6: changing agents and goals by asking. A change is words until the owner's Approve.
const quinnNow = { days: "weekdays" as const, time: "08:00", budget: 2, job: "Match receipts.", goodResult: "", tools: ["goal_progress"], costCap: 0.25 };
const chg = { kind: "change_agent" as const, agent: "Quinn", when: { days: "daily" as const, time: "06:00" }, budget: null, job: null, goodResult: "Every new supplier over $500, flagged with why.", add: ["approvals_waiting"], drop: ["goal_progress"], costCap: 0.4 };
assert.deepEqual(changeRows(chg, (id) => id.toUpperCase(), quinnNow), [
  { k: "When", from: "Weekdays at 08:00", to: "Every day at 06:00" },
  { k: "Good result", from: null, to: chg.goodResult },
  { k: "Reads", from: null, to: "+ APPROVALS_WAITING, − GOAL_PROGRESS" },
  { k: "Cost cap a run", from: "$0.25", to: "$0.40" },
], "each line is Now → New, worked out in code");
assert.equal(changeRows(chg, (x) => x)[0].from, null, "no Now side without the agent");
const goalNew = { kind: "goal" as const, change: "new" as const, goal: null, title: "Runway 8 months", measure: "runway_months", target: "8", dueOn: "2027-06-30" };
assert.deepEqual(goalRows(goalNew, null).map((r) => r.k), ["Goal", "Counted", "Target", "By"]);
const goalPause = { kind: "goal" as const, change: "pause" as const, goal: "Runway", title: null, measure: null, target: null, dueOn: null };
assert.deepEqual(goalRows(goalPause, { title: "Runway", measure: null, target: null, dueOn: null, state: "active" }), [{ k: "Goal", from: null, to: "Runway" }, { k: "State", from: "Running", to: "Paused" }]);
assert.equal(goalTitle(goalNew), "Runway 8 months"); assert.equal(goalTitle(goalPause), "Runway");
const goalChange = { kind: "goal" as const, change: "change" as const, goal: "Runway", title: null, measure: null, target: "8", dueOn: null };
assert.deepEqual(goalRows(goalChange, { title: "Runway", measure: "runway_months", target: 6, dueOn: null, state: "active" }), [{ k: "Target", from: "6", to: "8" }]);
const st = (o: Partial<Parameters<typeof changeStage>[0]>) => changeStage({ state: "accepted", spec: true, draftVersion: 4, savedVersion: 4, tryOf: null, ...o });
assert.equal(st({ state: "pending" }), "proposed");
assert.equal(st({}), "draft");
assert.equal(st({ tryOf: { clean: false, status: "running" } }), "trying");
assert.equal(st({ tryOf: { clean: true, status: "ok" } }), "clean", "Go live only after a clean try of the change's own version");
assert.equal(st({ tryOf: { clean: false, status: "ok" } }), "failed");
assert.equal(st({ draftVersion: null }), "done", "once live, the card is done");
assert.equal(st({ draftVersion: 5 }), "done", "a newer draft from elsewhere ends this card's buttons");
assert.equal(st({ spec: false }), "done"); assert.equal(st({ state: "declined" }), "done");
assert.equal(savedVersionOf("Draft v4 changes Quinn's job."), 4); assert.equal(savedVersionOf("Approved."), null); assert.equal(savedVersionOf(null), null);
assert.ok(keepDecided("Approved: Quinn runs daily at 06:00.") && !keepDecided("Replaced by a newer draft of the same change."), "a replaced card leaves the chat");
assert.equal(goalHref("finance"), `/dept/finance?say=${encodeURIComponent("Set a goal: ")}`);
assert.equal(goalHref("finance", "Runway"), `/dept/finance?say=${encodeURIComponent("Change the goal “Runway”: ")}`);
assert.equal(agentHref(org, "quinn", true), `${sheetHref("finance", "agents", "quinn")}&edit=1`);

assert.ok(/export async function changeInChat[\s\S]*?asRole\("owner"\)[\s\S]*?acceptProposal\(id\)[\s\S]*?applyChange\(/.test(pActs), "Approve is the owner's tap and goes through the proposal's own path");
assert.ok(/kind === "goal"( \|\| got\.plan\.kind === "move_agent")? \? await waitingChange\(/.test(proposalsSrc) && /async function waitingChange\(/.test(proposalsSrc) && /Replaced by a newer draft of the same/.test(proposalsSrc), "filing the same change again replaces the waiting card");
assert.ok(/change === "pause"[\s\S]*?setGoalState|setGoalState[\s\S]*?paused/.test(proposalsSrc), "a goal pause, turn back on or done goes through the goal's own code");
assert.ok(/saveSpecVersion\(/.test(proposalsSrc) && !/activateSpecVersion/.test(proposalsSrc), "a change saves a draft version; it never goes live by itself");
assert.ok(/plan\.kind === "change_agent"\) \{[\s\S]{0,200}?!live\.has\(id\)\) return \{ problem[\s\S]{0,120}?id === seat\?\.agentId/.test(proposalsSrc), "a change only reaches an agent in the head's department");
assert.ok(!/db\(\)|agent_defs|activateSpecVersion/.test(read("dashboard/components/changeCard.tsx")), "the change card never writes the database itself");
for (const f of ["dashboard/components/Flow.tsx", "dashboard/flowSteps.ts", "dashboard/components/GoalForm.tsx", "app/(room)/goals/new/page.tsx"]) assert.ok(!existsSync(f), `${f} went with slice 6`);
const appFiles = ["app/(room)/dept/[id]/page.tsx", "app/(room)/page.tsx", "app/(room)/goals/[id]/page.tsx", "app/(room)/proposals/[id]/page.tsx", "app/(room)/connections/find/page.tsx", "dashboard/agentMap.ts", "dashboard/needs.ts", "core/proposals.ts", "dashboard/components/agentSheet.tsx"];
for (const f of appFiles) assert.ok(!/\/build\/\$\{|\/build\/[a-z]|goals\/new/.test(read(f)), `${f} has no link to the old step editor or goal form`);
const sheetSrc = read("dashboard/components/agentSheet.tsx");
assert.ok(/More detail/.test(sheetSrc) && /goodResult/.test(sheetSrc) && /maxCostUsd/.test(sheetSrc) && /notionPages/.test(sheetSrc) && /readsFrom/.test(sheetSrc) && /reportPage/.test(sheetSrc), "the sheet's More detail holds good result, limits, pages, other agents' results and where it saves");
assert.ok(/ask at most two short questions/.test(headDirective({ name: "Morgan", title: "CFO", dept: "Finance", business: "Shop", agents: [] })), "the head asks at most two questions before it files a hire");

// slice 7: a department's settings on its own page, through the same owner-only actions Crew's editor used
assert.equal(settingsHref("finance", "overview"), "/dept/finance?settings=1");
assert.equal(settingsHref("finance", "goals"), "/dept/finance?tab=goals&settings=1");
const dsFor = read("dashboard/components/deptSettingsFor.tsx"), ds = read("dashboard/components/deptSettings.tsx"), orgActs = read("dashboard/orgActions.ts");
for (const a of ["orgRenameDepartment", "orgSetDeptBudget", "orgSetDeptEmails", "orgSetLeadChecks", "orgAddDeptRule", "orgForgetDeptRule", "orgRemoveDepartment"]) {
  assert.ok(dsFor.includes(a), `the settings sheet uses ${a}`);
  assert.ok(new RegExp(`export async function ${a}\\([^)]*\\)[^{]*\\{\\s*const \\{ (me, )?no \\} = await asRole\\("owner"\\)`).test(orgActs), `${a} is the owner's only`);
}
assert.ok(/export async function orgSetDeptBudget[\s\S]*?if \(ch\.looser && !confirmed\) return \{ ok: false, text: `Confirm first/.test(orgActs), "a raised budget asks to confirm on the server");
assert.ok(/deptEmailChange\(d\.maxEmailsPerDay, next, company\)/.test(orgActs), "emails stay under the company cap, checked on the server");
assert.ok(/asksConfirm\(r\)\) \{ setConfirm\(r\.text\)/.test(ds) && /Confirm and save/.test(ds), "the sheet stops for that confirm and saves again only on a second tap");
assert.ok(!/db\(\)|agent_memory|departments/.test(ds.replace(/^\s*(\/\/|\*).*$/gm, "")), "the sheet never writes the database itself");
assert.ok(/<DeptSettingsFor chart=\{chart\} id=\{id\}/.test(page) && /className="dp-gear"/.test(page), "the gear on the header opens the settings");
const chartSrc = read("dashboard/components/OrgChart.tsx");
assert.ok(!/DeptEditor|LimitForm|setBudget|setLeadChecks|addRule/.test(chartSrc) && /\/dept\/\$\{d\.id\}\?settings=1/.test(chartSrc), "Crew's department editor is gone; its Settings opens the department's page");
assert.ok(!/orgEditDeptRule/.test(orgActs), "the rule editor went with it");

// slice 8: Avery's Company page, home in place of the Desk and the floating Avery panel
{
  assert.deepEqual([...COMPANY_TABS], ["overview", "departments", "goals", "approvals"], "the same four tabs as a department, Departments in place of Agents; Overview first (overview slice 3)");
  assert.equal(companyTab("nope"), "overview"); assert.equal(companyTab("chat"), "overview", "an old link to the chat tab opens the Overview"); assert.equal(companyTab("goals"), "goals");
  assert.equal(companyHref("overview"), "/"); assert.equal(companyHref("approvals"), "/?tab=approvals");
  assert.equal(companyAskHref(), "/?ask=1"); assert.equal(companyAskHref("goals"), "/?tab=goals&ask=1", "Ask opens over the tab that is open");
  assert.equal(addDeptHref(), `/?say=${encodeURIComponent(ADD_DEPT_SAY)}`, "Add a department opens Avery's chat with the words typed in");
  assert.equal(goalsWord([]), "No goals yet."); assert.equal(goalsWord(["on_track", "behind", "reached"]), "2 of 3 goals on track."); assert.equal(goalsWord(["behind"]), "1 goal, behind or not measured yet.");
  const home = read("app/(room)/page.tsx"), frame = read("app/(room)/layout.tsx");
  assert.ok(/<HeadChat [\s\S]*?send=\{sendToAvery\}/.test(home) && /chatHistory\(/.test(home), "the Company chat is Avery's chat: the same table and the same server action");
  assert.ok(/\{askOpen && \(\s*<AskSheet [\s\S]*?<Chat /.test(home) && !/pinned=/.test(home), "her chat opens in the Ask sheet, with nothing pinned in it (overview slice 3)");
  assert.ok(!/className=\{`dp co\$\{/.test(home) && !/\.dp\.chat /.test(read("app/globals.css")), "the page has no chat mode any more");
  assert.ok(/<Link href=\{companyAskHref\("overview", say\)\}/.test(read("dashboard/components/askAvery.tsx")), "a card's Ask Avery opens her sheet with the words typed in");
  assert.ok(/deptRuns\(\[chiefId\]/.test(home), "Avery's runs post in her chat");
  assert.ok(/const waiting = interruptCount\(open\);/.test(home) && /const waiting = interruptCount\(open\);/.test(frame), "the Company page counts the same four as the menu and the bell");
  assert.ok(/<ApprovalCard /.test(home) && !/approve\.bind/.test(home), "the Approvals tab draws the same card, so approving is one path");
  assert.ok(/<GoalTiles /.test(home) && /<GoalTiles /.test(page), "the Company and department Goals tabs draw the same tiles");
  assert.ok(/redirect\("\/start"\)/.test(home), "a business in setup still starts at setup");
  assert.ok(!/AveryChat|chatHistory|sendToAvery/.test(frame), "the frame no longer draws the floating Avery panel");
  assert.ok(/label: "Company"/.test(frame) && !/label: "Desk"/.test(frame) && /addDeptHref\(\)/.test(frame), "the menu says Company, and Add a department opens Avery's interview");
  const sendAvery = read("dashboard/chatActions.ts");
  assert.ok(/export async function sendToAvery[\s\S]*?asRole\("approver"\)[\s\S]*?controlsOn\(\)[\s\S]*?cleanMessage/.test(sendAvery), "Avery's chat keeps its checks");
  assert.ok(!/callWriteTool|core\/gateway/.test(read("core/avery-chat.ts")), "Avery's chat never reaches the gateway");
  const dir = "app/(room)";
  const left = ["app", "dashboard"].flatMap((d) => execSync(`grep -rl "AveryChat\\|Back to the Desk\\|on your Desk\\|to your Desk" ${d} || true`, { encoding: "utf8" }).split("\n").filter(Boolean));
  assert.deepEqual(left, [], `no link or words for the Desk or the floating panel are left (${dir})`);
}
// card 370: a move card's lines, Now → New
assert.deepEqual(moveRows({ dept: "Marketing", seat: "Tess (new seat)", boss: "Sloane" }, { dept: null, seat: null, boss: null }), [
  { k: "Department", from: "None", to: "Marketing" },
  { k: "Seat", from: "None", to: "Tess (new seat)" },
  { k: "Reports to", from: "Nobody yet", to: "Sloane" },
]);
assert.deepEqual(moveRows({ dept: "Marketing", seat: null, boss: null }, { dept: "Sales", seat: null, boss: null }), [{ k: "Department", from: "Sales", to: "Marketing" }], "a decided card keeps only where it came from");
const cards = read("dashboard/changeCards.ts");
assert.ok(/"move_agent"/.test(cards) && /kind: "move"/.test(cards), "moves into a department show as its change cards");
assert.ok(/c\.kind !== "move"/.test(read("dashboard/components/changeCard.tsx")), "a move card has no Change something (a head can't file a move)");
assert.ok(/pr\.kind !== "move_agent"/.test(read("dashboard/proposalActions.ts")), "Approve on a move card goes through changeInChat");
const crew = read("dashboard/components/orgChartPane.tsx");
assert.ok(/<NotInDepartment agents=\{v\.offChart\}/.test(crew) && /orgPlaceAgent/.test(crew), "the Departments chart adds an agent in no department to one");
assert.ok(!/step 1/.test(crew) && !/step 1/.test(chartSrc), "no pointer to the builder's deleted seat picker");
assert.ok(/asRole\("owner"\)/.test(orgActs.slice(orgActs.indexOf("export async function orgPlaceAgent"))), "adding to a department is the owner's");
// card 385: moving a placed agent from its sheet, and the empty old seat closing on every move
{
  const sheet = read("dashboard/components/agentSheet.tsx"), sheetFor = read("dashboard/components/agentSheetFor.tsx"), sheetData = read("dashboard/agentSheet.ts"), orgSrc = read("core/org.ts");
  assert.ok(/place: orgPlaceAgent\.bind\(null, id\)/.test(sheetFor), "the sheet's Move goes through orgPlaceAgent (owner only, audited)");
  assert.ok(/<span className="lbl">Department<\/span>/.test(sheet) && /act\.place\(/.test(sheet), "the sheet has a Department line with Move");
  assert.ok(/placeSpots\(chart, x\.id\)\.filter\(\(p\) => x\.id !== dept\?\.id \|\| p\.seatId\)/.test(sheetData), "in its own department only open seats are offered");
  assert.ok(/seat\.departmentId == null/.test(sheetData.slice(sheetData.indexOf("places:"))), "no Move for the company seat's agent");
  const pa = orgSrc.slice(orgSrc.indexOf("export async function placeAgent"));
  assert.ok(/seatToClose\(o, agentId/.test(pa) && /removeSeat\(leaving\.id\)/.test(pa), "placeAgent closes the empty old seat, for Crew, the sheet and move cards alike");
  assert.ok(/placedWords\(/.test(orgActs) && /placedWords\(/.test(read("core/proposals.ts")), "the reply says when the old seat closed");
}

console.log("check:dept ok");

// slice 10: the Approvals page's whole job moved to Company > Approvals; the menu item and the coffee-shop bits went
{
  assert.equal(approvalsHistoryHref(), "/?tab=approvals#history");
  const company = read("app/(room)/page.tsx"), layout = read("app/(room)/layout.tsx"), needsSrc = read("dashboard/needs.ts"), actions = read("dashboard/actions.ts");
  for (const p of ["app/(room)/approvals/page.tsx", "app/(room)/proposals/page.tsx"])
    assert.match(read(p), /redirect\(companyHref\("approvals"\)\)/, `${p} only sends old links to Company > Approvals`);
  assert.ok(!/href: "\/approvals"/.test(layout) && /label: "Company", count: waiting/.test(layout), "Approvals left the menu; Company carries its count");
  const pane = company.slice(company.indexOf("async function Approvals("));
  for (const bit of ["acceptPromotion.bind", "declinePromotion.bind", "approveAll.bind", "cancelAction.bind", "action={applyWaiting}", "retryAction.bind", "trustToDraft.bind", "view.log.map", "view.decided.map", 'id="history"', "Proposals to decide"])
    assert.ok(pane.includes(bit), `Company > Approvals has what the Approvals page had: ${bit}`);
  assert.match(company, /export const maxDuration = 300/, "the Company page gives Approve all and Apply now the same time the Approvals page had");
  assert.ok(!/Quinn/.test(pane) && !/Quinn/.test(needsSrc) && !/queueQuinn/.test(actions), "no agent of one business is named in the shared app");
  assert.ok(!/href: "\/(approvals|proposals)"/.test(needsSrc), "what needs you links to Company > Approvals");
}

const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
// slice 11: Crew split into Company > Departments (Cards / Chart / Edit) and Settings > Schedule
{
  assert.equal(deptView("chart"), "chart");
  assert.equal(deptView("edit"), "edit");
  assert.equal(deptView("schedule"), "cards", "an unknown view is Cards");
  assert.equal(deptViewHref("cards"), "/?tab=departments");
  assert.equal(deptViewHref("chart"), "/?tab=departments&view=chart");
  assert.equal(SCHEDULE_HREF, "/settings/schedule");
  const crewPage = read("app/(room)/crew/page.tsx"), layout = read("app/(room)/layout.tsx"), company = read("app/(room)/page.tsx");
  assert.ok(/redirect\(/.test(crewPage) && /SCHEDULE_HREF/.test(crewPage) && !/OrgCanvas|OrgDay|<nav/.test(crewPage), "/crew only sends old links on");
  assert.ok(!/href: "\/crew"/.test(layout) && /label: "Company"/.test(layout), "Crew left the menu");
  assert.ok(/<OrgChartPane f=\{f\} edit=\{dview === "edit"\}/.test(company) && /aria-label="Departments view"/.test(company), "Company > Departments has the Cards / Chart switch and the chart");
  assert.ok(/SCHEDULE_HREF\} className="dp-pill co-org"/.test(company) && /!f\.org\.on &&/.test(company), "an org that is off shows the Turn on pill");
  const sched = read("app/(room)/settings/schedule/page.tsx");
  for (const bit of ["<OrgSwitch", "<OrgDay", "<ChainsBoard"]) assert.ok(sched.includes(bit), `Settings > Schedule has ${bit}`);
  assert.ok(/slug: "schedule"/.test(read("dashboard/settings-sections.ts")), "Schedule is a Settings section");
  for (const f of [...walk("app"), ...walk("dashboard"), ...walk("core")].filter((x) => /\.tsx?$/.test(x) && !x.includes(join("crew", "page.tsx"))))
    assert.ok(!/["'`]\/crew(\b|\?|["'`])/.test(read(f)), `${f}: no link to /crew left`);
}

// slice 13: the old pages that only redirected are gone; an agent's lasting address and the newest moves stay
{
  for (const p of ["app/(room)/build/page.tsx", "app/(room)/build/[id]/page.tsx", "app/(room)/integrations/page.tsx", "app/(room)/access/page.tsx"])
    assert.ok(!existsSync(p), `${p} is gone`);
  for (const f of [...walk("app"), ...walk("dashboard"), ...walk("core")].filter((x) => /\.tsx?$/.test(x)))
    assert.ok(!/["'`]\/(build|integrations|access)(\/|\?|["'`])/.test(read(f)), `${f}: no link to a deleted page`);
  assert.ok(existsSync("app/(room)/agents/[id]/page.tsx"), "an agent's lasting address stays: results, lessons and the agent map link to it");
  for (const p of ["approvals", "proposals", "crew", "runs", "status"]) assert.ok(existsSync(`app/(room)/${p}/page.tsx`), `/${p} still sends this month's emails and bookmarks on`);
}

// agent cards: the name sits on its own line and the job title under it, as in the approved mockup
// (a <b> that stayed inline ran "MorganCFO" together on the Agents tab and Company page)
{
  const css = read("app/globals.css");
  assert.ok(/\.dp-nm b \{[^}]*display: block/.test(css), "an agent card's name is its own line");
  for (const f of ["app/(room)/dept/[id]/page.tsx", "app/(room)/page.tsx"])
    assert.ok(/className="dp-nm"><b>\{a\.name\}<\/b><span>/.test(read(f)), `${f}: name in <b>, title in the <span> after it`);
}
