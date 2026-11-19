"use client";
// First-run setup, step 1 (card 151, docs/setup.md): the conversation with Avery and the "What I've
// learned so far" panel. Each message is one logged run (dashboard/setupActions.ts); the lines under a
// reply come from code: what it actually saved.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { SetupAnswer } from "@/core/setup";
import type { ActionResult } from "@/dashboard/actions";
import { FACT_TOPICS, TOPIC_WORDS, type Fact, type FactTopic } from "@/core/setup-rules";
import { Toast } from "./client";
import { Icon } from "./Icon";

export interface SetupMsg { id: string; role: "owner" | "avery"; text: string; runId: string | null; notes: string[] }

export function SetupChat({ name, initial, send, ready, blocked }: { name: string; initial: SetupMsg[]; send: (text: string, site: string) => Promise<SetupAnswer>; ready: boolean; blocked: string | null }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<SetupMsg[]>(initial);
  const [text, setText] = useState("");
  const [site, setSite] = useState("");
  const [busy, start] = useTransition();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [msgs, busy]);
  const go = () => {
    const t = text.trim();
    if (!t || busy || !ready) return;
    const s = site.trim();
    setText("");
    setMsgs((m) => [...m, { id: `z${Date.now()}`, role: "owner", text: s ? `${t}\n\n(My site: ${s})` : t, runId: null, notes: [] }]);
    start(async () => {
      let a: SetupAnswer;
      try { a = await send(t, s); } catch (e) { a = { ok: false, reply: e instanceof Error ? e.message : "Something went wrong.", notes: [], runId: null, costUsd: 0, kept: false, saved: 0, suggested: 0 }; }
      setMsgs((m) => [...m, { id: `a${Date.now()}`, role: "avery", text: a.reply, runId: a.runId, notes: a.notes }]);
      if (a.ok && s) setSite("");
      router.refresh();
    });
  };
  return (
    <section aria-label={`Conversation with ${name}`} className="stack" style={{ gap: 16, flex: "999 1 520px", minWidth: 0 }}>
      <div className="stack" style={{ gap: 6 }}>
        <h1 style={{ fontSize: 30, lineHeight: 1.15, fontWeight: 700, letterSpacing: "-.02em" }}>Tell me about your business</h1>
        <p className="ink2" style={{ fontSize: 15 }}>Talk the way you would to a new hire. I’ll work out the rest.</p>
      </div>
      <div ref={list} className="stack" style={{ gap: 14 }} aria-live="polite">
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <span className="avery-av lg">{name[0]}</span>
          <div className="avery-her" style={{ maxWidth: 620 }}>Hi, I’m {name}, your chief of staff. Tell me what you sell, who buys it, and which jobs eat up your week. A link to your site helps, but it’s optional.</div>
        </div>
        {msgs.map((m) => m.role === "owner"
          ? <div key={m.id} className="avery-me" style={{ alignSelf: "flex-end", maxWidth: 620, whiteSpace: "pre-wrap" }}>{m.text}</div>
          : (
            <div key={m.id} className="row" style={{ gap: 12, alignItems: "flex-start" }}>
              <span className="avery-av lg">{name[0]}</span>
              <div className="avery-her" style={{ maxWidth: 620 }}>
                <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
                {m.notes.map((n, i) => <span key={i} className="avery-note"><Icon name="check" size={14} />{n}</span>)}
                {m.runId && <Link href={`/runs/${m.runId}`} className="avery-run">See how she worked it out</Link>}
              </div>
            </div>
          ))}
        {busy && <div className="avery-her avery-sub">{name} is thinking…</div>}
      </div>
      {blocked && <div className="card" style={{ background: "var(--yel-soft)", color: "var(--yel-ink)", borderColor: "transparent" }}>{blocked}</div>}
      <form className="card stack" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); go(); }}>
        <label className="stack" style={{ gap: 4, fontSize: 13 }}>
          <span className="ink2">Your site (optional)</span>
          <input className="input" type="text" inputMode="url" maxLength={300} placeholder="yourbusiness.com" value={site} disabled={busy || !ready} onChange={(e) => setSite(e.target.value)} />
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 13 }}>
          <span className="ink2">Message</span>
          <textarea className="input" rows={3} maxLength={1000} value={text} disabled={busy || !ready}
            placeholder="We sell… Our customers are… I never get to…"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } }} />
        </label>
        <div className="row wrap" style={{ gap: 10, justifyContent: "flex-end" }}>
          <a href="#tools" className="btn outline sm">Skip to tools</a>
          <button type="submit" className="btn dark sm" disabled={busy || !ready || !text.trim()}>Send</button>
        </div>
      </form>
    </section>
  );
}

type Act = () => Promise<ActionResult>;

function FactRow({ f, edit, confirm, remove }: { f: Fact; edit: (id: string, text: string) => Promise<ActionResult>; confirm: (id: string) => Promise<ActionResult>; remove: (id: string) => Promise<ActionResult> }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(f.text);
  const [t, setT] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const run = (a: Act, after?: () => void) => start(async () => { const r = await a(); setT(r); if (r.ok) { after?.(); router.refresh(); } });
  return (
    <li className="stack" style={{ gap: 6, paddingTop: 10, paddingBottom: 10 }}>
      {editing ? (
        <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); run(() => edit(f.id, val), () => setEditing(false)); }}>
          <input className="input" style={{ flex: 1, minWidth: 0 }} maxLength={160} value={val} onChange={(e) => setVal(e.target.value)} aria-label="The fact, in your words" autoFocus />
          <button className="btn dark sm" disabled={busy || !val.trim()}>Save</button>
          <button type="button" className="btn outline sm" onClick={() => { setEditing(false); setVal(f.text); }}>Cancel</button>
        </form>
      ) : (
        <span style={{ fontSize: 14 }}>{f.text}{f.state === "suggested" && <span className="muted" style={{ fontSize: 12.5 }}> · from your site, not confirmed</span>}</span>
      )}
      {!editing && (
        <span className="row wrap" style={{ gap: 6 }}>
          {f.state === "suggested" && <button className="btn dark sm" disabled={busy} onClick={() => run(() => confirm(f.id))}>Confirm</button>}
          <button className="btn outline sm" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
          <button className="btn outline sm" disabled={busy} onClick={() => run(() => remove(f.id))} aria-label={`Remove: ${f.text}`}>Remove</button>
        </span>
      )}
      <Toast t={t} onDone={() => setT(null)} />
    </li>
  );
}

export function FactsPanel({ facts, add, edit, confirm, remove }: {
  facts: Fact[];
  add: (topic: string, text: string) => Promise<ActionResult>;
  edit: (id: string, text: string) => Promise<ActionResult>;
  confirm: (id: string) => Promise<ActionResult>;
  remove: (id: string) => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [topic, setTopic] = useState<FactTopic>("other");
  const [text, setText] = useState("");
  const [t, setT] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const groups = FACT_TOPICS.map((tp) => ({ tp, items: facts.filter((f) => f.topic === tp) })).filter((g) => g.items.length);
  return (
    <div className="card stack" style={{ gap: 10, background: "var(--soft)" }}>
      <h2 className="card-t" style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".04em" }}>What I’ve learned so far</h2>
      {!groups.length && <span className="sub">Nothing yet. What you tell Avery shows up here, and you can correct any of it.</span>}
      {groups.map((g) => (
        <div key={g.tp} className="stack" style={{ gap: 0 }}>
          <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{TOPIC_WORDS[g.tp]}</span>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {g.items.map((f) => <FactRow key={f.id} f={f} edit={edit} confirm={confirm} remove={remove} />)}
          </ul>
        </div>
      ))}
      <form className="stack rule" style={{ gap: 8, paddingTop: 10 }} onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await add(topic, text); setT(r); if (r.ok) { setText(""); router.refresh(); } }); }}>
        <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>Add one yourself</span>
        <div className="row wrap" style={{ gap: 8 }}>
          <select className="input" value={topic} onChange={(e) => setTopic(e.target.value as FactTopic)} aria-label="Topic">
            {FACT_TOPICS.map((tp) => <option key={tp} value={tp}>{TOPIC_WORDS[tp]}</option>)}
          </select>
          <input className="input" style={{ flex: 1, minWidth: 160 }} maxLength={160} value={text} onChange={(e) => setText(e.target.value)} placeholder="One short line" aria-label="The fact" />
          <button className="btn dark sm" disabled={busy || !text.trim()}>Add</button>
        </div>
      </form>
      <Toast t={t} onDone={() => setT(null)} />
    </div>
  );
}

/** Step 2, Shopify (card 152): the store's .myshopify.com address, saved before the key. */
export function StoreForm({ initial, save }: { initial: string; save: (domain: string) => Promise<ActionResult> }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [t, setT] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  return (
    <form className="row wrap" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await save(v); setT(r); if (r.ok) router.refresh(); }); }}>
      <input id="shopify-store" className="input" style={{ flex: "1 1 220px", minWidth: 0 }} maxLength={120} value={v} onChange={(e) => setV(e.target.value)} placeholder="your-store.myshopify.com" aria-label="Your store’s .myshopify.com address" />
      <button className="btn dark sm" disabled={busy || !v.trim()}>Save</button>
      <Toast t={t} onDone={() => setT(null)} />
    </form>
  );
}

/** Step 2: "A tool that isn't listed?" Code says where it goes; the answer stays on the page, with a link when there is one. */
export function UnlistedTool({ ask }: { ask: (name: string) => Promise<ActionResult & { href?: string }> }) {
  const [v, setV] = useState("");
  const [r, setR] = useState<(ActionResult & { href?: string }) | null>(null);
  const [busy, start] = useTransition();
  return (
    <div className="stack" style={{ gap: 8 }}>
      <form className="row wrap" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); start(async () => { const a = await ask(v); setR(a); if (a.ok) setV(""); }); }}>
        <input id="unlisted-tool" className="input" style={{ flex: "1 1 220px", minWidth: 0 }} maxLength={60} value={v} onChange={(e) => setV(e.target.value)} placeholder="Square, QuickBooks, PostHog…" aria-label="The tool’s name" />
        <button className="btn outline sm" disabled={busy || !v.trim()}>{busy ? "Checking…" : "Tell Avery"}</button>
      </form>
      {r && (
        <span className="soft-box" role="status" style={{ fontSize: 13, lineHeight: 1.45, background: r.ok ? "var(--soft)" : "var(--red-soft)", color: r.ok ? "inherit" : "var(--red-ink)" }}>
          {r.text}{r.href && <> <Link href={r.href}>Open it</Link></>}
        </span>
      )}
    </div>
  );
}
