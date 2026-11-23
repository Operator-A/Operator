// Checks the department pages (docs/department-pages.md): the tab in the address, the red counts and
// who works in a department, on a small chart. No database, no network. Run: npm run check:dept
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deptAgentIds, deptTab, headAgentId, needsByDept } from "../dashboard/dept-rules";
import type { Org } from "../core/org-rules";

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

// tabs: only the ones built, anything else opens Agents
assert.equal(deptTab("goals"), "goals");
assert.equal(deptTab("approvals"), "approvals");
assert.equal(deptTab(undefined), "agents");
assert.equal(deptTab("chat"), "agents", "Chat isn't built yet (slice 2), so it opens Agents");
assert.equal(deptTab("<script>"), "agents");

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

// wiring: the menu, the page and Everyone use these counts, and the page and the Approvals page draw one card
const read = (p: string) => readFileSync(p, "utf8");
const layout = read("app/(room)/layout.tsx"), page = read("app/(room)/dept/[id]/page.tsx"), approvals = read("app/(room)/approvals/page.tsx"), everyone = read("app/(room)/everyone/page.tsx");
assert.ok(/needsByDept\(/.test(layout) && /href: `\/dept\/\$\{d\.id\}`/.test(layout), "the side menu lists each department with its red count");
assert.ok(/href="\/everyone"/.test(layout), "the bell opens Everyone");
assert.ok(/needsByDept\(/.test(page) && /needsByDept\(/.test(everyone), "the page and Everyone count with needsByDept");
assert.ok(/<ApprovalCard /.test(page) && /<ApprovalCard /.test(approvals), "a department's Approvals tab and the Approvals page draw the same card");
assert.ok(!/approve\.bind/.test(page) && !/approve\.bind/.test(approvals), "only ApprovalCard binds Approve, so approving is one path");
assert.ok(!/opened\.goals|opened\.rules|<Feed runs=\{d\.runs\.filter\(\(r\) => ids/.test(read("dashboard/components/OrgCanvas.tsx")), "the Crew canvas no longer has its own department panel");

console.log("check:dept ok");
