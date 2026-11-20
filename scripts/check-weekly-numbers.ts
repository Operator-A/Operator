// Week over week (card 159): `npm run check:weekly-numbers`. Pure: no database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { change, shift, weekNumbers, weekOverWeek, type DayRow, type VisitDay } from "../core/weekly-numbers-rules";

const Y = "2026-11-19";
assert.equal(shift(Y, -6), "2026-11-13");
assert.equal(shift("2026-03-01", -1), "2026-02-28");
const row = (date: string, p: Partial<DayRow> = {}): DayRow => ({ date, revenue: 100, orders: 4, repeat_rate: 0.25, cost_of_goods: 40, margin: 0.6, ...p });
const days = (from: number, to: number, p: Partial<DayRow> = {}) => Array.from({ length: to - from + 1 }, (_, i) => row(shift(Y, -(from + i)), p));

// a full fortnight: last week 7 × $150 over 5 orders a day; the week before 7 × $100 over 4
const rows = [...days(0, 6, { revenue: 150, orders: 5, repeat_rate: 0.4, cost_of_goods: 45 }), ...days(7, 13)];
const visits: VisitDay[] = [...Array.from({ length: 7 }, (_, i) => ({ date: shift(Y, -i), sessions: 200, key_events: 10 })), ...Array.from({ length: 7 }, (_, i) => ({ date: shift(Y, -7 - i), sessions: 100, key_events: 4 }))];
const w = weekOverWeek(rows, visits, Y);
assert.deepEqual([w.now.from, w.now.to, w.before.from, w.before.to], ["2026-11-13", Y, "2026-11-06", "2026-11-12"]);
assert.equal(w.now.revenue, 1050);
assert.equal(w.before.revenue, 700);
assert.equal(w.now.orders, 35);
assert.equal(w.now.aov, 30);
assert.equal(w.before.aov, 25);
assert.equal(w.now.repeat_rate, 0.4);
assert.equal(w.now.margin, 0.7, "margin from cost and revenue, not an average of the days' margins");
assert.equal(w.now.key_events_per_100_sessions, 5);
const line = (k: string) => w.lines.find((l) => l.key === k)!;
assert.equal(line("revenue").change, 0.5, "a share for money");
assert.equal(line("orders").change, 0.25);
assert.equal(line("repeat_rate").change, 0.15, "points for a rate");
assert.equal(line("sessions").change, 1);
assert.equal(line("key_events_per_100_sessions").change, 1, "5 − 4 per 100");
assert.deepEqual(w.missing, []);
const n = weekNumbers(w);
assert.equal(n.now_revenue, 1050);
assert.equal(n.change_revenue, 0.5);
assert.equal(n.days_now, 7);

// missing days and no Google Analytics: said, never guessed
const thin = weekOverWeek(days(0, 4), null, Y);
assert.equal(thin.now.days, 5);
assert.equal(thin.before.days, 0);
assert.equal(thin.before.revenue, 0);
assert.equal(line("revenue").unit, "usd");
assert.equal(thin.lines.find((l) => l.key === "revenue")!.change, null, "nothing last week: no change");
assert.equal(thin.lines.some((l) => l.key === "sessions"), false, "no visit lines without Google Analytics");
assert.deepEqual(thin.missing, ["2 of the last 7 days have no saved numbers", "7 of the 7 days before have no saved numbers", "Google Analytics isn't connected, so there are no visits"]);
assert.equal(thin.before.aov, null);

// margin with no cost, a day with null numbers, rows outside the window
const odd = weekOverWeek([row(Y, { cost_of_goods: null, margin: null }), row(shift(Y, -1), { revenue: null, orders: null, repeat_rate: null }), row(shift(Y, -20), { revenue: 9999 })], null, Y);
assert.equal(odd.now.margin, null, "no cost on any day with revenue: no margin");
assert.equal(odd.now.revenue, 100);
assert.equal(odd.now.days, 2);
assert.equal(odd.before.revenue, 0, "a row outside both weeks is left out");
assert.equal(change(5, 0, "count"), null);
assert.equal(change(null, 3, "usd"), null);
assert.equal(change(0.3, 0.2, "pct"), 0.1);

// wiring: the tool reads saved numbers and computes in code
const cat = readFileSync("core/tools/catalog.ts", "utf8");
assert.match(cat, /id: "weekly_numbers"[\s\S]{0,1600}weekOverWeek\(/);
assert.match(cat, /ga4Overview\("last_30_days"\)\.then\(\(o\) => o\.days, \(\) => null\)/, "no Google Analytics means no visit lines, not a failed run");

console.log("check:weekly-numbers ok");
