"use client";
// A change card in a department's chat (docs/department-pages.md, slice 6), as in the approved mockup. The head
// filed a change to an agent or a goal; each line shows Now → New. Approve (owner only) goes through the goal
// code, or saves the agent's new version and sets its schedule and budget through the sheet's own actions. A
// new version then runs a try from the chat (the existing tryBuilt) and goes live only after a clean one (the
// existing goLive, which checks again).
import { useState, useTransition } from "react";
import type { ActionResult } from "@/dashboard/actions";
import type { ChangeCardView } from "@/dashboard/change-rules";
import { initialsOf } from "@/dashboard/dept-feed";
import { Icon } from "./Icon";

export interface ChangeActs {
  approve: (proposalId: string) => Promise<ActionResult & { agentId?: string; draft?: boolean }>;
  decline: (proposalId: string, reason: string) => Promise<ActionResult>;
  goLive: (agentId: string, version: number, keep: number[] | null, confirmed: boolean) => Promise<ActionResult>;
}

export function ChangeCard({ c, head, headTitle, controls, acts, trying, onTry, onChange, cont = false }: {
  c: ChangeCardView; head: string; headTitle: string; controls: boolean; acts: ChangeActs;
  /** Right under the head's reply: part of that message (no second name line). */
  cont?: boolean;
  /** This page is running the agent's try now. */
  trying: boolean;
  onTry: (agentId: string) => void;
  /** Change something: put the cursor in the chat with the agent or goal named. */
  onChange: (text: string) => void;
}) {
  const [busy, start] = useTransition();
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);
  const [closed, setClosed] = useState(false);
  const run = (f: () => Promise<{ ok: boolean; text: string }>) => start(async () => {
    try { setSaid(await f()); } catch (e) { setSaid({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." }); }
  });

  const approve = () => run(async () => {
    const r = await acts.approve(c.proposalId);
    if (!r.ok) return r;
    setClosed(true);
    if (r.draft && r.agentId) onTry(r.agentId);
    return { ok: true, text: `Approved by you · ${r.text}` };
  });
  const notNow = () => run(async () => {
    const r = await acts.decline(c.proposalId, "");
    if (r.ok) setClosed(true);
    return r.ok ? { ok: true, text: "Left as it is." } : r;
  });
  const live = () => run(async () => {
    const g = await acts.goLive(c.agentId!, c.version!, null, true);
    if (g.ok) setClosed(true);
    return g.ok ? { ok: true, text: `v${c.version} is live` } : g;
  });

  const stage = trying && c.stage !== "proposed" && c.stage !== "done" ? "trying" : c.stage;
  const name = c.title.split(",")[0];
  const kicker = stage === "trying" ? `${c.kicker} · trying v${c.version ?? ""}` : stage === "clean" ? `${c.kicker} · try worked` : stage === "failed" ? `${c.kicker} · try needs another go` : c.kicker;
  const off = !controls ? "Real runs are off on this OPERATOR" : undefined;

  return (
    <div className={`dp-msg${cont ? " cont" : ""}`}>
      <div className="dp-av head" aria-hidden={cont}>{initialsOf(head)}</div>
      <div className="dp-bub">
        {!cont && <div className="dp-who"><b>{head}</b> {headTitle}</div>}
        <div className="dp-glass dp-card dp-hire">
          <span className={`dp-card-k${stage === "failed" ? " amber" : ""}`}>{kicker}</span>
          <h4>{c.title}</h4>
          <dl className="dp-kv">
            {c.rows.map((r) => (
              <div key={r.k} style={{ display: "contents" }}>
                <dt>{r.k}</dt>
                <dd>{r.from != null && r.from !== r.to ? <><s>{r.from}</s><span className="to" aria-label="becomes">→</span>{r.to}</> : r.to}</dd>
              </div>
            ))}
          </dl>
          {stage === "proposed" && c.spec && <span className="dp-note">This saves a new version. {name} tries it once on today’s data before it replaces what runs now.</span>}
          {stage === "failed" && c.why && <span className="dp-note">The latest try {c.why}.</span>}
          {c.done && stage === "done" && <span className="dp-done"><Icon name="check" size={14} />{c.done}</span>}
          {!closed && stage !== "done" && (
            <div className="dp-btns">
              {stage === "proposed" && <button type="button" className="dp-btn dark" disabled={busy || !controls} title={off} onClick={approve}>{busy ? "Approving…" : c.spec ? "Approve and try once" : "Approve"}</button>}
              {stage === "proposed" && <button type="button" className="dp-btn" disabled={busy} onClick={notNow}>Not now</button>}
              {(stage === "draft" || stage === "failed") && c.agentId && <button type="button" className="dp-btn dark" disabled={busy || !controls} title={off} onClick={() => onTry(c.agentId!)}>{stage === "failed" ? "Try again" : "Try once"}</button>}
              {stage === "clean" && <button type="button" className="dp-btn dark" disabled={busy || !controls} title={off} onClick={live}>{busy ? "Going live…" : `Go live with v${c.version}`}</button>}
              {(stage === "proposed" || stage === "failed") && <button type="button" className="dp-btn" disabled={busy} onClick={() => onChange(`Change ${c.kind === "goal" ? `the goal “${name}”` : name}: `)}>Change something</button>}
            </div>
          )}
          {said && <span className={said.ok ? "dp-done" : "dp-note dp-bad"}>{said.ok && <Icon name="check" size={14} />}{said.text}</span>}
        </div>
      </div>
    </div>
  );
}
