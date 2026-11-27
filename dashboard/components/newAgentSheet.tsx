"use client";
// New agent (card 420), as in the approved mockup: the agent sheet drawn for an agent that doesn't exist yet. The
// same drawer, fields and look as an agent's Edit tab (agentSheet.tsx); Create sends the form to one server action
// (createAgentByHand), which checks it all again and makes the agent off duty as v1. The sheet then opens as that
// agent's own sheet. It is in the address (?agent=new), so back closes it.
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { NewSheetData } from "@/dashboard/agentSheet";
import { NEW_LIMITS } from "@/dashboard/new-agent-rules";
import type { RunsOnChoice } from "@/dashboard/runs-on-rules";
import { RoutineFields, RunsOnPicker } from "./runsOn";

type Result = { ok: boolean; text: string; agentId?: string };

const DAY_KEYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const DAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const X = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;
const CLOCK = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const ARROW = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
const HAND = <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-2a1.5 1.5 0 0 1 3 0V12M14 10.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 16a1.5 1.5 0 0 1 2.5-1.6L8 17" /></svg>;
/** The model field's value while it runs as a Claude routine; every other value is a model id. */
const ROUTINE = "routine";
/** The seat select's value for a new seat under the head. */
const NEW_SEAT = "new";
/** The department select's value for no department. */
const NONE = "";

export function NewAgentSheet({ d, closeHref, openHref, controls, create }: {
  d: NewSheetData; closeHref: string;
  /** Where the agent's own sheet opens once it exists, with "{id}" for its id. */
  openHref: string;
  controls: boolean;
  create: (form: unknown, tryIt: boolean) => Promise<Result>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const firstModel = d.models.find((m) => m.ready)?.id ?? d.models[0]?.id ?? "";
  const firstDept = d.deptId ?? NONE;
  const spotFor = (dept: string) => { const s = d.places.find((p) => p.id === dept)?.spots[0]; return s ? s.seatId ?? NEW_SEAT : ""; };
  const [f, setF] = useState({
    name: "", role: "", job: "", good: "", model: firstModel, routineId: "", routineKey: "",
    tools: [] as string[], when: "manual" as "manual" | "schedule" | "after",
    days: [1, 2, 3, 4, 5], time: "09:00", after: d.follow.find((o) => o.when)?.id ?? "", pass: true,
    dept: firstDept, spot: spotFor(firstDept), budget: d.budget.toFixed(2),
  });
  const [later, setLater] = useState(false);
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  useEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", esc);
    return () => { cancelAnimationFrame(r); removeEventListener("keydown", esc); };
  });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t); }, [toast]);

  // the page under the sheet loads while the sheet slides away, not after (click-speed slice 4)
  function close() { setOpen(false); router.push(closeHref, { scroll: false }); }
  const toggleTool = (id: string) => setF((x) => ({ ...x, tools: x.tools.includes(id) ? x.tools.filter((t) => t !== id) : [...x.tools, id] }));

  const routine = f.model === ROUTINE;
  const model = d.models.find((m) => m.id === f.model);
  const spots = d.places.find((p) => p.id === f.dept)?.spots ?? [];
  const place = d.places.find((p) => p.id === f.dept);
  const prev = d.follow.find((o) => o.id === f.after);
  const missing = !f.name.trim() ? "Give it a name and a job to create it." : !f.job.trim() ? "Give it a job to create it."
    : routine ? (!f.routineId.trim() !== !f.routineKey.trim() ? "Paste both the routine trigger id and its key, or neither for now." : null)
    : !f.tools.some((t) => d.reads.some((r) => r.id === t)) ? "Pick at least one thing it reads." : null;
  const choice: RunsOnChoice = routine ? { on: "claude" } : { on: "operator", model: f.model };

  function submit(tryIt: boolean) {
    start(async () => {
      try {
        const r = await create({
          name: f.name, role: f.role, job: f.job, good: f.good,
          runsOn: routine ? { on: "claude", ...(f.routineId.trim() ? { routine: { routine: f.routineId, token: f.routineKey } } : {}) } : { on: "operator", model: f.model },
          tools: routine ? [] : f.tools,
          start: f.when === "schedule" ? { kind: "schedule", days: f.days, time: f.time } : f.when === "after" ? { kind: "after", agentId: f.after, passAlong: f.pass } : { kind: "manual" },
          place: f.dept ? { deptId: f.dept, seatId: f.spot === NEW_SEAT || !f.spot ? null : f.spot } : null,
          budget: Number(f.budget),
        }, tryIt);
        setToast(r.text);
        if (r.ok && r.agentId) router.replace(openHref.replace("{id}", encodeURIComponent(r.agentId)), { scroll: false });
      } catch (e) { setToast(e instanceof Error ? e.message : "Something went wrong."); }
    });
  }

  return (
    <>
      <div className={`ag-bg${open ? " open" : ""}`} onClick={close} />
      <aside className={`ag${open ? " open" : ""}`} aria-label="New agent" role="dialog" aria-modal="true">
        <div className="ag-h">
          <div className="dp-av ag-av-new" aria-hidden="true">+</div>
          <div className="ag-nm">
            <input className="n" aria-label="Name" placeholder="Name it" maxLength={NEW_LIMITS.name} value={f.name} onChange={(e) => set({ name: e.target.value })} autoFocus />
            <input className="r" aria-label="Role" placeholder="What’s its role?" maxLength={NEW_LIMITS.role} value={f.role} onChange={(e) => set({ role: e.target.value })} />
          </div>
          <button type="button" className="x" onClick={close} aria-label="Close">{X}</button>
        </div>
        <div className="ag-state">
          <span className="dp-pill">New · lands off duty</span>
          <span className="dp-where">{routine ? "Runs in Claude" : model ? `Runs on ${model.label}` : "Pick what it runs on"}</span>
        </div>
        <div className="ag-seg" role="tablist">
          <button type="button" role="tab" aria-selected={false} disabled title="Runs show here once it exists">Runs</button>
          <button type="button" role="tab" aria-selected className="on">Edit</button>
        </div>

        <div className="ag-body">
          <div className="fld"><label htmlFor="na-job">Job</label>
            <textarea id="na-job" maxLength={NEW_LIMITS.job} placeholder="What should it do, in your words?" value={f.job} onChange={(e) => set({ job: e.target.value })} />
            <span className="dp-note">In your own words. The agent works from this.</span></div>

          <div className="fld"><span className="lbl" id="na-ro-l">Runs on</span>
            <RunsOnPicker labelId="na-ro-l" models={d.models} disabled={busy} value={choice}
              onChange={(v) => set(v.on === "claude" ? { model: ROUTINE } : { model: v.model })} />
            <span className="dp-note">Models run in OPERATOR, with its reads, approval cards and caps. A Claude routine runs in your Claude account.</span></div>

          {routine && (
            <div className="fld"><span className="lbl">Its Claude routine</span>
              <RoutineFields name={f.name} value={{ routine: f.routineId, token: f.routineKey }} disabled={busy} onChange={(v) => set({ routineId: v.routine, routineKey: v.token })} />
              <span className="dp-note">Or leave both empty and paste them on its sheet later.</span></div>
          )}

          {!routine && (
            <div className="fld"><span className="lbl">Reads</span>
              <div className="dp-chipset">
                {d.reads.map((r) => <button key={r.id} type="button" className="dp-chip ag-pick" aria-pressed={f.tools.includes(r.id)} onClick={() => toggleTool(r.id)}>{r.label}</button>)}
                {!d.reads.length && <span className="dp-note">Nothing connected to read yet. Connect a tool on Connections first.</span>}
              </div>
              <span className="dp-note">Only tools you have connected. Tap to add or take away.</span></div>
          )}

          <div className="fld"><span className="lbl">When it runs</span>
            <div className={`trow ag-when${f.when === "schedule" ? " on" : ""}`}>
              <label className="trow-h"><input type="radio" name="na-when" checked={f.when === "schedule"} onChange={() => set({ when: "schedule" })} /><span className="ic">{CLOCK}</span>On a schedule</label>
              {f.when === "schedule" && (
                <>
                  <div className="days">{DAY_KEYS.map((k) => <button key={k} type="button" aria-label={DAY_NAME[k]} aria-pressed={f.days.includes(k)} onClick={() => set({ days: f.days.includes(k) ? f.days.filter((x) => x !== k) : [...f.days, k] })}>{DAY_LETTER[k]}</button>)}</div>
                  <div className="row2"><label htmlFor="na-time" className="dp-note">at</label><input type="time" id="na-time" step={900} value={f.time} onChange={(e) => set({ time: e.target.value })} /></div>
                </>
              )}
            </div>
            <div className={`trow ag-when${f.when === "after" ? " on" : ""}`}>
              <label className="trow-h"><input type="radio" name="na-when" checked={f.when === "after"} disabled={!d.follow.some((o) => o.when)} onChange={() => set({ when: "after" })} /><span className="ic">{ARROW}</span>After another agent finishes</label>
              {f.when === "after" && (
                <>
                  <div className="row2 ag-inset">
                    <select aria-label="Agent it runs after" value={f.after} onChange={(e) => set({ after: e.target.value })}>
                      {d.follow.map((o) => <option key={o.id} value={o.id} disabled={!o.when}>{o.name}{o.when ? ` · ${o.when}` : " · no schedule yet"}</option>)}
                    </select>
                    <label className="ag-check"><input type="checkbox" checked={f.pass} onChange={(e) => set({ pass: e.target.checked })} />Pass its summary along</label>
                  </div>
                  {prev && <div className="ag-chain"><span className="ag-chain-n"><span className="nd">{prev.when ? `${prev.when} · ${prev.name}` : prev.name}</span></span><span className="ag-chain-n"><span className="ar" aria-hidden="true">→</span><span className="nd me">{f.name.trim() || "New agent"}</span></span></div>}
                </>
              )}
            </div>
            <div className={`trow ag-when${f.when === "manual" ? " on" : ""}`}>
              <label className="trow-h"><input type="radio" name="na-when" checked={f.when === "manual"} onChange={() => set({ when: "manual" })} /><span className="ic">{HAND}</span>Only when you press Run now</label>
            </div>
            <span className="dp-note">Pick one. A chain holds up to 8 agents. Nothing starts until you put it on duty.</span>
          </div>

          {!routine && (
            <div className="fld"><span className="lbl">Can do (each a draft you approve)</span>
              {d.canBy.shown.length > 0 && (
                <div className="ag-tools">
                  {d.canBy.shown.map((g) => {
                    const on = g.items.filter((c) => f.tools.includes(c.id)).length;
                    return (
                      <div key={g.conn} className={`ag-tool${g.items.length > 3 ? " wide" : ""}`}>
                        <div className="ag-tool-h"><span className="logo" aria-hidden="true">{g.name.slice(0, 1)}</span><div><b>{g.name}</b><small>Connected</small></div><span className="cnt">{on} of {g.items.length} on</span></div>
                        <div className="ag-acts">
                          {g.items.map((c) => <button key={c.id} type="button" className="ag-act" aria-pressed={f.tools.includes(c.id)} disabled={!c.ready} title={c.why} onClick={() => toggleTool(c.id)}><i /><span>{c.label}</span></button>)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              {!d.canBy.shown.length && <span className="dp-note">No connected tool has actions yet. It can only report.</span>}
              {d.canBy.later.length > 0 && (
                <div className="ag-later">
                  <button type="button" className="ag-later-h" aria-expanded={later} onClick={() => setLater((x) => !x)}>{d.canBy.later.length} more {d.canBy.later.length === 1 ? "tool" : "tools"}, not connected yet<span aria-hidden="true">{later ? "–" : "+"}</span></button>
                  {later && d.canBy.later.map((g) => <div key={g.conn} className="ag-lrow"><span><b>{g.name}</b> · {g.items.map((c) => c.label).join(", ")}</span><a className="ag-lnk" href={`/connections?c=${encodeURIComponent(g.conn)}`}>Connect</a></div>)}
                </div>
              )}
              <span className="dp-note">Starts with nothing on. Only an approver can turn these on, checked again on the server.</span></div>
          )}

          <div className="ag-two">
            <div className="fld"><span className="lbl">Department</span>
              <div className="ag-pair">
                <select aria-label="Department" value={f.dept} onChange={(e) => set({ dept: e.target.value, spot: spotFor(e.target.value) })}>
                  {d.places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  <option value={NONE}>No department</option>
                </select>
                {f.dept !== NONE && (
                  <select aria-label="Seat" value={f.spot} onChange={(e) => set({ spot: e.target.value })} disabled={!spots.length}>
                    {spots.length ? spots.map((p) => <option key={p.seatId ?? NEW_SEAT} value={p.seatId ?? NEW_SEAT}>{p.label}</option>) : <option value="">No room in this department</option>}
                  </select>
                )}
              </div>
              <span className="dp-note">{f.dept === NONE ? "It shows under Not in a department on Company." : place?.head ? `Reports to ${place.head} (${place.name}).` : `In ${place?.name ?? "this department"}.`}</span></div>
            <div className="fld"><label htmlFor="na-budget">Daily AI budget</label>
              <div className="row2"><span>$</span><input type="number" id="na-budget" min={0} max={d.ceiling} step={0.05} value={f.budget} onChange={(e) => set({ budget: e.target.value })} style={{ width: 110 }} /></div>
              <span className="dp-note">Up to ${d.ceiling} a day.</span></div>
          </div>

          {!routine && (
            <details className="ag-more">
              <summary>More detail</summary>
              <div className="ag-more-b">
                <div className="fld"><label htmlFor="na-good">What a good result looks like</label>
                  <textarea id="na-good" maxLength={NEW_LIMITS.good} value={f.good} onChange={(e) => set({ good: e.target.value })} /></div>
                <span className="dp-note">Run limits, Notion pages and other agents’ results are on its sheet once it exists, the same as on any agent.</span>
              </div>
            </details>
          )}
        </div>

        <div className="ag-foot">
          <span className="dp-note note">{missing ?? "Created off duty as v1. You put it on duty after a try."}</span>
          <button type="button" className="dp-btn" disabled={busy} onClick={close}>Cancel</button>
          <button type="button" className={`dp-btn${routine || !controls ? " dark" : ""}`} disabled={busy || !!missing || (f.dept !== NONE && !f.spot)} onClick={() => submit(false)}>{busy ? "Creating…" : "Create"}</button>
          {!routine && controls && <button type="button" className="dp-btn dark" disabled={busy || !!missing || (f.dept !== NONE && !f.spot)} onClick={() => submit(true)}>Create and try once</button>}
        </div>
      </aside>
      <div className={`ag-toast${toast ? " on" : ""}`} role="status">{toast}</div>
    </>
  );
}
