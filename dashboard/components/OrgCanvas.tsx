"use client";
// Crew > Canvas (docs/crew-canvas.md): the org chart as a living thing. You, the company seat and a
// column per department, each seat a small card. Columns float, lines curve, and a run from today
// travels up its line as a pulse. Opening a department clears the rest away and shows what its
// agents last did. Read only: it calls no action, and every box and line comes from
// dashboard/org-canvas.ts.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { defaultOpen, deptBox, layoutCanvas, moveLines, seatName, teamSize, type Box, type CanvasData, type CanvasDept, type CanvasRun, type CanvasSeat, type Line } from "../org-canvas";
import { GoalTile } from "./goals";
import { Icon } from "./Icon";
import { DeptLimits } from "./orgBits";

const HUES = ["#AEB8FF", "#FFC9B8", "#BFEFDD", "#F5D98A", "#F6B8C9"];
const RUN_COLOR = { ok: "--lc-report", failed: "--lc-fail", running: "--lc-handoff" } as const;

interface Node { x: number; y: number; tx: number; ty: number; px: number; py: number; hw: number; hh: number; ox: number; oy: number; rides: string | null; show: boolean; amp: number; p1: number; p2: number; f1: number; f2: number; placed: boolean }
interface Part { line: Line; u: number; color: string }
interface Engine { nodes: Record<string, Node>; lines: Line[]; parts: Part[]; hs: Set<string>; lit: boolean; opened: boolean; W: number; H: number; runs: CanvasRun[]; runI: number; next: number }
type Curve = [number, number][];

/** A steady number from an id, so a box drifts the same way every time: nothing here is random. */
const seed = (id: string, salt: number) => { let h = salt; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 9973; return h / 9973; };

function curve(l: Line, A: Node, B: Node, opened: boolean): Curve {
  if (l.shape === "elbow") { const sx = B.px - B.hw + 8; return [[A.px - A.hw, A.py], [sx, A.py], [sx, A.py], [sx, B.py + B.hh]]; }
  if (l.shape === "tree" && A.py - A.hh > B.py + B.hh + 6) {
    const p0: [number, number] = [A.px, A.py - A.hh], p3: [number, number] = [B.px, B.py + B.hh], gap = p0[1] - p3[1], lift = opened ? gap / 2 : Math.min(40, gap * .6);
    return [p0, [p0[0], p0[1] - lift], [p3[0], opened ? p3[1] + gap / 2 : p0[1] - lift], p3];
  }
  if (l.shape === "side") { const x = Math.max(A.px + A.hw, B.px + B.hw) + 13; return [[A.px + A.hw, A.py], [x, A.py], [x, B.py], [B.px + B.hw, B.py]]; }
  const dx = B.px - A.px, dy = B.py - A.py, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
  const edge = (n: Node) => Math.min(n.hw / (Math.abs(ux) || 1e-6), n.hh / (Math.abs(uy) || 1e-6), dist * .45);
  const ta = edge(A), tb = edge(B), p0: [number, number] = [A.px + ux * ta, A.py + uy * ta], p3: [number, number] = [B.px - ux * tb, B.py - uy * tb], b = dist * .13 * l.bend;
  const c = [(p0[0] + p3[0]) / 2 - uy * b, (p0[1] + p3[1]) / 2 + ux * b];
  return [p0, [p0[0] + (c[0] - p0[0]) * .67, p0[1] + (c[1] - p0[1]) * .67], [p3[0] + (c[0] - p3[0]) * .67, p3[1] + (c[1] - p3[1]) * .67], p3];
}
const at = (g: Curve, u: number): [number, number] => { const v = 1 - u, a = v * v * v, b = 3 * v * v * u, c = 3 * v * u * u, d = u * u * u; return [a * g[0][0] + b * g[1][0] + c * g[2][0] + d * g[3][0], a * g[0][1] + b * g[1][1] + c * g[2][1] + d * g[3][1]]; };

export function OrgCanvas({ d }: { d: CanvasData }) {
  const router = useRouter();
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  const els = useRef<Record<string, HTMLElement | null>>({});
  const eng = useRef<Engine>({ nodes: {}, lines: [], parts: [], hs: new Set(), lit: false, opened: false, W: 0, H: 0, runs: [], runI: 0, next: 0 });
  const [W, setW] = useState(0);
  const [focus, setFocus] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  // whose teams show: a big department starts as its head, and each fold row opens one level down
  const [open, setOpen] = useState<ReadonlySet<string>>(() => defaultOpen(d));
  const fold = (seat: string) => setOpen((o) => { const n = new Set(o); if (!n.delete(seat)) n.add(seat); return n; });

  const opened = focus ? d.depts.find((x) => x.id === focus) ?? null : null;
  const lay = useMemo(() => (W ? layoutCanvas(d, W, opened?.id ?? null, open) : null), [d, W, opened, open]);
  const seats = useMemo(() => new Map<string, { seat: CanvasSeat; dept: CanvasDept | null }>([...(d.company ? [[d.company.id, { seat: d.company, dept: null }] as const] : []), ...d.depts.flatMap((dp) => dp.seats.map((s) => [s.id, { seat: s, dept: dp }] as const))]), [d]);
  const picked = sel && opened?.seats.some((s) => s.id === sel) ? sel : null;

  // what is lit: the hovered or picked box, a hovered department's seats, and whatever a line joins them to
  const lit = hot ?? picked;
  const { hs, near } = useMemo(() => {
    const hs = new Set<string>(lit ? [lit] : []);
    if (lit && lay) for (const b of Object.values(lay.boxes)) if (b.rides === lit && !lay.boxes[lit]?.focus) hs.add(b.id);
    const near = new Set(hs);
    for (const l of lay?.lines ?? []) { if (hs.has(l.a)) near.add(l.b); if (hs.has(l.b)) near.add(l.a); }
    return { hs, near };
  }, [lit, lay]);

  const go = (id: string | null) => { setFocus(id); setSel(null); setHot(null); };

  // the canvas follows its box: width picks the layout, and the drawing surface matches what is on screen
  useEffect(() => {
    const el = wrap.current, c = cv.current;
    if (!el || !c) return;
    const fit = () => {
      const r = el.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      eng.current.W = r.width; eng.current.H = r.height; c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      c.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0); setW(Math.round(r.width));
    };
    const ro = new ResizeObserver(fit); ro.observe(el); fit();
    return () => ro.disconnect();
  }, []);

  // hand the layout to the engine: where each box should be, and the lines between them
  useEffect(() => {
    if (!lay) return;
    const e = eng.current;
    els.current = {};
    for (const el of wrap.current?.querySelectorAll<HTMLElement>("[data-box]") ?? []) els.current[el.dataset.box as string] = el;
    for (const id of Object.keys(e.nodes)) if (!lay.boxes[id]) delete e.nodes[id];
    for (const b of Object.values(lay.boxes)) {
      const n = (e.nodes[b.id] ??= { x: b.x, y: b.y, tx: b.x, ty: b.y, px: b.x, py: b.y, hw: b.w / 2, hh: b.h / 2, ox: 0, oy: 0, rides: null, show: false, amp: 0, p1: seed(b.id, 7) * 6.3, p2: seed(b.id, 13) * 6.3, f1: .25 + seed(b.id, 3) * .2, f2: .4 + seed(b.id, 5) * .25, placed: false });
      n.show = b.show; n.rides = b.rides;
      if (!b.show) continue;
      n.hw = b.w / 2; n.hh = b.h / 2; n.amp = b.kind === "dept" ? (b.focus ? 0 : b.port ? 3 : 4) : b.rides ? 1.2 : 2;
      const c = b.rides ? lay.boxes[b.rides] : null;
      if (c) { n.ox = b.x - c.x; n.oy = b.y - c.y; }
      n.tx = b.x; n.ty = b.y;
      if (!n.placed) { n.x = b.x; n.y = b.y; n.placed = true; }
    }
    e.lines = lay.lines; e.parts = []; e.opened = !!opened;
  }, [lay, opened]);
  useEffect(() => { eng.current.hs = hs; eng.current.lit = !!lit; }, [hs, lit]);
  useEffect(() => { eng.current.runs = d.runs; }, [d.runs]);
  useEffect(() => {
    const esc = (ev: KeyboardEvent) => { if (ev.key !== "Escape") return; if (sel) setSel(null); else setFocus(null); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [sel]);

  // the loop: ease every box to its place, let it drift, draw the lines, and send today's runs up them
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    let raf = 0, last = 0, tick = 0, col: Record<string, string> = {};
    const ping = (id: string, color: string) => { const el = els.current[id]; if (!el) return; el.style.setProperty("--pc", color); el.classList.add("ping"); window.setTimeout(() => el.classList.remove("ping"), 800); };
    const frame = (now: number) => {
      const e = eng.current, c = cv.current, ctx = c?.getContext("2d"), t = now / 1000, dt = Math.min(.05, (now - last) / 1000 || .016), k = 1 - Math.exp(-dt * 5.5), calm = still.matches;
      last = now;
      if (wrap.current && tick++ % 45 === 0) { const cs = getComputedStyle(wrap.current); col = Object.fromEntries(["--lc-report", "--lc-handoff", "--lc-fail"].map((v) => [v, cs.getPropertyValue(v).trim()])); }
      const move = (id: string, n: Node) => {
        const host = n.rides ? e.nodes[n.rides] : null;
        if (host) { n.tx = host.px + n.ox; n.ty = host.py + n.oy; }
        n.x += (n.tx - n.x) * k; n.y += (n.ty - n.y) * k;
        const a = calm ? 0 : n.amp;
        n.px = n.x + Math.sin(t * n.f1 + n.p1) * a + Math.sin(t * n.f2 + n.p2) * a * .5; n.py = n.y + Math.cos(t * n.f1 * .9 + n.p2) * a + Math.sin(t * n.f2 * 1.1 + n.p1) * a * .5;
        const el = els.current[id]; if (el) el.style.transform = `translate3d(${n.px.toFixed(1)}px,${n.py.toFixed(1)}px,0)`;
      };
      // departments first, so a card rides where its column is this frame
      for (const [id, n] of Object.entries(e.nodes)) if (!n.rides) move(id, n);
      for (const [id, n] of Object.entries(e.nodes)) if (n.rides) move(id, n);
      if (ctx) {
        ctx.clearRect(0, 0, e.W, e.H);
        const curves = new Map<Line, Curve>();
        for (const l of e.lines) {
          const A = e.nodes[l.a], B = e.nodes[l.b];
          if (!A?.show || !B?.show) continue;
          const g = curve(l, A, B, e.opened); curves.set(l, g);
          ctx.globalAlpha = e.lit ? (e.hs.has(l.a) || e.hs.has(l.b) ? .95 : .12) : l.type === "report" ? .55 : .75;
          ctx.strokeStyle = ctx.fillStyle = col[l.type === "report" ? "--lc-report" : "--lc-handoff"] || "#6272EE"; ctx.lineWidth = 1.7; ctx.lineCap = "round";
          ctx.setLineDash(l.type === "handoff" ? [7, 7] : []); ctx.lineDashOffset = calm ? 0 : -t * 16;
          ctx.beginPath(); ctx.moveTo(g[0][0], g[0][1]); ctx.bezierCurveTo(g[1][0], g[1][1], g[2][0], g[2][1], g[3][0], g[3][1]); ctx.stroke();
          if (l.type === "handoff") { ctx.setLineDash([]); ctx.beginPath(); ctx.arc(g[3][0], g[3][1], 3, 0, 6.3); ctx.fill(); }
        }
        ctx.setLineDash([]); ctx.globalAlpha = 1;
        for (const p of e.parts) {
          const g = curves.get(p.line); if (!g) continue;
          const [x, y] = at(g, p.u < .5 ? 2 * p.u * p.u : 1 - 2 * (1 - p.u) * (1 - p.u)), color = col[p.color] || "#6272EE";
          ctx.shadowColor = color; ctx.shadowBlur = 14; ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.3); ctx.fill(); ctx.shadowBlur = 0;
        }
      }
      if (!calm) {
        for (const p of e.parts) { p.u += dt / 1.5; if (p.u >= 1) ping(p.line.b, `var(${p.color})`); }
        e.parts = e.parts.filter((p) => p.u < 1);
        if (now > e.next) {
          e.next = now + 1700 + seed(String(e.runI), 11) * 1500;
          // the next of today's runs whose agent is on screen leaves its card and travels up its report line
          for (let i = 0; i < e.runs.length; i++) {
            const r = e.runs[(e.runI + i) % e.runs.length], n = e.nodes[r.seat];
            if (!n?.show) continue;
            e.runI = (e.runI + i + 1) % e.runs.length;
            const l = e.lines.find((x) => x.a === r.seat && x.type === "report");
            ping(r.seat, `var(${RUN_COLOR[r.status]})`);
            if (l && e.nodes[l.b]?.show) e.parts.push({ line: l, u: 0, color: RUN_COLOR[r.status] });
            break;
          }
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const click = (b: Box) => {
    if (b.kind === "dept") return go(b.id.slice(5));
    if (b.kind === "fold") return b.of ? fold(b.of) : undefined;
    const at = seats.get(b.id);
    if (b.kind === "you" || !at?.dept) { if (opened) go(null); return; }
    if (!opened) return go(at.dept.id);
    if (at.seat.agent) setSel(picked === b.id ? null : b.id);
    else if (at.seat.href) router.push(at.seat.href);
  };
  const size = (b: Box) => ({ [b.kind === "dept" ? "--w" : "--cw"]: `${b.w}px`, [b.kind === "dept" ? "--h" : "--ch"]: `${b.h}px` }) as React.CSSProperties;
  const cls = (b: Box, more: string) => `lc-n ${more}${b.show ? "" : " gone"}${lit && b.show && (b.kind === "dept" ? lit.startsWith("dept:") && !near.has(b.id) && !b.focus : !near.has(b.id)) ? " dim" : ""}`;
  const hover = (b: Box) => ({ onPointerEnter: () => setHot(b.id), onPointerLeave: () => setHot(null), onFocus: () => setHot(b.id), onBlur: () => setHot(null) });
  const waiting = opened ? null : "Click a department to open it.";

  return (
    <div className="lc">
      <nav className="lc-chips" aria-label="Departments">
        <button type="button" className={`lc-chip${opened ? "" : " on"}`} aria-pressed={!opened} onClick={() => go(null)}>Whole company</button>
        {d.depts.map((dp, i) => <button key={dp.id} type="button" className={`lc-chip${opened?.id === dp.id ? " on" : ""}`} aria-pressed={opened?.id === dp.id} onClick={() => go(dp.id)} style={{ "--hue": HUES[i % HUES.length] } as React.CSSProperties}><i />{dp.name}</button>)}
      </nav>
      <div className="lc-stage">
        <section ref={wrap} className="lc-wrap" aria-label="Org chart" style={{ height: lay?.height ?? 480 }} onClick={() => { if (picked) setSel(null); else if (opened) go(null); }}>
          <span className="lc-blob b0" aria-hidden="true" /><span className="lc-blob b1" aria-hidden="true" /><span className="lc-blob b2" aria-hidden="true" />
          {waiting && <span className="lc-hint">{waiting}</span>}
          {opened && <button type="button" className="btn outline sm lc-back" onClick={(ev) => { ev.stopPropagation(); go(null); }}><Icon name="chevron-left" size={14} />Whole company</button>}
          <div className="lc-nodes">
            {lay && Object.values(lay.boxes).map((b) => {
              const common = { "data-box": b.id, type: "button" as const, tabIndex: b.show ? 0 : -1, "aria-hidden": !b.show, onClick: (ev: React.MouseEvent) => { ev.stopPropagation(); click(b); }, ...hover(b) };
              if (b.kind === "dept") {
                const i = d.depts.findIndex((x) => deptBox(x.id) === b.id), dp = d.depts[i];
                return (
                  <button key={b.id} {...common} className={cls(b, `lc-dept${b.focus ? " focus" : ""}${b.port ? " port" : ""}`)} style={{ "--hue": HUES[i % HUES.length] } as React.CSSProperties} aria-label={`Open ${dp.name}`}>
                    <span className="lc-in"><span className="lc-cell" style={size(b)}><span className="lc-lbl"><b>{dp.name}</b></span></span></span>
                  </button>
                );
              }
              if (b.kind === "fold") {
                const at = b.of ? seats.get(b.of) : null;
                if (!at?.dept) return null;
                const n = teamSize(at.dept, at.seat.id), shown = open.has(at.seat.id) || (opened && at.seat.id === opened.seats[0]?.id);
                return (
                  <button key={b.id} {...common} className={cls(b, `lc-fold${shown ? " shown" : ""}`)} aria-expanded={!!shown} aria-label={`${shown ? "Hide" : "Show"} the ${n} seat${n === 1 ? "" : "s"} under ${seatName(at.seat)}`}>
                    <span className="lc-in" style={size(b)}><Icon name={shown ? "chevron-up" : "chevron-down"} size={13} /><span>{shown ? "Hide" : "Show"} {n} seat{n === 1 ? "" : "s"}</span></span>
                  </button>
                );
              }
              if (b.kind === "you") return <button key={b.id} {...common} className={cls(b, "lc-card you")}><span className="lc-in" style={size(b)}><span className="lc-meta"><b>You</b><span className="lc-role">Every approval is yours</span></span></span></button>;
              const s = seats.get(b.id)?.seat;
              if (!s) return null;
              const a = s.agent;
              return (
                <button key={b.id} {...common} className={cls(b, `lc-card ${a ? a.state : s.holder}${b.big ? " lc-big" : ""}${picked === b.id ? " sel" : ""}`)} aria-label={a ? `${a.name}, ${s.title}, ${a.label}` : s.holder === "owner" ? `You, ${s.title}` : `${s.title}, open seat`}>
                  <span className="lc-in" style={size(b)}>
                    <i className="lc-sd" aria-hidden="true" />
                    <span className="lc-meta">
                      <b>{seatName(s)}</b>
                      <span className="lc-role">{a || s.holder === "owner" ? s.title : s.proposal ? "Proposal waiting" : s.sub || "Open seat"}</span>
                      {a && <span className="lc-more"><span className={`lc-st ${a.state}`}>{a.label}</span><span className="lc-doing">{a.summary ?? a.last}</span></span>}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <canvas ref={cv} aria-hidden="true" />
        </section>
        <Panel d={d} opened={opened} picked={picked ? seats.get(picked)?.seat ?? null : null} pick={setSel} />
      </div>
    </div>
  );
}

function Feed({ runs }: { runs: CanvasRun[] }) {
  if (!runs.length) return <span className="sub">No runs yet today.</span>;
  return (
    <ul className="lc-feed">
      {runs.slice(0, 6).map((r) => (
        <li key={r.id}><Link href={r.href}><i style={{ background: `var(${RUN_COLOR[r.status]})` }} /><span><b>{r.who}</b> {r.text}</span><time>{r.at}</time></Link></li>
      ))}
    </ul>
  );
}

function Panel({ d, opened, picked, pick }: { d: CanvasData; opened: CanvasDept | null; picked: CanvasSeat | null; pick: (id: string | null) => void }) {
  if (opened && picked?.agent) {
    const a = picked.agent, lines = moveLines(d, opened.id).filter((l) => l.includes(a.name));
    return (
      <aside className="card lc-panel" aria-live="polite">
        <button type="button" className="lc-link" onClick={() => pick(null)}><Icon name="chevron-left" size={13} />{opened.name}</button>
        <div className="stack" style={{ gap: 4 }}><h2 className="lc-h2">{a.name}</h2><span className="sub">{picked.title} · {opened.name}</span></div>
        <span className="row wrap" style={{ gap: 8 }}><span className={`lc-st ${a.state}`}>{a.label}</span><span className="sub">{a.last}</span></span>
        {a.job && <div className="lc-sec"><span className="lc-k">What it does</span><p>{a.job}</p></div>}
        <div className="lc-sec"><span className="lc-k">Its last run</span><p>{a.summary ?? "It hasn’t run yet."}</p></div>
        {a.writes && <div className="lc-sec"><span className="lc-k">What a run hands you</span><p>{a.writes}</p></div>}
        {lines.length > 0 && <div className="lc-sec"><span className="lc-k">Who it works with</span><ul className="lc-moves">{lines.map((l) => <li key={l}>{l}</li>)}</ul></div>}
        <div className="lc-sec"><span className="lc-k">Today</span><Feed runs={d.runs.filter((r) => r.seat === picked.id)} /></div>
        <div className="row wrap" style={{ gap: 8 }}>
          <Link href={a.href} className="btn dark sm">Open {a.name}</Link>
          {a.lastRunHref && <Link href={a.lastRunHref} className="btn outline sm">Replay its last run</Link>}
        </div>
      </aside>
    );
  }
  if (opened) {
    const ids = new Set(opened.seats.map((s) => s.id)), moves = moveLines(d, opened.id), open = opened.seats.filter((s) => s.holder === "open").length;
    return (
      <aside className="card lc-panel" aria-live="polite">
        <div className="stack" style={{ gap: 4 }}><span className="lc-k">Department</span><h2 className="lc-h2">{opened.name}</h2><span className="sub">{opened.seats.length} seat{opened.seats.length === 1 ? "" : "s"}{open ? ` · ${open} open` : ""}</span></div>
        <DeptLimits d={opened} />
        {opened.goals != null && (
          <div className="lc-sec">
            <span className="lc-k">Goals</span>
            {opened.goals.map((g) => <GoalTile key={g.id} g={g} />)}
            {opened.goals.length === 0 && <Link href={`/goals/new?dept=${opened.id}`} className="goal-add"><Icon name="plus" size={14} />Set a goal for {opened.name}</Link>}
          </div>
        )}
        {moves.length > 0 && <div className="lc-sec"><span className="lc-k">How work moves here</span><ul className="lc-moves">{moves.map((l) => <li key={l}>{l}</li>)}</ul></div>}
        {opened.rules.length > 0 && <div className="lc-sec"><span className="lc-k">Rules every agent here follows</span><ul className="lc-moves">{opened.rules.map((r) => <li key={r}>{r}</li>)}</ul></div>}
        <div className="lc-sec">
          <span className="lc-k">Agents</span>
          {opened.seats.filter((s) => s.agent).map((s) => (
            <button key={s.id} type="button" className="lc-row" onClick={() => pick(s.id)}><span><b>{s.agent!.name}</b><span className="sub">{s.title}</span></span><span className={`lc-st ${s.agent!.state}`}>{s.agent!.label}</span></button>
          ))}
          {!opened.seats.some((s) => s.agent) && <span className="sub">No agent sits here yet. Click an open seat to build one.</span>}
        </div>
        <div className="lc-sec"><span className="lc-k">Today</span><Feed runs={d.runs.filter((r) => ids.has(r.seat))} /></div>
        <Link href="/crew?view=edit" className="lc-link"><Icon name="pencil" size={13} />Edit seats, budget and rules</Link>
      </aside>
    );
  }
  const all = [...(d.company ? [d.company] : []), ...d.depts.flatMap((x) => x.seats)], agents = all.filter((s) => s.agent);
  return (
    <aside className="card lc-panel" aria-live="polite">
      <div className="stack" style={{ gap: 4 }}><span className="lc-k">Whole company</span><h2 className="lc-h2">Your crew, working together</h2></div>
      <div className="lc-stats">
        <div><b>{agents.length}</b><span>agent{agents.length === 1 ? "" : "s"}</span></div>
        <div><b>{agents.filter((s) => s.agent!.state === "run" || s.agent!.state === "on").length}</b><span>on shift</span></div>
        <div><b>{all.filter((s) => s.holder === "open").length}</b><span>open seats</span></div>
      </div>
      <div className="lc-sec"><span className="lc-k">Today</span><Feed runs={d.runs} /></div>
      <div className="lc-sec">
        <span className="lc-k">What the lines mean</span>
        <span className="lc-leg"><i />Reports to</span>
        {d.handoffs.length > 0 && <span className="lc-leg dash"><i />Hands its summary and numbers on (a chain)</span>}
        <span className="lc-leg lc-dot"><i />A run from today</span>
      </div>
    </aside>
  );
}

