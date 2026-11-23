"use client";
// The setup check card (card 281, docs/setup-check.md): Check my setup on a connected tool, the card
// polling while the setup agent reads it, then each finding with Show me how (its steps and the help
// page they came from), Skip, and Check again. Every finding passed code's checks before it was saved.
import { useEffect, useRef, useState, useTransition } from "react";
import type { SetupCheck } from "@/core/setup-check";
import Link from "next/link";
import { FIXES, SEVERITY_WORDS, countLine, type Finding, type Severity } from "@/core/setup-check-rules";
import { fixFinding, reopenFinding, setupCheckState, skipFinding, startSetupCheck } from "@/dashboard/setupCheckActions";
import { usd } from "@/core/cost-rules";

const TONE: Record<Severity, { background: string; color: string }> = {
  broken: { background: "var(--red-soft)", color: "var(--red-ink)" },
  worth_fixing: { background: "var(--yel-soft)", color: "var(--yel-ink)" },
  good: { background: "var(--mint-soft)", color: "var(--mint-ink)" },
};
const POLL_MS = 4000;

function host(url: string): string { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } }

function FindingRow({ f, i, tile, canEdit, owner, onChange }: { f: Finding; i: number; tile: string; canEdit: boolean; owner: boolean; onChange: (c: SetupCheck | null) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, start] = useTransition();
  const [bad, setBad] = useState<string | null>(null);
  const [grant, setGrant] = useState<string | null>(null);
  const fix = () => start(async () => {
    const r = await fixFinding(tile, i);
    setBad(r.ok ? null : r.text); setGrant(r.ok ? null : r.href ?? null);
    onChange(await setupCheckState(tile));
  });
  const fixing = f.fix_run?.status === "running";
  const set = (skip: boolean) => start(async () => {
    const r = await (skip ? skipFinding(tile, i) : reopenFinding(tile, i));
    if (!r.ok) { setBad(r.text); return; }
    setBad(null); onChange(await setupCheckState(tile));
  });
  return (
    <li className="stack rule" style={{ gap: 6, paddingTop: 10, listStyle: "none" }}>
      <span className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
        <span className="pill sm" style={TONE[f.severity]}>{SEVERITY_WORDS[f.severity]}</span>
        <b style={{ fontSize: 14.5 }}>{f.title}</b>
      </span>
      <span className="sub" style={{ fontSize: 13.5 }}>{f.why}</span>
      {f.steps.length > 0 && (open ? (
        <div className="stack" style={{ gap: 6 }}>
          <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 4, fontSize: 14, lineHeight: 1.5 }}>{f.steps.map((s, k) => <li key={k}>{s}</li>)}</ol>
          {f.help_url && <span className="ink2" style={{ fontSize: 12.5 }}>From <a href={f.help_url} target="_blank" rel="noopener noreferrer nofollow">{host(f.help_url)}</a>, the help page the check read.</span>}
        </div>
      ) : null)}
      {(f.steps.length > 0 || canEdit) && (
        <div className="row wrap" style={{ gap: 8 }}>
          {f.fix && owner && f.state !== "skipped" && <button type="button" className="btn dark sm" disabled={busy || fixing} onClick={fix} title={FIXES[f.fix].label}>{fixing ? "Fixing…" : "Fix it for me"}</button>}
          {f.steps.length > 0 && <button type="button" className="btn outline sm" onClick={() => setOpen(!open)}>{open ? "Hide steps" : "Show me how"}</button>}
          {canEdit && f.severity !== "good" && <button type="button" className="btn ghost sm" disabled={busy} onClick={() => set(f.state !== "skipped")}>{f.state === "skipped" ? "Open again" : "Skip"}</button>}
        </div>
      )}
      {f.fix_run && f.fix_run.status !== "running" && (
        <span className="soft-box" role="status" style={{ fontSize: 13 }}>{f.fix_run.note}{f.fix_run.status === "done" && f.fix_run.staged > 0 && <> <Link href="/approvals">Open Approvals</Link></>}</span>
      )}
      {bad && <span className="soft-box" role="status" style={{ fontSize: 13, background: "var(--red-soft)", color: "var(--red-ink)" }}>{bad}{grant && <> <Link href={grant}>Give an agent this action</Link></>}</span>}
    </li>
  );
}

/**
 * One tool's check. `auto` starts it once on its own (the first few tools in free setup); otherwise the
 * owner taps Check my setup. Polls while the row says running.
 */
export function SetupCheckCard({ tile, name, initial, owner, approver, auto }: { tile: string; name: string; initial: SetupCheck | null; owner: boolean; approver: boolean; auto: boolean }) {
  const [c, setC] = useState<SetupCheck | null>(initial);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();
  const once = useRef(false);
  const go = () => start(async () => {
    const r = await startSetupCheck(tile);
    setNote(r.ok ? null : r);
    if (r.ok) setC(await setupCheckState(tile));
  });
  useEffect(() => { if (once.current || !auto || !owner || initial) return; once.current = true; go(); });
  // poll while the check runs, or while a Fix it for me run is going
  const running = c?.status === "running" || !!c?.findings.some((f) => f.fix_run?.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(async () => { const n = await setupCheckState(tile); if (n) setC(n); }, POLL_MS);
    return () => clearInterval(t);
  }, [running, tile]);

  const shown = (c?.findings ?? []).map((f, i) => ({ f, i })).filter(({ f }) => f.state !== "skipped");
  const skipped = (c?.findings.length ?? 0) - shown.length;
  return (
    <div className="stack rule" style={{ gap: 10, paddingTop: 12 }} aria-live="polite">
      <span className="row wrap" style={{ gap: 8, justifyContent: "space-between", alignItems: "baseline" }}>
        <b style={{ fontSize: 14.5 }}>Is {name} set up well for you?</b>
        {c?.status === "done" && <span className="ink2" style={{ fontSize: 12.5 }}>{countLine(c.findings)}</span>}
      </span>
      {busy || c?.status === "running" ? (
        <span className="row ink2" style={{ gap: 10, fontSize: 14 }}><span className="wg-dots" aria-hidden><i /><i /><i /></span>Reading how your {name} is set up and checking its help pages. About a minute or two.</span>
      ) : !c ? (
        <span className="sub">A setup agent reads how your {name} is set up and lists what’s missing for your business, each with steps from {name}’s own help. It changes nothing in {name}.</span>
      ) : c.status === "failed" ? (
        <span className="soft-box" role="status" style={{ fontSize: 13 }}>{c.summary ?? "The check didn’t finish, so nothing was saved."}</span>
      ) : (
        <>
          {c.summary && <span style={{ fontSize: 14 }}>{c.summary}</span>}
          {shown.length > 0 && <ul className="stack" style={{ gap: 0, margin: 0, padding: 0 }}>{shown.map(({ f, i }) => <FindingRow key={i} f={f} i={i} tile={tile} canEdit={approver} owner={owner} onChange={setC} />)}</ul>}
          {skipped > 0 && <span className="ink2" style={{ fontSize: 12.5 }}>{skipped} skipped. They wait on your Desk.</span>}
          <span className="ink2" style={{ fontSize: 12.5 }}>The check changed nothing in {name}{c.findings.some((f) => f.fix) ? "; Fix it for me only stages changes for you to approve" : ""}. This check cost {usd(c.costUsd)}.</span>
        </>
      )}
      {note && <span className="soft-box" role="status" style={{ fontSize: 13, background: "var(--red-soft)", color: "var(--red-ink)" }}>{note.text}</span>}
      {owner && !busy && c?.status !== "running" && <div><button type="button" className="btn outline sm" onClick={go}>{c ? "Check again" : "Check my setup"}</button></div>}
    </div>
  );
}
