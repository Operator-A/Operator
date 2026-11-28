"use client";
// Editing a department's Overview (packs slice 5), to the approved mockup. Each widget is a block: move it earlier or
// later, pick a third, two thirds or the full row (hidden on a phone, where every widget is full width), open its
// settings, or remove it. Blocks flow into rows of three columns in order, so nothing leaves a gap. Nothing changes
// for anyone until Save, which the server checks like a pack's layout (dashboard/packActions.ts saveLayout). Rules
// in core/layout-edit-rules.ts.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { DEFAULT_LAYOUT, SETTINGS, add, blockWords, catalog, flatten, fresh, hasSettings, keyWords, move, remove, replace, resize } from "@/core/layout-edit-rules";
import { MAX_WIDGETS, SERIES_LABEL, SNAPSHOT_MEASURES, WIDGET_LABEL, monthTile, runMetric, seriesBars, spanOf, type MetricUnit, type SeriesField, type SnapRow, type Widget, type WidgetKind } from "@/core/widget-rules";
import { MeasureTileView, RunMetricView, SeriesChartView } from "@/dashboard/components/widgetViews";

export interface EditAgent { id: string; name: string; keys: string[]; runs: { metrics: unknown }[] }
export interface ResetTo { label: string; title: string; sub: string; body: string; items: Widget[] | null }
type Result = { ok: boolean; text: string };
type Sheet = null | { kind: "add" } | { kind: "reset" } | { kind: "set"; i: number | null; x: Widget };

const TALL: ReadonlySet<WidgetKind> = new Set(["report", "series_chart", "agents", "chains"]);
const WIDTHS: { n: 1 | 2 | 3; label: string }[] = [{ n: 1, label: "1/3" }, { n: 2, label: "2/3" }, { n: 3, label: "Full" }];

export function LayoutEditor({ deptId, start, agents, snaps, today, reset, backHref, agentsHref, save }: {
  deptId: string; start: Widget[]; agents: EditAgent[]; snaps: SnapRow[]; today: string; reset: ResetTo; backHref: string; agentsHref: string;
  save: (deptId: string, items: Widget[] | null) => Promise<Result>;
}) {
  const router = useRouter();
  const [items, setItems] = useState<Widget[]>(start);
  // after Reset to the usual Overview, until anything else changes: Save clears the saved layout
  const [usual, setUsual] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, go] = useTransition();
  const names = useMemo(() => Object.fromEntries(agents.map((a) => [a.id, a.name])), [agents]);
  const edit = (next: Widget[]) => { setItems(next); setUsual(false); setMsg(null); };

  useEffect(() => {
    if (!sheet) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setSheet(null); };
    addEventListener("keydown", esc);
    return () => removeEventListener("keydown", esc);
  }, [sheet]);

  const onSave = () => go(async () => {
    try {
      const r = await save(deptId, usual ? null : items);
      if (r.ok) router.push(backHref, { scroll: false }); else setMsg(r.text);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong."); }
  });
  const doReset = () => {
    if (reset.items) { setItems(reset.items); setUsual(false); } else { setItems(flatten(DEFAULT_LAYOUT)); setUsual(true); }
    setMsg(null); setSheet(null);
  };
  const pick = (w: WidgetKind) => {
    const x = fresh(w, agents);
    if (hasSettings(x)) setSheet({ kind: "set", i: null, x });
    else { edit(add(items, x)); setSheet(null); }
  };
  const done = (x: Widget, i: number | null) => { edit(i == null ? add(items, x) : replace(items, i, x)); setSheet(null); };
  const selected = sheet?.kind === "set" ? sheet.i : null;

  return (
    <>
      <div className="ov-gridwrap"><div className="ov-grid le-grid">
        {items.map((x, i) => {
          const { name, sub } = blockWords(x, names);
          const n = spanOf(x);
          return (
            <div key={i} className={`ov-cell ov-s${n} le-b${selected === i ? " sel" : ""}`}>
              <div><b>{name}</b><div className="le-d">{sub}</div></div>
              <div className={`le-pv${TALL.has(x.w) ? " tall" : ""}`} aria-hidden="true" />
              <div className="le-ctl">
                <button type="button" className="le-ic" aria-label={`Move ${name} earlier`} disabled={i === 0} onClick={() => edit(move(items, i, -1))}>↑</button>
                <button type="button" className="le-ic" aria-label={`Move ${name} later`} disabled={i === items.length - 1} onClick={() => edit(move(items, i, 1))}>↓</button>
                <span className="le-wd" role="group" aria-label={`${name} width`}>
                  {WIDTHS.map((w) => <button key={w.n} type="button" aria-pressed={n === w.n} onClick={() => edit(resize(items, i, w.n))}>{w.label}</button>)}
                </span>
                {hasSettings(x) && <button type="button" className="le-ic" aria-label={`${name} settings`} onClick={() => setSheet({ kind: "set", i, x })}>✎</button>}
                <button type="button" className="le-ic x" aria-label={`Remove ${name}`} onClick={() => edit(remove(items, i))}>✕</button>
              </div>
            </div>
          );
        })}
        <button type="button" className="ov-cell ov-s3 le-add" disabled={items.length >= MAX_WIDGETS} onClick={() => setSheet({ kind: "add" })}>
          {items.length >= MAX_WIDGETS ? `A page holds ${MAX_WIDGETS} widgets at most` : "+ Add a widget"}
        </button>
      </div></div>
      <div className="le-bar">
        <span className="t" role="status">{msg ?? <><b>Editing the Overview.</b> Changes show only when you save.</>}</span>
        <button type="button" className="dp-btn sm" onClick={() => setSheet({ kind: "reset" })}>{reset.label}</button>
        <Link href={backHref} scroll={false} className="dp-btn sm">Cancel</Link>
        <button type="button" className="dp-btn sm dark" disabled={busy} onClick={onSave}>{busy ? "Saving…" : "Save layout"}</button>
      </div>
      {sheet && <div className="ag-bg open" onClick={() => setSheet(null)} />}
      {sheet?.kind === "add" && (
        <SheetBox title="Add a widget" sub="From core’s catalog. Each one shows numbers OPERATOR already saved." foot={<button type="button" className="dp-btn sm" onClick={() => setSheet(null)}>Close</button>}>
          <Catalog items={items} pick={pick} />
        </SheetBox>
      )}
      {sheet?.kind === "set" && <Settings key={sheet.i ?? "new"} start={sheet.x} agents={agents} snaps={snaps} today={today} agentsHref={agentsHref} cancel={() => setSheet(null)} done={(x) => done(x, sheet.i)} />}
      {sheet?.kind === "reset" && (
        <SheetBox short title={reset.title} sub={reset.sub} foot={<><button type="button" className="dp-btn sm" onClick={() => setSheet(null)}>Keep editing</button><button type="button" className="dp-btn sm dark" onClick={doReset}>Reset</button></>}>
          <p className="le-p">{reset.body}</p>
        </SheetBox>
      )}
    </>
  );
}

function SheetBox({ title, sub, foot, short, children }: { title: string; sub: string; foot: React.ReactNode; short?: boolean; children: React.ReactNode }) {
  return (
    <aside className={`ag open le-sheet${short ? " short" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className="le-sh"><b>{title}</b><span>{sub}</span></div>
      <div className="le-sb">{children}</div>
      <div className="le-sf">{foot}</div>
    </aside>
  );
}

/** Core's catalog: the widgets with settings first (more than once), then this department's (once each). */
function Catalog({ items, pick }: { items: Widget[]; pick: (w: WidgetKind) => void }) {
  const all = catalog(items);
  const card = (c: (typeof all)[number]) => (
    <button key={c.w} type="button" className={`le-ci${c.used ? " used" : ""}`} disabled={c.used} onClick={() => pick(c.w)}>
      <b>{c.label}</b><span>{c.used ? "On the page" : c.about}</span>
    </button>
  );
  return (
    <>
      <div className="le-h6">Numbers you pick</div>
      <div className="le-cat">{all.filter((c) => c.many).map(card)}</div>
      <div className="le-h6">This department</div>
      <div className="le-cat">{all.filter((c) => !c.many).map(card)}</div>
    </>
  );
}

const SUB: Partial<Record<WidgetKind, string>> = {
  measure_tile: "One number this month, worked out in code from what OPERATOR saved",
  series_chart: "Drawn from the daily numbers OPERATOR saves from your store",
  run_metric: "A number one of this department’s agents works out each run",
};

/** A widget's settings, picked from lists in code, with a preview from real saved numbers. */
function Settings({ start, agents, snaps, today, agentsHref, cancel, done }: { start: Widget; agents: EditAgent[]; snaps: SnapRow[]; today: string; agentsHref: string; cancel: () => void; done: (x: Widget) => void }) {
  const [x, setX] = useState<Widget>(start);
  const set = (p: Partial<Widget>) => setX({ ...x, ...p });
  const agent = agents.find((a) => a.id === x.agent) ?? null;
  const ok = x.w !== "run_metric" || (!!agent && !!x.key);
  return (
    <SheetBox title={WIDGET_LABEL[x.w]} sub={SUB[x.w] ?? ""} foot={<><button type="button" className="dp-btn sm" onClick={cancel}>Cancel</button><button type="button" className="dp-btn sm dark" disabled={!ok} onClick={() => done(x)}>Done</button></>}>
      {x.w === "measure_tile" && (
        <>
          <div className="le-fld"><label htmlFor="le-m">What it shows</label>
            <select id="le-m" value={x.measure ?? ""} onChange={(e) => set({ measure: e.target.value })}>{SETTINGS.measures.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select></div>
          <div className="le-fld"><label htmlFor="le-l">Label (optional)</label>
            <input id="le-l" maxLength={40} value={x.label ?? ""} placeholder={SETTINGS.measures.find((m) => m.key === x.measure)?.label} onChange={(e) => set({ label: e.target.value })} /></div>
          <div className="le-h6">Preview</div>
          {SNAPSHOT_MEASURES[x.measure ?? ""]
            ? <MeasureTileView label={x.label?.trim() || (SETTINGS.measures.find((m) => m.key === x.measure)?.label ?? "Number")} t={monthTile(snaps, SNAPSHOT_MEASURES[x.measure!], today)} />
            : <div className="le-note">This number is read from the saved daily readings of the goal that measures it. With no such goal, the tile says so.</div>}
        </>
      )}
      {x.w === "series_chart" && (
        <>
          <div className="le-fld"><label htmlFor="le-f">What it shows</label>
            <select id="le-f" value={x.field ?? "revenue"} onChange={(e) => set({ field: e.target.value as SeriesField })}>{SETTINGS.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}</select></div>
          <div className="le-fld"><span className="lbl">How far back</span>
            <span className="le-wd" role="group" aria-label="How far back">{SETTINGS.days.map((d) => <button key={d} type="button" aria-pressed={(x.days ?? 30) === d} onClick={() => set({ days: d })}>{d} days</button>)}</span></div>
          <div className="le-h6">Preview</div>
          <SeriesChartView title={SERIES_LABEL[x.field ?? "revenue"]} days={x.days ?? 30} {...seriesBars(snaps, x.field ?? "revenue", x.days ?? 30, today)} money={x.field !== "orders"} />
        </>
      )}
      {x.w === "run_metric" && (
        <>
          {agents.length ? (
            <div className="le-fld"><label htmlFor="le-a">Agent</label>
              <select id="le-a" value={x.agent ?? ""} onChange={(e) => { const a = agents.find((y) => y.id === e.target.value); set({ agent: e.target.value, key: a?.keys[0] ?? "", label: a?.keys[0] ? keyWords(a.keys[0]) : x.label }); }}>
                {!agent && <option value="">Pick an agent</option>}
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></div>
          ) : <div className="le-warn">This department has no agents yet. Hire one, and an agent number can show what its runs work out.</div>}
          {agent && (agent.keys.length ? (
            <div className="le-fld"><label htmlFor="le-k">Number</label>
              <select id="le-k" value={x.key ?? ""} onChange={(e) => set({ key: e.target.value, label: keyWords(e.target.value) })}>
                {!agent.keys.includes(x.key ?? "") && <option value={x.key ?? ""}>{x.key ? `${x.key} (not in the last runs)` : "Pick a number"}</option>}
                {agent.keys.map((k) => <option key={k} value={k}>{k}</option>)}
              </select></div>
          ) : <div className="le-warn">No numbers from {agent.name}’s last runs yet. An agent saves numbers when its runs finish with them.</div>)}
          <div className="le-fld"><label htmlFor="le-l2">Label</label>
            <input id="le-l2" maxLength={40} value={x.label ?? ""} onChange={(e) => set({ label: e.target.value })} /></div>
          <div className="le-fld"><label htmlFor="le-u">Reads as</label>
            <select id="le-u" value={x.unit ?? "count"} onChange={(e) => set({ unit: e.target.value as MetricUnit })}>{SETTINGS.units.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}</select></div>
          {agent && x.key && (
            <>
              <div className="le-h6">Preview</div>
              <RunMetricView label={x.label?.trim() || "Agent number"} v={runMetric(agent.runs, x.key, x.unit ?? "count")} who={agent.name} href={agentsHref} />
            </>
          )}
          <div className="le-warn">An agent number lists only this department’s agents, and only numbers that agent’s last runs saved. A number it stops saving shows that it has none.</div>
        </>
      )}
    </SheetBox>
  );
}
