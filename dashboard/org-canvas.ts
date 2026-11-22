// The living Crew canvas (docs/crew-canvas.md): the shape of its data, where every box and line
// goes for a width and an opened department, and how work moves in words. Pure, so it is tested
// without a browser (`npm run check:org-canvas`). The canvas only draws what is here, and what is
// here comes only from the org chart, the active flow and today's runs.
import type { Chain } from "@/core/flow-rules";
import type { GoalView } from "./goals";

export type CanvasState = "run" | "on" | "call" | "off" | "over" | "missing";
export interface CanvasAgent {
  id: string; name: string; role: string; href: string;
  state: CanvasState;
  /** The state in words, as the rest of the Control Room says it. */
  label: string;
  last: string;
  /** What its last run said it did, and where to replay it. */
  summary: string | null; lastRunHref: string | null;
  job: string; writes: string | null;
}
export interface CanvasSeat {
  id: string; title: string; sub: string;
  holder: "agent" | "owner" | "open";
  /** The seat it reports to in its department; null for a head and for the company seat. */
  parent: string | null;
  /** A head is 0, the seats right under it 1, and so on. */
  depth: number;
  agent: CanvasAgent | null;
  /** Where clicking an open seat goes (New agent with the seat filled in, or its proposal). */
  href: string | null;
  proposal: string | null;
}
export interface CanvasDept {
  id: string; name: string;
  /** Head first, then every seat under it, depth first. */
  seats: CanvasSeat[];
  spent: number; budget: number | null;
  rules: string[];
  goals: GoalView[] | null;
}
export interface Handoff { from: string; to: string; chain: string }
export interface CanvasRun { id: string; seat: string; who: string; text: string; at: string; status: "ok" | "failed" | "running"; href: string }
export interface CanvasData {
  company: CanvasSeat | null;
  depts: CanvasDept[];
  /** Seat to seat: two steps in a row of a chain that is on, where the second takes the first's facts. */
  handoffs: Handoff[];
  /** Today's runs by agents on the chart, newest first. */
  runs: CanvasRun[];
}

/** Who holds a seat, as a sentence names them. */
export const seatName = (s: CanvasSeat) => (s.agent ? s.agent.name : s.holder === "owner" ? "You" : s.title);

/**
 * Hand-off lines from the active flow. One step hands work to the next only when the chain is on
 * and the next step takes the step before's summary and numbers (passAlong). Agents with no seat draw no line.
 */
export function handoffsOf(chains: readonly Chain[], seatOfAgent: Readonly<Record<string, string>>): Handoff[] {
  const out: Handoff[] = [], seen = new Set<string>();
  for (const c of chains) {
    if (!c.on) continue;
    for (let i = 1; i < c.steps.length; i++) {
      if (!c.steps[i].passAlong) continue;
      const from = seatOfAgent[c.steps[i - 1].agent], to = seatOfAgent[c.steps[i].agent];
      if (!from || !to || from === to || seen.has(`${from}>${to}`)) continue;
      seen.add(`${from}>${to}`); out.push({ from, to, chain: c.name });
    }
  }
  return out;
}

export const YOU = "you";
export const deptBox = (id: string) => `dept:${id}`;

export interface Box {
  id: string; kind: "you" | "seat" | "dept" | "fold";
  /** Centre, width and height, in canvas pixels. */
  x: number; y: number; w: number; h: number;
  show: boolean;
  /** An opened card: it also says its state in words and what it last did. */
  big: boolean;
  /** A department opened (focus), or shrunk to a pill that leads to it (port). */
  focus: boolean; port: boolean;
  /** The department box a seat floats with. */
  rides: string | null;
  /** A fold row: the seat whose team it shows or hides. */
  of: string | null;
  /** A department drawn as a card in the phone's list: its head, what is happening now, its seats and budget. */
  list: boolean;
}
/** elbow: a seat to the seat above it in a column. tree: up to a box above. spine: up the left edge of a phone to a box above. side: two cards in one column. free: anywhere. */
export type LineShape = "elbow" | "tree" | "spine" | "side" | "free";
export interface Line { a: string; b: string; type: "report" | "handoff"; shape: LineShape; bend: 1 | -1 }
export interface Layout { boxes: Record<string, Box>; lines: Line[]; height: number; cols: number }

export const PAD = 16;
const GAP = 12, CH = 52, FH = 26, INDENT = 16, COL_MIN = 128, COL_MAX = 260;
/** A department with more seats than this starts folded down to its head. */
export const FOLD_AT = 5;
export const foldBox = (seat: string) => `fold:${seat}`;

/** How tall a department's card is in the phone's list. */
export const LIST_H = 164;
/** Below this width (a phone) the whole company is a list of department cards, one per row. */
export const PHONE = 560;
/** The left gutter on a phone, where every department's line runs up to the company seat. */
export const SPINE = 14;

/** Departments across at a width: one on a phone, up to five. */
export function colsFor(W: number, depts: number) {
  if (W < PHONE) return Math.min(1, depts) || 1;
  const fit = Math.floor((W - 2 * PAD + GAP) / (COL_MIN + GAP));
  return Math.max(1, Math.min(depts, Math.max(2, Math.min(5, fit))));
}

const kidsOf = (dp: CanvasDept, id: string) => dp.seats.filter((s) => s.parent === id);
/** Every seat under one, at any depth. */
export function teamSize(dp: CanvasDept, id: string): number {
  return kidsOf(dp, id).reduce((n, k) => n + 1 + teamSize(dp, k.id), 0);
}
/**
 * The seats whose teams show when the page loads: every seat in a small department, none in a
 * big one, so a big department starts as its head with a row that opens the next level down.
 */
export function defaultOpen(d: CanvasData): Set<string> {
  const open = new Set<string>();
  for (const dp of d.depts) if (dp.seats.length <= FOLD_AT) for (const s of dp.seats) if (kidsOf(dp, s.id).length) open.add(s.id);
  return open;
}

type Row = { seat: CanvasSeat } | { fold: CanvasSeat };
/** A seat, then (when it has a team) its fold row, then its team when that seat is open. */
function branch(dp: CanvasDept, s: CanvasSeat, open: ReadonlySet<string>, withSelf = true): Row[] {
  const kids = kidsOf(dp, s.id);
  const self: Row[] = withSelf ? [{ seat: s }] : [];
  if (!kids.length) return self;
  return [...self, { fold: s }, ...(open.has(s.id) ? kids.flatMap((k) => branch(dp, k, open)) : [])];
}

/**
 * Every box and line. With no department opened it is the org chart: you, the company seat, a
 * column per department. With one opened, that department fills the canvas and the others leave,
 * except those it hands work to or takes work from, which shrink to a pill under it. A seat whose
 * team is folded shows a row under it instead of the team; `open` names the seats whose teams show
 * (an opened department always shows the seats right under its head).
 */
export function layoutCanvas(d: CanvasData, W: number, focus: string | null, open: ReadonlySet<string> = defaultOpen(d)): Layout {
  const boxes: Record<string, Box> = {}, lines: Line[] = [];
  const box = (id: string, kind: Box["kind"], x: number, y: number, w: number, h: number, more: Partial<Box> = {}) => (boxes[id] = { id, kind, x, y, w, h, show: true, big: false, focus: false, port: false, rides: null, of: null, list: false, ...more });
  const line = (a: string, b: string, type: Line["type"], shape: LineShape) => lines.push({ a, b, type, shape, bend: lines.length % 2 ? 1 : -1 });
  const deptOfSeat: Record<string, string> = {};
  for (const dp of d.depts) for (const s of dp.seats) deptOfSeat[s.id] = dp.id;
  const top = d.company?.id ?? YOU;
  const opened = focus ? d.depts.find((x) => x.id === focus) ?? null : null;
  const narrow = W < PHONE;
  const parentOf: Record<string, string | null> = {};
  for (const dp of d.depts) for (const s of dp.seats) parentOf[s.id] = s.parent;
  // a hand-off to a seat that is folded away lands on the nearest seat above it that shows
  const shownUp = (seat: string) => { let s: string | null = seat; while (s && !boxes[s]?.show) s = parentOf[s] ?? null; return s; };
  const rowH = (r: Row) => ("seat" in r ? CH : FH) + 8;
  // seats a fold hides wait, unseen, where the seat above them is, so they grow out of it when it opens
  const hideRest = (dp: CanvasDept, id: string) => {
    for (const s of dp.seats) {
      if (boxes[s.id]) continue;
      let up = s.parent ? boxes[s.parent] : null;
      for (let p = s.parent; p && !up?.show; p = dp.seats.find((x) => x.id === p)?.parent ?? null) up = boxes[p] ?? null;
      const at = up?.show ? up : boxes[id];
      box(s.id, "seat", at.x, at.y, Math.min(at.w, 120), CH, { show: false, rides: id });
    }
    for (const s of dp.seats) if (kidsOf(dp, s.id).length && !boxes[foldBox(s.id)]) box(foldBox(s.id), "fold", boxes[s.id].x, boxes[s.id].y, 100, FH, { show: false, rides: id, of: s.id });
  };
  // a column of rows, top down from y: seats with a report line each, fold rows under their seat
  const column = (rows: Row[], cx: number, y: number, w: number, rides: string, base: number) => {
    for (const r of rows) {
      const s = "seat" in r ? r.seat : r.fold, depth = "seat" in r ? s.depth - base : s.depth - base + 1;
      const ind = Math.min(Math.max(depth, 0), 4) * INDENT, h = "seat" in r ? CH : FH;
      if ("seat" in r) { box(s.id, "seat", cx + ind / 2, y + h / 2, w - ind, h, { rides }); if (s.parent) line(s.id, s.parent, "report", "elbow"); }
      else box(foldBox(s.id), "fold", cx + ind / 2, y + h / 2, w - ind, h, { rides, of: s.id });
      y += h + 8;
    }
    return y;
  };
  let bottom: number;

  if (!opened && narrow) {
    // a phone: you, the company seat, then a card per department down the page. Each card's seats
    // wait inside it, unseen, so opening a department flows them out of its card.
    const colW = W - 2 * PAD - SPINE, cx = PAD + SPINE + colW / 2;
    box(YOU, "you", W / 2, 44, Math.min(168, W - 2 * PAD), CH);
    if (d.company) { box(d.company.id, "seat", W / 2, 122, Math.min(190, W - 2 * PAD), CH); line(d.company.id, YOU, "report", "tree"); }
    let y = d.company ? 196 : 118;
    for (const dp of d.depts) {
      const id = deptBox(dp.id);
      box(id, "dept", cx, y + LIST_H / 2, colW, LIST_H, { list: true });
      for (const s of dp.seats) {
        box(s.id, "seat", cx, y + 66, colW - 24, CH, { show: false, rides: id });
        if (kidsOf(dp, s.id).length) box(foldBox(s.id), "fold", cx, y + 66, colW - 24, FH, { show: false, rides: id, of: s.id });
      }
      line(id, top, "report", "spine");
      y += LIST_H + 14;
    }
    // hand-offs between departments run down the right edge, card to card
    const endOf = (seat: string) => (deptOfSeat[seat] ? deptBox(deptOfSeat[seat]) : boxes[seat]?.show ? seat : null);
    const seen = new Set<string>();
    for (const h of d.handoffs) {
      const a = endOf(h.from), b = endOf(h.to);
      if (!a || !b || a === b || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`); line(a, b, "handoff", a.startsWith("dept:") && b.startsWith("dept:") ? "side" : "free");
    }
    return { boxes, lines, height: Math.round((d.depts.length ? y - 14 : y) + 18), cols: 1 };
  }

  if (!opened) {
    const cols = colsFor(W, d.depts.length), colW = Math.min(COL_MAX, (W - 2 * PAD - (cols - 1) * GAP) / cols);
    box(YOU, "you", W / 2, 44, Math.min(168, W - 2 * PAD), CH);
    if (d.company) { box(d.company.id, "seat", W / 2, 122, Math.min(190, W - 2 * PAD), CH); line(d.company.id, YOU, "report", "tree"); }
    let y = d.company ? 196 : 118;
    for (let r = 0; r * cols < d.depts.length; r++) {
      const row = d.depts.slice(r * cols, (r + 1) * cols), x0 = (W - row.length * colW - (row.length - 1) * GAP) / 2;
      let maxH = 0;
      row.forEach((dp, i) => {
        const head = dp.seats[0], rows = head ? branch(dp, head, open) : [];
        const h = 40 + rows.reduce((n, x) => n + rowH(x), 0) + 4, cx = x0 + i * (colW + GAP) + colW / 2, id = deptBox(dp.id);
        maxH = Math.max(maxH, h);
        box(id, "dept", cx, y + h / 2, colW, h);
        column(rows, cx, y + 40, colW - 20, id, head?.depth ?? 0);
        if (head) line(head.id, top, "report", "tree");
        hideRest(dp, id);
      });
      y += maxH + 44;
    }
    bottom = (d.depts.length ? y - 44 : y) + 18;
    const seen = new Set<string>();
    for (const h of d.handoffs) {
      const a = shownUp(h.from), b = shownUp(h.to);
      if (!a || !b || a === b || seen.has(`${a}>${b}`)) continue;
      seen.add(`${a}>${b}`); line(a, b, "handoff", deptOfSeat[a] === deptOfSeat[b] ? "side" : "free");
    }
    return { boxes, lines, height: Math.round(bottom), cols };
  }

  // one department, opened
  const cellW = W - 2 * PAD, bw = narrow ? (cellW - 24 - GAP) / 2 : Math.min(214, cellW - 24), bh = narrow ? 68 : 100, hubY = narrow ? 92 : 64, cellTop = hubY + 44;
  const head = opened.seats[0], kids = head ? kidsOf(opened, head.id) : [];
  const per = Math.max(1, Math.floor((cellW - 24 + GAP) / (bw + GAP)));
  const tall = (s: CanvasSeat) => (s.agent ? bh : CH);
  // a column per seat right under the head: that seat, then its fold row and whatever is open under it
  const under = (k: CanvasSeat) => branch(opened, k, open, false);
  const colH = (k: CanvasSeat) => tall(k) + under(k).reduce((n, r) => n + rowH(r), 0);
  const rows: CanvasSeat[][] = [];
  for (let i = 0; i < kids.length; i += per) rows.push(kids.slice(i, i + per));
  const rowsH = rows.reduce((n, r) => n + Math.max(...r.map(colH)), 0) + Math.max(0, rows.length - 1) * 14;
  const h = 44 + (head ? tall(head) : 0) + (rows.length ? 38 + rowsH : 0) + 16, id = deptBox(opened.id);
  if (d.company) box(d.company.id, "seat", W * (narrow ? .27 : .36), hubY, 140, CH);
  box(YOU, "you", W * (narrow ? .74 : .66), hubY, 150, CH);
  box(id, "dept", W / 2, cellTop + h / 2, cellW, h, { focus: true });
  if (head) {
    box(head.id, "seat", W / 2, cellTop + 44 + tall(head) / 2, bw, tall(head), { rides: id, big: true });
    line(head.id, top, "report", "tree");
    let y = cellTop + 44 + tall(head) + 38;
    for (const r of rows) {
      r.forEach((k, i) => {
        const cx = W / 2 + (i - (r.length - 1) / 2) * (bw + GAP);
        box(k.id, "seat", cx, y + tall(k) / 2, bw, tall(k), { rides: id, big: true });
        line(k.id, head.id, "report", "tree");
        column(under(k), cx, y + tall(k) + 8, bw, id, k.depth);
      });
      y += Math.max(...r.map(colH)) + 14;
    }
    hideRest(opened, id);
  }
  // the departments it trades work with stay as pills under it; the rest leave
  const linked = d.handoffs.flatMap((x) => (deptOfSeat[x.from] === opened.id && deptOfSeat[x.to] !== opened.id ? [deptOfSeat[x.to]] : deptOfSeat[x.to] === opened.id && deptOfSeat[x.from] !== opened.id ? [deptOfSeat[x.from]] : []));
  const ports = [...new Set(linked)].slice(0, Math.max(1, Math.floor((cellW + GAP) / (150 + GAP))));
  ports.forEach((p, i) => box(deptBox(p), "dept", PAD + 75 + i * (150 + GAP), cellTop + h + 46, 150, 38, { port: true }));
  for (const dp of d.depts) {
    if (dp.id === opened.id) continue;
    if (!boxes[deptBox(dp.id)]) box(deptBox(dp.id), "dept", W / 2, cellTop + h / 2, 150, 38, { show: false });
    for (const s of dp.seats) {
      box(s.id, "seat", 0, 0, 120, CH, { show: false, rides: deptBox(dp.id) });
      if (kidsOf(dp, s.id).length) box(foldBox(s.id), "fold", 0, 0, 100, FH, { show: false, rides: deptBox(dp.id), of: s.id });
    }
  }
  const end = (seat: string) => (deptOfSeat[seat] === opened.id ? shownUp(seat) : ports.includes(deptOfSeat[seat]) ? deptBox(deptOfSeat[seat]) : null);
  const seen = new Set<string>();
  for (const x of d.handoffs) {
    if (deptOfSeat[x.from] !== opened.id && deptOfSeat[x.to] !== opened.id) continue;
    const a = end(x.from), b = end(x.to);
    if (!a || !b || a === b || seen.has(`${a}>${b}`)) continue;
    seen.add(`${a}>${b}`); line(a, b, "handoff", "free");
  }
  bottom = cellTop + h + (ports.length ? 46 + 19 + 16 : 16);
  return { boxes, lines, height: Math.round(bottom), cols: 1 };
}

/** How work moves in a department, as sentences written from the lines (never by a model). */
export function moveLines(d: CanvasData, deptId: string): string[] {
  const dp = d.depts.find((x) => x.id === deptId);
  if (!dp) return [];
  const all = new Map<string, CanvasSeat>(d.depts.flatMap((x) => x.seats).map((s) => [s.id, s]));
  const boss = d.company ? seatName(d.company) : "You";
  const low = (n: string) => (n === "You" ? "you" : n);
  const out: string[] = [];
  for (const s of dp.seats) {
    if (!s.agent) continue;
    const up = s.parent ? all.get(s.parent) : null;
    out.push(`${s.agent.name} reports to ${up ? (up.holder === "open" ? `the open ${up.title} seat` : low(seatName(up))) : low(boss)}.`);
  }
  for (const h of d.handoffs) {
    const a = all.get(h.from), b = all.get(h.to);
    if (!a || !b || !dp.seats.some((s) => s.id === h.from || s.id === h.to)) continue;
    out.push(`${seatName(a)} hands its summary and numbers to ${low(seatName(b))} in the ${h.chain} chain.`);
  }
  return out;
}
