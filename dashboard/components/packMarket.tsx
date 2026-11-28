"use client";
// The Packs page and a pack's page (packs slice 4), to the approved mockup. Search and filters run in the browser on
// the cards the server already worked out (core/pack-market-rules.ts), so a keystroke never waits on a request. Adding
// a department pack is the same owner-only server action as the Add a department sheet (dashboard/packActions.ts).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { costWords, matchCards, noMatchWords, packHref, type MarketCard, type MarketFilter } from "@/core/pack-market-view";

const KINDS: { id: MarketFilter["kind"]; label: string }[] = [{ id: "all", label: "All" }, { id: "department", label: "Departments" }, { id: "agent", label: "Agents" }];

export const PackIcon = ({ letter, hue, big }: { letter: string; hue: string; big?: boolean }) => (
  <span className={`pk-ci${big ? " pm-big" : ""}`} style={{ background: `color-mix(in srgb, ${hue} 32%, var(--card))` }}>{letter}</span>
);

/** Search, the kind and Works with filters, and the cards they leave. */
export function PackMarket({ cards, chips, start, averyHref }: { cards: MarketCard[]; chips: { id: string; name: string; connected: boolean }[]; start: MarketFilter; averyHref: string }) {
  const [f, setF] = useState<MarketFilter>(start);
  const shown = useMemo(() => matchCards(cards, f), [cards, f]);
  const tileName = chips.find((c) => c.id === f.tile)?.name ?? null;
  return (
    <>
      <label className="pm-search"><span aria-hidden="true">⌕</span><input id="pm-q" type="search" placeholder="Search packs" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} aria-label="Search packs" /></label>
      <div className="pm-filters">
        <div className="pm-seg" role="group" aria-label="Kind">
          {KINDS.map((k) => <button key={k.id} type="button" aria-pressed={f.kind === k.id} onClick={() => setF({ ...f, kind: k.id })}>{k.label}</button>)}
        </div>
        {chips.length > 0 && <span className="pm-flab">Works with</span>}
        {chips.map((c) => (
          <button key={c.id} type="button" className="pm-chip" aria-pressed={f.tile === c.id} onClick={() => setF({ ...f, tile: f.tile === c.id ? null : c.id })} title={c.connected ? "Connected" : "Not connected"}>
            <span className={`pk-dot ${c.connected ? "ok" : "warn"}`} />{c.name}
          </button>
        ))}
      </div>
      {shown.length > 0 ? (
        <div className="pm-grid">
          {shown.map((c) => (
            <Link key={c.id} href={packHref(c.id)} className="pm-card">
              <div className="pm-top"><PackIcon letter={c.letter} hue={c.hue} /><div><b>{c.name}</b><span className="pm-kind">{c.kind === "department" ? "Department" : "Agent"} pack · Built in</span></div></div>
              <p>{c.about}</p>
              <div className="pk-meta">{c.tags.map((t) => <span key={t.text} className={`pk-tag${t.tone ? ` ${t.tone}` : ""}`}>{t.text}</span>)}</div>
              <div className="pm-foot"><span>{costWords(c.cost)}{c.cost.byHand ? "" : " on duty"}</span><span className="dp-btn">Open</span></div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="pm-empty">
          <b>{noMatchWords(f, tileName)}</b>
          <span>Try All, or have Avery design one with you.</span>
          <span className="pm-row">
            <button type="button" className="dp-btn" onClick={() => setF({ q: "", kind: "all", tile: null })}>Clear filters</button>
            <Link href={averyHref} className="dp-btn dark">Design one with Avery</Link>
          </span>
        </div>
      )}
    </>
  );
}

/** Add on a department pack's page: this page is the confirm step, so one tap installs and lands on the department. */
export function AddPackButton({ id, name, install }: { id: string; name: string; install: (id: string) => Promise<{ ok: boolean; text: string; href?: string }> }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const add = () => start(async () => {
    try { const r = await install(id); if (r.ok && r.href) router.push(r.href); else setMsg(r.text); } catch (e) { setMsg(e instanceof Error ? e.message : "Something went wrong."); }
  });
  return (
    <>
      <button type="button" className="dp-btn dark pm-add" disabled={busy} onClick={add}>{busy ? "Adding…" : `Add ${name}`}</button>
      <span className="pm-note" role="status">{msg ?? "Only the owner can add a pack. If anything fails, nothing is left behind."}</span>
    </>
  );
}
