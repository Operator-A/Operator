// The top bar (docs/department-pages.md, slice 9): `npm run check:header`.
// 1. Rules: what the working pill says, which runs it lists and where each opens, and what the bell lists.
// 2. Source: the layout draws the three drop-downs and none of what they replaced (the agent rail, the date
//    pill, the Everyone link), Sign out sits in your initial's menu, and Everyone is gone.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { BELL_MAX, bellRows, liveRows, minsWord, workingWord } from "../dashboard/header-rules";
import type { Org } from "../core/org-rules";

assert.equal(workingWord(0), "All quiet");
assert.equal(workingWord(1), "1 working");
assert.equal(workingWord(3), "3 working");
assert.equal(minsWord(0), "just now");
assert.equal(minsWord(4), "4 min");
assert.equal(minsWord(75), "1 hr");

const org: Org = {
  departments: [
    { id: "finance", name: "Finance", sort: 1, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false },
    { id: "sales", name: "Sales", sort: 2, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false },
  ],
  seats: [
    { id: "c", departmentId: null, parentId: null, title: "Chief of Staff", sub: "", holder: "agent", agentId: "avery", sort: 0 },
    { id: "f", departmentId: "finance", parentId: null, title: "CFO", sub: "", holder: "agent", agentId: "morgan", sort: 0 },
    { id: "s", departmentId: "sales", parentId: null, title: "Rep", sub: "", holder: "agent", agentId: "rico", sort: 0 },
  ],
} as unknown as Org;
const byId = { avery: { name: "Avery", role: "Chief of staff" }, morgan: { name: "Morgan", role: "CFO" }, rico: { name: "Rico", role: "Rep" }, gone: undefined };
const now = Date.parse("2026-11-23T20:00:00Z");
const ago = (m: number) => new Date(now - m * 6e4).toISOString();
const rows = liveRows([
  { id: "r1", agent_id: "morgan", status: "running", started_at: ago(2) },
  { id: "r2", agent_id: "avery", status: "running", started_at: ago(0.2) },
  { id: "r3", agent_id: "rico", status: "ok", started_at: ago(1) },        // finished: not working
  { id: "r4", agent_id: "rico", status: "running", started_at: ago(9) },   // stuck past 6 minutes: not counted
  { id: "r5", agent_id: "gone", status: "running", started_at: ago(1) },   // no longer on the crew
], byId, org, now);
assert.deepEqual(rows.map((r) => r.id), ["r2", "r1"], "only live runs of agents on the crew, newest first");
assert.equal(rows[1].href, "/dept/finance", "a run in a department opens that department's chat, where its checklist posts");
assert.equal(rows[1].dept, "Finance");
assert.ok(rows[1].hue, "it carries its department's colour");
assert.equal(rows[1].mins, 2);
assert.equal(rows[0].href, "/?tab=departments&agent=avery", "an agent in no department opens its sheet on Company > Departments");
assert.equal(rows[0].dept, null);
assert.deepEqual(liveRows([{ id: "x", agent_id: "morgan", status: "running", started_at: ago(1) }], byId, null, now)[0].href, "/?tab=departments&agent=morgan", "no chart: the sheet on Company");

const need = (title: string, interrupt: string | null, from = "approval") => ({ title, sub: "", href: `/${title}`, interrupt, source: { from } });
const bell = bellRows([need("later", null, "job"), need("connect", null, "connection"), need("hire", "new_agent", "proposal"), need("first", "first_time")]);
assert.deepEqual(bell.rows.map((r) => r.title), ["hire", "first", "later"], "interrupting kinds first; connecting a tool is setup, never on the bell");
assert.deepEqual(bell.rows.map((r) => r.red), [true, true, false], "only the interrupting kinds are marked red");
const many = bellRows(Array.from({ length: BELL_MAX + 3 }, (_, i) => need(`n${i}`, null, "job")));
assert.equal(many.rows.length, BELL_MAX);
assert.equal(many.more, 3, "the rest are counted, not dropped silently");

const read = (p: string) => readFileSync(p, "utf8");
const layout = read("app/(room)/layout.tsx"), client = read("dashboard/components/client.tsx"), css = read("app/globals.css");
const top = layout.slice(layout.indexOf('<header className="topbar">'), layout.indexOf("</header>"));
assert.equal((top.match(/<HeaderPop /g) ?? []).length, 3, "the top bar has three drop-downs: working, bell, your initial");
assert.ok(/liveRows\(floor\.runs, floor\.byId, org, floor\.now\)/.test(layout) && /bellRows\(open\)/.test(layout), "the pill and the bell read the same floor as the page");
assert.ok(/workingWord\(live\.length\)/.test(top), "the pill says how many are working");
assert.ok(/companyHref\("approvals"\)/.test(top), "the bell links to Company > Approvals");
assert.ok(/<SignOutButton look="menu" \/>/.test(top) && /<ThemeToggle initial=\{theme\} wide \/>/.test(top), "your initial's menu has light or dark and Sign out");
assert.ok(!/RailLink|className="rail"|date-pill|\/everyone|longDay/.test(layout), "no agent rail, no date pill, no Everyone link");
assert.ok(!/export function RailLink/.test(client) && /export function HeaderPop/.test(client), "RailLink is gone; HeaderPop replaces it");
assert.ok(!/^\.(rail|rail-item|rail-av|rail-dot|date-pill|me|badge) /m.test(css), "the rail, date pill and old initial styles are gone");
assert.ok(/^\.hp-pop \{/m.test(css) && /prefers-reduced-motion: reduce\) \{ \.hp-pulse/.test(css), "the drop-down is styled and holds still when motion is reduced");
assert.ok(!existsSync("app/(room)/everyone/page.tsx"), "Everyone is gone: the bell's drop-down and Company > Departments replace it");
const phoneMenu = layout.slice(layout.indexOf("<MobileMenu"), layout.indexOf("</MobileMenu>"));
assert.ok(/<SignOutButton \/>/.test(phoneMenu), "on phones Sign out stays at the bottom of the menu");

console.log("check:header ok");
