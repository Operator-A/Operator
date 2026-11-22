// The living Crew canvas (docs/crew-canvas.md): `npm run check:org-canvas`. Pure: lays the canvas
// out for sample companies at phone and desktop widths, and reads files.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import type { Chain } from "../core/flow-rules";
import { FOLD_AT, LIST_H, PAD, PHONE, SPINE, YOU, colsFor, defaultOpen, deptBox, foldBox, handoffsOf, layoutCanvas, teamSize, moveLines, seatName, type Box, type CanvasData, type CanvasDept, type CanvasSeat } from "../dashboard/org-canvas";

const read = (p: string) => readFileSync(p, "utf8");

// ---- a sample company: a company seat and five departments, one deep, one with an open seat, one of a single seat
const agent = (id: string, name: string) => ({ id, name, role: "Role", href: `/agents/${id}`, state: "on" as const, label: "On duty", last: "Last ran today", summary: "Did a thing.", lastRunHref: null, job: "A job.", writes: null });
const seat = (id: string, parent: string | null, depth: number, who: string | null, holder: CanvasSeat["holder"] = who ? "agent" : "open"): CanvasSeat =>
  ({ id, title: `${id} seat`, sub: "", holder, parent, depth, agent: who ? agent(`a-${id}`, who) : null, href: who ? null : `/build/new?seat=${id}`, proposal: null });
const dept = (id: string, seats: CanvasSeat[]): CanvasDept => ({ id, name: id, seats, spent: 1.5, budget: null, rules: [], goals: [] });
const depts: CanvasDept[] = [
  dept("sales", [seat("s1", null, 0, "Reese"), seat("s2", "s1", 1, "Rico"), seat("s3", "s2", 2, "Ivy"), seat("s4", "s2", 2, null), seat("s5", "s1", 1, "Jo"), seat("s6", "s1", 1, "Kit"), seat("s7", "s6", 2, "Lee")]),
  dept("money", [seat("m1", null, 0, "Morgan"), seat("m2", "m1", 1, "Quinn")]),
  dept("marketing", [seat("k1", null, 0, "Sloane"), seat("k2", "k1", 1, "Wren"), seat("k3", "k1", 1, null)]),
  dept("care", [seat("c1", null, 0, null, "owner")]),
  dept("ops", [seat("o1", null, 0, null), seat("o2", "o1", 1, "Rowan")]),
];
const seatOfAgent: Record<string, string> = {};
for (const d of depts) for (const s of d.seats) if (s.agent) seatOfAgent[s.agent.id] = s.id;
const step = (a: string, passAlong: boolean) => ({ agent: a, passAlong }) as unknown as Chain["steps"][number];
const chain = (name: string, on: boolean, steps: Chain["steps"]) => ({ key: name, name, on, start: {} as Chain["start"], steps });
const chains: Chain[] = [
  chain("Morning", true, [step("a-m1", false), step("a-s1", true), step("a-s2", true), step("a-k1", false), step("a-nowhere", true), step("a-k2", true)]),
  chain("Off", false, [step("a-k1", false), step("a-o2", true)]),
  chain("Again", true, [step("a-m1", false), step("a-s1", true), step("a-s1", true)]),
];

// ---- hand-offs: only from chains that are on, only where the next step takes the facts, only between seats
const handoffs = handoffsOf(chains, seatOfAgent);
assert.deepEqual(handoffs.map((h) => `${h.from}>${h.to}`), ["m1>s1", "s1>s2"], "a chain that is off, a step that takes nothing, an agent in no seat and a repeat draw no line");
assert.equal(handoffs[0].chain, "Morning");
assert.deepEqual(handoffsOf([], seatOfAgent), []);

const full: CanvasData = { company: seat("top", null, 0, "Avery"), depts, handoffs, runs: [] };
const cases: [string, CanvasData][] = [
  ["a full company", full],
  ["no company seat", { ...full, company: null }],
  ["one department", { ...full, depts: depts.slice(0, 1), handoffs: handoffs.slice(1) }],
  ["no departments", { ...full, depts: [], handoffs: [] }],
  // the company seat is in no department: a hand-off to or from it must still lay out (opening the
  // department used to make a pill for a department that doesn't exist and crash the page)
  ["a hand-off with the company seat", { ...full, handoffs: [...handoffs, { from: "m2", to: "top", chain: "Up" }, { from: "top", to: "s1", chain: "Down" }] }],
];
const WIDTHS = [326, 390, 600, 886, 1200, 1500];

const edges = (b: Box) => ({ l: b.x - b.w / 2, r: b.x + b.w / 2, t: b.y - b.h / 2, b: b.y + b.h / 2 });
const overlap = (a: Box, b: Box) => { const p = edges(a), q = edges(b); return p.l < q.r - .5 && q.l < p.r - .5 && p.t < q.b - .5 && q.t < p.b - .5; };
const inside = (a: Box, b: Box) => { const p = edges(a), q = edges(b); return p.l >= q.l - .5 && p.r <= q.r + .5 && p.t >= q.t - .5 && p.b <= q.b + .5; };

// each layout is tried as the page loads, with every team open, and with every team folded
const folds = (d: CanvasData): [string, Set<string>][] => [["as it loads", defaultOpen(d)], ["all open", new Set(d.depts.flatMap((x) => x.seats.map((s) => s.id)))], ["all folded", new Set()]];
let layouts = 0;
for (const [name, d] of cases) {
  for (const W of WIDTHS) {
    for (const focus of [null, ...d.depts.map((x) => x.id)]) for (const [fold, open] of folds(d)) {
      const at = `${name}, ${W}px, ${focus ?? "whole company"}, ${fold}`;
      const L = layoutCanvas(d, W, focus, open);
      layouts++;
      const all = Object.values(L.boxes), shown = all.filter((b) => b.show);
      const seats = [...(d.company ? [d.company] : []), ...d.depts.flatMap((x) => x.seats)];

      // every seat and department has a box, and you are always there
      assert.ok(L.boxes[YOU]?.show, `${at}: you are on the canvas`);
      for (const s of seats) assert.ok(L.boxes[s.id], `${at}: seat ${s.id} has a box`);
      for (const x of d.depts) assert.ok(L.boxes[deptBox(x.id)], `${at}: department ${x.id} has a box`);
      for (const b of all) assert.ok([b.x, b.y, b.w, b.h].every(Number.isFinite), `${at}: ${b.id} has real numbers`);

      // what shows is on the canvas and is wide enough to read
      for (const b of shown) {
        const e = edges(b);
        assert.ok(e.l >= -.5 && e.r <= W + .5, `${at}: ${b.id} is inside the width (${e.l} to ${e.r})`);
        assert.ok(e.t >= -.5 && e.b <= L.height + .5, `${at}: ${b.id} is inside the height`);
        assert.ok(b.w >= (b.kind === "seat" || b.kind === "fold" ? 60 : 100), `${at}: ${b.id} is ${b.w} wide`);
      }

      // no two cards overlap, no two departments overlap, and a seat sits inside its department
      const cards = shown.filter((b) => b.kind !== "dept"), cells = shown.filter((b) => b.kind === "dept");
      for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) assert.ok(!overlap(cards[i], cards[j]), `${at}: ${cards[i].id} and ${cards[j].id} overlap`);
      for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) assert.ok(!overlap(cells[i], cells[j]), `${at}: ${cells[i].id} and ${cells[j].id} overlap`);
      for (const b of cards) {
        if (b.rides) assert.ok(L.boxes[b.rides].show && inside(b, L.boxes[b.rides]), `${at}: ${b.id} sits inside ${b.rides}`);
        else for (const c of cells) assert.ok(!overlap(b, c), `${at}: ${b.id} is clear of ${c.id}`);
      }

      // lines join two different boxes that show, and none is drawn twice
      const keys = new Set<string>();
      for (const l of L.lines) {
        assert.ok(l.a !== l.b && L.boxes[l.a]?.show && L.boxes[l.b]?.show, `${at}: the ${l.type} line ${l.a} to ${l.b} joins boxes that show`);
        assert.ok(!keys.has(`${l.type}:${l.a}>${l.b}`), `${at}: ${l.a} to ${l.b} is drawn once`);
        keys.add(`${l.type}:${l.a}>${l.b}`);
      }

      // every seat that shows has exactly one report line, up to the seat above it (or the top)
      const top = d.company?.id ?? YOU;
      for (const s of seats) {
        const up = L.lines.filter((l) => l.type === "report" && l.a === s.id);
        if (!L.boxes[s.id].show) { assert.equal(up.length, 0, `${at}: hidden ${s.id} has no line`); continue; }
        if (s.id === d.company?.id) { if (!focus) assert.deepEqual(up.map((l) => l.b), [YOU], `${at}: the company seat reports to you`); continue; }
        assert.deepEqual(up.map((l) => l.b), [s.parent ?? top], `${at}: ${s.id} reports to ${s.parent ?? top}`);
      }

      // folding: a seat shows when every seat above it is open (an opened department always shows its
      // head's seats), and a seat with a team that shows has the row that folds it
      const parent = new Map(d.depts.flatMap((x) => x.seats.map((s) => [s.id, s.parent] as const)));
      const heads = new Set(d.depts.map((x) => x.seats[0]?.id));
      const unfolded = (id: string): boolean => { const p = parent.get(id); return !p || ((open.has(p) || (focus != null && heads.has(p))) && unfolded(p)); };
      // a phone's whole company is a list: every seat waits inside its department's card
      const list = !focus && W < PHONE;
      if (list) for (const x of d.depts) {
        const cell = L.boxes[deptBox(x.id)];
        assert.ok(cell.list && cell.show, `${at}: ${x.id} is a card in the list`);
        assert.deepEqual(L.lines.filter((l) => l.a === cell.id && l.type === "report").map((l) => `${l.b}:${l.shape}`), [`${top}:spine`], `${at}: ${x.id}'s card reports up the spine`);
        for (const s of x.seats) assert.ok(!L.boxes[s.id].show && !L.boxes[foldBox(s.id)]?.show && L.boxes[s.id].rides === cell.id, `${at}: ${s.id} waits inside the ${x.id} card`);
      }
      for (const x of d.depts) {
        if ((focus && x.id !== focus) || list) continue;
        for (const s of x.seats) {
          assert.equal(L.boxes[s.id].show, unfolded(s.id), `${at}: ${s.id} shows only when the seats above it are open`);
          const kids = x.seats.some((k) => k.parent === s.id), f = L.boxes[foldBox(s.id)];
          assert.equal(!!f, kids, `${at}: ${s.id} has a fold row exactly when it has a team`);
          if (f) assert.equal(f.show, L.boxes[s.id].show && !(focus && heads.has(s.id)), `${at}: the fold row of ${s.id} shows with its seat (an opened head has none)`);
          if (f?.show) assert.ok(f.y > L.boxes[s.id].y && f.of === s.id, `${at}: the fold row sits under ${s.id}`);
        }
      }

      // hand-off lines only where the data has one, landing on the nearest seat that shows
      const deptOf = (id: string) => d.depts.find((x) => x.seats.some((s) => s.id === id))?.id;
      const up = (id: string) => { let s: string | null | undefined = id; while (s && !L.boxes[s]?.show) s = parent.get(s); return s; };
      for (const l of L.lines.filter((x) => x.type === "handoff")) {
        const ok = d.handoffs.some((h) => {
          const a = l.a.startsWith("dept:") ? deptBox(deptOf(h.from) ?? "") : up(h.from), b = l.b.startsWith("dept:") ? deptBox(deptOf(h.to) ?? "") : up(h.to);
          return a === l.a && b === l.b;
        });
        assert.ok(ok, `${at}: the hand-off line ${l.a} to ${l.b} comes from a chain`);
      }

      if (!focus) {
        assert.equal(L.cols, colsFor(W, d.depts.length));
        assert.ok(all.every((b) => !b.big && !b.focus && !b.port), `${at}: the whole company draws every box small`);
        assert.ok(all.filter((b) => b.kind === "dept" || b.kind === "you").every((b) => b.show), `${at}: every department shows`);
        assert.equal(all.some((b) => b.list), list && d.depts.length > 0, `${at}: only a phone's whole company is a list`);
        if (fold === "all open" && !list) assert.equal(L.lines.filter((l) => l.type === "handoff").length, d.handoffs.length, `${at}: every hand-off is drawn`);
      } else {
        const mine = d.depts.find((x) => x.id === focus)!;
        assert.ok(L.boxes[deptBox(focus)].focus, `${at}: the opened department is marked`);
        for (const s of mine.seats) if (s.depth <= 1) assert.ok(L.boxes[s.id].show, `${at}: its seat ${s.id} shows`);
        assert.ok(L.boxes[mine.seats[0].id].big, `${at}: its head is a big card`);
        for (const x of d.depts) {
          if (x.id === focus) continue;
          const b = L.boxes[deptBox(x.id)];
          const trades = d.handoffs.some((h) => (deptOf(h.from) === focus && deptOf(h.to) === x.id) || (deptOf(h.to) === focus && deptOf(h.from) === x.id));
          assert.ok(!b.show || (b.port && trades), `${at}: ${x.id} leaves unless it trades work with the opened department`);
          for (const s of x.seats) assert.ok(!L.boxes[s.id].show && !L.boxes[foldBox(s.id)]?.show, `${at}: ${s.id} leaves`);
        }
      }
    }
  }
}

// a big department starts folded to its head; a small one starts open
assert.ok(depts[0].seats.length > FOLD_AT && depts[1].seats.length <= FOLD_AT);
const loads = layoutCanvas(full, 886, null);
assert.deepEqual(depts[0].seats.filter((s) => loads.boxes[s.id].show).map((s) => s.id), ["s1"], "sales (7 seats) shows only its head");
assert.ok(loads.boxes[foldBox("s1")].show, "with a row to open its team");
assert.deepEqual(depts[1].seats.filter((s) => loads.boxes[s.id].show).map((s) => s.id), ["m1", "m2"], "money (2 seats) shows every seat");
assert.equal(teamSize(depts[0], "s1"), 6); assert.equal(teamSize(depts[0], "s2"), 2); assert.equal(teamSize(depts[0], "s3"), 0);
// opening the head shows the next level down, and only that
const one = layoutCanvas(full, 886, null, new Set(["s1"]));
assert.deepEqual(depts[0].seats.filter((s) => one.boxes[s.id].show).map((s) => s.id), ["s1", "s2", "s5", "s6"]);
assert.ok(one.height > loads.height, "the canvas grows when a team opens");
// an unfolded big department takes two columns, so its seats stay readable; a small one keeps one
const cellW = (L: ReturnType<typeof layoutCanvas>, id: string) => L.boxes[deptBox(id)].w;
assert.equal(cellW(one, "sales"), 2 * cellW(one, "money") + 12, "opened sales is two columns wide");
assert.equal(cellW(loads, "sales"), cellW(loads, "money"), "folded sales is one column, like the rest");
assert.ok(one.boxes["s2"].w > loads.boxes["s1"].w, "its seats get the room");
assert.ok(one.boxes[deptBox("sales")].x < one.boxes[deptBox("money")].x, "departments keep their order");
// the folded sales head still takes Morgan's hand-off, and Reese's to Rico (folded) draws no line
assert.deepEqual(loads.lines.filter((l) => l.type === "handoff").map((l) => `${l.a}>${l.b}`), ["m1>s1"]);

// a phone lists the departments as full-width cards right of the gutter where their lines run up,
// and hand-offs between departments run card to card down the right edge
const phone = layoutCanvas(full, 390, null);
depts.forEach((x, i) => {
  const cell = phone.boxes[deptBox(x.id)];
  assert.equal(cell.x - cell.w / 2, PAD + SPINE, `${x.id} starts right of the spine`);
  assert.equal(cell.x + cell.w / 2, 390 - PAD, `${x.id} runs to the right edge`);
  assert.equal(cell.h, LIST_H, `${x.id} is one card tall, however many seats it has`);
  if (i) assert.ok(cell.y > phone.boxes[deptBox(depts[i - 1].id)].y, "cards keep the department order");
});
assert.deepEqual(phone.lines.filter((l) => l.type === "handoff").map((l) => `${l.a}>${l.b}:${l.shape}`), ["dept:money>dept:sales:side"], "Morgan to Reese draws money to sales; Reese to Rico stays inside sales");
assert.ok(!layoutCanvas(full, 886, null).lines.some((l) => l.shape === "spine"), "only a phone has the spine");
// opening a department on a phone shows its chart, and its seats come out of the card
const phoneOpen = layoutCanvas(full, 390, "sales");
assert.ok(!phoneOpen.boxes[deptBox("sales")].list && phoneOpen.boxes["s1"].show, "the opened department is a chart, not a card");

// columns: one on a phone, never more than five or than there are departments
assert.equal(colsFor(326, 5), 1, "a phone stacks departments one per row");
assert.equal(colsFor(600, 5), 4);
assert.equal(colsFor(326, 1), 1);
assert.equal(colsFor(1500, 9), 5);
assert.equal(colsFor(886, 3), 3);
// a hand-off between a department and the company seat runs straight to that seat, with no pill
const withTop = cases.find(([n]) => n === "a hand-off with the company seat")![1];
const money = layoutCanvas(withTop, 1200, "money", new Set(["m1"]));
assert.ok(!Object.keys(money.boxes).some((k) => k.includes("undefined")), "no box for a department that doesn't exist");
assert.ok(money.lines.some((l) => l.type === "handoff" && l.a === "m2" && l.b === "top"), "Quinn's hand-off reaches the company seat");
// a focus that names no department is the whole company
assert.deepEqual(layoutCanvas(full, 886, "gone"), layoutCanvas(full, 886, null));
// the same input gives the same layout (nothing random, so it doesn't jump between renders)
assert.deepEqual(layoutCanvas(full, 886, "sales"), layoutCanvas(full, 886, "sales"));

// ---- how work moves, in words written from the lines
assert.equal(seatName(full.company!), "Avery");
assert.equal(seatName(depts[3].seats[0]), "You");
assert.equal(seatName(depts[4].seats[0]), "o1 seat");
assert.deepEqual(moveLines(full, "sales"), [
  "Reese reports to Avery.", "Rico reports to Reese.", "Ivy reports to Rico.", "Jo reports to Reese.", "Kit reports to Reese.", "Lee reports to Kit.",
  "Morgan hands its summary and numbers to Reese in the Morning chain.", "Reese hands its summary and numbers to Rico in the Morning chain.",
]);
assert.deepEqual(moveLines(full, "ops"), ["Rowan reports to the open o1 seat seat."], "an open seat above is named as open (the sample titles end in seat)");
assert.deepEqual(moveLines({ ...full, company: null }, "money")[0], "Morgan reports to you.");
assert.deepEqual(moveLines(full, "care"), [], "a department with no agents says nothing");
assert.deepEqual(moveLines(full, "gone"), []);

// ---- files: the canvas is the Crew page, it changes nothing, and the folding it replaced is gone
const canvas = read("dashboard/components/OrgCanvas.tsx"), chart = read("dashboard/components/OrgChart.tsx"), css = read("app/globals.css"), page = read("app/(room)/crew/page.tsx");
assert.match(canvas, /^"use client";/, "the canvas runs in the browser");
assert.ok(!/router\.refresh\(|\.refresh\(\)/.test(canvas), "the canvas never refreshes the page");
assert.ok(!/from "@\/app\/|actions"/.test(canvas), "the canvas calls no server action: Edit chart changes things");
assert.ok(!/Math\.random\(/.test(canvas), "nothing on the canvas is random: the same crew draws the same way");
assert.match(canvas, /prefers-reduced-motion/, "the canvas holds still for people who ask for less motion");
assert.match(page, /<OrgCanvas d=\{canvasData\(/, "Crew draws the canvas from canvasData");
assert.match(page, /view=edit|"edit"/, "Edit chart is its own view");
for (const gone of ["org-fold", "org-sum", "org-team", "org-faces", "org-more", "org-z"]) {
  assert.ok(!css.includes(`.${gone}`), `the style .${gone} is gone`);
  assert.ok(!chart.includes(gone) && !canvas.includes(gone), `no component uses ${gone}`);
}
for (const gone of ["DeptSummary", "teamCounts", "setEditing"]) assert.ok(!chart.includes(gone), `OrgChart no longer has ${gone}`);
assert.match(css, /\.lc-wrap/, "the canvas has its styles");
assert.ok(existsSync("docs/crew-canvas.md"), "the spec is in docs");

console.log(`check:org-canvas ok (${layouts} layouts)`);
