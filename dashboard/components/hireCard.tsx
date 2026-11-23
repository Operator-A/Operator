"use client";
// A hire card in a department's chat (docs/department-pages.md, slice 5), as in the approved mockup. A hire
// the head filed shows Hire and try once: the owner's tap creates the agent off duty with only the actions
// they turned on, then runs its first try (the existing tryBuilt). An agent that was never put on duty shows
// Try once, then Put on duty after a clean try (the existing goLive and setEnabled, each checking again).
import { useState, useTransition } from "react";
import type { ActionResult } from "@/dashboard/actions";
import type { HireCardView } from "@/dashboard/hire-rules";
import { initialsOf } from "@/dashboard/dept-feed";
import { Icon } from "./Icon";

export interface HireActs {
  hire: (proposalId: string, grants: string[]) => Promise<ActionResult & { agentId?: string }>;
  tryIt: (agentId: string, fresh?: boolean) => Promise<ActionResult & { runId?: string }>;
  goLive: (agentId: string, version: number, keep: number[] | null, confirmed: boolean) => Promise<ActionResult>;
  duty: (agentId: string, on: boolean) => Promise<ActionResult>;
}

export function HireCard({ c, dept, head, headTitle, controls, acts, trying, onTry, onChange, cont = false }: {
  c: HireCardView; dept: string; head: string; headTitle: string; controls: boolean; acts: HireActs;
  /** Right under the head's reply: part of that message, as in the mockup (no second name line). */
  cont?: boolean;
  /** This page is running the agent's try now (it outlives the card's redraw after Hire). */
  trying: boolean;
  /** Runs a fresh try from the chat, which keeps it going while the cards redraw. */
  onTry: (agentId: string) => void;
  /** Change something: put the cursor in the chat with the agent named. */
  onChange: (text: string) => void;
}) {
  const [grants, setGrants] = useState<string[]>([]);
  const [busy, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [later, setLater] = useState(false);
  const [done, setDone] = useState(false);
  const flip = (id: string) => setGrants((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  const run = (f: () => Promise<{ ok: boolean; text: string }>) => start(async () => {
    try { setSaid(await f()); } catch (e) { setSaid({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." }); }
  });

  const hire = () => run(async () => {
    const r = await acts.hire(c.proposalId!, grants);
    if (!r.ok || !r.agentId) return r;
    onTry(r.agentId);
    return { ok: true, text: `Hired by you · ${c.name} joins ${dept}, off duty until this first try looks right` };
  });
  const tryOnce = () => onTry(c.agentId!);
  const onDuty = () => run(async () => {
    const g = await acts.goLive(c.agentId!, c.version ?? 1, null, true);
    if (!g.ok) return g;
    const d = await acts.duty(c.agentId!, true);
    if (d.ok) setDone(true);
    return d.ok ? { ok: true, text: `${c.name} is on duty · ${c.when === "Only when you ask" ? "runs when you press Run now" : c.when.toLowerCase()}` } : d;
  });

  const stage = trying && c.stage !== "proposed" ? "trying" : c.stage;
  const kicker = stage === "proposed" ? (c.fromApp ? "New agent from Claude · needs your OK" : "New agent · needs your OK")
    : stage === "trying" ? "First try · working" : stage === "clean" ? "First try worked" : stage === "failed" ? "First try · needs another go" : c.fromApp ? "New agent from Claude · off duty" : "Hired · off duty";
  const off = !controls ? "Real runs are off on this OPERATOR" : undefined;

  return (
    <div className={`dp-msg${cont ? " cont" : ""}`}>
      <div className="dp-av head" aria-hidden={cont}>{initialsOf(head)}</div>
      <div className="dp-bub">
        {!cont && <div className="dp-who"><b>{head}</b> {headTitle}</div>}
        <div className="dp-glass dp-card dp-hire">
          <span className={`dp-card-k${stage === "failed" ? " amber" : ""}`}>{kicker}</span>
          <h4>{c.name}, {c.seat}</h4>
          <dl className="dp-kv">
            <dt>Job</dt><dd>{c.job}</dd>
            <dt>When</dt><dd>{c.when}</dd>
            {c.reportsTo && <><dt>Reports to</dt><dd>{c.reportsTo}</dd></>}
            <dt>Reads</dt><dd><div className="dp-chipset">{c.reads.length ? c.reads.map((r) => <span key={r} className="dp-chip">{r}</span>) : <span className="dp-note">Nothing yet.</span>}</div></dd>
            <dt>Can do</dt>
            <dd>
              <div className="dp-chipset">
                {!c.can.length ? <span className="dp-note">Nothing. It only reports.</span>
                  : stage === "proposed" ? c.can.map((x) => (
                    <button key={x.id} type="button" className="dp-tog" aria-pressed={grants.includes(x.id)} disabled={busy || !x.ready} title={x.why} onClick={() => flip(x.id)}><i />{x.label}{x.why ? ` · ${x.why}` : ""}</button>
                  )) : c.can.map((x) => <span key={x.id} className="dp-chip can">{x.label}</span>)}
              </div>
              {stage === "proposed" && c.can.length > 0 && <span className="dp-note">Tap to give it this. Each one stays a draft you approve.</span>}
            </dd>
          </dl>
          <div className="dp-cost"><b>{c.cost.big}</b><span>{c.cost.small}</span></div>
          {stage === "failed" && c.why && <span className="dp-note">The latest try {c.why}.</span>}
          {!done && !later && (
            <div className="dp-btns">
              {stage === "proposed" && <button type="button" className="dp-btn dark" disabled={busy || !controls} title={off} onClick={hire}>{busy ? "Hiring…" : `Hire ${c.name} and try once`}</button>}
              {(stage === "hired" || stage === "failed") && <button type="button" className="dp-btn dark" disabled={busy || !controls} title={off} onClick={tryOnce}>{busy ? "Trying…" : stage === "failed" ? "Try again" : "Try once"}</button>}
              {stage === "clean" && <button type="button" className="dp-btn dark" disabled={busy || !controls} title={off} onClick={onDuty}>{busy ? "Putting on duty…" : `Put ${c.name} on duty`}</button>}
              {stage === "clean" && <button type="button" className="dp-btn" disabled={busy} onClick={() => setLater(true)}>Not yet</button>}
              {(stage === "proposed" || stage === "hired" || stage === "failed") && <button type="button" className="dp-btn" disabled={busy} onClick={() => onChange(`Change ${c.name}: `)}>Change something</button>}
            </div>
          )}
          {later && <span className="dp-note">{c.name} stays off duty. Put it on duty from here or its sheet whenever you like.</span>}
          {said && <span className={said.ok ? "dp-done" : "dp-note dp-bad"}>{said.ok && <Icon name="check" size={14} />}{said.text}</span>}
        </div>
      </div>
    </div>
  );
}
