"use client";
// A department's chat with its head (docs/department-pages.md, slice 2), the first tab of the
// department's page. Each message is one logged run of the head inside its budget
// (dashboard/chatActions.ts sendToHead). The lines under a reply come from code: what it actually saved.
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import type { ChatAnswer } from "@/core/avery-chat";
import { Reply } from "./chatReply";
import { Icon } from "./Icon";

export interface HeadMsg { id: string; role: "owner" | "head"; text: string; runId: string | null; notes: string[] }

export function HeadChat({ deptId, dept, head, initial, missing, starters, send }: {
  deptId: string; dept: string; head: string; initial: HeadMsg[]; missing: string | null; starters: string[];
  send: (deptId: string, text: string) => Promise<ChatAnswer>;
}) {
  const [msgs, setMsgs] = useState<HeadMsg[]>(initial);
  const [text, setText] = useState("");
  const [busy, start] = useTransition();
  const list = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // after layout settles, so the chat opens on the newest message
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    const f = requestAnimationFrame(() => requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight })));
    return () => cancelAnimationFrame(f);
  }, [msgs, busy]);

  const go = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || busy) return;
    setText("");
    setMsgs((m) => [...m, { id: `z${Date.now()}`, role: "owner", text: t, runId: null, notes: [] }]);
    start(async () => {
      let a: ChatAnswer;
      try { a = await send(deptId, t); } catch (e) { a = { ok: false, reply: e instanceof Error ? e.message : "Something went wrong.", notes: [], runId: null, costUsd: 0, kept: false }; }
      setMsgs((m) => [...m, { id: `a${Date.now()}`, role: "head", text: a.reply, runId: a.runId, notes: a.notes }]);
    });
  };

  return (
    <div className="card hc">
      <div className="hc-list" ref={list} aria-live="polite" aria-label={`Chat with ${head}`}>
        {!msgs.length && (
          <p className="sub" style={{ lineHeight: 1.5, margin: 0 }}>
            Ask {head} how {dept} is doing, tell them a rule for one of its agents in your own words, or ask to hire into {dept}. {head} reads the department’s data, saves your rules and files proposals. Nothing changes until you say yes.
          </p>
        )}
        {missing && <p className="sub" style={{ lineHeight: 1.5, margin: 0 }}>{missing}</p>}
        {msgs.map((m) => m.role === "owner"
          ? <div key={m.id} className="hc-me">{m.text}</div>
          : (
            <div key={m.id} className="hc-head">
              <span className="hc-who">{head}</span>
              <Reply text={m.text} />
              {m.notes.map((n, i) => <span key={i} className="hc-note"><Icon name="check" size={14} />{n}</span>)}
              {m.runId && <Link href={`/runs/${m.runId}`} className="hc-run">See how {head} worked it out</Link>}
            </div>
          ))}
        {busy && <div className="hc-head sub">{head} is looking…</div>}
      </div>
      <div className="hc-chips">
        {starters.map((s) => <button key={s} type="button" className="hc-chip" disabled={busy} onClick={() => go(s)}>{s}</button>)}
      </div>
      <form className="hc-form" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <label className="sr-only" htmlFor="hc-input">Message {head}</label>
        <textarea id="hc-input" ref={box} className="hc-input" rows={2} maxLength={1000} value={text} disabled={busy}
          placeholder={`Message ${head}`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }} />
        <button type="submit" className="hc-send" disabled={busy || !text.trim()} aria-label="Send"><Icon name="send" size={18} /></button>
      </form>
    </div>
  );
}
