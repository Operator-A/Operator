"use client";
// Chains where they live (chains slice 1, card 430), built to the approved mockup: a list of chains on the left and
// the open chain as a lane on the right (its start, then each step, with what passes between them and a "+" to add a
// step there). Used on a department page's Chains tab and on Settings > Schedule (every chain, plus the versions).
// It only holds the open chain until Save: the server (saveChain) merges it into the saved flow and checks it again,
// and a chain never turns an agent on. A step is an agent or, from chains slice 2, an Ask a model step: one
// instruction to a model, text back, no tools, capped a run and billed to the agent that pays for the chain.
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { ActionResult, ChainPreviewStep } from "@/dashboard/actions";
import { ASK, DAYS, OK, flowProblems, isDays, runsPerMonth, type Chain, type Days, type Flow, type Op, type Owner, type Start, type Step, type When } from "@/core/flow-rules";
import { EVENTS, EVENT_BY_TYPE, type EventStart, type EventType } from "@/core/event-rules";
import { afterChoices, askModel, boardGroups, linkWords, moveStep, newAsk, newChain, newImage, okFits, roomFor, startWords, withStep, withoutStep } from "@/dashboard/chain-rules";
import { IMAGE, IMAGE_KEEP_DAYS, IMAGE_QUALITIES, IMAGE_SIZES, SIZE_LABEL, imageMaxUsd, type ImageQuality, type ImageSize } from "@/core/image-rules";
import { payerOf, type Payers } from "@/core/ask-rules";
import { Modal, Toast, type Confirm } from "./client";
import { Summary } from "./ui";

export interface ChainAgent {
  id: string; name: string; role: string; job: string; hue: string;
  enabled: boolean; buttonOnly: boolean; dept: string | null;
  /** Runs as the owner's Claude routine (runs_on "claude"); else in OPERATOR on `model`. */
  claude: boolean; model: string | null;
  metrics: { key: string; label: string }[];
  /** Average cost of its last real runs; null before any. */
  perRun: number | null; estimated: boolean;
}
/** A model an Ask a model step can pick (integrations/models.ts), and whether it can run here (its key is saved). */
export interface ChainModel { id: string; label: string; ready: boolean; in: number; out: number }
/** An image model a Make an image step can pick (core/image-rules.ts), and whether its provider's key is saved. */
export interface ChainImageModel { id: string; label: string; ready: boolean }
export interface ChainVersion { version: number; active: boolean; note: string | null; createdBy: string; createdAt: string; chains: number; on: string[] }
export interface ChainsData {
  version: number; flow: Flow; problems: string[]; versions: ChainVersion[];
  /** Next scheduled firings (ISO) of each saved chain. */
  next: Record<string, string[]>;
  palette: ChainAgent[]; deptOf: Record<string, string | null>; depts: { id: string; name: string }[];
  /** Ask a model steps: the model list, and the agents that pay for a department's or the company's chains. */
  models: ChainModel[]; payers: Payers;
  /** Make an image steps (chains slice 4). */
  imageModels: ChainImageModel[];
  approvalTools: { id: string; label: string }[];
  controls: boolean; maxSteps: number; maxChains: number; now: number; tz: string; problem?: string;
}
export interface ChainsActions {
  save: (chain: Chain, place: string, confirmed: boolean) => Promise<ActionResult>;
  remove: (key: string) => Promise<ActionResult>;
  runNow: (key: string) => Promise<ActionResult>;
  preview: (chain: Chain) => Promise<ActionResult & { steps?: ChainPreviewStep[] }>;
  rollBack?: (version: number, confirmed: boolean) => Promise<ActionResult>;
}

const OPS: Op[] = [">=", ">", "<=", "<", "="];
const QUARTERS = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);
const WHEN_LABEL: Record<When, string> = { ok: "if it worked", failed: "if it failed", any: "either way" };
const DAY_LABEL: Record<string, string> = { daily: "Every day", weekdays: "Weekdays", mondays: "Mondays" };
const money = (v: number) => (v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`);
const clock = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
const at = (iso: string, tz: string) => new Date(iso).toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const asksConfirm = (r: ActionResult) => !r.ok && /^Confirm first/.test(r.text);
const firstLine = (s: string) => (s.split(/(?<=[.!?])\s/)[0] ?? s).slice(0, 160);
const START_TYPES: { t: Start["type"]; label: string }[] = [
  { t: "schedule", label: "Schedule" }, { t: "button", label: "Run button" }, { t: "after", label: "After a chain" }, { t: "event", label: "Live event" }, { t: "approval", label: "Approval" },
];

export function ChainsBoard({ d, scope, place, pick, startWith, newAgentHref, actions }: {
  d: ChainsData;
  /** A department's own and its agents' chains, or every chain (Settings). */
  scope: { dept: string } | "all";
  /** Where a save says it came from, in the version list ("Marketing", "Settings"). */
  place: string;
  /** A chain to open first (the agent sheet's Open). */
  pick?: string;
  /** "+ New chain starting with" an agent: opens a new chain with it as the first step. */
  startWith?: string;
  /** The New agent sheet, for "A new agent for this step". */
  newAgentHref?: string;
  actions: ChainsActions;
}) {
  const byId = useMemo(() => Object.fromEntries(d.palette.map((a) => [a.id, a])), [d.palette]);
  const crew = useMemo(() => ({ ids: d.palette.map((a) => a.id), manualOnly: new Set(d.palette.filter((a) => a.buttonOnly).map((a) => a.id)), models: d.models.map((m) => m.id) }), [d.palette, d.models]);
  const modelOf = (id: string) => d.models.find((m) => m.id === id);
  const firstModel = askModel(d.models);
  const groups = useMemo(() => boardGroups(d.flow, scope, d.deptOf, d.depts), [d.flow, scope, d.deptOf, d.depts]);
  const shown = groups.flatMap((g) => g.chains);
  const name = (id: string) => byId[id]?.name ?? id;
  const stepName = (s: Step) => (s.ask ? `Ask ${modelOf(s.ask.model)?.label ?? s.ask.model}` : s.image ? "Make an image" : s.ok ? "Wait for my OK" : name(s.agent!));
  const firstImage = d.imageModels.find((m) => m.ready)?.id ?? null;
  const chainName = (key: string) => d.flow.chains.find((c) => c.key === key)?.name ?? key;
  const tool = (id: string) => d.approvalTools.find((t) => t.id === id)?.label ?? id;

  const fresh = (agent: string | undefined): Chain | null => {
    const first = (agent && byId[agent]) ? agent : (d.palette.find((a) => !a.buttonOnly && (scope === "all" || a.dept === scope.dept)) ?? d.palette.find((a) => !a.buttonOnly))?.id;
    if (!first) return null;
    const owner: Owner | null = agent && byId[agent] ? { agent } : scope === "all" ? null : { dept: scope.dept };
    return newChain(d.flow, owner, first, agent && byId[agent] ? `${byId[agent].name}’s chain` : "New chain");
  };
  const initial = (): Chain | null => (startWith ? fresh(startWith) : null) ?? d.flow.chains.find((c) => c.key === pick) ?? shown[0] ?? null;
  const [draft, setDraft] = useState<Chain | null>(initial);
  const saved = draft ? d.flow.chains.find((c) => c.key === draft.key) ?? null : null;
  const isNew = !!draft && !saved;
  const dirty = !!draft && (isNew || !same(saved, draft));
  const [open, setOpen] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  const [editStart, setEditStart] = useState(false);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [confirm, setConfirm] = useState<(Confirm & { go: () => void }) | null>(null);
  const [preview, setPreview] = useState<{ key: string; text: string; steps: ChainPreviewStep[] } | null>(null);
  const [busy, start] = useTransition();

  const choose = (c: Chain | null) => { setDraft(c); setOpen(null); setAdding(null); setEditStart(false); setPreview(null); };
  const problems = useMemo(() => {
    if (!draft) return [];
    const flow = { chains: saved ? d.flow.chains.map((c) => (c.key === draft.key ? draft : c)) : [...d.flow.chains, draft] };
    return flowProblems(flow, crew);
  }, [draft, saved, d.flow, crew]);

  const run = (f: () => Promise<ActionResult>, after?: (r: ActionResult) => void) => start(async () => {
    let r: ActionResult;
    try { r = await f(); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r); after?.(r);
  });
  const save = () => {
    if (!draft) return;
    const go = (confirmed: boolean) => start(async () => {
      let r: ActionResult;
      try { r = await actions.save(draft, place, confirmed); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
      if (!confirmed && asksConfirm(r)) {
        setConfirm({ title: `Save ${draft.name} and let it run on its own?`, body: "Saving never turns an agent on. Each step still checks that its agent is on duty and under its daily budget, and a skipped step stops the chain.", lines: [{ k: "Changes", v: r.text.replace(/^Confirm first: /, "") }], confirmLabel: "Save chain", kind: "dark", go: () => go(true) });
        return;
      }
      setToast(r);
    });
    go(false);
  };
  const runNow = () => saved && setConfirm({
    title: `Run ${saved.name} now?`, body: "Real runs, one after another, shown in Activity. An agent that is off duty is skipped and the chain stops there.",
    lines: saved.steps.map((s, k) => ({ k: `Step ${k + 1}`, v: s.ask || s.image ? `${stepName(s)}, up to ${money(s.ask?.maxUsd ?? imageMaxUsd(s.image!))}${payer && "agent" in payer ? `, billed to ${name(payer.agent)}` : ""}` : s.ok ? "Wait for your OK (a card in Approvals, up to 3 days)" : `${name(s.agent!)}${byId[s.agent!]?.enabled ? "" : " (off duty, skipped)"}` })),
    confirmLabel: "Run chain", kind: "primary", go: () => run(() => actions.runNow(saved.key)),
  });
  const remove = () => saved && setConfirm({
    title: `Delete ${saved.name}?`, body: "It stops running. Settings > Schedule keeps every version, so you can bring it back.", confirmLabel: "Delete chain", kind: "danger",
    go: () => run(() => actions.remove(saved.key), (r) => { if (r.ok) choose(shown.find((c) => c.key !== saved.key) ?? null); }),
  });
  const tryIt = () => draft && start(async () => {
    try { const r = await actions.preview(draft); setPreview({ key: draft.key, text: r.text, steps: r.steps ?? [] }); if (!r.ok) setToast(r); }
    catch (e) { setToast({ ok: false, text: e instanceof Error ? e.message : "Try failed." }); }
  });
  const rollBack = (v: ChainVersion) => actions.rollBack && setConfirm({
    title: `Make chains v${v.version} active again?`, body: v.on.length ? `These chains are on in v${v.version} and would run on their own: ${v.on.join(", ")}. Agents that are off duty are still skipped.` : `Every chain is off in v${v.version}, so nothing runs on its own.`, confirmLabel: "Roll back", kind: "dark",
    go: () => run(() => actions.rollBack!(v.version, true)),
  });

  const set = (c: Chain) => setDraft(c);
  const setStep = (k: number, st: Step) => draft && set({ ...draft, steps: draft.steps.map((x, i) => (i === k ? st : x)) });
  // an Ask a model step counts at its cap: the most it can cost a run
  const perRun = draft ? draft.steps.reduce((s, st) => s + (st.ask ? st.ask.maxUsd : st.image ? imageMaxUsd(st.image) : st.agent ? byId[st.agent]?.perRun ?? 0 : 0), 0) : 0;
  const unknownCost = draft ? draft.steps.some((st) => st.agent && (byId[st.agent]?.perRun == null || byId[st.agent]?.estimated)) : false;
  const payer = draft && draft.steps.some((s) => s.ask || s.image) ? payerOf(draft, d.payers) : null;
  const month = draft && draft.on ? perRun * runsPerMonth(draft) : 0;

  const picker = (k: number) => {
    if (!draft) return null;
    const free = d.palette.filter((a) => !draft.steps.some((s) => s.agent === a.id) && (!a.buttonOnly || draft.start.type === "button"));
    const mine = scope === "all" ? free : [...free.filter((a) => a.dept === scope.dept), ...free.filter((a) => a.dept !== scope.dept)];
    return (
      <div className="ch-pick" role="menu" aria-label="Add a step">
        <div className="ch-pgrp">An agent</div>
        {mine.map((a) => (
          <button key={a.id} type="button" role="menuitem" className="ch-po" onClick={() => { set(withStep(draft, k, a.id)); setAdding(null); setOpen(k); }}>
            <span className={`ch-ico ${a.claude ? "k-claude" : "k-agent"}`} style={a.claude ? undefined : { background: a.hue, color: "#111114" }} aria-hidden="true">{a.claude ? "✦" : a.name.slice(0, 1)}</span>
            <b>{a.name}{!a.enabled && <span className="ch-off">off duty</span>}</b>
            <small>{a.claude ? "Runs as its Claude routine" : `Runs in OPERATOR${a.model ? ` · ${a.model}` : ""}`}</small>
          </button>
        ))}
        {!mine.length && <span className="ch-note" style={{ padding: "4px 9px" }}>Every agent is already in this chain.</span>}
        {newAgentHref && (
          <Link href={newAgentHref} scroll={false} className="ch-po" role="menuitem">
            <span className="ch-ico k-agent" aria-hidden="true">+</span>
            <b>A new agent for this step</b><small>Opens the New agent sheet. Save this chain first, then add it here.</small>
          </Link>
        )}
        <div className="ch-pgrp">A quick step</div>
        <button type="button" role="menuitem" className="ch-po" disabled={!firstModel} onClick={() => { if (!firstModel) return; set(withStep(draft, k, newAsk(firstModel))); setAdding(null); setOpen(k); }}>
          <span className="ch-ico k-model" aria-hidden="true">AI</span>
          <b>Ask a model</b><small>Claude, OpenAI, Gemini or Grok. One instruction, text back, no tools</small>
        </button>
        <button type="button" role="menuitem" className="ch-po" disabled={!okFits(draft, k)} onClick={() => { if (!okFits(draft, k)) return; set(withStep(draft, k, { ok: {} })); setAdding(null); setOpen(k); }}>
          <span className="ch-ico k-ok" aria-hidden="true">✓</span>
          <b>Wait for my OK</b><small>{k === 0 ? "Goes after a step: you approve that step’s result" : okFits(draft, k) ? "A card in Approvals with the step before’s result; the chain goes on when you approve" : "There’s already an OK next to this spot"}</small>
        </button>
        <button type="button" role="menuitem" className="ch-po" disabled={!firstImage} onClick={() => { if (!firstImage) return; set(withStep(draft, k, newImage(firstImage))); setAdding(null); setOpen(k); }}>
          <span className="ch-ico k-image" aria-hidden="true">▣</span>
          <b>Make an image</b><small>{firstImage ? "One picture, kept privately in OPERATOR. Never posted by itself" : "Needs an OpenAI key on Connections > Other models"}</small>
        </button>
      </div>
    );
  };

  const link = (k: number, words: string | null) => (
    <div className="ch-link">
      {words && <span className="ch-pill">{words}</span>}
      {draft && roomFor(draft) && <button type="button" className="ch-add" aria-label={`Add a step here (step ${k + 1})`} aria-expanded={adding === k} onClick={() => setAdding(adding === k ? null : k)}>+</button>}
      {adding === k && picker(k)}
    </div>
  );

  return (
    <div className="ch-board dp-tok">
      <div className="ch-list">
        {groups.map((g) => (
          <div key={g.id} className="ch-lgrp">
            <div className="ch-grp">{g.title}</div>
            {g.chains.map((c) => (
              <button key={c.key} type="button" className="ch-ci" aria-pressed={draft?.key === c.key} onClick={() => choose(c)}>
                <b>{c.name}{!c.on && <span className="ch-offtag">Off</span>}</b>
                <small>{startWords(c.start, { chain: chainName, tool })} · {c.steps.length} step{c.steps.length === 1 ? "" : "s"}</small>
                <span className="ch-minis" aria-hidden="true">{c.steps.map((s, i) => (s.ask ? <i key={i} className="k-model">AI</i> : s.image ? <i key={i} className="k-image">▣</i> : s.ok ? <i key={i} className="k-ok">✓</i> : <i key={i} className={byId[s.agent!]?.claude ? "k-claude" : undefined} style={byId[s.agent!]?.claude ? undefined : { background: byId[s.agent!]?.hue }}>{byId[s.agent!]?.claude ? "✦" : name(s.agent!).slice(0, 1)}</i>))}</span>
              </button>
            ))}
            {isNew && draft && (g.id === "dept" || g.id === "company") && <button type="button" className="ch-ci" aria-pressed="true"><b>{draft.name}<span className="ch-offtag">Not saved</span></b><small>{draft.steps.length} step{draft.steps.length === 1 ? "" : "s"}</small></button>}
            {!g.chains.length && !(isNew && (g.id === "dept" || g.id === "company")) && <span className="ch-note">None yet.</span>}
          </div>
        ))}
        <button type="button" className="dp-btn ch-new" disabled={d.flow.chains.length >= d.maxChains || !d.palette.length} onClick={() => choose(fresh(undefined))}>+ New chain</button>
        {d.problem && <span className="ch-note">{d.problem}</span>}
        {!!d.problems.length && <span className="ch-note">Part of the saved chains was dropped and won’t run: {d.problems.join(" ")}</span>}
      </div>

      {draft ? (
        <div className="ch-ed">
          <div className="ch-ed-h">
            <input value={draft.name} maxLength={60} aria-label="Chain name" onChange={(e) => set({ ...draft, name: e.target.value })} />
            <label className="ch-tog">{draft.on ? "On" : "Off"}<button type="button" className={"switch" + (draft.on ? " on" : "")} aria-pressed={draft.on} aria-label={draft.on ? "Turn the chain off" : "Turn the chain on"} title={draft.on ? "Off: it then runs only with Run chain" : "On: it starts on its own while the org is on. Agents still need to be on duty."} onClick={() => set({ ...draft, on: !draft.on })}><span /></button></label>
            <button type="button" className="dp-btn sm" disabled={busy || !saved || !d.controls} onClick={runNow} title={!saved ? "Save the chain first" : !d.controls ? "Real runs are off on this OPERATOR" : dirty ? "Runs the saved version" : "Real runs of the saved chain"}>Run chain now</button>
          </div>

          <div className="ch-lane">
            <div className="ch-st start">
              <span className="ch-ico k-start" aria-hidden="true">⏱</span>
              <b>{startWords(draft.start, { chain: chainName, tool })}</b>
              <button type="button" className="ch-badge b-free ch-chg" aria-expanded={editStart} onClick={() => setEditStart((x) => !x)}>Change start</button>
              <span className="ch-what">
                {draft.start.type === "button" ? "Only when you press Run chain now." : `Also starts when you press Run chain now.${draft.on ? "" : " Off: it starts on its own only once you turn it on."}`}
                {draft.on && draft.start.type === "schedule" && saved && same(saved, draft) && (d.next[draft.key] ?? []).length > 0 && <> Next: {(d.next[draft.key] ?? []).map((t) => at(t, d.tz)).join(" · ")}.</>}
              </span>
              {editStart && <StartEditor c={draft} set={set} d={d} />}
            </div>
            {link(0, "then")}
            {draft.steps.map((st, k) => {
              const a = st.agent ? byId[st.agent] : undefined;
              const pb = k > 0 ? draft.steps[k - 1] : undefined;
              const prev = pb?.agent ? byId[pb.agent] : undefined;
              // after an OK, the step gets the result from the step before the OK
              const src = pb?.ok ? draft.steps[k - 2] : pb;
              const prevName = src ? (src.ask ? "the model" : src.image ? "the picture step" : src.ok ? "the step before" : name(src.agent!)) : undefined;
              const nx = draft.steps[k + 1];
              const shared = (
                <>
                  {k > 0 && (
                    <label className="ch-row"><span>Runs</span>
                      <select value={st.when ?? "ok"} onChange={(e) => setStep(k, { ...st, when: e.target.value as When })}>{(Object.keys(WHEN_LABEL) as When[]).map((w) => <option key={w} value={w}>{w === "any" ? "either way" : `${WHEN_LABEL[w].replace("it", prevName ?? "the step before")}`}</option>)}</select>
                    </label>
                  )}
                  {k > 0 && prev && prev.metrics.length > 0 && (st.check ? (
                    <div className="ch-row"><span>Only if</span>
                      <select aria-label="Number" value={st.check.metric} onChange={(e) => setStep(k, { ...st, check: { ...st.check!, metric: e.target.value } })}>{prev.metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}</select>
                      <select aria-label="Comparison" value={st.check.op} onChange={(e) => setStep(k, { ...st, check: { ...st.check!, op: e.target.value as Op } })}>{OPS.map((o) => <option key={o} value={o}>{o}</option>)}</select>
                      <input aria-label="Value" type="number" style={{ width: 80 }} value={st.check.value} onChange={(e) => setStep(k, { ...st, check: { ...st.check!, value: Number(e.target.value) } })} />
                      <button type="button" className="ch-x" onClick={() => setStep(k, { ...st, check: undefined })}>No check</button>
                    </div>
                  ) : <button type="button" className="ch-x" onClick={() => setStep(k, { ...st, check: { metric: prev.metrics[0].key, op: ">", value: 0 } })}>Only if… a number from {prev.name}</button>)}
                  <label className="ch-row"><span>On</span>
                    <select value={st.days ?? "daily"} onChange={(e) => setStep(k, { ...st, days: e.target.value === "daily" ? undefined : (e.target.value as Days) })}>
                      {[...DAYS, ...(st.days && !DAYS.includes(st.days) ? [st.days] : [])].map((x) => <option key={x} value={x}>{x === "daily" ? "any day" : `${DAY_LABEL[x] ?? x} only`}</option>)}
                    </select>
                  </label>
                  {k > 0 && (
                    <label className="ch-row"><span>Not before</span>
                      <select value={st.notBefore ?? ""} onChange={(e) => setStep(k, { ...st, notBefore: e.target.value || undefined })}><option value="">no wait</option>{QUARTERS.map((q) => <option key={q} value={q}>{clock(q)}</option>)}</select>
                    </label>
                  )}
                  {(k > 0 || draft.start.type === "after") && <label className="ch-row ch-chk"><input type="checkbox" checked={!!st.passAlong} onChange={(e) => setStep(k, { ...st, passAlong: e.target.checked || undefined })} />Gets {k > 0 ? (src?.ask ? "the model’s answer" : `${prevName ?? "the step before"}’s result`) : "the last step’s result"} as facts{pb?.ok ? ", once you approve it" : ""}</label>}
                  <div className="ch-row">
                    <button type="button" className="ch-x" disabled={k === 0} onClick={() => { set(moveStep(draft, k, -1)); setOpen(k - 1); }}>Move up</button>
                    <button type="button" className="ch-x" disabled={!nx} onClick={() => { set(moveStep(draft, k, 1)); setOpen(k + 1); }}>Move down</button>
                    <button type="button" className="ch-x" disabled={draft.steps.length === 1} onClick={() => { set(withoutStep(draft, k)); setOpen(null); }}>Remove step</button>
                  </div>
                </>
              );
              if (st.ask) {
                const ask = st.ask, m = modelOf(ask.model);
                const setAsk = (p: Partial<typeof ask>) => setStep(k, { ...st, ask: { ...ask, ...p } });
                return (
                  <div key={`ask-${k}`} className="ch-stwrap">
                    <div className={`ch-st${open === k ? " open" : ""}`}>
                      <span className="ch-ico k-model" aria-hidden="true">AI</span>
                      <button type="button" className="ch-stb" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}><b>Ask a model{ask.prompt.trim() ? `: ${firstLine(ask.prompt)}` : ""}</b></button>
                      <span className="ch-badge b-op">{m?.label ?? ask.model}</span>
                      <span className="ch-what">
                        A quick task, not an agent: one instruction{st.passAlong ? ", the step before’s result as facts" : ""}, text back. No tools, no reads. Up to {money(ask.maxUsd)} a run
                        {payer && "agent" in payer ? <>, billed to {name(payer.agent)}.</> : "."}
                        {payer && "problem" in payer && <b className="ch-warn"> {payer.problem}</b>}
                        {payer && "agent" in payer && byId[payer.agent] && !byId[payer.agent].enabled && <b className="ch-warn"> {name(payer.agent)} is off duty, so this step is skipped and the chain stops here.</b>}
                        {m && !m.ready && <b className="ch-warn"> {m.label} needs its key on Connections &gt; Other models.</b>}
                        {!ask.prompt.trim() && <b className="ch-warn"> Say what to ask.</b>}
                      </span>
                      {open === k && (
                        <div className="ch-opts">
                          <label className="ch-row"><span>Model</span>
                            <select value={ask.model} onChange={(e) => setAsk({ model: e.target.value })}>
                              {d.models.map((x) => <option key={x.id} value={x.id} disabled={!x.ready && x.id !== ask.model}>{x.label}{x.ready ? "" : " (needs its key)"}</option>)}
                            </select>
                          </label>
                          <label className="ch-row ch-ask"><span>Ask</span>
                            <textarea rows={4} maxLength={ASK.promptMax} placeholder="Write three short captions for this week’s post, each under 120 characters." value={ask.prompt} onChange={(e) => setAsk({ prompt: e.target.value })} />
                          </label>
                          <label className="ch-row"><span>Up to</span>
                            $<input type="number" aria-label="Most it can cost a run, in dollars" min={0.01} max={ASK.maxUsd} step={0.05} style={{ width: 90 }} value={ask.maxUsd} onChange={(e) => setAsk({ maxUsd: Math.round(Number(e.target.value) * 100) / 100 })} />
                            <span className="ch-note">a run, at most ${ASK.maxUsd.toFixed(2)}. The answer is cut short at the cap.</span>
                          </label>
                          {shared}
                        </div>
                      )}
                    </div>
                    {link(k + 1, nx ? linkWords(nx) : null)}
                  </div>
                );
              }
              if (st.image) {
                const img = st.image, im = d.imageModels.find((x) => x.id === img.model);
                const setImg = (p: Partial<typeof img>) => setStep(k, { ...st, image: { ...img, ...p } });
                return (
                  <div key={`img-${k}`} className="ch-stwrap">
                    <div className={`ch-st${open === k ? " open" : ""}`}>
                      <span className="ch-ico k-image" aria-hidden="true">▣</span>
                      <button type="button" className="ch-stb" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}><b>Make an image{img.prompt.trim() ? `: ${firstLine(img.prompt)}` : ""}</b></button>
                      <span className="ch-badge b-img">{im?.label ?? img.model}</span>
                      <span className="ch-what">
                        One {SIZE_LABEL[img.size].toLowerCase()} picture at {img.quality} quality{st.passAlong ? ", drawing on the step before’s result" : ""}, about {money(imageMaxUsd(img))}
                        {payer && "agent" in payer ? <>, billed to {name(payer.agent)}.</> : "."} Kept privately in OPERATOR for {IMAGE_KEEP_DAYS} days and shown on the run; never posted or sent. The next step gets a line about it, not the picture.
                        {payer && "problem" in payer && <b className="ch-warn"> {payer.problem.replace("Ask a model", "Make an image")}</b>}
                        {im && !im.ready && <b className="ch-warn"> {im.label} needs an OpenAI key on Connections &gt; Other models.</b>}
                        {!img.prompt.trim() && <b className="ch-warn"> Say what picture to make.</b>}
                      </span>
                      {open === k && (
                        <div className="ch-opts">
                          <label className="ch-row"><span>Model</span>
                            <select value={img.model} onChange={(e) => setImg({ model: e.target.value })}>
                              {d.imageModels.map((x) => <option key={x.id} value={x.id} disabled={!x.ready && x.id !== img.model}>{x.label}{x.ready ? "" : " (needs its key)"}</option>)}
                            </select>
                          </label>
                          <label className="ch-row ch-ask"><span>Picture</span>
                            <textarea rows={3} maxLength={IMAGE.promptMax} placeholder="A bright flat-lay of this week’s new products on a wood counter, morning light, no text." value={img.prompt} onChange={(e) => setImg({ prompt: e.target.value })} />
                          </label>
                          <label className="ch-row"><span>Quality</span>
                            <select value={img.quality} onChange={(e) => setImg({ quality: e.target.value as ImageQuality })}>{IMAGE_QUALITIES.map((q) => <option key={q} value={q}>{q} · about {money(imageMaxUsd({ ...img, quality: q }))}</option>)}</select>
                          </label>
                          <label className="ch-row"><span>Shape</span>
                            <select value={img.size} onChange={(e) => setImg({ size: e.target.value as ImageSize })}>{IMAGE_SIZES.map((z) => <option key={z} value={z}>{SIZE_LABEL[z]} ({z})</option>)}</select>
                          </label>
                          {shared}
                        </div>
                      )}
                    </div>
                    {link(k + 1, nx ? linkWords(nx) : null)}
                  </div>
                );
              }
              if (st.ok) {
                const okNote = st.ok.note ?? "";
                return (
                  <div key={`ok-${k}`} className="ch-stwrap">
                    <div className={`ch-st${open === k ? " open" : ""}`}>
                      <span className="ch-ico k-ok" aria-hidden="true">✓</span>
                      <button type="button" className="ch-stb" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}><b>Wait for my OK</b></button>
                      <span className="ch-badge b-ok">Approvals</span>
                      <span className="ch-what">
                        {prevName ? `${prevName.replace(/^the /, "The ")}’s result` : "The step before’s result"} goes on a card in Approvals. Approve and the chain goes on{nx ? ` to ${stepName(nx)}` : ""}; reject and it stops. No answer in {OK.days} days stops it too. Costs nothing.
                        {okNote.trim() && <> Card note: “{okNote.trim()}”</>}
                      </span>
                      {open === k && (
                        <div className="ch-opts">
                          <label className="ch-row ch-ask"><span>Note</span>
                            <textarea rows={2} maxLength={OK.noteMax} placeholder="Check the captions sound like us before Rowan drafts the email." value={okNote} onChange={(e) => setStep(k, { ...st, ok: e.target.value ? { note: e.target.value } : {} })} />
                          </label>
                          <label className="ch-row"><span>Asks</span>
                            <select value={st.when ?? "ok"} onChange={(e) => setStep(k, { ...st, when: e.target.value as When })}>{(Object.keys(WHEN_LABEL) as When[]).map((w) => <option key={w} value={w}>{w === "any" ? "either way" : `${WHEN_LABEL[w].replace("it", prevName ?? "the step before")}`}</option>)}</select>
                          </label>
                          <div className="ch-row">
                            <button type="button" className="ch-x" disabled={k <= 1} onClick={() => { set(moveStep(draft, k, -1)); setOpen(k - 1); }}>Move up</button>
                            <button type="button" className="ch-x" disabled={!nx} onClick={() => { set(moveStep(draft, k, 1)); setOpen(k + 1); }}>Move down</button>
                            <button type="button" className="ch-x" onClick={() => { set(withoutStep(draft, k)); setOpen(null); }}>Remove step</button>
                          </div>
                        </div>
                      )}
                    </div>
                    {link(k + 1, nx ? linkWords(nx) : null)}
                  </div>
                );
              }
              return (
                <div key={`${st.agent}-${k}`} className="ch-stwrap">
                  <div className={`ch-st${open === k ? " open" : ""}`}>
                    <span className={`ch-ico ${a?.claude ? "k-claude" : "k-agent"}`} style={a && !a.claude ? { background: a.hue, color: "#111114" } : undefined} aria-hidden="true">{a?.claude ? "✦" : name(st.agent!).slice(0, 1)}</span>
                    <button type="button" className="ch-stb" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}><b>{name(st.agent!)}</b>{a?.role ? <small>{a.role}</small> : null}</button>
                    <span className={`ch-badge ${a?.claude ? "b-cl" : "b-op"}`}>{a?.claude ? "Claude routine" : `OPERATOR${a?.model ? ` · ${a.model}` : ""}`}</span>
                    <span className="ch-what">
                      {a?.claude ? "An agent that runs in your Claude account. The chain waits for its result (up to 24 hours). " : "An agent. "}
                      {a?.job ? firstLine(a.job) : ""}
                      {a && !a.enabled && <b className="ch-warn"> Off duty: this step is skipped and the chain stops here until you put {a.name} on duty.</b>}
                    </span>
                    {open === k && (
                      <div className="ch-opts">
                        <label className="ch-row"><span>Agent</span>
                          <select value={st.agent} onChange={(e) => setStep(k, { ...st, agent: e.target.value, check: undefined } as Step)}>
                            {d.palette.filter((p) => p.id === st.agent || !draft.steps.some((s) => s.agent === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}, {p.role}{p.enabled ? "" : " (off duty)"}{p.buttonOnly ? " · by hand only" : ""}</option>)}
                          </select>
                        </label>
                        {shared}
                      </div>
                    )}
                  </div>
                  {link(k + 1, nx ? linkWords(nx) : null)}
                </div>
              );
            })}
          </div>

          {preview?.key === draft.key && (
            <div className="ch-preview">
              <span className="ch-note">{preview.text}</span>
              {preview.steps.map((p, i) => (
                <div key={i} className="ch-st">
                  <b style={{ gridColumn: "1 / -1" }}>Step {i + 1}: {p.name}</b>
                  <span className="ch-what" style={{ gridColumn: "1 / -1" }}><Summary text={p.summary} /></span>
                  <span className="ch-note" style={{ gridColumn: "1 / -1" }}>{p.next}</span>
                </div>
              ))}
            </div>
          )}

          {dirty && problems.length > 0 && <div className="ch-probs">{problems.join(" ")}</div>}
          <div className="ch-foot">
            <span className="ch-note">Each step runs through its agent’s duty and budget checks (a quick step, the paying agent’s). A step’s result reaches the next step as facts, never as instructions.</span>
            <span className="ch-cost">About <b>{money(perRun)}</b> a run{draft.on && month > 0 && <> · <b>{money(month)}</b> a month</>}{unknownCost ? " (some agents have no real run yet)" : ""}{draft.steps.some((x) => x.ask || x.image) ? " (quick steps at their cap)" : ""}</span>
            {saved && <button type="button" className="dp-btn sm ghost" disabled={busy} onClick={remove}>Delete</button>}
            <button type="button" className="dp-btn" disabled={busy || problems.length > 0} onClick={tryIt} title="Dry-runs each step on real data. No writes, no model, no cost, nothing logged. An Ask a model step says what it would ask.">Try it</button>
            <button type="button" className="dp-btn dark" disabled={busy || !dirty || problems.length > 0} onClick={save}>{busy ? "Saving…" : "Save"}</button>
          </div>
          {saved && dirty && <span className="ch-note">Run chain now runs the saved version. Save to run your changes.</span>}
        </div>
      ) : (
        <div className="ch-ed ch-empty">
          <b>No chains here yet</b>
          <span className="ch-note">A chain starts on a schedule, with Run chain, after another chain, on a live event or when you decide an approval, then runs up to {d.maxSteps} steps in order (agents, or Ask a model), each getting the one before’s result.</span>
        </div>
      )}

      {scope === "all" && actions.rollBack && d.versions.length > 0 && (
        <details className="ch-versions">
          <summary>Versions</summary>
          {d.versions.map((v) => (
            <div key={v.version} className="ch-ver">
              <b>v{v.version}</b>
              <span>{v.note ?? ""} <span className="ch-note">· {v.chains} chain{v.chains === 1 ? "" : "s"}, {v.on.length ? `on: ${v.on.join(", ")}` : "all off"} · {v.createdBy} · {at(v.createdAt, d.tz)}</span></span>
              {v.active ? <span className="ch-badge b-op">Active</span> : <button type="button" className="dp-btn sm" disabled={busy} onClick={() => rollBack(v)}>Roll back</button>}
            </div>
          ))}
        </details>
      )}

      {confirm && <Modal c={confirm} busy={busy} onCancel={() => setConfirm(null)} onGo={() => { const g = confirm.go; setConfirm(null); g(); }} />}
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}

/** The start's fields: a schedule, the Run button, after another chain, a live event or an approval. */
function StartEditor({ c, set, d }: { c: Chain; set: (c: Chain) => void; d: ChainsData }) {
  const choices = afterChoices(d.flow, c.key);
  const s = c.start;
  const to = (t: Start["type"]): Start => t === "schedule" ? { type: "schedule", days: "weekdays", time: "07:00" }
    : t === "button" ? { type: "button" }
    : t === "event" ? { type: "event", event: EVENTS[0].type }
    : t === "after" ? { type: "after", chain: choices[0]?.key ?? "" }
    : { type: "approval", tool: d.approvalTools[0]?.id ?? "", decision: "approve" };
  return (
    <div className="ch-opts">
      <div className="seg" role="radiogroup" aria-label="Start">
        {START_TYPES.map(({ t, label }) => (
          <button key={t} type="button" role="radio" aria-checked={s.type === t} className={s.type === t ? "on" : ""} disabled={t === "after" && !choices.length} onClick={() => set({ ...c, start: to(t) })}>{label}</button>
        ))}
      </div>
      {s.type === "schedule" && (
        <div className="ch-row">
          <select aria-label="Days" value={s.days} onChange={(e) => isDays(e.target.value) && set({ ...c, start: { ...s, days: e.target.value } })}>
            {[...DAYS, ...(!DAYS.includes(s.days) ? [s.days] : [])].map((x) => <option key={x} value={x}>{DAY_LABEL[x] ?? x}</option>)}
          </select>
          <select aria-label="Time" value={s.time} onChange={(e) => set({ ...c, start: { ...s, time: e.target.value } })}>{QUARTERS.map((q) => <option key={q} value={q}>{clock(q)}</option>)}</select>
          <span className="ch-note">Your time zone, on a quarter hour.</span>
        </div>
      )}
      {s.type === "after" && (
        <div className="ch-row">
          <select aria-label="After which chain" value={s.chain} onChange={(e) => set({ ...c, start: { ...s, chain: e.target.value } })}>{choices.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}</select>
          <select aria-label="When" value={s.when ?? "ok"} onChange={(e) => set({ ...c, start: e.target.value === "any" ? { ...s, when: "any" } : { type: "after", chain: s.chain } })}><option value="ok">finishes and its last step worked</option><option value="any">finishes either way</option></select>
          <span className="ch-note">Tick “Gets the last step’s result” on the first step to hand it over.</span>
        </div>
      )}
      {s.type === "approval" && (
        <div className="ch-row">
          <select aria-label="Decision" value={s.decision} onChange={(e) => set({ ...c, start: { ...s, decision: e.target.value as "approve" | "reject" | "any" } })}><option value="approve">You approve</option><option value="reject">You reject</option><option value="any">You decide either way</option></select>
          <select aria-label="Approval type" value={s.tool} onChange={(e) => set({ ...c, start: { ...s, tool: e.target.value } })}>{d.approvalTools.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        </div>
      )}
      {s.type === "event" && (
        <div className="ch-row">
          <select aria-label="Event" value={s.event} onChange={(e) => set({ ...c, start: { ...s, event: e.target.value as EventType } })}>{EVENTS.map((ev) => <option key={ev.type} value={ev.type}>{ev.label}</option>)}</select>
          <input type="number" min={0} step="1" inputMode="decimal" placeholder="Any total" style={{ width: 120 }} aria-label={EVENT_BY_TYPE[s.event]?.total.label ?? "Minimum total"} value={s.minTotal ?? ""}
            onChange={(e) => { const v = e.target.value.trim(); const { minTotal: _drop, ...rest } = s as EventStart; void _drop; set({ ...c, start: v === "" ? rest : { ...rest, minTotal: Math.max(0, Number(v)) } }); }} />
          <span className="ch-note">Set it up under Connections &gt; Live events. At most 10 an hour and 50 a day.</span>
        </div>
      )}
    </div>
  );
}
