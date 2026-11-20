// Memory follows the org chart (card 157): `npm run check:memory-reach`. Pure: no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { memoryReach, ownFilter, sharedIds, sharedLabel, type Reach } from "../core/memory-rules";
import { memoryBlock, type MemoryRow, type SharedLine } from "../core/memory";
import type { Department, Org, Seat } from "../core/org-rules";

const dept = (id: string, name: string): Department => ({ id, name, sort: 0, monthlyBudgetUsd: null, maxEmailsPerDay: null, leadChecksDrafts: false });
let n = 0;
const seat = (departmentId: string | null, parentId: string | null, agentId: string | null, holder: Seat["holder"] = agentId ? "agent" : "open"): Seat =>
  ({ id: `s${++n}`, departmentId, parentId, title: "t", sub: "", holder, agentId, sort: n });

// the chart: Avery (chief of staff); Finance: Morgan head, Quinn, Pat (a lead) with Lee under it;
// Sales: Rico head, Rowan; Coffee: an open head seat with Blair under it; Ops: a head held by the owner; Kit off the chart
const cos = seat(null, null, "avery");
const finH = seat("finance", null, "morgan");
const quinn = seat("finance", finH.id, "quinn");
const pat = seat("finance", finH.id, "pat");
const lee = seat("finance", pat.id, "lee");
const salH = seat("sales", null, "rico");
const rowan = seat("sales", salH.id, "rowan");
const cofH = seat("coffee", null, null);
const blair = seat("coffee", cofH.id, "blair");
const opsH = seat("ops", null, null, "owner");
const planned = seat("sales", salH.id, "ghost");
const org: Org = { departments: [dept("finance", "Finance"), dept("sales", "Sales"), dept("coffee", "Coffee"), dept("ops", "Ops")], seats: [cos, finH, quinn, pat, lee, salH, rowan, cofH, blair, opsH, planned] };
const live = new Set(["avery", "morgan", "quinn", "pat", "lee", "rico", "rowan", "blair", "kit"]);
const reach = (a: string) => memoryReach(org, a, live);
const ids = (r: Reach) => r.shared.map((s) => `${s.agentId}:${s.why}`);

// a narrow agent: its head first, then everyone else in its department (any depth); nothing else
assert.deepEqual(reach("quinn"), { level: "narrow", deptId: "finance", shared: [
  { agentId: "morgan", why: "your_head", deptId: "finance" }, { agentId: "pat", why: "your_department", deptId: "finance" }, { agentId: "lee", why: "your_department", deptId: "finance" },
] });
assert.deepEqual(ids(reach("lee")), ["morgan:your_head", "quinn:your_department", "pat:your_department"], "a lead's agent shares with its whole department");
// a head: its team, then the chief of staff and the other heads (leadership)
assert.deepEqual(ids(reach("morgan")), ["quinn:your_team", "pat:your_team", "lee:your_team", "avery:chief_of_staff", "rico:leadership"]);
assert.equal(reach("morgan").level, "head");
// the chief of staff: every head with an agent in it, nobody else
assert.deepEqual(reach("avery"), { level: "company", deptId: null, shared: [{ agentId: "morgan", why: "leadership", deptId: "finance" }, { agentId: "rico", why: "leadership", deptId: "sales" }] });
// an open or owner-held head seat shares nothing; a planned agent (not live) is left out
assert.deepEqual(ids(reach("blair")), [], "no head and nobody else in Coffee");
assert.deepEqual(ids(reach("rowan")), ["rico:your_head"], "a planned agent that doesn't exist is left out");
// off the chart, or no chart
assert.deepEqual(reach("kit"), { level: "off", deptId: null, shared: [] });
assert.deepEqual(memoryReach(null, "quinn", live), { level: "off", deptId: null, shared: [] });

// done when: an agent in one department never reaches another department's agents or rules
const deptOfAgent = Object.fromEntries(org.seats.filter((s) => s.agentId).map((s) => [s.agentId as string, s.departmentId]));
const heads = new Set(["morgan", "rico"]);
for (const a of live) {
  const r = reach(a);
  for (const s of r.shared) {
    assert.notEqual(s.agentId, a, `${a} doesn't read itself as shared`);
    const theirs = deptOfAgent[s.agentId];
    if (r.level === "narrow") {
      assert.equal(theirs, r.deptId, `${a} (narrow) reads only its own department, not ${s.agentId}`);
      assert.notEqual(s.agentId, "avery", `${a} (narrow) never reads the chief of staff`);
    }
    if (theirs && theirs !== r.deptId) assert.ok(heads.has(s.agentId) && (r.level === "head" || r.level === "company"), `${a} reads ${s.agentId} of another department only as leadership`);
  }
  assert.ok(r.deptId === null || r.deptId === deptOfAgent[a], `${a} loads only its own department's rules`);
}

// the filter for its own lines: own, rules for everyone, its department's rules; ids checked
assert.equal(ownFilter("quinn", "finance"), "agent_id.eq.quinn,grp.eq.crew,department_id.eq.finance");
assert.equal(ownFilter("avery", null), "agent_id.eq.avery,grp.eq.crew");
assert.equal(ownFilter("quinn", "finance),agent_id.neq.x"), "agent_id.eq.quinn,grp.eq.crew", "a bad department id is left out");
assert.throws(() => ownFilter("quinn,grp.eq.working", null), /Unknown agent/);
assert.deepEqual(sharedIds({ level: "head", deptId: "x", shared: [{ agentId: "a", why: "your_team", deptId: "x" }, { agentId: "a", why: "leadership", deptId: "y" }, { agentId: "Bad,id", why: "your_team", deptId: "x" }] }), ["a"]);
assert.equal(sharedLabel({ agentId: "rico", why: "leadership", deptId: "sales" }, "Rico", "Sales"), "Rico, a department head (Sales)");
assert.equal(sharedLabel({ agentId: "morgan", why: "your_head", deptId: "finance" }, "Morgan"), "Morgan, your head");

// shared lines are data: fenced off, labelled with who wrote them, never notes
const row = (p: Partial<MemoryRow>): MemoryRow => ({ id: "r", agent_id: "quinn", department_id: null, grp: "standing_order", text: "x", source: "owner", source_tag: null, notion_page_id: null, trust: "note", state: "kept", keep: "always", runs_left: null, expires_at: null, tokens: 1, created_at: "", updated_at: "", ...p });
const shared: SharedLine[] = [{ id: "w1", agentId: "morgan", label: "Morgan, your head", text: "Chasing the March receipts.", tokens: 8 }];
const block = memoryBlock([row({ text: "Plain words." })], [], shared);
const fenced = block.slice(block.indexOf("<data>"), block.indexOf("</data>"));
assert.ok(fenced.includes("What Morgan, your head is working on:\n- Chasing the March receipts."), "shared lines sit inside <data>");
assert.ok(block.indexOf("Plain words.") < block.indexOf("<data>"), "the agent's own notes come before data");
assert.ok(memoryBlock([], [], shared).includes("<data>"), "shared lines alone still make a block");
assert.equal(memoryBlock([], [], []), "");

// wiring: loadMemory and the Memory tab use the reach; shared lines trimmed first; ownedBy is gone
const mem = readFileSync("core/memory.ts", "utf8");
assert.doesNotMatch(mem, /ownedBy/, "the old filter is gone");
assert.match(mem, /memoryReach\(o, agentId, live\)/);
assert.match(mem, /other agents' working memory comes last and is the first thing left out/);
assert.match(mem, /\.eq\("grp", "working"\)\.eq\("state", "kept"\)\.in\("agent_id", ids\)/, "only working memory is shared, never another agent's standing orders or notes");
assert.doesNotMatch(readFileSync("dashboard/builder.ts", "utf8"), /grp\.eq\.crew\$\{/, "the builder uses ownFilter");

console.log("check:memory-reach ok");
