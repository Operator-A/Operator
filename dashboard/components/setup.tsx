"use client";
// First-run setup (docs/setup.md): the conversation with Avery and the "What I've learned so far" panel
// (card 151), the tools step's forms (card 152) and the company chart (card 153). Each message is one
// logged run (dashboard/setupActions.ts); the lines under a reply come from code: what it actually saved.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import type { SetupAnswer } from "@/core/setup";
import type { ActionResult } from "@/dashboard/actions";
import { FACT_TOPICS, TOPIC_WORDS, type Fact, type FactTopic } from "@/core/setup-rules";
import { BILLING_WORDS, costDetail, monthWords, usd } from "@/core/cost-rules";
import { companyTotals, type CompanyAgent, type CompanyDept } from "@/core/company-rules";
import { Toast } from "./client";
import { Icon } from "./Icon";

export interface SetupMsg { id: string; role: "owner" | "avery"; text: string; runId: string | null; notes: string[] }

export function SetupChat({ name, initial, send, ready, blocked, foot }: { name: string; initial: SetupMsg[]; send: (text: string, site: string) => Promise<SetupAnswer>; ready: boolean; blocked: string | null; foot: string | null }) {
  const router = useRouter();
  const [msgs, setMsgs] = useState<SetupMsg[]>(initial);
  const [text, setText] = useState("");
  const [site, setSite] = useState("");
  const [reading, setReading] = useState("");
  const [busy, start] = useTransition();
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight, behavior: "smooth" }); }, [msgs, busy]);
  const go = () => {
    const t = text.trim();
    if (!t || busy || !ready) return;
    const s = site.trim();
    setText("");
    setReading(s);
    setMsgs((m) => [...m, { id: `z${Date.now()}`, role: "owner", text: s ? `${t}\n\n(My site: ${s})` : t, runId: null, notes: [] }]);
    start(async () => {
      let a: SetupAnswer;
      try { a = await send(t, s); } catch (e) { a = { ok: false, reply: e instanceof Error ? e.message : "Something went wrong.", notes: [], runId: null, costUsd: 0, kept: false, saved: 0, suggested: 0 }; }
      setMsgs((m) => [...m, { id: `a${Date.now()}`, role: "avery", text: a.reply, runId: a.runId, notes: a.notes }]);
      if (a.ok && s) setSite("");
      router.refresh();
    });
  };
  const off = busy || !ready;
  const submit = (e: React.FormEvent) => { e.preventDefault(); go(); };
  const enter = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } };
  const warn = blocked && <div className="soft-box" role="status" style={{ background: "var(--yel-soft)", color: "var(--yel-ink)", fontSize: 13.5 }}>{blocked}</div>;

  // before the first message: one card, nothing else on screen (card 181)
  if (!msgs.length) {
    return (
      <section aria-labelledby="wg-h" className="wg-glass wg-card wg-enter" style={{ maxWidth: 620, margin: "0 auto", width: "100%" }}>
        <span className="row" style={{ gap: 10 }}><span className="wg-av" aria-hidden>{name[0]}</span><span className="ink2" style={{ fontSize: 13.5 }}>{name}, your chief of staff</span></span>
        <h1 id="wg-h" className="wg-h1">Let’s build your company.</h1>
        <p className="wg-lead">Tell me what you sell and what you’re behind on. I’ll build the team around it.</p>
        {warn}
        <form className="stack" style={{ gap: 12 }} onSubmit={submit}>
          <label className="wg-sr" htmlFor="wg-about">About your business</label>
          <textarea id="wg-about" className="wg-area" rows={3} maxLength={1000} value={text} disabled={off} placeholder="We sell… I’m behind on… I never get to…" onChange={(e) => setText(e.target.value)} onKeyDown={enter} />
          <div className="row wrap" style={{ gap: 10 }}>
            <label className="wg-sr" htmlFor="wg-site">Your website (optional)</label>
            <input id="wg-site" className="wg-in" type="text" inputMode="url" maxLength={300} placeholder="yourstore.com (optional)" value={site} disabled={off} onChange={(e) => setSite(e.target.value)} />
            <button type="submit" className="btn dark" disabled={off || !text.trim()}>Build my company</button>
          </div>
        </form>
        {foot && <span className="sub" style={{ fontSize: 13 }}>{foot}</span>}
      </section>
    );
  }
  return (
    <section aria-label={`Conversation with ${name}`} className="wg-glass wg-card wg-enter" style={{ flex: "999 1 520px", minWidth: 0 }}>
      <div ref={list} className="stack wg-talk" style={{ gap: 14 }} aria-live="polite">
        {msgs.map((m) => m.role === "owner"
          ? <div key={m.id} className="wg-me wg-pop">{m.text}</div>
          : (
            <div key={m.id} className="row wg-pop" style={{ gap: 12, alignItems: "flex-start" }}>
              <span className="wg-av" aria-hidden>{name[0]}</span>
              <div className="wg-her">
                <span style={{ whiteSpace: "pre-wrap" }}>{m.text}</span>
                {m.notes.map((n, i) => <span key={i} className="wg-note"><Icon name="check" size={14} />{n}</span>)}
                {m.runId && <Link href={`/runs/${m.runId}`} style={{ fontSize: 12.5 }}>See how she worked it out</Link>}
              </div>
            </div>
          ))}
        {busy && (
          <div className="row wg-pop ink2" style={{ gap: 10, fontSize: 14 }}>
            <span className="wg-dots" aria-hidden><i /><i /><i /></span>
            {name} is {reading ? `reading ${reading.slice(0, 60)} and ` : ""}laying out your company
          </div>
        )}
      </div>
      {warn}
      <form className="stack rule" style={{ gap: 10, paddingTop: 14 }} onSubmit={submit}>
        <label className="wg-sr" htmlFor="wg-msg">Message</label>
        <textarea id="wg-msg" className="wg-area" rows={2} maxLength={1000} value={text} disabled={off} placeholder={`Answer ${name}, or tell her more`} onChange={(e) => setText(e.target.value)} onKeyDown={enter} />
        <div className="row wrap" style={{ gap: 10 }}>
          <label className="wg-sr" htmlFor="wg-site2">Your website (optional)</label>
          <input id="wg-site2" className="wg-in" type="text" inputMode="url" maxLength={300} placeholder="yourstore.com (optional)" value={site} disabled={off} onChange={(e) => setSite(e.target.value)} />
          <button type="submit" className="btn dark" disabled={off || !text.trim()}>Send</button>
        </div>
      </form>
    </section>
  );
}

/** Back and Next under a step (card 181). The step is saved, then the page shows it. */
export function StageNav({ back, next, go }: { back: { stage: string; label: string } | null; next: { stage: string; label: string; quiet?: boolean } | null; go: (stage: string) => Promise<ActionResult> }) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [bad, setBad] = useState<string | null>(null);
  const to = (stage: string) => start(async () => { const r = await go(stage); if (r.ok) { setBad(null); router.refresh(); window.scrollTo({ top: 0 }); } else setBad(r.text); });
  return (
    <nav aria-label="Setup steps" className="stack" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 10, justifyContent: "space-between" }}>
        {back ? <button type="button" className="btn outline" disabled={busy} onClick={() => to(back.stage)}>{back.label}</button> : <span />}
        {next && <button type="button" className={next.quiet ? "btn outline" : "btn dark"} disabled={busy} onClick={() => to(next.stage)}>{next.label}</button>}
      </div>
      {bad && <span className="soft-box" role="status" style={{ fontSize: 13, background: "var(--red-soft)", color: "var(--red-ink)" }}>{bad}</span>}
    </nav>
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
    <div className="wg-glass wg-card" style={{ gap: 10 }}>
      <h2 className="wg-eyebrow">What I’ve learned so far</h2>
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

/**
 * Step 3, "Your company" (card 153): the org chart Avery proposes, drawn in code. The founder can leave
 * a department out or add one; Start this company installs exactly what's on the chart.
 */
export function CompanyChart({ owner, company, depts, initial, install, back }: {
  owner: string; company: CompanyAgent[]; depts: CompanyDept[]; initial: string[];
  install: (ids: string[]) => Promise<ActionResult & { href?: string }>; back: () => Promise<ActionResult>;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<string[]>(initial);
  const [r, setR] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const on = depts.filter((d) => picked.includes(d.id));
  const also = depts.filter((d) => !picked.includes(d.id));
  const tot = companyTotals(depts, picked, company);
  const billing = company[0]?.cost.billing ?? on[0]?.agents[0]?.cost.billing;
  const go = () => start(async () => { const a = await install(picked); setR(a); if (a.ok && a.href) router.push(a.href); });
  const agentCard = (a: CompanyAgent) => (
    <div key={a.id} className="soft-box stack" style={{ gap: 4, background: "var(--panel, var(--soft))", border: "1px solid var(--line)" }}>
      <span className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
        <b style={{ fontSize: 14 }}>{a.name} · {a.role}</b>
        <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>{a.cost.perRun == null ? "Cost unknown" : a.runsPerMonth ? `${usd(a.cost.month)}/mo` : "$0/mo"}</span>
      </span>
      <span style={{ fontSize: 13, lineHeight: 1.45 }}>{a.job}</span>
      {a.tools.length > 0 && <span className="muted" style={{ fontSize: 12 }}>Uses: {a.tools.join(", ")}</span>}
      <span className="muted" style={{ fontSize: 12 }}>{monthWords(a.cost)} · {costDetail(a.cost)}</span>
    </div>
  );
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="stack" style={{ gap: 8 }} role="tree" aria-label="Your company">
        <div className="soft-box" style={{ fontSize: 14 }}><b>{owner}</b> · Founder</div>
        <div style={{ paddingLeft: 16, borderLeft: "2px solid var(--line)" }} className="stack">
          {company.map(agentCard)}
          <div className="stack" style={{ gap: 12, paddingLeft: 16, borderLeft: "2px solid var(--line)" }}>
            {on.length === 0 && <span className="sub">No departments yet. Tell Avery about your business and she’ll propose some, or add one below.</span>}
            {on.map((d) => (
              <div key={d.id} className="stack" style={{ gap: 6 }}>
                <span className="row wrap" style={{ gap: 8, alignItems: "baseline" }}>
                  <b style={{ fontSize: 15 }}>{d.name}</b>
                  {d.fit && <span className="pill sm">{d.fit === "strong" ? "Avery: strong fit" : "Avery: likely"}</span>}
                  <button className="btn ghost sm" type="button" onClick={() => setPicked((p) => p.filter((x) => x !== d.id))}>Leave out</button>
                </span>
                {d.waitsOn.length > 0 && <span className="sub">Waits on {d.waitsOn.join(" and ")}: it starts working once that’s connected.</span>}
                {d.agents.map(agentCard)}
                {d.openSeats.length > 0 && <span className="muted" style={{ fontSize: 12.5 }}>Open seats: {d.openSeats.join(", ")}</span>}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="soft-box stack" style={{ gap: 2 }} aria-live="polite">
        <b style={{ fontSize: 14 }}>{tot.agents} agents · about {usd(tot.month)} a month once on duty</b>
        <span className="muted" style={{ fontSize: 12.5 }}>At most {usd(tot.atMost)} a month on these schedules{tot.unknown.length ? `, plus ${tot.unknown.join(", ")} (cost unknown)` : ""} · estimates until each has run{billing ? ` · ${BILLING_WORDS[billing]}` : ""}</span>
      </div>

      {also.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="ted-k">Also available</span>
          {also.map((d) => (
            <div key={d.id} className="row rule" style={{ gap: 12, paddingTop: 10, alignItems: "flex-start" }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}><b style={{ fontSize: 14 }}>{d.name}</b><span className="sub">{d.about}</span></span>
              <button className="btn outline sm" type="button" onClick={() => setPicked((p) => [...p, d.id])}>Add</button>
            </div>
          ))}
        </div>
      )}

      <span className="sub">Every agent starts off duty, every action is an approval card, and nothing runs until you approve each first playbook.</span>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn dark sm" type="button" disabled={busy || !picked.length} onClick={go}>{busy ? "Starting…" : "Start this company"}</button>
        <button className="btn outline sm" type="button" disabled={busy} onClick={() => start(async () => { const a = await back(); if (a.ok) router.refresh(); else setR(a); })}>Change something</button>
      </div>
      {r && !r.ok && <span className="soft-box" role="status" style={{ fontSize: 13, background: "var(--red-soft)", color: "var(--red-ink)" }}>{r.text}</span>}
    </div>
  );
}
