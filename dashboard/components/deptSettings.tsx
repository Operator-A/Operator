"use client";
// A department's settings (docs/department-pages.md, slice 7), as in the approved mockup: the gear on the
// department header (the title pill on a phone) opens a sheet like the agent sheet. It holds what Crew's
// department editor held: name, monthly AI budget, emails a day, the head checking drafts first, the rules every
// agent in it follows, and Remove. It is in the address (?settings=1), so back closes it. Every change goes
// through the same owner-only server actions, with their checks: raising a limit asks to confirm first.
import { useRouter } from "next/navigation";
import { deptViewHref } from "@/dashboard/company-rules";
import { useEffect, useState, useTransition } from "react";

type Result = { ok: boolean; text: string };
export interface DeptSettingsData {
  id: string; name: string; head: string | null;
  /** Monthly AI budget (null: none) and what its agents spent this month, added up in code. */
  budget: number | null; spent: number; ceiling: number;
  /** Its email cap (null: the company cap) and the company cap it sits under. */
  emails: number | null; companyEmails: number;
  leadChecks: boolean; reviewHours: number;
  rules: { id: string; text: string }[];
  /** Only a department where every seat is open can be removed. */
  removable: boolean; agents: string[];
  /** A newer version of the pack it came from (packs slice 3b), with what it would change, worked out in code. */
  offer?: { to: number; name: string; lines: { mark: "+" | "~" | "="; text: string }[]; warns: string[]; drafts: number } | null;
}
export interface DeptSettingsActions {
  rename: (name: string) => Promise<Result>;
  budget: (v: string, confirmed: boolean) => Promise<Result>;
  emails: (v: string, confirmed: boolean) => Promise<Result>;
  leadChecks: (on: boolean) => Promise<Result>;
  addRule: (text: string) => Promise<Result>;
  forgetRule: (ruleId: string) => Promise<Result>;
  remove: () => Promise<Result>;
  savePack?: () => Promise<Result>;
}

const X = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;
const asksConfirm = (r: Result) => !r.ok && /^Confirm first/.test(r.text);
const money = (n: number) => `$${n.toFixed(2)}`;
const numText = (n: number | null) => (n == null ? "" : String(n));
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function DeptSettings({ d, closeHref, act }: { d: DeptSettingsData; closeHref: string; act: DeptSettingsActions }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [sure, setSure] = useState(false);
  const init = () => ({ name: d.name, budget: numText(d.budget), emails: numText(d.emails), lead: d.leadChecks });
  const [f, setF] = useState(init);
  const [drawn, setDrawn] = useState(d);
  if (drawn !== d) { setDrawn(d); setF(init()); setConfirm(null); }
  const [rule, setRule] = useState("");
  const [later, setLater] = useState(false);

  useEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", esc);
    return () => { cancelAnimationFrame(r); removeEventListener("keydown", esc); };
  });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 3200); return () => clearTimeout(t); }, [toast]);

  // the page under the sheet loads while the sheet slides away, not after (click-speed slice 4)
  function close() { setOpen(false); router.push(closeHref, { scroll: false }); }
  const set = (p: Partial<ReturnType<typeof init>>) => { setF((x) => ({ ...x, ...p })); setConfirm(null); };
  const go = (fn: () => Promise<Result>, after?: (r: Result) => void) => start(async () => {
    try { const r = await fn(); setToast(r.text); if (r.ok) after?.(r); } catch (e) { setToast(e instanceof Error ? e.message : "Something went wrong."); }
  });

  const nameChanged = f.name.trim() !== d.name;
  const budgetChanged = f.budget.trim() !== numText(d.budget);
  const emailsChanged = f.emails.trim() !== numText(d.emails);
  const leadChanged = f.lead !== d.leadChecks;
  const dirty = nameChanged || budgetChanged || emailsChanged || leadChanged;
  const budgetN = f.budget.trim() === "" ? null : Number(f.budget);
  const share = d.budget ? Math.min(100, Math.round((d.spent / d.budget) * 100)) : 0;

  // each piece through its own action, in order; a limit that is raised stops for a confirm, then goes again
  function save(confirmed: boolean) {
    start(async () => {
      const said: string[] = [];
      try {
        if (nameChanged) { const r = await act.rename(f.name.trim()); if (!r.ok) { setToast(r.text); return; } said.push(r.text); }
        if (budgetChanged) {
          const r = await act.budget(f.budget.trim(), confirmed);
          if (asksConfirm(r)) { setConfirm(r.text); return; }
          if (!r.ok) { setToast(r.text); return; }
          said.push(r.text);
        }
        if (emailsChanged) {
          const r = await act.emails(f.emails.trim(), confirmed);
          if (asksConfirm(r)) { setConfirm(r.text); return; }
          if (!r.ok) { setToast(r.text); return; }
          said.push(r.text);
        }
        if (leadChanged) { const r = await act.leadChecks(f.lead); if (!r.ok) { setToast(r.text); return; } said.push(r.text); }
        setConfirm(null);
        setToast(said.join(" ") || "Nothing changed.");
      } catch (e) { setToast(e instanceof Error ? e.message : "Something went wrong."); }
    });
  }

  return (
    <>
      <div className={`ag-bg${open ? " open" : ""}`} onClick={close} />
      <aside className={`ag${open ? " open" : ""}`} aria-label={`${d.name} settings`} role="dialog" aria-modal="true">
        <div className="ag-h ds-h">
          <div className="dp-icon"><i /></div>
          <div><b>{d.name} settings</b><span>{d.head ? `Led by ${d.head}` : "No head yet"} · {d.agents.length} agent{d.agents.length === 1 ? "" : "s"}</span></div>
          <button type="button" className="x" onClick={close} aria-label="Close">{X}</button>
        </div>
        <div className="ag-body">
          {d.offer && !later && act.savePack && (
            <div className="pk-update">
              <div className="pk-update-h"><span className="pk-tag acc">Version {d.offer.to}</span><b>A newer {d.offer.name} pack</b></div>
              <div className="pk-diff">{d.offer.lines.map((l, i) => <div key={i} className={l.mark === "+" ? "p" : l.mark === "~" ? "c" : "k"}><i>{l.mark}</i><span>{l.text}</span></div>)}</div>
              {d.offer.warns.map((w) => <div key={w} className="pk-box warn">{w}</div>)}
              <div className="dp-btns"><button type="button" className="dp-btn dark" disabled={busy} onClick={() => go(act.savePack!, () => setLater(true))}>Save as drafts</button><button type="button" className="dp-btn" disabled={busy} onClick={() => setLater(true)}>Not now</button></div>
              <span className="dp-note">{d.offer.drafts ? "Each draft needs a clean try and your Go live, like any change to an agent." : "No agent changes: saving moves the department to this version."}</span>
            </div>
          )}
          <div className="fld"><label htmlFor="ds-name">Name</label>
            <input type="text" id="ds-name" maxLength={60} value={f.name} onChange={(e) => set({ name: e.target.value })} /></div>
          <div className="fld"><label htmlFor="ds-budget">Monthly AI budget</label>
            <div className="row2"><span>$</span><input type="number" id="ds-budget" min={0} max={d.ceiling} step={5} placeholder="None" value={f.budget} onChange={(e) => set({ budget: e.target.value })} style={{ width: 110 }} /><span className="dp-note">{money(d.spent)} spent this month</span></div>
            {d.budget != null && <div className="ds-meter" aria-hidden="true"><i style={{ width: `${share}%` }} /></div>}
            <span className="dp-note">Shared by every agent in {d.name}, on top of each one’s daily budget. At the budget their runs stop and you get one email. Blank for none, up to ${d.ceiling}. Raising it asks you to confirm.</span>
            {budgetN != null && !Number.isFinite(budgetN) && <span className="dp-note dp-bad">That isn’t a dollar amount.</span>}</div>
          <div className="fld"><label htmlFor="ds-emails">Emails a day</label>
            <div className="row2"><input type="number" id="ds-emails" min={0} max={d.companyEmails} step={1} placeholder={String(d.companyEmails)} value={f.emails} onChange={(e) => set({ emails: e.target.value })} style={{ width: 110 }} /><span className="dp-note">Blank uses the company cap of {d.companyEmails}</span></div>
            <span className="dp-note">Outbound emails from {d.name}’s agents, all together. Never more than the company cap.</span></div>
          <div className="fld"><span className="lbl">Drafts</span>
            <button type="button" className="dp-tog" aria-pressed={f.lead} style={{ alignSelf: "flex-start" }} onClick={() => set({ lead: !f.lead })}><i />{d.head ?? "The head"} checks drafts first</button>
            <span className="dp-note">A draft from an agent in {d.name} waits up to {d.reviewHours} hours for {d.head ?? "the agent above it"}, who adds a note or sends it back once, before it reaches you.</span></div>
          <div className="fld"><span className="lbl">Rules every agent in {d.name} follows</span>
            {d.rules.map((r) => (
              <div key={r.id} className="ag-mem"><span>{r.text}</span><button type="button" className="rm" aria-label="Remove this rule" disabled={busy} onClick={() => go(() => act.forgetRule(r.id))}>✕</button></div>
            ))}
            <textarea aria-label="New rule" rows={2} maxLength={280} value={rule} onChange={(e) => setRule(e.target.value)} placeholder="A new rule, like: Never promise a payment date." style={{ minHeight: 64 }} />
            <button type="button" className="dp-chip addtrig" style={{ alignSelf: "flex-start" }} disabled={busy || !rule.trim()} onClick={() => go(() => act.addRule(rule), () => setRule(""))}>+ Add rule</button>
            <span className="dp-note">Loaded from each agent’s next run. A rule adds a do or don’t; it never raises a cap or gives access. You can also ask {d.head ?? "the head"} in the chat to add one.</span></div>
          <div className="fld"><span className="lbl">Remove</span>
            {sure && d.removable
              ? <div className="dp-btns"><button type="button" className="dp-btn ds-danger-btn" disabled={busy} onClick={() => go(act.remove, () => router.push(deptViewHref("cards")))}>Remove {d.name} for good</button><button type="button" className="dp-btn" disabled={busy} onClick={() => setSure(false)}>Keep it</button></div>
              : <button type="button" className="ds-danger" disabled={busy || !d.removable} onClick={() => setSure(true)}>Remove {d.name}</button>}
            <span className="dp-note">{d.removable ? "Its seats go with it. Nothing else changes." : `Only a department with every seat open can be removed. Move ${d.agents.length ? list(d.agents) : "everyone"} out first, on Crew.`}</span></div>
        </div>
        <div className="ag-foot">
          <span className="dp-note note">{confirm ?? (d.head ? `Or tell ${d.head} in the chat what to change.` : "Changes apply through the same checks as before.")}</span>
          <button type="button" className="dp-btn" disabled={busy || !dirty} onClick={() => { setF(init()); setConfirm(null); }}>Cancel</button>
          <button type="button" className="dp-btn dark" disabled={busy || !dirty || !f.name.trim()} onClick={() => save(!!confirm)}>{confirm ? "Confirm and save" : "Save changes"}</button>
        </div>
      </aside>
      <div className={`ag-toast${toast ? " on" : ""}`} role="status">{toast}</div>
    </>
  );
}
