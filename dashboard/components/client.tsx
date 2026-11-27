"use client";
// The few interactive pieces: theme, nav highlighting, and confirm-then-act buttons.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, useTransition } from "react";
import type { ActionResult } from "../actions";
import { SEEN_COOKIE, parseSeen } from "../seen";
import { Icon } from "./Icon";
import { IntentLink } from "./intentLink";
import { LIVE_POLL_MS, liveKey, runOfPath, shouldRefresh } from "../live-rules";

export function ThemeToggle({ initial, wide }: { initial: "light" | "dark"; wide?: boolean }) {
  const [theme, setTheme] = useState(initial);
  const flip = () => {
    const t = theme === "dark" ? "light" : "dark";
    setTheme(t);
    document.documentElement.dataset.theme = t;
    document.cookie = `cr_theme=${t}; path=/; max-age=31536000; samesite=lax`;
  };
  if (wide) return (
    <span className="seg" role="group" aria-label="Theme">
      <button type="button" aria-pressed={theme === "light"} onClick={() => theme !== "light" && flip()}>Light</button>
      <button type="button" aria-pressed={theme === "dark"} onClick={() => theme !== "dark" && flip()}>Dark</button>
    </span>
  );
  return <button className="round" title="Switch theme" onClick={flip}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>;
}

/** Rendered only while an agent has run alerts the owner hasn't looked at: notes the look, then refreshes so the badge clears. */
export function MarkSeen({ agentId, at }: { agentId: string; at: number }) {
  const router = useRouter();
  useEffect(() => {
    const raw = document.cookie.split("; ").find((c) => c.startsWith(SEEN_COOKIE + "="))?.slice(SEEN_COOKIE.length + 1);
    const seen = parseSeen(raw);
    if ((seen[agentId] ?? 0) >= at) return;
    seen[agentId] = at;
    document.cookie = `${SEEN_COOKIE}=${encodeURIComponent(JSON.stringify(seen))}; path=/; max-age=31536000; samesite=lax`;
    router.refresh(); // refresh-ok: no server action ran; the badge reads the cookie just written
  }, [agentId, at, router]);
  return null;
}

/** Sidebar link, active when the path matches (a trailing * matches a prefix) and, if given, the tab matches. */
export function SideLink({ href, match, icon, label, note, noteColor, count, red, dot }: { href: string; match: string | string[]; icon: string; label: string; note?: string; noteColor?: string; count?: string; red?: boolean; dot?: string }) {
  const path = usePathname();
  const active = (Array.isArray(match) ? match : [match]).some((m) => (m.endsWith("*") ? path.startsWith(m.slice(0, -1)) : path === m));
  return (
    <IntentLink href={href} className={"side-item" + (active ? " active" : "")} aria-current={active ? "page" : undefined}>
      <Icon name={icon} size={17} />
      <span style={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>{label}</span>
      {note && <span className="side-note" style={{ color: noteColor }}>{note}</span>}
      {count && <span className={"count" + (red ? " red" : "")}>{count}</span>}
      {/* a red dot with no number: something is broken (Activity, slice 12); the title says what */}
      {dot && <span className="side-dot" title={dot} aria-label={dot} />}
    </IntentLink>
  );
}

/**
 * The top bar's three drop-downs (slice 9): the working pill, the bell and your initial. A button and a glass
 * panel under it; the panel closes on a second tap, a tap outside, Escape, or following a link in it, and
 * after navigating (it remembers the page it was opened on, like the phone menu).
 */
export function HeaderPop({ label, className, trigger, children, panelClass }: { label: string; className: string; trigger: React.ReactNode; children: React.ReactNode; panelClass?: string }) {
  const here = usePathname() + "?" + useSearchParams().toString();
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === here;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpenOn(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenOn(null); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div className="hp" ref={ref}>
      <button type="button" className={className} aria-label={label} aria-haspopup="true" aria-expanded={open} onClick={() => setOpenOn(open ? null : here)}>{trigger}</button>
      {open && (
        <div className={"hp-pop" + (panelClass ? ` ${panelClass}` : "")} role="menu" aria-label={label}
          onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpenOn(null); }}>
          {children}
        </div>
      )}
    </div>
  );
}

// Phones (decided 2026-11-24, the approved mockup's phone menu): the menu button opens the sidebar itself, which
// slides in from the left over a dimmed page. One menu: the same sidebar as on a wide screen, where none of this shows.
// It closes on the dim, Escape, a swipe to the left, a tap on a link in it, or after navigating.
const MenuCtx = createContext<{ open: boolean; set: (o: boolean) => void }>({ open: false, set: () => {} });

export function MenuRoot({ children }: { children: React.ReactNode }) {
  const here = usePathname();
  // remembers the page it was opened on, so it closes itself after navigating
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === here;
  const set = useCallback((o: boolean) => setOpenOn(o ? here : null), [here]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenOn(null); };
    document.addEventListener("keydown", esc);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = ""; };
  }, [open]);
  return <MenuCtx.Provider value={{ open, set }}>{children}</MenuCtx.Provider>;
}

/** Phones only (CSS hides it on wide screens): the round button at the left of the top bar. */
export function MenuButton({ alert }: { alert?: boolean }) {
  const { open, set } = useContext(MenuCtx);
  return (
    <button type="button" className="round menu-btn" aria-label="Menu" aria-controls="side-menu" aria-expanded={open} onClick={() => set(!open)} style={{ position: "relative" }}>
      <Icon name="menu" />
      {alert && !open && <span className="menu-alert" />}
    </button>
  );
}

/** The sidebar: a panel beside the page on a wide screen, a drawer from the left on a phone. */
export function SideMenu({ children }: { children: React.ReactNode }) {
  const { open, set } = useContext(MenuCtx);
  const x0 = useRef<number | null>(null);
  return (
    <>
      <div className={"side-bg" + (open ? " open" : "")} onClick={() => set(false)} aria-hidden="true" />
      <aside id="side-menu" className={"side" + (open ? " open" : "")} aria-label="Menu"
        onClick={(e) => { if ((e.target as HTMLElement).closest("a")) set(false); }}
        onTouchStart={(e) => { x0.current = open ? e.touches[0].clientX : null; }}
        onTouchEnd={(e) => { if (x0.current !== null && x0.current - e.changedTouches[0].clientX > 60) set(false); x0.current = null; }}>
        {children}
      </aside>
    </>
  );
}

export interface Confirm { title: string; body: string; lines?: { k: string; v: string }[]; confirmLabel: string; kind?: "primary" | "dark" | "danger" }

type Act = () => Promise<ActionResult>;

export function Toast({ t, onDone }: { t: ActionResult | null; onDone: () => void }) {
  useEffect(() => { if (!t) return; const h = setTimeout(onDone, 6000); return () => clearTimeout(h); }, [t, onDone]);
  if (!t) return null;
  return <div className="toast" role="status"><span className="dot" style={{ background: t.ok ? "var(--mint)" : "var(--red)" }} /><span>{t.text}</span></div>;
}

export function Modal({ c, busy, onCancel, onGo }: { c: Confirm; busy: boolean; onCancel: () => void; onGo: () => void }) {
  return (
    <div className="modal-bg" onClick={busy ? undefined : onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={c.title} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-.02em" }}>{c.title}</h3>
        <p style={{ fontSize: 14, lineHeight: 1.55, color: "var(--ink2)" }}>{c.body}</p>
        {!!c.lines?.length && <div>{c.lines.map((l) => <div key={l.k} className="modal-line"><span className="muted">{l.k}</span><span style={{ fontWeight: 500, textAlign: "right" }}>{l.v}</span></div>)}</div>}
        <div className="row wrap" style={{ justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
          <button className="btn ghost" style={{ height: 42 }} onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={`btn ${c.kind ?? "primary"}`} style={{ height: 42 }} onClick={onGo} disabled={busy}>{busy ? "Working…" : c.confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/** A button that (optionally) confirms, runs a server action, then toasts the result and refreshes. The confirm closes as soon as it's accepted. */
/** `follow`: on success, go to the in-app page the action names (its `href`), instead of staying. */
/**
 * `dim` (slice 2 of the click-speed fix): the card around the button fades and stops taking taps the moment it is
 * pressed, so an Approve or Reject shows at once while the server works; it comes back if the action refuses.
 * The button always says it is working, after a confirm too.
 */
export function ActionButton({ action, confirm, className, children, disabled, title, busyLabel, follow, dim }: { action: Act; confirm?: Confirm; className?: string; children: React.ReactNode; disabled?: boolean; title?: string; busyLabel?: React.ReactNode; follow?: boolean; dim?: boolean }) {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const router = useRouter();
  const btn = useRef<HTMLButtonElement>(null);
  const go = () => {
    setOpen(false);
    const card = dim ? dimCard(btn.current) : null;
    start(async () => {
      let res: ActionResult;
      try { res = await action(); } catch (e) { res = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
      if (!res.ok) card?.restore();
      setToast(res);
      const href = (res as { href?: unknown }).href;
      if (follow && res.ok && typeof href === "string" && href.startsWith("/") && !href.startsWith("//")) router.push(href);
    });
  };
  return (
    <>
      <button ref={btn} className={className} disabled={disabled || busy} title={title} onClick={() => (confirm ? setOpen(true) : go())}>{busy ? busyLabel ?? "Working…" : children}</button>
      {open && confirm && <Modal c={confirm} busy={busy} onCancel={() => setOpen(false)} onGo={go} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </>
  );
}

/** Fades the card a button sits in (an approval card) until the server answers; `restore` brings it back. */
export function dimCard(el: HTMLElement | null): { restore: () => void } | null {
  const card = el?.closest<HTMLElement>("[data-dim-card]");
  if (!card) return null;
  const was = { opacity: card.style.opacity, pe: card.style.pointerEvents };
  card.style.opacity = "0.45";
  card.style.pointerEvents = "none";
  card.setAttribute("aria-busy", "true");
  return { restore: () => { card.style.opacity = was.opacity; card.style.pointerEvents = was.pe; card.removeAttribute("aria-busy"); } };
}

/**
 * A choice of two or more, saved the moment one is tapped (Connections > Claude runs on): shows the tap at once and
 * goes back if the action refuses it. `disabled` for members who can see the choice but not change it.
 */
export function ChoiceSwitch({ label, value, options, act, disabled }: {
  label: string; value: string; options: readonly { id: string; title: string; sub: string }[]; act: (id: string) => Promise<ActionResult>; disabled?: boolean;
}) {
  const [on, setOn] = useState(value);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const id = useId();
  const pick = (o: string) => {
    if (o === on || busy || disabled) return;
    const was = on;
    setOn(o);
    start(async () => {
      let res: ActionResult;
      try { res = await act(o); } catch (e) { res = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
      if (!res.ok) setOn(was);
      setToast(res);
    });
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span id={id} style={{ fontSize: 12.5, fontWeight: 600 }}>{label}</span>
      <div role="radiogroup" aria-labelledby={id} className="pick2">
        {options.map((o) => (
          <button key={o.id} type="button" role="radio" aria-checked={on === o.id} disabled={disabled || busy} onClick={() => pick(o.id)}>
            <b>{o.title}</b><span>{o.sub}</span>
          </button>
        ))}
      </div>
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** Dry run: free, reads real data, writes nothing. Shows the result in place. */
export function DryRun({ action, compact }: { action: Act; compact?: boolean }) {
  const [res, setRes] = useState<(ActionResult & { at: string }) | null>(null);
  const [busy, start] = useTransition();
  const go = () => start(async () => {
    let r: ActionResult;
    try { r = await action(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Dry run failed." }; }
    // the moment it ended, on the viewer's own clock: it was just now
    setRes({ ...r, at: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) });
  });
  return (
    <>
      <button className="btn primary" style={compact ? { height: 40 } : undefined} onClick={go} disabled={busy}><Icon name="play" size={15} />{busy ? "Dry run going…" : "Dry run · free"}</button>
      {(busy || res) && !compact && (
        <div style={{ flexBasis: "100%", padding: "14px 16px", borderRadius: 18, border: "1px dashed var(--mut2)", display: "flex", flexDirection: "column", gap: 6 }}>
          {busy ? <span style={{ fontSize: 13 }} className="muted">Dry run going… reading real data, writing nothing.</span> : res && (
            <>
              <span style={{ fontSize: 11.5, fontWeight: 600 }} className="muted">Dry run · {res.at} · nothing written, $0</span>
              <span style={{ fontSize: 13.5, lineHeight: 1.5, color: res.ok ? "inherit" : "var(--red-ink)" }}>{res.text}</span>
            </>
          )}
        </div>
      )}
      {compact && res && <Toast t={{ ok: res.ok, text: res.text }} onDone={() => setRes(null)} />}
    </>
  );
}

export interface RecentRun { id: string; name: string; status: string; live: boolean }

/**
 * Keeps the floor current while an agent works, and says so when a run finishes. Mounted once in the room layout,
 * so it follows the owner around. While a run is live it asks /live which runs are live now (one small query) and
 * renders the page again only when that set changes, or every tick on a live run's own page, whose steps arrive as
 * it runs (slice 1 of the click-speed fix, docs/speed.md rule 10). `watch` keeps the old every-tick render for a
 * page that shows one run's progress outside the room (setup's first job).
 */
export function LiveRefresher({ runs, watch }: { runs: RecentRun[]; watch?: boolean }) {
  const router = useRouter();
  const path = usePathname();
  const anyLive = runs.some((r) => r.live);
  const shown = liveKey(runs.filter((r) => r.live).map((r) => r.id));
  const [seen, setSeen] = useState(runs);
  const [done, setDone] = useState<RecentRun | null>(null);
  // the latest values for the timer, without restarting it on every render
  const now = useRef({ shown, path, watch: !!watch });
  useEffect(() => { now.current = { shown, path, watch: !!watch }; }, [shown, path, watch]);
  // compare with the last render's runs (React's "adjust state on prop change" pattern)
  if (seen !== runs) {
    const finished = runs.find((r) => !r.live && seen.some((p) => p.id === r.id && p.live));
    setSeen(runs);
    if (finished) setDone(finished);
  }
  useEffect(() => {
    if (!anyLive) return;
    let busy = false, lastAsked: string | null = null;
    const tick = async () => {
      if (busy || document.visibilityState !== "visible") return;
      const { shown, path, watch } = now.current;
      const run = runOfPath(path);
      const watching = watch || (!!run && shown.split(",").includes(run));
      busy = true;
      try {
        let got = shown;
        if (!watching) {
          const res = await fetch("/live", { cache: "no-store" });
          if (!res.ok) return;
          got = liveKey(((await res.json()) as { live?: string[] }).live ?? []);
        }
        if (!shouldRefresh({ shown, got, lastAsked, watching })) return;
        lastAsked = got;
        router.refresh(); // refresh-ok: a run started or finished (or this page shows a live run's steps), seen by the /live poll
      } catch { /* offline for a moment: the next tick tries again */ } finally { busy = false; }
    };
    const h = setInterval(tick, LIVE_POLL_MS);
    return () => clearInterval(h);
  }, [anyLive, router]);
  useEffect(() => { if (!done) return; const h = setTimeout(() => setDone(null), 10000); return () => clearTimeout(h); }, [done]);
  if (!done) return null;
  const color = done.status === "ok" ? "var(--mint)" : done.status === "failed" ? "var(--red)" : "var(--mut2)";
  const word = done.status === "ok" ? "finished" : done.status === "failed" ? "failed" : done.status === "skipped" ? "was skipped" : "stopped";
  return (
    <div className="toast" role="status">
      <span className="dot" style={{ background: color }} />
      <span>{done.name}’s run {word}.</span>
      <Link href={`/runs/${done.id}`} onClick={() => setDone(null)} style={{ fontWeight: 600, color: "inherit", textDecoration: "underline" }}>See the run</Link>
    </div>
  );
}


/** Pastes a key into the token vault. The field is a password field, cleared once the key is kept; the key is never shown back. */
/** One cost target (card 255): an amount, or blank for none. Saving checks it again on the server. */
export function TargetForm({ label, current, save }: { label: string; current: number | null; save: (v: string) => Promise<ActionResult> }) {
  const [v, setV] = useState(current === null ? "" : String(current));
  const same = v.trim() === (current === null ? "" : String(current));
  return (
    <span className="row wrap" style={{ gap: 8, alignItems: "center" }}>
      <span style={{ flex: "1 1 160px", fontSize: 13 }}>{label}</span>
      <input className="input" inputMode="decimal" autoComplete="off" value={v} onChange={(e) => setV(e.target.value)} placeholder="No target" aria-label={label}
        style={{ width: 120, background: "var(--card)", border: "1px solid var(--bd)", fontSize: 14 }} />
      <ActionButton className="btn outline sm" disabled={same} action={() => save(v)}>{v.trim() ? "Save" : "Clear"}</ActionButton>
    </span>
  );
}

export function KeyForm({ label, save, replace, placeholder = "ntn_…" }: { label: string; save: (key: string) => Promise<ActionResult>; replace?: boolean; placeholder?: string }) {
  const [v, setV] = useState("");
  return (
    <span className="row wrap" style={{ gap: 8 }}>
      <input className="input" type="password" autoComplete="off" spellCheck={false} value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={label}
        style={{ flex: "1 1 220px", minWidth: 0, background: "var(--card)", border: "1px solid var(--bd)", fontSize: 14 }} />
      <ActionButton className={`btn ${replace ? "outline" : "dark"} sm`} disabled={!v.trim()} action={async () => { const r = await save(v); if (r.ok) setV(""); return r; }}>
        {replace ? "Replace key" : "Lock key in the vault"}
      </ActionButton>
    </span>
  );
}
