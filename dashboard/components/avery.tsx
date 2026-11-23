"use client";
// Avery's chat on every screen (docs/company-mode.md, slice 5): a side panel on a wide screen, a bar
// at the bottom of a phone that opens into a full sheet. Each message is one logged run inside her
// budget (dashboard/chatActions.ts). The lines under a reply come from code: what it actually saved.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import type { ChatAnswer } from "@/core/avery-chat";
import { WIDTH, clampWidth, closeEffect, defaultWidth, parseReply, storedWidth, type Inline } from "@/dashboard/chat-ui";
import { Icon } from "./Icon";

export interface ChatMsg { id: string; role: "owner" | "avery"; text: string; runId: string | null; notes: string[] }

const STARTERS = ["What needs me today?", "How are the goals?", "Hire someone", "Add a department"];
const KEY = "cr_avery";
const WKEY = "cr_avery_w";
const noop = () => () => {};
const readStored = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
// the panel's width (card 290): this browser's dragged width, kept inside what this window allows
const onResize = (cb: () => void) => { window.addEventListener("resize", cb); return () => window.removeEventListener("resize", cb); };
const readWidth = () => { let raw: string | null = null; try { raw = localStorage.getItem(WKEY); } catch { /* fine without it */ } return storedWidth(raw, window.innerWidth); };
const serverWidth = () => WIDTH.def;

/** Her reply with its light formatting (dashboard/chat-ui.ts): React elements only, never HTML, never links. */
function Line({ parts }: { parts: Inline[] }) {
  return <>{parts.map((p, i) => p.kind === "b" ? <b key={i}>{p.text}</b> : p.kind === "i" ? <em key={i}>{p.text}</em> : p.kind === "code" ? <code key={i}>{p.text}</code> : <span key={i}>{p.text}</span>)}</>;
}
function Reply({ text }: { text: string }) {
  return (
    <div className="avery-md">
      {parseReply(text).map((b, i) =>
        b.kind === "h" ? <b key={i} className="avery-md-h"><Line parts={b.text} /></b>
        : b.kind === "p" ? <p key={i}>{b.lines.map((l, j) => <span key={j}>{j > 0 && <br />}<Line parts={l} /></span>)}</p>
        : b.kind === "ul" ? <ul key={i}>{b.items.map((it, j) => <li key={j}><Line parts={it} /></li>)}</ul>
        : <ol key={i} start={b.start}>{b.items.map((it, j) => <li key={j}><Line parts={it} /></li>)}</ol>)}
    </div>
  );
}

export function AveryChat({ name, initial, missing, send, draft, draftSummary }: {
  name: string; initial: ChatMsg[]; missing: string | null; send: (text: string) => Promise<ChatAnswer>;
  /** Card 156: the department draft card, drawn on the server. Card 290: shown in place of the messages when opened. */
  draft?: React.ReactNode;
  /** Card 290: the one-line strip pinned under the header while a draft exists. */
  draftSummary?: { name: string; gaps: string[] } | null;
}) {
  const path = usePathname();
  // wide screen: open by default on the Desk; elsewhere it remembers what the owner last did (this browser only).
  // phone: a bar at the bottom that opens a full sheet, closed again on the next page.
  const stored = useSyncExternalStore(noop, readStored, () => null);
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const open = manual[path] ?? (path === "/" || stored === "open");
  const [sheetAt, setSheetAt] = useState<string | null>(null);
  const sheet = sheetAt === path;
  // card 290: the panel stays mounted so it can slide; motion starts with the owner's first open or close,
  // so a page load never animates
  const [anim, setAnim] = useState(false);
  const savedWidth = useSyncExternalStore(onResize, readWidth, serverWidth);
  const [drag, setDrag] = useState<number | null>(null);
  const width = drag ?? savedWidth;
  const [showDraft, setShowDraft] = useState(false);
  const [msgs, setMsgs] = useState<ChatMsg[]>(initial);
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // after layout settles (two frames), so the panel opens on the newest message, not partway up (card 189);
  // the draft opens at its top (card 290)
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const f = requestAnimationFrame(() => requestAnimationFrame(() => el.scrollTo({ top: showDraft ? 0 : el.scrollHeight })));
    return () => cancelAnimationFrame(f);
  }, [msgs, open, sheet, busy, showDraft]);

  const focusBox = () => setTimeout(() => box.current?.focus(), 60);
  const openPanel = () => {
    setAnim(true);
    setManual((m) => ({ ...m, [path]: true }));
    try { if (path !== "/") localStorage.setItem(KEY, "open"); } catch { /* fine without it */ }
    focusBox();
  };
  const openSheet = () => { setAnim(true); setSheetAt(path); focusBox(); };
  // card 290: closing the phone sheet closes only the sheet; only the wide-screen close is remembered
  const close = () => {
    const fx = closeEffect(sheet, path);
    setAnim(true);
    if (fx.sheet === "close") setSheetAt(null);
    if (fx.panel === "close") setManual((m) => ({ ...m, [path]: false }));
    if (fx.remember) { try { localStorage.setItem(KEY, fx.remember); } catch { /* fine without it */ } }
  };
  const saveWidth = (w: number) => {
    try { localStorage.setItem(WKEY, String(w)); } catch { /* fine without it */ }
    window.dispatchEvent(new Event("resize"));
  };
  // drag the left edge: wider to the left, narrower to the right
  const startDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, w0 = width;
    let last = w0;
    const move = (ev: PointerEvent) => { last = clampWidth(w0 + (x0 - ev.clientX), window.innerWidth); setDrag(last); };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      saveWidth(last);
      setDrag(null);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
  };
  const nudge = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const by = e.key === "ArrowLeft" ? WIDTH.step : e.key === "ArrowRight" ? -WIDTH.step : 0;
    if (e.key === "Home" || e.key === "End" || by) {
      e.preventDefault();
      const w = e.key === "Home" ? WIDTH.min : e.key === "End" ? WIDTH.max : width + by;
      saveWidth(clampWidth(w, window.innerWidth));
    }
  };
  const go = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || busy) return;
    setText("");
    setShowDraft(false);
    setMsgs((m) => [...m, { id: `z${Date.now()}`, role: "owner", text: t, runId: null, notes: [] }]);
    start(async () => {
      let a: ChatAnswer;
      try { a = await send(t); } catch (e) { a = { ok: false, reply: e instanceof Error ? e.message : "Something went wrong.", notes: [], runId: null, costUsd: 0, kept: false }; }
      setMsgs((m) => [...m, { id: `a${Date.now()}`, role: "avery", text: a.reply, runId: a.runId, notes: a.notes }]);
    });
  };
  const viewingDraft = showDraft && !!draft;
  const shown = open || sheet;

  return (
    <>
      <button className="avery-bar" onClick={openSheet} aria-label={`Ask ${name}`}>
        <span className="avery-av">{name[0]}</span>
        <span className="avery-bar-t">Ask {name}, or tell her something</span>
        <Icon name="message-circle" size={18} />
      </button>
      {!open && (
        <button className="avery-tab" onClick={openPanel} title={`Ask ${name}`} aria-label={`Open the chat with ${name}`}>
          <span className="avery-av">{name[0]}</span>
          <span className="avery-tab-t">Ask {name}</span>
        </button>
      )}
      <aside className={`avery${open ? " d-open" : ""}${sheet ? " m-open" : ""}${anim ? " anim" : ""}${drag != null ? " dragging" : ""}`}
        style={{ "--avery-w": `${width}px` } as React.CSSProperties} aria-label={`Chat with ${name}`} inert={!shown}
        onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
        <div className="avery-grip" role="separator" aria-orientation="vertical" aria-label="Drag to resize the chat" tabIndex={open ? 0 : -1}
          aria-valuemin={WIDTH.min} aria-valuemax={WIDTH.max} aria-valuenow={width}
          onPointerDown={startDrag} onKeyDown={nudge} onDoubleClick={() => saveWidth(defaultWidth(window.innerWidth))} />
        <div className="avery-in">
          <div className="avery-head">
            <span className="avery-av lg">{name[0]}</span>
            <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              <b style={{ fontWeight: 600 }}>{name}</b>
              <span className="avery-sub">Chief of staff · proposes, never changes things herself</span>
            </span>
            <button className="avery-x" onClick={close} aria-label="Close the chat"><Icon name="x" size={18} /></button>
          </div>
          {draft && (
            <button className={`avery-draft${viewingDraft ? " on" : ""}`} onClick={() => setShowDraft((v) => !v)} aria-expanded={viewingDraft}>
              <span className="avery-draft-k">Department draft</span>
              <span className="avery-draft-t">
                <b>{draftSummary?.name || "New department"}</b>
                {draftSummary && draftSummary.gaps.length > 0 ? ` · still needs ${draftSummary.gaps.join(", ")}` : " · ready to propose"}
              </span>
              <Icon name={viewingDraft ? "x" : "chevron-right"} size={16} />
            </button>
          )}
          <div className="avery-list" ref={list} aria-live="polite">
            {viewingDraft ? (
              <>
                <button className="avery-back" onClick={() => setShowDraft(false)}><Icon name="chevron-left" size={14} />Back to chat</button>
                <div className="avery-draft-card">{draft}</div>
              </>
            ) : (
              <>
                {!msgs.length && (
                  <p className="avery-sub" style={{ lineHeight: 1.5 }}>
                    Ask how a department is doing, tell {name} a rule for an agent in your own words, ask her to hire someone, or design a new department with her. She reads the company’s data, saves your rules and files proposals. Nothing changes until you say yes.
                  </p>
                )}
                {missing && <p className="avery-sub" style={{ lineHeight: 1.5 }}>{missing}</p>}
                {msgs.map((m) => m.role === "owner"
                  ? <div key={m.id} className="avery-me">{m.text}</div>
                  : (
                    <div key={m.id} className="avery-her">
                      <Reply text={m.text} />
                      {m.notes.map((n, i) => <span key={i} className="avery-note"><Icon name="check" size={14} />{n}</span>)}
                      {m.runId && <Link href={`/runs/${m.runId}`} className="avery-run">See how she worked it out</Link>}
                    </div>
                  ))}
                {busy && <div className="avery-her avery-sub">{name} is looking…</div>}
              </>
            )}
          </div>
          {!viewingDraft && (
            <div className="avery-chips">
              {STARTERS.map((s) => <button key={s} className="avery-chip" disabled={busy} onClick={() => (s === "Hire someone" ? (setText("Hire someone to "), box.current?.focus()) : s === "Add a department" ? (setText("I want a new department for "), box.current?.focus()) : go(s))}>{s}</button>)}
            </div>
          )}
          <form className="avery-form" onSubmit={(e) => { e.preventDefault(); go(); }}>
            <label className="avery-sub" htmlFor="avery-input">Ask {name}, or tell her something</label>
            <div className="row" style={{ gap: 8 }}>
              <textarea id="avery-input" ref={box} className="avery-input" rows={2} maxLength={1000} value={text} disabled={busy}
                placeholder="e.g. Quinn keeps putting Costco in supplies. It's groceries."
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }} />
              <button type="submit" className="avery-send" disabled={busy || !text.trim()} aria-label="Send"><Icon name="send" size={18} /></button>
            </div>
          </form>
        </div>
      </aside>
    </>
  );
}
