"use client";
// Installing a pack (packs slice 3), to the approved mockup: the Add a department sheet (Avery first, then department
// packs, then a confirm step listing what the pack adds and the connections it reads) and the Fill from a pack sheet
// on an open seat (agent packs that fit it, their suggested actions as Can do toggles that start off). Both are in the
// address (?add=dept, ?fill=<seat>), so back closes them. What each card says is worked out on the server
// (dashboard/pack-sheet-rules.ts); the install is one owner-only server action (dashboard/packActions.ts).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import type { AgentCard, DeptCard, Tag } from "@/dashboard/pack-sheet-rules";

type Result = { ok: boolean; text: string; href?: string };
const X = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>;

function useSheet(closeHref: string) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setOpen(true));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    addEventListener("keydown", esc);
    return () => { cancelAnimationFrame(r); removeEventListener("keydown", esc); };
  });
  // the page under the sheet loads while the sheet slides away, not after (click-speed slice 4)
  function close() { setOpen(false); router.push(closeHref, { scroll: false }); }
  return { open, close, router };
}

const Tags = ({ tags }: { tags: Tag[] }) => <div className="pk-meta">{tags.map((t) => <span key={t.text} className={`pk-tag${t.tone ? ` ${t.tone}` : ""}`}>{t.text}</span>)}</div>;
const Ci = ({ letter, hue }: { letter: string; hue: string }) => <span className="pk-ci" style={{ background: `color-mix(in srgb, ${hue} 35%, var(--card))` }}>{letter}</span>;

function Shell({ open, close, title, sub, children, foot }: { open: boolean; close: () => void; title: string; sub: string; children: React.ReactNode; foot: React.ReactNode }) {
  return (
    <>
      <div className={`ag-bg${open ? " open" : ""}`} onClick={close} />
      <aside className={`ag pk${open ? " open" : ""}`} aria-label={title} role="dialog" aria-modal="true">
        <div className="ag-h"><div><b>{title}</b><span>{sub}</span></div><button type="button" className="x" onClick={close} aria-label="Close">{X}</button></div>
        <div className="ag-body">{children}</div>
        <div className="ag-foot">{foot}</div>
      </aside>
    </>
  );
}

/** Add a department: Avery first, then the department packs; Next shows what the picked one adds, and Add installs it. */
export function AddDeptSheet({ packs, averyHref, closeHref, install }: { packs: DeptCard[]; averyHref: string; closeHref: string; install: (id: string) => Promise<Result> }) {
  const { open, close, router } = useSheet(closeHref);
  const [pick, setPick] = useState<string | null>(packs[0]?.id ?? null);
  const [step, setStep] = useState<"list" | "confirm">("list");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const p = packs.find((x) => x.id === pick) ?? null;
  const add = () => p && start(async () => {
    try { const r = await install(p.id); if (r.ok && r.href) router.push(r.href); else setMsg(r.text); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong."); }
  });

  if (step === "confirm" && p) return (
    <Shell open={open} close={close} title={`Add ${p.name}`} sub={p.by} foot={<>
      <span className="dp-note note">{msg ?? "Only the owner can add a pack. If anything fails, nothing is left behind."}</span>
      <button type="button" className="dp-btn" disabled={busy} onClick={() => { setStep("list"); setMsg(null); }}>Back</button>
      {!p.problems.length && <button type="button" className="dp-btn dark" disabled={busy} onClick={add}>{busy ? "Adding…" : `Add ${p.name}`}</button>}
    </>}>
      {p.problems.length > 0 && <div className="pk-box warn"><b>This pack can’t be added.</b> {p.problems.join("; ")}.</div>}
      <span className="pk-h6">What it adds</span>
      <div className="pk-list">{p.adds.map((r) => (
        <div key={`${r.title}${r.rest}`} className="pk-li"><span className="pk-dot" /><span className="t"><b>{r.title}</b>{r.rest}<small>{r.sub}</small></span>{r.off && <span className="pk-off">{r.off}</span>}</div>
      ))}</div>
      {p.conns.length > 0 && <>
        <span className="pk-h6">Connections it reads</span>
        <div className="pk-list">{p.conns.map((c) => (
          <div key={c.tile} className="pk-li"><span className={`pk-dot ${c.connected ? "ok" : "warn"}`} /><span className="t"><b>{c.name}</b>, for {c.gives}<small>{c.sub}</small></span>{!c.connected && <Link href="/connections" className="dp-btn">Connect</Link>}</div>
        ))}</div>
      </>}
      <div className="pk-box"><b>Everything starts off.</b> {p.offNote}</div>
    </Shell>
  );

  return (
    <Shell open={open} close={close} title="Add a department" sub="Start from a pack, or design one with Avery." foot={<>
      <span className="dp-note note">More packs, from the community, come with the marketplace.</span>
      <button type="button" className="dp-btn" onClick={close}>Cancel</button>
      <button type="button" className="dp-btn dark" disabled={!p} onClick={() => setStep("confirm")}>{p ? `Next: ${p.name}` : "Next"}</button>
    </>}>
      <Link href={averyHref} className="pk-choice"><Ci letter="A" hue="#F2C46B" /><div><b>Design one with Avery</b><p>She interviews you in the chat (what to track, goals, which tools), then proposes a head, agents and a monthly cost for your OK.</p></div></Link>
      {packs.length > 0 && <span className="pk-h6">Start from a pack</span>}
      {packs.map((x) => (
        <button key={x.id} type="button" className={`pk-choice${x.id === pick ? " pick" : ""}`} aria-pressed={x.id === pick} onClick={() => setPick(x.id)}>
          <Ci letter={x.letter} hue={x.hue} /><div><b>{x.name}</b><p>{x.about}</p><Tags tags={x.tags} /></div>
        </button>
      ))}
    </Shell>
  );
}

/** Fill an open seat from an agent pack: the packs that fit, the picked one's suggested actions as toggles that start off. */
export function FillSeatSheet({ seat, head, packs, closeHref, install }: { seat: { id: string; title: string }; head: string | null; packs: AgentCard[]; closeHref: string; install: (id: string, seatId: string, grants: string[], name: string) => Promise<Result> }) {
  const { open, close, router } = useSheet(closeHref);
  const [pick, setPick] = useState<string | null>(packs[0]?.id ?? null);
  const [on, setOn] = useState<string[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const p = packs.find((x) => x.id === pick) ?? null;
  const add = () => p && start(async () => {
    try { const r = await install(p.id, seat.id, on, p.name); setMsg(r.text); if (r.ok) router.push(closeHref, { scroll: false }); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong."); }
  });
  return (
    <Shell open={open} close={close} title={`Fill ${seat.title}`} sub="Agent packs that fit this seat" foot={<>
      <span className="dp-note note">{msg ?? "Only the owner can add a pack."}</span>
      <button type="button" className="dp-btn" onClick={close}>Cancel</button>
      {p && !p.problems.length && <button type="button" className="dp-btn dark" disabled={busy} onClick={add}>{busy ? "Adding…" : `Add ${p.name}`}</button>}
    </>}>
      {!packs.length && <span className="dp-note">No agent pack fits {seat.title} yet. Ask {head ?? "the head"} to hire for it instead.</span>}
      {packs.map((x) => (
        <button key={x.id} type="button" className={`pk-choice${x.id === pick ? " pick" : ""}`} aria-pressed={x.id === pick} onClick={() => { setPick(x.id); setOn([]); }}>
          <Ci letter={x.letter} hue={x.hue} /><div><b>{x.name}</b><p>{x.about}</p><Tags tags={x.tags} /></div>
        </button>
      ))}
      {p && p.problems.length > 0 && <div className="pk-box warn"><b>This pack can’t be added.</b> {p.problems.join("; ")}.</div>}
      {p && p.suggests.length > 0 && <>
        <span className="pk-h6">Can do (all start off)</span>
        <div className="pk-list">{p.suggests.map((t) => {
          const lit = on.includes(t.id);
          return (
            <div key={t.id} className="pk-li"><span className="t"><b>{t.label}</b><small>Suggested by the pack. Each one is a draft for your OK.</small></span>
              <button type="button" className="dp-tog" aria-pressed={lit} aria-label={`${t.label}: ${lit ? "on" : "off"}`} onClick={() => setOn((xs) => (lit ? xs.filter((y) => y !== t.id) : [...xs, t.id]))}><i /></button></div>
          );
        })}</div>
      </>}
      {p && <div className="pk-box"><b>It joins {head ? `under ${head}` : "the department"}, off duty.</b> Its playbook waits for your OK, and {p.starts ? `its schedule (${p.starts}) starts off until you turn it on.` : "it starts by hand until you give it a schedule."}</div>}
    </Shell>
  );
}
