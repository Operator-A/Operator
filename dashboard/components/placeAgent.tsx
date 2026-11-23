"use client";
// Crew's "Not in a department yet" (card 370, docs/org-chart.md): each agent that sits in no seat, with a
// department picker, a place picker (a new seat under the head, or an open seat) and Add. One tap, owner
// only; the server checks it again (orgPlaceAgent). A seat gives an agent nothing by itself.
import Link from "next/link";
import { useState, useTransition } from "react";
import type { ActionResult } from "../actions";
import type { PlaceDept, SeatAgent } from "../org";
import { Toast } from "./client";
import { Face } from "./orgBits";

type Place = (agentId: string, deptId: string, seatId: string | null) => Promise<ActionResult>;

/** The value a place picker holds: "new" for a new seat under the head, else the open seat's id. */
const NEW = "new";

export function NotInDepartment({ agents, depts, place }: { agents: SeatAgent[]; depts: PlaceDept[]; place: Place }) {
  const [toast, setToast] = useState<ActionResult | null>(null);
  if (!agents.length) return null;
  return (
    <div className="stack" style={{ gap: 10 }}>
      <span className="card-t">Not in a department yet</span>
      <span className="ink2" style={{ fontSize: 13, lineHeight: 1.5 }}>
        Pick a department and Add. It gets a new seat under the head, or an open seat you pick. Only where it sits changes: what it reads, can do and when it runs stay as they are.
      </span>
      {depts.length === 0
        ? <span className="sub">Add a department first, on Edit chart.</span>
        : <div className="crew-grid">{agents.map((a) => <PlaceCard key={a.id} a={a} depts={depts} place={place} onDone={setToast} />)}</div>}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

function PlaceCard({ a, depts, place, onDone }: { a: SeatAgent; depts: PlaceDept[]; place: Place; onDone: (r: ActionResult) => void }) {
  const [dept, setDept] = useState(depts[0].id);
  const spots = depts.find((d) => d.id === dept)?.spots ?? [];
  const [spot, setSpot] = useState(spots[0] ? spots[0].seatId ?? NEW : "");
  const [busy, start] = useTransition();
  const pickDept = (id: string) => { setDept(id); const s = depts.find((d) => d.id === id)?.spots[0]; setSpot(s ? s.seatId ?? NEW : ""); };
  const add = () => start(async () => {
    let r: ActionResult;
    try { r = await place(a.id, dept, spot === NEW ? null : spot); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    onDone(r);
  });
  return (
    <div className="card crew-card place-card">
      <Link href={a.href} className="row" style={{ gap: 12, color: "inherit", textDecoration: "none" }}>
        <Face a={a} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</span><span className="muted clip" style={{ fontSize: 12.5 }}>{a.role}</span></span>
        <span className="pill sm" style={{ background: a.look.bg, color: a.look.fg }}>{a.look.label}</span>
      </Link>
      <div className="place-row">
        <select className="input" value={dept} onChange={(e) => pickDept(e.target.value)} aria-label={`Department for ${a.name}`}>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select className="input" value={spot} onChange={(e) => setSpot(e.target.value)} aria-label={`Seat for ${a.name}`} disabled={!spots.length}>
          {spots.length ? spots.map((s) => <option key={s.seatId ?? NEW} value={s.seatId ?? NEW}>{s.label}</option>) : <option value="">No room in this department</option>}
        </select>
        <button type="button" className="btn dark sm" disabled={busy || !spot} onClick={add}>{busy ? "Adding…" : "Add"}</button>
      </div>
    </div>
  );
}
