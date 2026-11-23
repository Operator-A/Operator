"use client";
// An agent's sheet (docs/department-pages.md, slice 4), as in the approved mockup: a glass drawer on the right
// on desktop, a sheet from the bottom on a phone, with Runs and Edit. It is in the address (?agent=), so back
// closes it. Every change goes through the server actions the old agent and builder pages used, with their
// checks: a changed job, model, reads or can do saves a new version that goes live only after a clean try.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { SheetData } from "@/dashboard/agentSheet";
import { clock, dayLabel, initialsOf, runFoot, runState, runTitle } from "@/dashboard/dept-feed";
import { daysOf, type AgentTime } from "@/core/flow-rules";
import { notionId } from "@/core/settings-rules";

type Result = { ok: boolean; text: string };
export interface SheetActions {
  duty: (on: boolean) => Promise<Result>;
  run: () => Promise<Result>;
  time: (t: AgentTime | null, confirmed: boolean) => Promise<Result>;
  budget: (v: number) => Promise<Result>;
  save: (draft: unknown, note: string) => Promise<Result>;
  tryIt: () => Promise<Result & { runId?: string }>;
  goLive: (version: number, keep: null, confirmed: boolean) => Promise<Result>;
  forget: (memoryId: string) => Promise<Result>;
  keep: (memoryId: string, forCrew: boolean) => Promise<Result>;
  discard: (memoryId: string) => Promise<Result>;
  goBack: (version: number, confirmed: boolean) => Promise<Result>;
  /** An agent that runs in Claude (live events slice 2): its routine, and moving it into OPERATOR. */
  routineSave: (routine: string, token: string) => Promise<Result>;
  routineRemove: () => Promise<Result>;
  moveIn: () => Promise<Result>;
}

const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const X = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;
const CLOCK = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const asksConfirm = (r: Result) => !r.ok && /^Confirm first/.test(r.text);

export function AgentSheet({ d, closeHref, tz, now, controls, act, edit = false }: { d: SheetData; closeHref: string; tz: string; now: number; controls: boolean; act: SheetActions; edit?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"runs" | "edit">(edit ? "edit" : "runs");
  const [opened, setOpened] = useState<string | null>(d.runs[0]?.id ?? null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, setConfirm] = useState<string | null>(null);
  // the edit form, from what the server drew; a fresh draw (after a save) starts it over
  const init = () => ({
    job: d.spec?.directive ?? "", model: d.spec?.model ?? "", tools: [...(d.spec?.tools ?? [])],
    days: d.days, time: d.time, manual: d.manual, budget: d.budget.toFixed(2),
    // more detail (slice 6): what the step editor held
    good: d.spec?.goodResult ?? "", cap: (d.spec?.limits.maxCostUsd ?? 0).toFixed(2), steps: String(d.spec?.limits.maxSteps ?? 0),
    pages: [...(d.spec?.notionPages ?? [])], from: [...(d.spec?.readsFrom ?? [])], reportPage: d.spec?.reportPage ?? null,
  });
  const [f, setF] = useState(init);
  const [drawn, setDrawn] = useState(d);
  if (drawn !== d) { setDrawn(d); setF(init()); setConfirm(null); }
  const [addReads, setAddReads] = useState(false);
  const [addPage, setAddPage] = useState<"read" | "report" | null>(null);
  const [link, setLink] = useState(""), [linkLabel, setLinkLabel] = useState("");
  const [addFrom, setAddFrom] = useState(false), [addReport, setAddReport] = useState(false);
  const [rt, setRt] = useState({ routine: "", token: "" });
  const [pick, setPick] = useState(false);

  useEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", esc);
    return () => { cancelAnimationFrame(r); removeEventListener("keydown", esc); };
  });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);

  function close() { setOpen(false); setTimeout(() => router.push(closeHref, { scroll: false }), 320); }
  const set = (p: Partial<ReturnType<typeof init>>) => { setF((x) => ({ ...x, ...p })); setConfirm(null); };
  const say = (r: Result) => setToast(r.text);
  const go = (fn: () => Promise<Result>) => start(async () => { try { say(await fn()); } catch (e) { setToast(e instanceof Error ? e.message : "Something went wrong."); } });

  const capN = Number(f.cap), stepsN = Number(f.steps);
  const moreChanged = !!d.spec && (f.good.trim() !== d.spec.goodResult.trim() || Math.round(capN * 100) !== Math.round(d.spec.limits.maxCostUsd * 100) || stepsN !== d.spec.limits.maxSteps
    || JSON.stringify(f.pages) !== JSON.stringify(d.spec.notionPages) || JSON.stringify(f.from) !== JSON.stringify(d.spec.readsFrom) || JSON.stringify(f.reportPage) !== JSON.stringify(d.spec.reportPage));
  const specChanged = !!d.spec && (moreChanged || f.job.trim() !== d.spec.directive.trim() || f.model !== d.spec.model || f.tools.slice().sort().join() !== d.spec.tools.slice().sort().join());
  const usePage = () => {
    const id = notionId(link);
    if (!id) { setToast("That doesn’t look like a Notion page link. In Notion use Share, then Copy link."); return; }
    const page = { id, label: linkLabel.trim().slice(0, 60) || "Notion page" };
    if (addPage === "read") { if (!f.pages.some((x) => x.id === id)) set({ pages: [...f.pages, page].slice(0, 10) }); }
    else set({ reportPage: page });
    setLink(""); setLinkLabel(""); setAddPage(null);
  };
  const dayChoice = daysOf(f.days);
  const timeChanged = f.manual !== d.manual || (!f.manual && (f.time !== d.time || f.days.slice().sort().join() !== d.days.slice().sort().join()));
  const budgetN = Number(f.budget);
  const budgetChanged = Number.isFinite(budgetN) && Math.round(budgetN * 100) !== Math.round(d.budget * 100);
  const dirty = specChanged || timeChanged || budgetChanged;
  const toggleTool = (id: string) => set({ tools: f.tools.includes(id) ? f.tools.filter((t) => t !== id) : [...f.tools, id] });

  function save(confirmed: boolean) {
    start(async () => {
      const said: string[] = [];
      try {
        if (timeChanged) {
          if (!f.manual && !dayChoice) { setToast("Pick at least one day."); return; }
          const r = await act.time(f.manual ? null : { days: dayChoice!, time: f.time }, confirmed);
          if (asksConfirm(r)) { setConfirm(r.text); return; }
          if (!r.ok) { setToast(r.text); return; }
          said.push(r.text);
        }
        if (budgetChanged) { const r = await act.budget(budgetN); if (!r.ok) { setToast(r.text); return; } said.push(r.text); }
        if (specChanged && d.spec) {
          const r = await act.save({
            ...d.spec, directive: f.job.trim(), model: f.model, tools: f.tools, goodResult: f.good.trim(),
            limits: { maxCostUsd: Number.isFinite(capN) ? capN : d.spec.limits.maxCostUsd, maxSteps: Number.isFinite(stepsN) ? Math.round(stepsN) : d.spec.limits.maxSteps },
            notionPages: f.pages, readsFrom: f.from, reportPage: f.reportPage,
          }, "Edited in the agent sheet");
          if (!r.ok) { setToast(r.text); return; }
          said.push(r.text);
        }
        setConfirm(null);
        setToast(said.join(" ") || "Nothing changed.");
      } catch (e) { setToast(e instanceof Error ? e.message : "Something went wrong."); }
    });
  }

  const reads = d.reads.filter((r) => f.tools.includes(r.id));
  const st = d.enabled;
  return (
    <>
      <div className={`ag-bg${open ? " open" : ""}`} onClick={close} />
      <aside className={`ag${open ? " open" : ""}`} aria-label={d.name} role="dialog" aria-modal="true">
        <div className="ag-h">
          <div className="dp-av">{initialsOf(d.name)}</div>
          <div><b>{d.name}</b><span>{d.role}</span></div>
          <button type="button" className="x" onClick={close} aria-label="Close">{X}</button>
        </div>
        <div className="ag-state">
          <button type="button" className="dp-tog" aria-pressed={st} disabled={busy} onClick={() => go(() => act.duty(!st))}><i />{st ? "On duty" : "Off duty"}</button>
          {d.claude ? <span className="dp-where">Runs in Claude</span> : d.model && <span className="dp-where">Runs on {d.model}</span>}
          <span className="dp-pill ag-next">{d.next ? `Next: ${d.next}` : d.manual ? "Only when you ask" : "No run planned"}</span>
          <button type="button" className="dp-btn" disabled={busy || !controls} title={controls ? undefined : "Real runs are off on this OPERATOR"} onClick={() => go(act.run)}>Run now</button>
        </div>
        <div className="ag-seg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "runs"} className={tab === "runs" ? "on" : ""} onClick={() => setTab("runs")}>Runs</button>
          <button type="button" role="tab" aria-selected={tab === "edit"} className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}>Edit</button>
        </div>

        {tab === "runs" && (
          <div className="ag-body">
            {!d.runs.length && <span className="dp-note">No runs in the last 60 days. Press Run now, and its checklist shows here and in the chat.</span>}
            {d.runs.map((r) => {
              const s = runState(r.status);
              const on = opened === r.id;
              const need = r.drafts.length;
              return (
                <div key={r.id} className={`runrow${on ? " open" : ""}`}>
                  <button type="button" className="runrow-hit" aria-expanded={on} onClick={() => setOpened(on ? null : r.id)}>
                    <span className="top2"><b>{runTitle(r.trigger)}</b>{dayLabel(r.at, tz, now)} {clock(r.at, tz)}<span className={`st ${need ? "warn" : s.look}`}>{need ? `${need} need${need === 1 ? "s" : ""} you` : s.word}</span></span>
                    {r.result && <span className="res">{r.result}</span>}
                  </button>
                  {on && r.lines.length > 0 && <ul className="dp-steps">{r.lines.map((l, i) => <li key={i} className={l.state}><span className="ck" /><span>{l.label}</span></li>)}</ul>}
                  <span className="meta">{runFoot(r.steps, r.at, r.endedAt, r.costUsd)} · {r.session ? <a href={r.session} target="_blank" rel="noopener noreferrer">Open in Claude</a> : <Link href={`/runs/${r.id}`}>How it thought</Link>}</span>
                </div>
              );
            })}
            <Link href="/runs" className="dp-note" style={{ textDecoration: "underline" }}>Every run, on Runs</Link>
          </div>
        )}

        {tab === "edit" && (
          <div className="ag-body">
            {!d.spec && <span className="dp-note">{d.name} has no saved version to edit.</span>}
            {d.claude && (
              <>
                <div className="ag-draft">
                  <b>{d.name} runs in Claude.</b>
                  <span>Each run, on its schedule, from a chain, an event or Run now, starts a session of your Claude routine. The session posts its result back here. What it does with its Claude connectors happens in Claude, outside OPERATOR’s approval cards and caps; its prompt asks it to send anything outward here as a proposal.</span>
                </div>
                <div className="fld"><span className="lbl">Uses in Claude</span>
                  <div className="dp-chipset">{d.claude.tools.length ? d.claude.tools.map((t) => <span key={t} className="dp-chip">{t}</span>) : <span className="dp-note">No connectors named.</span>}</div></div>
                <div className="fld"><span className="lbl">Job</span><span style={{ fontSize: 14, whiteSpace: "pre-wrap" }}>{d.spec?.directive || "No job saved."}</span>
                  <span className="dp-note">Sent with every run. Change it in the routine’s prompt on claude.ai.</span></div>
                <div className="fld"><span className="lbl">Claude routine</span>
                  {d.claude.routine.connected
                    ? <span style={{ fontSize: 14 }}>{d.claude.routine.paused ? `Paused: ${d.claude.routine.paused}` : `Connected: ${d.claude.routine.routine ?? "routine"}`}</span>
                    : <span className="dp-note">Not connected yet. Nothing runs until it is.</span>}
                  <ol className="dp-note" style={{ paddingLeft: 18, margin: "6px 0" }}>
                    <li>On claude.ai, open Routines and click New routine. Give it the connectors above.</li>
                    <li>Paste this line into its prompt: <code style={{ userSelect: "all" }}>{d.claude.prompt}</code></li>
                    <li>Click Edit, then Trigger, then API, then Generate token. Copy the routine id (trig_…) and the token. Claude shows the token once.</li>
                  </ol>
                  <input aria-label="Routine id" placeholder="trig_…" value={rt.routine} onChange={(e) => setRt((x) => ({ ...x, routine: e.target.value }))} autoComplete="off" />
                  <input aria-label="Routine token" placeholder="sk-ant-oat01-…" type="password" value={rt.token} onChange={(e) => setRt((x) => ({ ...x, token: e.target.value }))} autoComplete="off" />
                  <div className="dp-btns">
                    <button type="button" className="dp-btn dark" disabled={busy || !rt.routine.trim() || !rt.token.trim()} onClick={() => go(async () => { const r = await act.routineSave(rt.routine, rt.token); if (r.ok) setRt({ routine: "", token: "" }); return r; })}>{d.claude.routine.connected ? "Replace" : "Save"}</button>
                    {d.claude.routine.connected && <button type="button" className="dp-btn" disabled={busy} onClick={() => go(act.routineRemove)}>Forget token</button>}
                  </div>
                  <span className="dp-note">The token is locked away and never shown again. It can only start this one routine.</span></div>
                <div className="fld"><span className="lbl">When OPERATOR has its connectors</span>
                  <button type="button" className="dp-btn" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={() => { if (window.confirm(`Move ${d.name} into OPERATOR? It keeps its runs and goes off duty until you give it reads, try it and go live.`)) go(act.moveIn); }}>Move into OPERATOR</button></div>
              </>
            )}
            {d.spec && d.draft && !d.claude && (
              <div className="ag-draft">
                <b>Draft v{d.version} isn’t live yet.</b>
                <span>{d.tried ? (d.tried.clean ? `Its try worked on every step (${d.tried.at}).` : `Its latest try ${d.tried.why}.`) : "Try it on today’s data. It sends nothing."} {d.live ? `v${d.live} keeps running until you go live.` : ""}</span>
                <div className="dp-btns">
                  <button type="button" className="dp-btn" disabled={busy || !controls} onClick={() => go(act.tryIt)}>{d.tried ? "Try again" : "Try it"}</button>
                  <button type="button" className="dp-btn dark" disabled={busy || !controls || !d.tried?.clean} onClick={() => start(async () => {
                    const r = await act.goLive(d.version, null, false);
                    if (asksConfirm(r)) { if (window.confirm(r.text)) say(await act.goLive(d.version, null, true)); return; }
                    say(r);
                  })}>Go live</button>
                </div>
              </div>
            )}
            {d.spec && !d.claude && (
              <>
                <div className="fld"><label htmlFor="ag-job">Job</label>
                  <textarea id="ag-job" maxLength={4000} value={f.job} onChange={(e) => set({ job: e.target.value })} />
                  <span className="dp-note">In your words. The agent follows this on every run.</span></div>
                <div className="fld"><label htmlFor="ag-model">Runs on</label>
                  <select id="ag-model" value={f.model} onChange={(e) => set({ model: e.target.value })}>
                    {d.models.map((m) => <option key={m.id} value={m.id} disabled={!m.ready && !m.on}>{m.label}{m.ready ? "" : ` (${m.why})`}</option>)}
                  </select>
                  <span className="dp-note">Other models use your own key from Connections.</span></div>
              </>
            )}
            <div className="fld"><span className="lbl">When it runs</span>
              {!f.manual && (
                <div className="trow">
                  <div className="trow-h"><span className="ic">{CLOCK}</span>On a schedule<button type="button" className="rm" aria-label="Remove schedule" onClick={() => set({ manual: true })}>✕</button></div>
                  <div className="days">{DAY_KEYS.map((k) => <button key={k} type="button" aria-label={DAY_NAME[k]} aria-pressed={f.days.includes(k)} onClick={() => set({ days: f.days.includes(k) ? f.days.filter((x) => x !== k) : [...f.days, k] })}>{DAY_LETTER[k]}</button>)}</div>
                  <div className="row2"><label htmlFor="ag-time" className="dp-note">at</label><input type="time" id="ag-time" step={900} value={f.time} onChange={(e) => set({ time: e.target.value })} /></div>
                </div>
              )}
              <button type="button" className="dp-chip addtrig" aria-expanded={pick} onClick={() => setPick((x) => !x)}>+ Add a trigger</button>
              {pick && (
                <div className="picker">
                  <button type="button" disabled={!f.manual} onClick={() => { set({ manual: false }); setPick(false); }}>On a schedule{!f.manual && <small>Set</small>}</button>
                  <Link href="/crew?view=schedule">After another agent finishes<small>Crew &gt; Schedule</small></Link>
                  <Link href="/crew?view=schedule">When you approve a draft<small>Crew &gt; Schedule</small></Link>
                  <Link href="/crew?view=schedule">From a connected tool, like a new order<small>Crew &gt; Schedule</small></Link>
                </div>
              )}
              <span className="dp-tog on" style={{ alignSelf: "flex-start" }}><i />Also when I ask (Run now)</span>
              <span className="dp-note">Times are on the quarter hour, in your business’s time zone. What starts a run is checked by OPERATOR before the agent wakes, and never picks who gets emailed, what’s bought or what’s posted.</span>
            </div>
            {d.spec && !d.claude && (
              <>
                <div className="fld"><span className="lbl">Reads</span>
                  <div className="dp-chipset">
                    {reads.map((r) => <span key={r.id} className="dp-chip">{r.label}</span>)}
                    <button type="button" className="dp-chip addtrig" aria-expanded={addReads} onClick={() => setAddReads((x) => !x)}>{addReads ? "Done" : "+ Add"}</button>
                  </div>
                  {addReads && (
                    <div className="picker">
                      {d.reads.map((r) => <button key={r.id} type="button" disabled={!r.ready && !f.tools.includes(r.id)} aria-pressed={f.tools.includes(r.id)} onClick={() => toggleTool(r.id)}>{f.tools.includes(r.id) ? "✓ " : ""}{r.label}{r.why && <small>{r.why}</small>}</button>)}
                    </div>
                  )}</div>
                <div className="fld"><span className="lbl">Can do (each a draft you approve)</span>
                  <div className="dp-chipset">
                    {d.can.length ? d.can.map((c) => <button key={c.id} type="button" className="dp-tog" aria-pressed={f.tools.includes(c.id)} disabled={!c.ready} title={c.why} onClick={() => toggleTool(c.id)}><i />{c.label}</button>) : <span className="dp-note">Nothing yet. It only reports.</span>}
                  </div>
                  <span className="dp-note">Tap to give or take away. Only the owner can, and it is checked again on the server.</span></div>
              </>
            )}
            <div className="fld"><label htmlFor="ag-budget">Daily AI budget</label>
              <div className="row2"><span>$</span><input type="number" id="ag-budget" min={0} max={d.ceiling} step={0.05} value={f.budget} onChange={(e) => set({ budget: e.target.value })} style={{ width: 110 }} /><span className="dp-note">${d.monthAtPace.toFixed(2)} in the last 30 days</span></div></div>
            <div className="fld"><span className="lbl">Reports to</span><span style={{ fontSize: 14 }}>{d.boss ?? "No one yet"}</span></div>
            {d.spec && !d.claude && (
              <details className="ag-more">
                <summary>More detail</summary>
                <div className="ag-more-b">
                  <div className="fld"><label htmlFor="ag-good">What a good result looks like</label>
                    <textarea id="ag-good" maxLength={1000} value={f.good} onChange={(e) => set({ good: e.target.value })} /></div>
                  <div className="fld"><span className="lbl">Each run stops at</span>
                    <div className="row2"><span>$</span><input type="number" aria-label="Cost cap a run, in dollars" min={d.limits.maxCostUsd.min} max={d.limits.maxCostUsd.max} step={0.05} value={f.cap} onChange={(e) => set({ cap: e.target.value })} style={{ width: 96 }} />
                      <span className="dp-note">or</span><input type="number" aria-label="Step limit a run" min={d.limits.maxSteps.min} max={d.limits.maxSteps.max} step={1} value={f.steps} onChange={(e) => set({ steps: e.target.value })} style={{ width: 80 }} /><span className="dp-note">steps</span></div></div>
                  <div className="fld"><span className="lbl">Notion pages it reads</span>
                    <div className="dp-chipset">
                      {f.pages.length ? f.pages.map((p) => <span key={p.id} className="dp-chip">{p.label}<button type="button" className="rm" aria-label={`Stop reading ${p.label}`} onClick={() => set({ pages: f.pages.filter((x) => x.id !== p.id) })}>✕</button></span>) : <span className="dp-note">None yet.</span>}
                      <button type="button" className="dp-chip addtrig" aria-expanded={addPage === "read"} onClick={() => setAddPage((x) => (x === "read" ? null : "read"))}>+ Add a page link</button>
                    </div></div>
                  {addPage && (
                    <div className="picker ag-link">
                      <input aria-label="Notion page link" placeholder="Paste a Notion page link" value={link} onChange={(e) => setLink(e.target.value)} />
                      <input aria-label="What to call it" placeholder="What to call it" maxLength={60} value={linkLabel} onChange={(e) => setLinkLabel(e.target.value)} />
                      <button type="button" className="dp-btn" onClick={usePage}>{addPage === "read" ? "Add" : "Use this page"}</button>
                    </div>
                  )}
                  <div className="fld"><span className="lbl">Other agents’ results it reads</span>
                    <div className="dp-chipset">
                      {f.from.length ? f.from.map((x) => <span key={x.agentId} className="dp-chip">{x.label}<button type="button" className="rm" aria-label={`Stop reading ${x.label}`} onClick={() => set({ from: f.from.filter((y) => y.agentId !== x.agentId) })}>✕</button></span>) : <span className="dp-note">None yet.</span>}
                      {d.others.length > 0 && <button type="button" className="dp-chip addtrig" aria-expanded={addFrom} onClick={() => setAddFrom((x) => !x)}>{addFrom ? "Done" : "+ Add"}</button>}
                    </div>
                    {addFrom && (
                      <div className="picker">
                        {d.others.map((o) => { const on = f.from.some((x) => x.agentId === o.id); return (
                          <button key={o.id} type="button" aria-pressed={on} onClick={() => set({ from: on ? f.from.filter((x) => x.agentId !== o.id) : [...f.from, { agentId: o.id, label: `${o.name}: ${o.outputName}` }].slice(0, 10) })}>{on ? "✓ " : ""}{o.name}<small>{o.outputName}</small></button>
                        ); })}
                      </div>
                    )}</div>
                  <div className="fld"><span className="lbl">Saves its result to</span>
                    <div className="dp-chipset">
                      {d.reports.filter((r) => f.tools.includes(r.id)).map((r) => <span key={r.id} className="dp-chip">{r.id === "report_notion_page" && f.reportPage ? `${f.reportPage.label} (Notion)` : r.label}</span>)}
                      {!d.reports.some((r) => f.tools.includes(r.id)) && <span className="dp-note">Only its run history.</span>}
                      {d.reports.length > 0 && <button type="button" className="dp-chip addtrig" aria-expanded={addReport} onClick={() => setAddReport((x) => !x)}>{addReport ? "Done" : "Change"}</button>}
                    </div>
                    {addReport && (
                      <div className="picker">
                        {d.reports.map((r) => <button key={r.id} type="button" disabled={!r.ready && !f.tools.includes(r.id)} aria-pressed={f.tools.includes(r.id)} onClick={() => toggleTool(r.id)}>{f.tools.includes(r.id) ? "✓ " : ""}{r.label}{r.why && <small>{r.why}</small>}</button>)}
                        {f.tools.includes("report_notion_page") && <button type="button" onClick={() => setAddPage("report")}>Page it writes under<small>{f.reportPage?.label ?? "Pick one"}</small></button>}
                      </div>
                    )}</div>
                  <span className="dp-note">Changes here, like a new job, save a draft version. It runs after one clean try.</span>
                </div>
              </details>
            )}
            {d.lessons.length > 0 && (
              <div className="fld"><span className="lbl">Lessons to review</span>
                {d.lessons.map((m) => (
                  <div key={m.id} className="ag-mem"><span>{m.text}</span>
                    <button type="button" className="dp-btn" disabled={busy} onClick={() => go(() => act.keep(m.id, false))}>Keep</button>
                    <button type="button" className="rm" aria-label="Discard this lesson" disabled={busy} onClick={() => go(() => act.discard(m.id))}>✕</button></div>
                ))}
                <span className="dp-note">Proposed from drafts you turned down. A kept lesson loads on every run.</span></div>
            )}
            {d.remembers.length > 0 && (
              <div className="fld"><span className="lbl">Remembers</span>
                {d.remembers.map((m) => (
                  <div key={m.id} className="ag-mem"><span>{m.text}</span>{m.shared ? <small>For {d.deptName ?? "everyone"}</small> : <button type="button" className="rm" aria-label="Forget this" disabled={busy} onClick={() => go(() => act.forget(m.id))}>✕</button>}</div>
                ))}</div>
            )}
            {d.versions.length > 1 && (
              <div className="fld"><span className="lbl">Earlier versions</span>
                {d.versions.map((v) => (
                  <div key={v.version} className="ag-mem"><span><b>v{v.version}</b> {v.note || "No note"} <small>{v.when}</small></span>
                    {v.active ? <small>Live</small> : d.live != null && v.version < d.live ? <button type="button" className="dp-btn" disabled={busy} onClick={() => start(async () => {
                      const r = await act.goBack(v.version, false);
                      if (asksConfirm(r)) { if (window.confirm(r.text)) say(await act.goBack(v.version, true)); return; }
                      say(r);
                    })}>Go back</button> : null}
                  </div>
                ))}</div>
            )}
          </div>
        )}

        {tab === "edit" && (
          <div className="ag-foot">
            <span className="dp-note note">{confirm ?? (specChanged ? "A new job, model, reads, can do or more detail saves as a draft you try, then go live." : d.head ? `Or tell ${d.head} in the chat what to change.` : "Changes apply through the same checks as before.")}</span>
            <button type="button" className="dp-btn" disabled={busy || !dirty} onClick={() => { setF(init()); setConfirm(null); }}>Cancel</button>
            <button type="button" className="dp-btn dark" disabled={busy || !dirty} onClick={() => save(!!confirm)}>{confirm ? "Confirm and save" : "Save changes"}</button>
          </div>
        )}
      </aside>
      <div className={`ag-toast${toast ? " on" : ""}`} role="status">{toast}</div>
    </>
  );
}
