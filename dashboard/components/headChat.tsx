"use client";
// A department's chat (docs/department-pages.md, slices 2 and 3), as in the approved mockup: a glass room
// with the conversation with the head and every run of the department's agents. The Company page (slice 8)
// uses the same room for Avery's chat, with Avery's runs; both open in the page's Ask sheet. A run shows its checklist
// (built in code from its logged steps), its result and its drafts as approval cards; while it is going the
// chat polls the department's runs (app/(room)/dept/[id]/live) so its steps appear as they happen. Each
// message to the head is one logged run of the head (dashboard/chatActions.ts sendToHead).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, useTransition } from "react";
import type { ChatAnswer } from "@/core/avery-chat";
import type { HireCardView } from "@/dashboard/hire-rules";
import { HireCard, type HireActs } from "./hireCard";
import type { ChangeCardView } from "@/dashboard/change-rules";
import { ChangeCard, type ChangeActs } from "./changeCard";
import { clock, dayLabel, initialsOf, mergeFeed, runFoot, runState, runTitle, type FeedRun, type FeedTalk } from "@/dashboard/dept-feed";
import { Reply } from "./chatReply";
import { Icon } from "./Icon";

const LIVE_MS = 3000, IDLE_MS = 20000;

function RunCard({ r, tz, cards }: { r: FeedRun; tz: string; cards: Record<string, React.ReactNode> }) {
  const st = runState(r.status);
  return (
    <div className="dp-msg">
      <div className="dp-av">{initialsOf(r.name)}</div>
      <div className="dp-bub">
        <div className="dp-who"><b>{r.name}</b> {r.role ? `${r.role} · ` : ""}{clock(r.at, tz)} <span className="tag">run</span></div>
        <div className="dp-glass dp-run">
          <div className="dp-run-t">{runTitle(r.trigger, r.version ?? null)}<span className={`st ${st.look}`}>{st.word}</span></div>
          {r.lines.length > 0 && (
            <ul className="dp-steps">
              {r.lines.map((l, i) => <li key={i} className={l.state}><span className="ck" /><span>{l.label}</span></li>)}
            </ul>
          )}
        </div>
        {r.result && <div className="dp-glass dp-headtext dp-text"><Reply text={r.result} /></div>}
        {r.drafts.map((id) => cards[id] ? <Fragment key={id}>{cards[id]}</Fragment> : null)}
        {r.status !== "running" && <div className="dp-run-foot"><span>{runFoot(r.steps, r.at, r.endedAt, r.costUsd)}</span><Link href={`/runs/${r.id}`}>How it thought</Link></div>}
      </div>
    </div>
  );
}

export function HeadChat({ deptId, dept, head, title, tz, talk, runs, cards, starters, missing, send, hires = [], hireActs, changes = [], changeActs, controls = false, say = "", live: liveAt, empty }: {
  deptId: string; dept: string; head: string | null; title: string; tz: string;
  talk: FeedTalk[]; runs: FeedRun[]; cards: Record<string, React.ReactNode>; starters: string[]; missing: string | null;
  /** One message to the head (a server action already bound to its department, or Avery's). */
  send: (text: string) => Promise<ChatAnswer>;
  /** Where the runs are polled as they happen: the department's own by default; null polls nothing. */
  live?: string | null;
  /** Cards drawn on the server, shown after the conversation (the Company page's Needs you, slice 8). */
  /** The line an empty chat shows. */
  empty?: string;
  /** Hire cards (slice 5): hires waiting on you and agents never put on duty. */
  hires?: HireCardView[]; hireActs?: HireActs; controls?: boolean;
  /** Change cards (slice 6): changes to an agent or a goal the head filed, waiting on you or decided this week. */
  changes?: ChangeCardView[]; changeActs?: ChangeActs;
  /** Typed into the box when the page opens (a "hire an agent" link). */
  say?: string;
}) {
  const router = useRouter();
  const [mine, setMine] = useState<FeedTalk[]>([]);
  const [live, setLive] = useState<FeedRun[]>([]);
  const [text, setText] = useState(say);
  // tries this page started: they keep going while the server redraws the cards
  const [trying, setTrying] = useState<string[]>([]);
  const [tried, setTried] = useState<{ id: string; ok: boolean; text: string }[]>([]);
  const [busy, start] = useTransition();
  const log = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [loadedAt] = useState(() => new Date(Date.now() - 60e3).toISOString());
  const [now] = useState(() => Date.now());
  // a fresh server draw holds everything this page added, so start over from it
  const [drawn, setDrawn] = useState({ talk, runs });
  if (drawn.talk !== talk || drawn.runs !== runs) { setDrawn({ talk, runs }); setMine([]); setLive([]); }

  // what the server drew, then what this page added since (its own messages, live run updates)
  const serverTalk = new Set(talk.map((t) => t.id));
  const items = mergeFeed([...talk, ...mine.filter((m) => !serverTalk.has(m.id))], [...runs, ...live.filter((l) => {
    const s = runs.find((r) => r.id === l.id);
    return !s || s.status === "running";
  })]);
  const going = items.some((i) => i.kind === "run" && i.status === "running");

  // keep the newest message in view
  useEffect(() => {
    const el = log.current;
    if (!el) return;
    const f = requestAnimationFrame(() => requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight })));
    return () => cancelAnimationFrame(f);
  }, [items.length, busy, going, tried.length]);

  // runs as they happen: poll often while one is going, now and then otherwise
  const liveUrl = liveAt === undefined ? `/dept/${deptId}/live` : liveAt;
  useEffect(() => {
    if (!liveUrl) return;
    let stop = false;
    const since = [loadedAt, ...items.filter((i) => i.kind === "run" && i.status === "running").map((i) => i.at)].sort()[0];
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`${liveUrl}?since=${encodeURIComponent(since)}`, { cache: "no-store" });
        if (!res.ok || stop) return;
        const got = ((await res.json()).runs ?? []) as FeedRun[];
        const wasGoing = new Set(items.filter((i) => i.kind === "run" && i.status === "running").map((i) => i.id));
        setLive(got);
        // a run just finished: draw its approval cards and result on the server
        if (got.some((r) => wasGoing.has(r.id) && r.status !== "running")) router.refresh(); // refresh-ok: a run finished while the chat was open
      } catch { /* the next poll tries again */ }
    }, going ? LIVE_MS : IDLE_MS);
    return () => { stop = true; clearTimeout(t); };
  });

  const go = (raw?: string) => {
    const t = (raw ?? text).trim();
    if (!t || busy || !head) return;
    setText("");
    const now = new Date().toISOString();
    setMine((m) => [...m, { id: `z${Date.now()}`, role: "owner", text: t, notes: [], runId: null, at: now }]);
    start(async () => {
      let a: ChatAnswer;
      try { a = await send(t); } catch (e) { a = { ok: false, reply: e instanceof Error ? e.message : "Something went wrong.", notes: [], runId: null, costUsd: 0, kept: false }; }
      // a kept reply comes back in the server's fresh draw; only one that wasn't kept is added here
      if (!a.kept) setMine((m) => [...m, { id: `a${Date.now()}`, role: "head", text: a.reply, notes: a.notes, runId: a.runId, at: new Date().toISOString() }]);
    });
  };

  const startTry = (agentId: string) => {
    if (!hireActs || trying.includes(agentId)) return;
    setTrying((t) => [...t, agentId]);
    void hireActs.tryIt(agentId, true)
      .then((r) => ({ ok: r.ok, text: r.ok ? "Try done. Its result is above." : r.text }), (e: unknown) => ({ ok: false, text: e instanceof Error ? e.message : "The try didn’t finish." }))
      .then((r) => { setTrying((t) => t.filter((x) => x !== agentId)); setTried((d) => [...d, { id: `${agentId}:${Date.now()}`, ...r }]); });
  };
  const change = (t: string) => { setText(t); requestAnimationFrame(() => box.current?.focus()); };

  // a divider above the first message of each day
  const labels = items.map((it) => dayLabel(it.at, tz, now));
  const day = (i: number) => (i === 0 || labels[i] !== labels[i - 1] ? <div className="dp-day">{labels[i]}</div> : null);
  const headIni = initialsOf(head ?? dept);
  const hireCard = (h: HireCardView, cont = false) => hireActs ? (
    <HireCard key={h.key} c={h} dept={dept} head={head ?? dept} headTitle={title} controls={controls} acts={hireActs} cont={cont}
      trying={!!h.agentId && trying.includes(h.agentId)} onTry={startTry} onChange={change} />
  ) : null;
  const changeCard = (c: ChangeCardView, cont = false) => changeActs ? (
    <ChangeCard key={c.key} c={c} head={head ?? dept} headTitle={title} controls={controls} acts={changeActs} cont={cont}
      trying={!!c.agentId && trying.includes(c.agentId)} onTry={startTry} onChange={change} />
  ) : null;
  // hire and change cards, in time order between the messages and runs
  const extra = [...hires.map((h) => ({ at: h.at, el: (cont: boolean) => hireCard(h, cont) })), ...changes.map((c) => ({ at: c.at, el: (cont: boolean) => changeCard(c, cont) }))]
    .sort((x, y) => x.at.localeCompare(y.at));

  return (
    <div className="dp-room">
      <div className="dp-blob b0" /><div className="dp-blob b1" /><div className="dp-blob b2" />
      <div className="dp-log" ref={log} aria-live="polite">
        {!items.length && !extra.length && (
          <p className="dp-empty">
            {empty ?? (head ? `Ask ${head} how ${dept} is doing, tell ${head} a rule for one of its agents in your own words, or ask to hire into ${dept}. Every run in ${dept} posts here too: its steps, its result and anything waiting for your OK.` : `Every run in ${dept} posts here: its steps, its result and anything waiting for your OK.`)}
          </p>
        )}
        {missing && <p className="dp-empty">{missing}</p>}
        {extra.filter((h) => !items.length || h.at < items[0].at).map((h) => h.el(false))}
        {items.map((it, i) => (
          <Fragment key={`${it.kind}:${it.id}`}>
            {day(i)}
            {it.kind === "run" ? <RunCard r={it} tz={tz} cards={cards} />
              : it.role === "owner" ? <div className="dp-msg mine"><div className="dp-bub"><div className="dp-text">{it.text}</div></div></div>
              : (
                <div className="dp-msg">
                  <div className="dp-av head">{headIni}</div>
                  <div className="dp-bub">
                    <div className="dp-who"><b>{head ?? dept}</b> {title} · {clock(it.at, tz)}</div>
                    <div className="dp-glass dp-headtext dp-text"><Reply text={it.text} /></div>
                    {it.notes.map((n, i) => <span key={i} className="dp-saved"><Icon name="check" size={14} />{n}</span>)}
                    {it.runId && <div className="dp-run-foot"><Link href={`/runs/${it.runId}`}>How it thought</Link></div>}
                  </div>
                </div>
              )}
            {extra.filter((h) => h.at >= it.at && (i === items.length - 1 || h.at < items[i + 1].at)).map((h) => h.el(it.kind !== "run" && it.role === "head"))}
          </Fragment>
        ))}
        {tried.map((t) => <span key={t.id} className={t.ok ? "dp-done" : "dp-note dp-bad"}>{t.ok && <Icon name="check" size={14} />}{t.text}</span>)}
        {busy && <div className="dp-msg"><div className="dp-av head">{headIni}</div><div className="dp-glass dp-typing" aria-label={`${head} is looking`}><i /><i /><i /></div></div>}
      </div>
      {head && (
        <div className="dp-composer">
          <div className="dp-sugg">
            {starters.map((s) => <button key={s} type="button" disabled={busy} onClick={() => go(s)}>{s}</button>)}
          </div>
          <form className="dp-inbox dp-glass" onSubmit={(e) => { e.preventDefault(); go(); }}>
            <label className="sr-only" htmlFor="dp-say">Message {head}</label>
            <textarea id="dp-say" ref={box} rows={1} maxLength={1000} value={text} disabled={busy} placeholder={`Message ${head} about ${dept}…`}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }} />
            <button type="submit" className="dp-send" disabled={busy || !text.trim()} aria-label="Send">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
