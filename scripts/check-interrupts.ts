// Only four things interrupt the founder (card 158): `npm run check:interrupts`. Pure: no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INTERRUPTS, INTERRUPT_WORDS, MONEY_TOOLS, interruptCounts, interruptKind, totalOf, type Source } from "../dashboard/needs-rules";
import { alerting, interruptCount, needs, split } from "../dashboard/needs";
import type { Floor } from "../dashboard/data";
import { GOAL_CHANGES, KIND_WORDS, PROPOSAL_KINDS, planProposal, proposalTitle, toolInfoOf, type ProposalPlan } from "../core/proposal-rules";
import { TOOLS } from "../core/tools/catalog";
import { deskLine } from "../dashboard/desk";

// every place something can want the owner maps to exactly one place: one of the four, or the summary
const later: Source[] = ["run_failed", "run_stuck", "budget", "database", "connection", "lesson", "photos", "job"].map((from) => ({ from }) as Source);
for (const s of later) assert.equal(interruptKind(s), null, `${s.from} waits for the summary`);
assert.equal(interruptKind({ from: "approval", tool: "gmail_draft_lead" }), "first_time", "every approval is a first time until card 7 promotes its action type");
assert.equal(interruptKind({ from: "approval", tool: "gmail_draft_lead", promoted: true }), null, "a promoted action type stops asking");
const money = new Set(["pay_vendor"]);
assert.equal(interruptKind({ from: "approval", tool: "pay_vendor", promoted: true }, money), "money", "money asks every time, however much trust it earned");
assert.equal(MONEY_TOOLS.size, 0, "no money tool is built yet");
for (const id of MONEY_TOOLS) assert.equal(TOOLS[id]?.kind, "action");
const want: Record<string, string | null> = { hire: "new_agent", department: "new_agent", goal: "goal", grant_tool: null, new_tool: null, retire: null, change_agent: null, move_agent: null };
for (const kind of [...PROPOSAL_KINDS, "department"]) {
  assert.ok(kind in want, `${kind} is decided here`);
  assert.equal(interruptKind({ from: "proposal", kind }), want[kind], `a ${kind} proposal`);
}
assert.deepEqual([...INTERRUPTS].sort(), ["first_time", "goal", "money", "new_agent"], "four kinds, no more");
assert.deepEqual(INTERRUPTS.map((k) => INTERRUPT_WORDS[k]), ["Spends money", "First time", "New agent", "Goal change"]);
const c = interruptCounts([{ from: "approval", tool: "a" }, { from: "proposal", kind: "goal" }, { from: "proposal", kind: "retire" }, { from: "lesson" }]);
assert.deepEqual(c, { first_time: 1, money: 0, new_agent: 0, goal: 1 });
assert.equal(totalOf(c), 2);

// needs() on a floor: nothing outside the four reaches Needs you, and the badge counts only them
const floor = {
  ok: true, now: Date.parse("2026-11-20T15:00:00Z"), agents: {}, runs: [], spentToday: {}, health: {}, photosWaiting: 2,
  approvalsPending: 3, proposalsPending: 4, approvalTools: ["gmail_draft_lead", "gmail_draft_lead", "mercury_propose_annotation"],
  proposalKinds: ["hire", "goal", "retire", "grant_tool"], jobsForYou: [{ planId: "p", head: null, title: "Taste the new lot", href: "/goals/x" }],
  lessonsWaiting: {}, grants: {}, liveVersion: {}, crew: [], byId: {},
} as unknown as Floor;
const all = needs(floor, floor.now);
const { now, later: wait } = split(all);
for (const x of now) assert.ok(x.interrupt && INTERRUPTS.includes(x.interrupt), `${x.title} is one of the four`);
for (const x of all) assert.equal(x.interrupt, interruptKind(x.source), `${x.title}: only interruptKind decides`);
assert.deepEqual(now.map((x) => [x.interrupt, x.title]), [["first_time", "3 approvals waiting for your OK"], ["new_agent", "1 new agent"], ["goal", "1 goal change"]]);
assert.deepEqual(wait.map((x) => x.title).sort(), ["2 charges need a receipt photo", "2 proposals to decide", "Taste the new lot"]);
assert.equal(interruptCount(all), 5, "3 approvals, a hire and a goal change");
assert.equal(interruptCount(needs({ ...floor, approvalTools: [], proposalKinds: ["retire"] } as Floor, floor.now)), 0, "a retirement alone interrupts no one");

// the goal-change proposal: pure checks here, the goal checks (measure, target, 3 goals, own department) on the server
const tools = toolInfoOf(TOOLS);
const why = "Wholesale is the bigger lever this quarter, per goal_progress.";
const ok = (i: Record<string, unknown>) => { const r = planProposal({ kind: "goal", why, ...i }, tools); if ("problem" in r) assert.fail(r.problem); return r.plan as Extract<ProposalPlan, { kind: "goal" }>; };
const no = (i: Record<string, unknown>, re: RegExp) => { const r = planProposal({ kind: "goal", why, ...i }, tools); assert.ok("problem" in r, JSON.stringify(i)); assert.match(r.problem, re); };
assert.deepEqual(GOAL_CHANGES, ["new", "change", "drop", "pause", "resume", "done"]);
const n = ok({ change: "new", title: "Land 5 wholesale accounts", measure: "wholesale_won", target: "5", due_on: "2027-03-31" });
assert.deepEqual(n, { kind: "goal", change: "new", goal: null, title: "Land 5 wholesale accounts", measure: "wholesale_won", target: "5", dueOn: "2027-03-31" });
assert.equal(proposalTitle(n), "New goal: Land 5 wholesale accounts");
assert.equal(proposalTitle(ok({ change: "change", goal: "Grow orders", target: "150" })), "Change goal: Grow orders");
const d = ok({ change: "drop", goal: "Grow orders", title: "ignored", target: "9" });
assert.deepEqual(d, { kind: "goal", change: "drop", goal: "Grow orders", title: null, measure: null, target: null, dueOn: null }, "a drop keeps nothing else");
assert.equal(proposalTitle(d), "Drop goal: Grow orders");
assert.equal(KIND_WORDS.goal, "Goal change");
no({ change: "grow" }, /change must be new, change, drop, pause, resume or done/);
no({ change: "new" }, /needs a title/);
no({ change: "drop" }, /name the goal to drop/);
no({ change: "change", goal: "Grow orders" }, /say what changes/);
no({ change: "new", title: "Grow orders", target: "100" }, /a target needs a measure/);
no({ change: "new", title: "See https://evil.example" }, /link/);
no({ change: "new", title: "Grow orders", due_on: "March" }, /due_on is a date/);

// the wiring: the server's checks, the tool, the Company page and the badge
const store = readFileSync("core/proposals.ts", "utf8");
assert.match(store, /const dept = seat\?\.departmentId \?\? deptId;/, "a head reaches only its own department");
assert.match(store, /open\.length >= MAX_GOALS_PER_DEPT/, "the 3-goal limit is checked when filed");
assert.match(store, /planGoal\(input, \(?await orgDate\(0\)\)?, await ownMeasureDefs\(\)\)/, "the measure and target pass the Goals page's checks");
assert.match(store, /const c = await goalCheck\(p, dept, p\.goalId \?\? null\);\s*if \("problem" in c\) throw/, "checked again at the owner's yes");
for (const f of ["createGoal(dept", "editGoal(c.goal!.id", "setGoalState(c.goal!.id, to)", "drop: \"dropped\", pause: \"paused\", resume: \"active\", done: \"done\""]) assert.ok(store.includes(f), `the yes goes through ${f}`);
const propose = TOOLS.propose.params.find((p) => p.name === "kind");
assert.ok(propose && propose.type === "enum" && propose.options.includes("goal"), "a head can propose a goal change");
const migration = readFileSync("supabase/migrations/20261222090000_goal_proposals.sql", "utf8");
assert.match(migration, /check \(kind in \('hire', 'grant_tool', 'new_tool', 'retire', 'department', 'goal'\)\)/);
const home = readFileSync("app/(room)/page.tsx", "utf8");
assert.match(home, /const \{ now: asks, later \} = split\(open\);/, "the Company page splits Needs you by interruptKind");
assert.match(home, /These can wait; \{chief\} rolls them into the next summary/);
assert.match(home, /const waiting = interruptCount\(open\);/, "the Company page's count is the same four as the bell and the menu");
assert.doesNotMatch(home, /proposals from your heads|x\.href !== "\/proposals"/, "the old mixed list is gone");
assert.match(readFileSync("app/(room)/layout.tsx", "utf8"), /const waiting = interruptCount\(open\);/, "the menu badge counts only the four");
assert.doesNotMatch(readFileSync("dashboard/needs.ts", "utf8"), /Mercury change|from your heads/);

// the Company page's day line counts the four, then what waits
assert.equal(deskLine(["on_track"], 2, 3, "Avery"), "One goal on track. Two things need you; three wait for Avery’s summary.");
assert.equal(deskLine([], 0, 0), "No goals set yet. Nothing needs you.");

// card 189: a fresh business isn't covered in red. "Connect a tool" never marks the frame; a failure still does.
{
  const n = (from: string) => ({ pri: "Medium", title: from, sub: "", href: "/", n: 1, interrupt: null, source: { from } }) as unknown as Parameters<typeof alerting>[0][number];
  assert.deepEqual(alerting([n("connection"), n("connection")]), [], "tools not connected yet put no red badge or bell dot");
  assert.equal(alerting([n("connection"), n("run_failed")]).length, 1, "a failed run still does");
  const layout = readFileSync("app/(room)/layout.tsx", "utf8"), conn = readFileSync("dashboard/connections.ts", "utf8"), page = readFileSync("app/(room)/connections/page.tsx", "utf8");
  assert.match(layout, /const red = alerting\(open\)/, "the bell's count is only what alerts (the agent badges went with the rail, slice 9)");
  assert.match(layout, /red\.length > 0 && <span className="hp-pip">/, "the bell's red count");
  assert.match(readFileSync("dashboard/header-rules.ts", "utf8"), /source\.from !== "connection"/, "the bell's list leaves out tools not connected yet");
  assert.doesNotMatch(layout, /to fix/, "the sidebar never calls an unconnected tool something to fix");
  assert.match(conn, /usersOf\(c\.id, grants\)\.length > 0\)\.length;\s*return n \? `\$\{n\} to connect`/, "it counts only tools an agent uses, as to connect");
  assert.doesNotMatch(/function Status[\s\S]*?\n\}/.exec(page)?.[0] ?? "", /--red/, "Not set up is grey on Connections, not red");
}

console.log("check:interrupts ok");
