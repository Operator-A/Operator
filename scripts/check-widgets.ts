// The department widget grid (core/widget-rules.ts, dashboard/components/widgetGrid.tsx, docs/packs.md, packs slice 2).
// Run: npm run check:widgets. Pure: no database, no network.
// A layout names only core's widgets with their own settings, fits 3 columns a row, and an agent number names only an
// agent seated in its department; a layout that fails falls back to the default Overview; the new widgets' numbers
// are worked out in code (gaps stay gaps, changes need something to compare); the page reads only what its widgets
// show, from saved rows only, and a department with no layout keeps the default Overview.
import assert from "node:assert/strict";
import { DEFAULT_LAYOUT, MANY_KINDS, WIDGET_ABOUT, add, blockWords, catalog, flatten, flow, fresh, keyWords, layoutSource, metricKeys, move, packLayoutHere, remove, replace, resize, toSave } from "../core/layout-edit-rules";
import { readFileSync } from "node:fs";
import {
  WIDGETS, layoutProblems, monthTile, packFrom, readLayout, readingTile, runMetric, seriesBars, spanOf, widgetNeeds, metricWord, pctWord,
  type Layout, type SnapRow,
} from "../core/widget-rules";
import { crewProblems, installRows } from "../core/install-rules";
import { mergePacks, type DepartmentPack } from "../core/pack-rules";
import { DEPT_PACKS } from "../core/packs";

const read = (f: string) => readFileSync(f, "utf8");

// ---- layouts: only core's widgets, each with its own settings, 1 to 3 per row in 3 columns
const good: Layout = [
  [{ w: "needs" }],
  [{ w: "report" }, { w: "measure_tile", measure: "revenue_month" }],
  [{ w: "goal_tile" }, { w: "run_metric", agent: "head", key: "now_sessions", label: "Sessions" }, { w: "measure_tile", measure: "runway_months", label: "Runway" }],
  [{ w: "series_chart", field: "orders", days: 90, span: 2 }, { w: "spend" }],
  [{ w: "agents" }],
];
assert.deepEqual(layoutProblems(good), []);
assert.deepEqual(layoutProblems(good, ["head"]), []);
assert.deepEqual(readLayout(good), good);
assert.equal(spanOf({ w: "needs" }), 3);
assert.equal(spanOf({ w: "report" }), 2);
assert.equal(spanOf({ w: "drafts" }), 1);
assert.equal(spanOf({ w: "agents", span: 1 }), 1);
const bad = (raw: unknown, re: RegExp, agents?: string[]) => {
  const p = layoutProblems(raw, agents);
  assert.ok(p.some((x) => re.test(x)), `expected ${re} in ${JSON.stringify(p)}`);
  if (!agents) assert.equal(readLayout(raw), null, "a layout with a problem falls back to the default Overview");
};
bad({}, /a list of rows/);
bad([], /1 to 12 rows/);
bad(Array.from({ length: 13 }, () => [{ w: "measure_tile", measure: "orders_month" }]), /1 to 12 rows/);
bad([[]], /1 to 3 widgets/);
bad([[{ w: "drafts" }, { w: "drafts" }]], /drafts shows once/);
bad([[{ w: "drafts" }, { w: "spend" }, { w: "runs_chart" }, { w: "week_tile" }]], /1 to 3 widgets/);
bad([[{ w: "report" }, { w: "spend", span: 2 }]], /4 of 3 columns/);
bad([[{ w: "needs" }, { w: "spend" }]], /4 of 3 columns/);
bad([[{ w: "custom_html", html: "<script>" }]], /each widget is one of/);
bad([[{ w: "spend", query: "select * from members" }]], /spend has no field query/);
bad([[{ w: "spend", span: 4 }]], /span is 1, 2 or 3/);
bad([[{ w: "measure_tile", measure: "n_secret" }]], /measure_tile measure is one of/);
bad([[{ w: "measure_tile", measure: "revenue_month", label: "x".repeat(41) }]], /label is 1 to 40/);
bad([[{ w: "series_chart", field: "margin" }]], /series_chart field/);
bad([[{ w: "series_chart", field: "revenue", days: 365 }]], /14, 30 or 90/);
bad([[{ w: "run_metric", agent: "Bad Id", key: "x", label: "X" }]], /agent is an agent id/);
bad([[{ w: "run_metric", agent: "other", key: "x", label: "X" }]], /isn't one of this department's agents/, ["head"]);
bad([[{ w: "run_metric", agent: "head", key: "DROP TABLE", label: "X" }]], /key is a number's name/);
bad([[{ w: "run_metric", agent: "head", key: "x" }]], /label is 1 to 40/);
bad([[{ w: "run_metric", agent: "head", key: "x", label: "X", unit: "btc" }]], /unit is one of/);
bad(Array.from({ length: 9 }, () => [{ w: "measure_tile", measure: "orders_month" }, { w: "measure_tile", measure: "orders_month" }, { w: "measure_tile", measure: "orders_month" }]), /at most 24 widgets/);
assert.equal(readLayout(null), null);
assert.equal(readLayout(undefined), null);
assert.equal(WIDGETS.length, new Set(WIDGETS).size);

// ---- the page reads only what its widgets show; no layout reads everything the default Overview always did
assert.deepEqual([...widgetNeeds(null)].sort(), ["cards", "chains", "claude", "reports", "trust"]);
assert.deepEqual([...widgetNeeds([[{ w: "measure_tile", measure: "orders_month" }]])], []);
assert.deepEqual([...widgetNeeds([[{ w: "report" }, { w: "drafts" }]])].sort(), ["cards", "reports", "trust"]);
assert.deepEqual([...widgetNeeds([[{ w: "agents" }]])], ["claude"]);

// ---- the pack a department came from
assert.deepEqual(packFrom("store-analytics@1"), { id: "store-analytics", version: 1 });
for (const x of [null, "", "store-analytics", "Store@1", "a@1", "x@y", 3]) assert.equal(packFrom(x), null);

// ---- a number tile from the saved daily numbers: this month so far against the same days last month
const snap = (date: string, revenue: number, orders = 1, cash_usd: number | null = null): SnapRow => ({ date, revenue, orders, cash_usd });
const snaps = [snap("2026-10-01", 100, 2), snap("2026-10-02", 100, 2), snap("2026-10-03", 500, 9), snap("2026-11-01", 120, 3), snap("2026-11-02", 110, 1)];
let t = monthTile(snaps, "revenue", "2026-11-02");
assert.equal(t.value, "$230");
assert.equal(t.change, 0.15, "230 against 200 on Oct 1 and 2, not the whole of October");
assert.equal(t.changeWord, "+15%");
assert.match(t.sub, /same days last month/);
t = monthTile(snaps, "orders", "2026-11-05");
assert.equal(t.value, "4");
assert.equal(t.change, 0, "Nov 1-2 against Oct 1-2: the latest saved day decides the range");
assert.equal(t.changeWord, "No change");
assert.match(monthTile([snap("2026-11-01", 50), snap("2026-11-03", 50)], "revenue", "2026-11-03").sub, /1 day not saved/);
assert.equal(monthTile([snap("2026-11-01", 50)], "revenue", "2026-11-01").change, null, "no saved days last month: no change, never a guess");
assert.equal(monthTile([], "revenue", "2026-11-01").empty, true);
assert.equal(monthTile([snap("2026-12-31", 9)], "revenue", "2026-11-30").empty, true, "a day after today isn't this month so far");
// March 30 against February: February ends on the 28th
assert.equal(monthTile([snap("2027-03-30", 300), snap("2027-02-28", 100)], "revenue", "2027-03-30").change, 2);

// ---- a number tile from a goal's saved readings: the newest against the one nearest a week before it
let rt = readingTile([{ day: "2026-11-20", value: 4 }, { day: "2026-11-27", value: 5 }, { day: "2026-11-25", value: 4.8 }], "months", "2026-11-28");
assert.equal(rt.value, "5 months");
assert.equal(rt.change, 0.25);
assert.match(rt.sub, /as of 11\/27/);
rt = readingTile([{ day: "2026-11-27", value: 5 }, { day: "2026-11-26", value: 4 }], "count", "2026-11-27");
assert.equal(rt.change, null, "a reading 1 day before isn't a week before");
assert.equal(readingTile([], "count", "2026-11-27").empty, true);
assert.equal(readingTile([{ day: "2026-11-20", value: 0 }, { day: "2026-11-27", value: 5 }], "count", "2026-11-27").change, null, "no share of zero");

// ---- a daily chart: a day with nothing saved is a gap, never 0
const sb = seriesBars([snap("2026-11-26", 200), snap("2026-11-28", 50), snap("2026-11-27", 0), snap("2026-10-01", 999)], "revenue", 14, "2026-11-28");
assert.equal(sb.bars.length, 14);
assert.equal(sb.bars[0].day, "2026-11-15");
assert.equal(sb.bars[13].day, "2026-11-28");
assert.equal(sb.saved, 3);
assert.equal(sb.top, 200, "days outside the window don't set the scale");
assert.deepEqual(sb.bars.slice(11).map((b) => [b.value, b.pct]), [[200, 100], [0, 0], [50, 25]]);
assert.equal(sb.bars[0].value, null);
assert.equal(seriesBars([snap("2026-11-28", 1), snap("2026-11-27", 1000)], "revenue", 14, "2026-11-28").bars[13].pct, 4, "a small day still shows");
const cash = seriesBars([snap("2026-11-28", 1, 1, null), snap("2026-11-27", 1, 1, 5000)], "cash_usd", 14, "2026-11-28");
assert.equal(cash.bars[13].value, null, "no cash reading that day is a gap");
assert.equal(cash.saved, 1);
// across a daylight-saving change the days stay whole
assert.deepEqual(seriesBars([], "orders", 3, "2026-11-02").bars.map((b) => b.day), ["2026-10-31", "2026-11-01", "2026-11-02"]);
assert.equal(seriesBars([], "orders", 90, "2026-11-28").bars.length, 90);

// ---- an agent number: from the agent's runs, newest first as read; runs without it are skipped
const runs = [{ metrics: { now_sessions: 4180 } }, { metrics: { other: 1 } }, { metrics: { now_sessions: 3800 } }, { metrics: null }, { metrics: { now_sessions: "9" } }, { metrics: { now_sessions: 3100 } }];
let m = runMetric(runs, "now_sessions", "count");
assert.equal(m.value, "4,180");
assert.equal(m.runs, 3);
assert.equal(m.changeWord, "+10%");
assert.equal(m.up, true);
assert.equal(m.points.length, 3);
assert.deepEqual(m.points[0], { x: 8, y: 42 }, "the lowest is at the bottom, oldest on the left");
assert.deepEqual(m.points[2], { x: 292, y: 6 }, "the newest is at the right and the highest at the top");
m = runMetric([{ metrics: { conv: 0.021 } }, { metrics: { conv: 0.024 } }], "conv", "pct");
assert.equal(m.value, "2.1%");
assert.equal(m.changeWord, "−0.3 pts");
assert.equal(m.up, false);
assert.equal(runMetric([{ metrics: { k: 5 } }, { metrics: { k: 5 } }], "k", "count").changeWord, "No change");
assert.equal(runMetric([{ metrics: { k: 5 } }], "k", "count").points.length, 0, "one run draws no line");
assert.equal(runMetric([], "k", "count").value, null);
assert.equal(runMetric(Array.from({ length: 20 }, (_, i) => ({ metrics: { k: i } })), "k", "count").runs, 7);
assert.equal(runMetric([{ metrics: { k: Infinity } }], "k", "count").value, null);
assert.equal(metricWord(12.345, "rate"), "12.35");
assert.equal(metricWord(1234.5, "usd"), "$1,235");
assert.equal(pctWord(-0.034), "−3%");

// ---- packs: the built-in layouts pass, and install saves them with the pack they came from
for (const p of DEPT_PACKS) for (const d of p.departments) {
  if (d.overview == null) continue;
  const mine = p.seats.filter((s) => s.department === d.id && s.agent).map((s) => s.agent!);
  assert.deepEqual(layoutProblems(d.overview, mine), [], `${p.id} ${d.id}: its overview passes`);
}
const store = DEPT_PACKS.find((p) => p.id === "store-analytics")!;
assert.ok(store.departments[0].overview, "the store analytics pack lays out its Overview");
const rows = installRows("store-analytics", mergePacks([store]), () => "id");
assert.deepEqual(rows.departments[0].overview, store.departments[0].overview);
assert.equal(rows.departments[0].pack, `store-analytics@${store.version}`);
const finance = DEPT_PACKS.find((p) => p.id === "finance")!;
assert.equal(installRows("finance", mergePacks([finance]), () => "id").departments[0].overview, null, "a pack with no layout keeps the default Overview");
// a pack's layout can't name another pack's agent, or a widget core doesn't have
const sneaky = JSON.parse(JSON.stringify(store)) as DepartmentPack;
sneaky.departments[0].overview = [[{ w: "run_metric", agent: "cfo", key: "cash_usd", label: "Cash" }]];
assert.ok(crewProblems(mergePacks([sneaky])).some((x) => /isn't one of this department's agents/.test(x)));
sneaky.departments[0].overview = [[{ w: "iframe", src: "https://example.com" }]];
assert.ok(crewProblems(mergePacks([sneaky])).some((x) => /each widget is one of/.test(x)));
assert.throws(() => installRows("x", mergePacks([sneaky])), /can't be installed/);

// ---- wiring: the page reads the layout in its one parallel round, gates reads by the widgets, and keeps the default
const page = read("app/(room)/dept/[id]/page.tsx");
assert.match(page, /Promise\.all\(\[monthSpendByAgent[^\n]*deptLayout\(id\)/, "the layout is read with the spend, not after it");
assert.match(page, /const need = widgetNeeds\(layout\)/);
assert.match(page, /if \(layout\) return <WidgetGrid/);
assert.match(page, /return <Overview d=\{d\}/, "no layout: the default Overview");
const data = read("dashboard/widgets.ts");
assert.match(data, /^import "server-only";/);
for (const live of ["integrations/", "ordersBetween", "readMeasures", "callMcpTool", "fetch("]) assert.ok(!data.includes(live), `widgets read saved rows only (no ${live})`);
assert.equal((data.match(/= cache\(/g) ?? []).length, 3, "every shared read happens once per request");
const grid = read("dashboard/components/widgetGrid.tsx");
assert.ok(!/^"use client"/.test(grid), "the grid draws on the server");
for (const w of ["measure_tile", "series_chart", "run_metric"]) assert.match(grid, new RegExp(`case "${w}": return <Suspense`), `${w} streams in its own frame`);
for (const w of WIDGETS) assert.match(grid, new RegExp(`case "${w}"`), `the grid draws ${w}`);
assert.ok(!grid.includes("dangerouslySetInnerHTML"));
const mig = read("supabase/migrations/20270114090000_department_overview.sql");
assert.match(mig, /add column if not exists overview jsonb/);
assert.match(mig, /pg_column_size\(overview\) <= 8192/);
assert.match(mig, /add column if not exists pack text/);
assert.match(read("core/install.ts"), /k !== "overview" && k !== "pack"/, "installs work before the migration");
assert.match(read("docs/packs.md"), /## The Overview/);

// ---- Editing a department's Overview (packs slice 5, core/layout-edit-rules.ts) ----
{
  // the usual Overview as widgets passes the same check a pack's layout does, and covers every show-once widget
  assert.deepEqual(layoutProblems(DEFAULT_LAYOUT, []), []);
  const once = WIDGETS.filter((w) => !MANY_KINDS.includes(w));
  assert.deepEqual([...new Set(flatten(DEFAULT_LAYOUT).map((x) => x.w))].sort(), [...once].sort(), "editing a department with no layout starts from the usual page");
  assert.deepEqual(flow(flatten(DEFAULT_LAYOUT)), DEFAULT_LAYOUT, "the usual page flows back into its own rows");
  for (const w of WIDGETS) assert.ok(WIDGET_ABOUT[w], `${w} has a line in the catalog`);

  // rows fill three columns in order, at most three widgets a row, so nothing leaves a gap
  const ones = Array.from({ length: 7 }, () => ({ w: "measure_tile" as const, measure: "revenue_month" }));
  assert.deepEqual(flow(ones).map((r) => r.length), [3, 3, 1]);
  assert.deepEqual(flow([{ w: "report" }, { w: "report" }, { w: "week_tile" }]).map((r) => r.length), [1, 2], "a two-thirds widget that doesn't fit starts a row");
  assert.deepEqual(flow([{ w: "needs" }, { w: "week_tile" }]).map((r) => r.length), [1, 1], "a full row holds one");
  assert.deepEqual(flow([]), []);

  // move, width, remove, add, replace never change the list they're given
  const xs = flatten(DEFAULT_LAYOUT);
  const before = JSON.stringify(xs);
  assert.deepEqual(move(xs, 1, -1).slice(0, 2).map((x) => x.w), ["report", "needs"]);
  assert.deepEqual(move(xs, 0, -1), xs, "the first can't move earlier");
  assert.deepEqual(move(xs, xs.length - 1, 1), xs, "the last can't move later");
  assert.equal(resize(xs, 2, 3)[2].span, 3);
  assert.equal(remove(xs, 0).length, xs.length - 1);
  assert.equal(add(xs, { w: "needs" }).length, xs.length, "a show-once widget already on the page is refused");
  assert.equal(add(remove(xs, 0), { w: "needs" }).at(-1)!.w, "needs", "a new widget goes at the end");
  assert.equal(add(xs, { w: "series_chart", field: "orders", days: 14 }).length, xs.length + 1, "widgets with settings can be on the page more than once");
  assert.equal(add(Array.from({ length: 24 }, () => ({ w: "measure_tile" as const })), { w: "measure_tile" }).length, 24, "at most 24 widgets");
  assert.equal(replace(xs, 0, { w: "chains" })[0].w, "chains");
  assert.equal(JSON.stringify(xs), before);

  // the catalog greys out what shows once and is on the page
  const cat = catalog([{ w: "needs" }, { w: "series_chart" }]);
  assert.equal(cat.length, WIDGETS.length);
  assert.equal(cat.find((c) => c.w === "needs")!.used, true);
  assert.equal(cat.find((c) => c.w === "series_chart")!.used, false);
  assert.equal(cat.find((c) => c.w === "report")!.used, false);

  // a new widget with settings starts from something that saves
  const ag = [{ id: "analytics_head", name: "Iris", keys: ["visits_7d"] }];
  assert.deepEqual(fresh("series_chart", ag), { w: "series_chart", field: "revenue", days: 30 });
  assert.deepEqual(fresh("run_metric", ag), { w: "run_metric", agent: "analytics_head", key: "visits_7d", label: "Visits 7d" });
  assert.equal(fresh("measure_tile", ag).w, "measure_tile");
  assert.deepEqual(fresh("report", ag), { w: "report" });
  assert.equal(fresh("run_metric", []).agent, "", "no agents: an agent number can't save until one is picked");
  assert.equal(keyWords("now_sessions"), "Now sessions");
  assert.equal(blockWords({ w: "run_metric", agent: "x", key: "k", label: "Visits" }, {}).sub, "Agent number · an agent not in this department");
  assert.equal(blockWords({ w: "series_chart", field: "orders", days: 90 }, {}).name, "Orders per day, 90 days");

  // saving: an empty page or null is the usual Overview; fields a kind doesn't take are dropped; the pack check refuses the rest
  assert.deepEqual(toSave(null, []), { layout: null, problems: [] });
  assert.deepEqual(toSave([], []), { layout: null, problems: [] });
  const sneaky = toSave([{ w: "report", span: 2, label: "x", agent: "y" } as never, { w: "measure_tile", measure: "revenue_month", label: "  Sales  ", field: "orders" } as never], []);
  assert.deepEqual(sneaky.layout, [[{ w: "report", span: 2 }, { w: "measure_tile", measure: "revenue_month", label: "Sales" }]]);
  assert.deepEqual(sneaky.problems, []);
  assert.ok(toSave([{ w: "run_metric", agent: "elsewhere", key: "k", label: "K" }], ["analytics_head"]).problems.length, "an agent number from another department is refused");
  assert.deepEqual(toSave([{ w: "run_metric", agent: "analytics_head", key: "visits_7d", label: "Visits" }], ["analytics_head"]).problems, []);
  assert.ok(toSave([{ w: "nope" } as never], []).problems.length, "only core's widgets");
  assert.ok(toSave([{ w: "needs" }, { w: "needs" }], []).problems.length, "a show-once widget twice is refused");

  // the keys an agent's last runs saved: numbers only, most recent first, no repeats
  assert.deepEqual(metricKeys([{ metrics: { visits_7d: 4180, note: "x", Bad: 1 } }, { metrics: { conversion_pct: 0.024, visits_7d: 3900 } }, { metrics: null }, { metrics: [1] }]), ["visits_7d", "conversion_pct"]);

  // where the layout came from
  const packL: Layout = [[{ w: "needs" }], [{ w: "report" }, { w: "week_tile" }]];
  assert.equal(layoutSource(null, { name: "Store analytics", layout: packL }, null, "a@b.c"), "The usual Overview");
  assert.equal(layoutSource(packL, { name: "Store analytics", layout: packL }, { by: "a@b.c", at: "2026-11-28T10:00:00Z" }, "a@b.c"), "Laid out by the Store analytics pack");
  assert.equal(layoutSource([[{ w: "needs" }]], { name: "Store analytics", layout: packL }, { by: "A@b.c", at: "2026-11-28T10:00:00Z" }, "a@b.c"), "Laid out by you, Nov 28");
  assert.equal(layoutSource([[{ w: "needs" }]], null, { by: "sam@b.c", at: "2026-11-28T10:00:00Z" }, "a@b.c"), "Laid out by sam@b.c, Nov 28");
  assert.equal(layoutSource([[{ w: "needs" }]], null, null, "a@b.c"), "Your own layout");

  // a pack's layout here: its agent numbers follow to this department's agents; one whose agent isn't here is left out
  const raw = [[{ w: "report", span: 2 }, { w: "run_metric", agent: "analytics_head", key: "visits_7d", label: "Visits" }], [{ w: "run_metric", agent: "site_conversion", key: "c", label: "C" }]];
  assert.deepEqual(packLayoutHere(raw, new Map([["analytics_head", "iris"]])), [[{ w: "report", span: 2 }, { w: "run_metric", agent: "iris", key: "visits_7d", label: "Visits" }]]);
  assert.equal(packLayoutHere("nope", new Map()), null);
}
const editor = read("dashboard/components/layoutEditor.tsx");
assert.match(editor, /^"use client"/);
assert.ok(!editor.includes("router.refresh"), "no refresh after saving (check:speed)");
assert.ok(!editor.includes("dangerouslySetInnerHTML"));
const actions = read("dashboard/packActions.ts");
const saveFn = actions.slice(actions.indexOf("export async function saveLayout"));
assert.match(saveFn, /^export async function saveLayout[^{]+\{\n\s+const \{ me, no \} = await asRole\("approver"\); if \(no\) return no;/, "saving a layout is for the owner and approvers, checked first");
assert.match(saveFn, /toSave\(items, agents\)/, "saved through the same check as a pack's layout, with this department's agents");
assert.match(saveFn, /audit\(me, "edit_layout"/, "every save is in the audit log");
const deptPage = read("app/(room)/dept/[id]/page.tsx");
assert.match(deptPage, /editing=\{tab === "overview" && sp\.layout === "edit" && me\.role !== "viewer"\}/, "only the owner and approvers edit");
assert.match(deptPage, /canEdit=\{me\.role !== "viewer"\}/, "only the owner and approvers see Edit layout");

console.log("check:widgets ok");
