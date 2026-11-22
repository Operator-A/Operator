"use client";
// Crew > Edit chart (docs/org-chart.md, docs/crew-canvas.md): the structured chart for changing things.
// You on top, the company seat, then each department with its head and the seats under it. Every
// seat and department is a button: rename it, add seats under it, pick who sits there or remove it,
// and set a department's monthly AI budget, email cap, rules and lead checks. The server checks
// every change. Looking at the crew is the canvas's job (components/OrgCanvas.tsx).
import Link from "next/link";
import { useState, useTransition } from "react";
import { DEPT_BUDGET_CEILING, LEAD_REVIEW_HOURS, deptBudgetChange, deptEmailChange } from "@/core/org-rules";
import type { ActionResult } from "../actions";
import type { DeptView, OrgView, SeatView } from "../org";
import { Modal, Toast, type Confirm } from "./client";
import { Icon } from "./Icon";
import { MemoryLine } from "./memory";
import { AgentCard, DeptLimits, Face } from "./orgBits";

type Act<T extends unknown[]> = (...a: T) => Promise<ActionResult>;
export interface OrgActions {
  addDept: Act<[string]>;
  renameDept: Act<[string, string]>;
  removeDept: Act<[string]>;
  addSeat: Act<[string, string, string]>;
  editSeat: Act<[string, string, string]>;
  removeSeat: Act<[string]>;
  setHolder: Act<[string, string]>;
  /** Department id, the new limit ("" for none), confirmed. */
  setBudget: Act<[string, string, boolean]>;
  setEmails: Act<[string, string, boolean]>;
  addRule: Act<[string, string]>;
  editRule: Act<[string, string]>;
  forgetRule: Act<[string]>;
  /** Department id, on or off. */
  setLeadChecks: Act<[string, boolean]>;
}

type Open = { kind: "seat"; seat: SeatView; head: boolean; company: boolean } | { kind: "dept"; dept: DeptView } | null;

export function OrgChart({ v, actions, controls }: { v: OrgView; actions: OrgActions; controls: boolean }) {
  const [open, setOpen] = useState<Open>(null);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const [dept, setDept] = useState("");
  const run = (f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => start(async () => {
    let r: ActionResult;
    try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r); if (r.ok) after?.(r);
  });
  const pick = (seat: SeatView, head = false, company = false) => setOpen({ kind: "seat", seat, head, company });

  return (
    <div className="org">
      <div className="row wrap" style={{ gap: 10, alignItems: "center" }}>
        <span className="ink2" style={{ flex: "1 1 300px", fontSize: 13, lineHeight: 1.5 }}>
          Click a seat or a department to change it. A seat gives an agent nothing by itself: what it can read or do is still its own setup.
        </span>
        <Link href="/crew" className="btn dark sm"><Icon name="check" size={14} />Done editing</Link>
      </div>

      {v.problems.length > 0 && <div className="card" style={{ borderLeft: "4px solid var(--red)", gap: 4 }}>{v.problems.map((p) => <span key={p} style={{ fontSize: 13 }}>{p}</span>)}</div>}

      <div className="org-top">
        <div className="org-seat you"><span className="av" style={{ width: 32, height: 32, background: "var(--ink)", color: "var(--ws)", fontSize: 13, fontWeight: 700 }}>Z</span><span className="org-who"><b>You</b><span>Owner · every approval is yours</span></span></div>
        <span className="org-stem" aria-hidden="true" />
        {v.company ? <SeatCard s={v.company} onPick={() => pick(v.company!, false, true)} wide /> : <span className="muted" style={{ fontSize: 13 }}>No company seat yet.</span>}
        {v.departments.length > 0 && <span className="org-stem" aria-hidden="true" />}
      </div>

      <div className="org-depts">
        {v.departments.map((d) => (
          <section key={d.id} className={`card org-dept${wideDept(d) ? " wide" : ""}`} aria-label={`${d.name} department`}>
            <div className="org-dept-h">
              <span className="org-dept-n">{d.name}</span>
              <span className="muted" style={{ fontSize: 12 }}>{deptCounts(d)}</span>
              <button type="button" className="btn ghost xs" style={{ marginLeft: "auto" }} onClick={() => setOpen({ kind: "dept", dept: d })}>Edit</button>
            </div>
            <DeptLimits d={d} />
            {d.rules.length > 0 && (
              <details className="org-rules">
                <summary>{d.rules.length} department rule{d.rules.length === 1 ? "" : "s"}</summary>
                <ul>{d.rules.map((r) => <li key={r.id}>{r.text}</li>)}</ul>
              </details>
            )}
            <Tree s={d.head} onPick={pick} head cols={wideDept(d)} />
          </section>
        ))}
        <section className="card dashed org-dept" aria-label="Add a department">
          <span className="org-dept-n">New department</span>
          <span className="ink2" style={{ fontSize: 13, lineHeight: 1.5 }}>It starts with an open head seat. Add seats under the head, then build agents for them.</span>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" style={{ flex: 1, minWidth: 0 }} placeholder="Customer care" maxLength={60} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department name" />
            <button type="button" className="btn dark sm" disabled={busy || !dept.trim()} onClick={() => run(() => actions.addDept(dept), () => setDept(""))}>Add</button>
          </div>
        </section>
      </div>

      {v.offChart.length > 0 && (
        <div className="stack" style={{ gap: 10 }}>
          <span className="card-t">Not on the chart yet</span>
          <span className="ink2" style={{ fontSize: 13 }}>Click a seat above and pick one of these to sit there, or do it from step 1 when you edit the agent.</span>
          <div className="crew-grid">{v.offChart.map((a) => <AgentCard key={a.id} a={a} />)}</div>
        </div>
      )}

      {open?.kind === "seat" && <SeatEditor o={open} v={v} busy={busy} run={run} actions={actions} close={() => setOpen(null)} />}
      {open?.kind === "dept" && <DeptEditor d={v.departments.find((x) => x.id === open.dept.id) ?? open.dept} controls={controls} busy={busy} run={run} actions={actions} close={() => setOpen(null)} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** A department with leads that have their own teams spreads its leads side by side, like a printed chart. */
const wideDept = (d: DeptView) => d.head.kids.length >= 3 && d.head.kids.some((k) => k.kids.length > 0);

function Tree({ s, onPick, head, cols }: { s: SeatView; onPick: (s: SeatView, head?: boolean) => void; head?: boolean; cols?: boolean }) {
  return (
    <div className="org-node">
      <SeatCard s={s} onPick={() => onPick(s, head)} head={head} />
      {s.kids.length > 0 && <div className={`org-kids${cols ? " cols" : ""}`}>{s.kids.map((k) => <Tree key={k.id} s={k} onPick={onPick} />)}</div>}
    </div>
  );
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const deptCounts = (d: DeptView) => `${plural(d.seats, "seat")}${d.open ? ` · ${d.open} open` : ""}`;

function SeatCard({ s, onPick, head, wide }: { s: SeatView; onPick: () => void; head?: boolean; wide?: boolean }) {
  return (
    <button type="button" className={`org-seat${s.holder === "open" ? " open" : s.holder === "owner" ? " you" : ""}${wide ? " wide" : ""}`} onClick={onPick} aria-label={`Edit seat ${s.title}`}>
      {s.agent ? <Face a={s.agent} /> : s.holder === "owner" ? <span className="av" style={{ width: 32, height: 32, background: "var(--ink)", color: "var(--ws)", fontSize: 13, fontWeight: 700 }}>Z</span> : <span className="av org-plus" style={{ width: 32, height: 32 }}><Icon name="plus" size={15} /></span>}
      <span className="org-who">
        <b>{s.agent ? s.agent.name : s.holder === "owner" ? "You" : s.title}</b>
        <span>{s.agent || s.holder === "owner" ? [s.title, s.sub].filter(Boolean).join(" · ") : s.sub || "Open seat"}</span>
        {s.agent && <span className="org-last">{s.agent.look.label} · {s.agent.last}</span>}
      </span>
      {head && <span className="tag" style={{ flex: "none" }}>HEAD</span>}
      <Icon name="pencil" size={13} style={{ flex: "none", opacity: 0.5 }} />
    </button>
  );
}

type Runner = (f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => void;

function Sheet({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal org-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ gap: 8 }}>
          <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em", flex: 1 }}>{title}</h3>
          <button type="button" className="btn ghost sm" onClick={close} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SeatEditor({ o, v, busy, run, actions, close }: { o: Extract<Open, { kind: "seat" }>; v: OrgView; busy: boolean; run: Runner; actions: OrgActions; close: () => void }) {
  const s = o.seat;
  const [title, setTitle] = useState(s.title), [sub, setSub] = useState(s.sub);
  const [who, setWho] = useState(s.holder === "agent" && s.agent ? `agent:${s.agent.id}` : s.holder);
  const [kt, setKt] = useState(""), [ks, setKs] = useState("");
  const canRemove = !o.head && !o.company && s.holder === "open" && !s.kids.length;
  return (
    <Sheet title={s.title} close={close}>
      <div className="bf-stack" style={{ gap: 14 }}>
        <div className="org-form">
          <label className="bf-field"><span className="bf-k">Seat name</span><input className="input" value={title} maxLength={60} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="bf-field"><span className="bf-k">What it covers</span><input className="input" value={sub} maxLength={120} onChange={(e) => setSub(e.target.value)} placeholder="Klaviyo flows" /></label>
          <button type="button" className="btn outline sm" disabled={busy || !title.trim() || (title === s.title && sub === s.sub)} onClick={() => run(() => actions.editSeat(s.id, title, sub))}>Save name</button>
        </div>
        <div className="org-form">
          <label className="bf-field">
            <span className="bf-k">Who sits here</span>
            <select className="input" value={who} onChange={(e) => setWho(e.target.value)}>
              <option value="open">Nobody yet (open)</option>
              <option value="owner">You (a job that stays with a person)</option>
              {v.choices.map((c) => <option key={c.id} value={`agent:${c.id}`}>{c.label}{c.seat && `agent:${c.id}` !== (s.agent ? `agent:${s.agent.id}` : "") ? ` · now in ${c.seat}` : ""}</option>)}
            </select>
            <span className="sub">An agent that sits somewhere else moves here, and its old seat opens.</span>
          </label>
          <button type="button" className="btn dark sm" disabled={busy || who === (s.holder === "agent" && s.agent ? `agent:${s.agent.id}` : s.holder)} onClick={() => run(() => actions.setHolder(s.id, who), close)}>Set</button>
        </div>
        {!o.company && (
          <div className="org-form">
            <span className="bf-k">Add a seat under it</span>
            <input className="input" value={kt} maxLength={60} onChange={(e) => setKt(e.target.value)} placeholder="Seat name, like Subscriptions" aria-label="New seat name" />
            <input className="input" value={ks} maxLength={120} onChange={(e) => setKs(e.target.value)} placeholder="What it covers (optional)" aria-label="What the new seat covers" />
            <button type="button" className="btn outline sm" disabled={busy || !kt.trim()} onClick={() => run(() => actions.addSeat(s.id, kt, ks), () => { setKt(""); setKs(""); })}>Add seat</button>
          </div>
        )}
        {canRemove && <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start", color: "var(--red-ink)" }} disabled={busy} onClick={() => run(() => actions.removeSeat(s.id), close)}><Icon name="trash-2" size={14} />Remove this seat</button>}
        {!canRemove && !o.company && <span className="sub">{o.head ? "A department keeps its head seat; remove the department instead." : s.kids.length ? "Remove the seats under it first to remove this one." : "Open the seat first to remove it."}</span>}
      </div>
    </Sheet>
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** A number box saved on its own: blank means no department limit. Loosening asks for a confirm, and needs Controls on. */
function LimitForm({ label, help, now, unit, check, save, busy, run, controls, confirmFor }: {
  label: string; help: string; now: number | null; unit: "usd" | "count";
  check: (next: number | null) => { refuse: string } | { looser: boolean };
  save: (v: string, confirmed: boolean) => Promise<ActionResult>; busy: boolean; run: Runner; controls: boolean;
  confirmFor: (next: number | null) => Confirm;
}) {
  const [val, setVal] = useState(now == null ? "" : String(now));
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const next = val.trim() === "" ? null : Number(val);
  const ch = check(next);
  const looser = "looser" in ch && ch.looser;
  return (
    <div className="org-form">
      <label className="bf-field">
        <span className="bf-k">{label}</span>
        <span className="row" style={{ gap: 8 }}>
          {unit === "usd" && <span className="ink2">$</span>}
          <input className="input" style={{ flex: 1, minWidth: 0 }} inputMode={unit === "usd" ? "decimal" : "numeric"} value={val} onChange={(e) => setVal(e.target.value)} placeholder="Blank for none" />
        </span>
        <span className="sub">{"refuse" in ch && val !== (now == null ? "" : String(now)) ? ch.refuse : help}</span>
      </label>
      <button type="button" className="btn outline sm" disabled={busy || "refuse" in ch || (looser && !controls)} title={looser && !controls ? "Raising needs real runs switched on for this OPERATOR" : undefined}
        onClick={() => (looser ? setConfirm(confirmFor(next)) : run(() => save(val, false)))}>
        {looser && !controls ? "Raising needs Controls on" : "Save"}
      </button>
      {confirm && <Modal c={confirm} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { setConfirm(null); run(() => save(val, true)); }} />}
    </div>
  );
}

function DeptEditor({ d, controls, busy, run, actions, close }: { d: DeptView; controls: boolean; busy: boolean; run: Runner; actions: OrgActions; close: () => void }) {
  const [name, setName] = useState(d.name);
  const [rule, setRule] = useState("");
  const empty = d.open === d.seats;
  const fmtB = (n: number | null) => (n == null ? "No budget" : `${usd(n)} a month`);
  const fmtE = (n: number | null) => (n == null ? `Company cap (${d.companyEmails})` : `${n} a day`);
  return (
    <Sheet title={d.name} close={close}>
      <div className="bf-stack" style={{ gap: 14 }}>
        <div className="org-form">
          <label className="bf-field"><span className="bf-k">Department name</span><input className="input" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
          <button type="button" className="btn outline sm" disabled={busy || !name.trim() || name === d.name} onClick={() => run(() => actions.renameDept(d.id, name), close)}>Rename</button>
        </div>
        <LimitForm
          label="Monthly AI budget" unit="usd" now={d.budget} busy={busy} run={run} controls={controls}
          help={`Shared by every agent in ${d.name}, on top of each one’s daily budget. At the budget their runs are skipped at $0 and you get one email. ${usd(d.spent)} spent this month. Up to $${DEPT_BUDGET_CEILING}.`}
          check={(n) => deptBudgetChange(d.budget, n)} save={(v, c) => actions.setBudget(d.id, v, c)}
          confirmFor={(n) => ({ title: `Raise ${d.name}’s budget?`, body: `Its agents can spend more on AI this month. Each agent’s daily budget still applies.`, lines: [{ k: "Now", v: fmtB(d.budget) }, { k: "New", v: fmtB(n) }], confirmLabel: "Save", kind: "dark" })}
        />
        <LimitForm
          label="Emails a day" unit="count" now={d.emails} busy={busy} run={run} controls={controls}
          help={`Outbound emails from the agents in ${d.name}, all together. Never more than the company cap of ${d.companyEmails}. No agent can send email yet; this is the limit it will have.`}
          check={(n) => deptEmailChange(d.emails, n, d.companyEmails)} save={(v, c) => actions.setEmails(d.id, v, c)}
          confirmFor={(n) => ({ title: `Let ${d.name} send more?`, body: `Its agents can send more emails a day, still never past the company cap.`, lines: [{ k: "Now", v: fmtE(d.emails) }, { k: "New", v: fmtE(n) }], confirmLabel: "Save", kind: "dark" })}
        />
        <label className={`bf-opt${d.leadChecks ? " on" : ""}`}>
          <input type="checkbox" checked={d.leadChecks} disabled={busy} onChange={() => run(() => actions.setLeadChecks(d.id, !d.leadChecks))} />
          <span className="bf-opt-t"><b>Lead checks drafts first</b><span className="muted"> · A draft from an agent in {d.name} waits up to {LEAD_REVIEW_HOURS} hours for the agent above it, which adds a note or sends it back once. That agent needs Your team’s drafts and Check a team draft (builder step 2). Only your tap approves.</span></span>
        </label>
        <div className="org-form">
          <span className="bf-k">Department rules</span>
          <span className="sub">Every agent in {d.name} loads these from its next run, next to its own standing orders. A rule can add a do or don’t, never raise a cap or grant access.</span>
          {d.rules.map((r) => <MemoryLine key={r.id} line={{ id: r.id, text: r.text, meta: `Every agent in ${d.name}` }} color="var(--acc)" edit={(t) => actions.editRule(r.id, t)} forget={() => actions.forgetRule(r.id)} />)}
          <textarea className="input" rows={2} maxLength={280} value={rule} onChange={(e) => setRule(e.target.value)} placeholder="A new rule, like: Never promise a delivery date." aria-label="New department rule" />
          <button type="button" className="btn outline sm" disabled={busy || !rule.trim()} onClick={() => run(() => actions.addRule(d.id, rule), (r) => { if (r.ok) setRule(""); })}>Add rule</button>
        </div>
        <button type="button" className="btn ghost sm" style={{ alignSelf: "flex-start", color: "var(--red-ink)" }} disabled={busy || !empty} onClick={() => run(() => actions.removeDept(d.id), close)}><Icon name="trash-2" size={14} />Remove {d.name}</button>
        {!empty && <span className="sub">Only a department where every seat is open can be removed. Move its agents and your seats out first.</span>}
      </div>
    </Sheet>
  );
}
