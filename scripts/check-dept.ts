// Checks the department pages (docs/department-pages.md): the tab in the address, the red counts and
// who works in a department, on a small chart. No database, no network. Run: npm run check:dept
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEPT_TABS, deptAgentIds, deptTab, headAgentId, needsByDept, tabHref } from "../dashboard/dept-rules";
import { deptReach, headDirective } from "../core/head-chat-rules";
import { resolveRuleWho, deptNamed } from "../core/chat-rules";
import type { Org } from "../core/org-rules";
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

console.log("check:dept ok");
