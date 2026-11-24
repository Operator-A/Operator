"use client";
// The Runs on picker (card 405), as in the approved mockup: one control for where an agent runs. Models OPERATOR
// runs, grouped by maker (Claude, OpenAI, Gemini, Grok; a maker without a key shows "Add a key on Connections"),
// then "A Claude routine" in the owner's own Claude account. Used on the agent sheet's Edit tab and on the New agent
// sheet. It only holds the choice: saving goes through the server (setRunsOn), which checks the role and the model.
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { fillClaudeTools, makerOf, modelGroups, type PickModel, type RunsOnChoice } from "@/dashboard/runs-on-rules";
import { CLAUDE_TOOLS } from "@/core/routine-rules";

const ROUTINE_MARK = "✦";

/** What the closed picker shows for a choice: the mark, the name and where it runs. */
export function runsOnLabel(v: RunsOnChoice, models: readonly PickModel[]): { mark: string; name: string; where: string } {
  if (v.on === "claude") return { mark: ROUTINE_MARK, name: "A Claude routine", where: "In your Claude account" };
  const m = models.find((x) => x.id === v.model);
  const mk = makerOf(m?.provider ?? "");
  return { mark: mk?.mark ?? "?", name: m?.label ?? v.model, where: `In OPERATOR${mk ? ` · ${mk.name}` : ""}` };
}

export function RunsOnPicker({ value, onChange, models, disabled = false, claudeTools = [], labelId }: {
  value: RunsOnChoice; onChange: (v: RunsOnChoice) => void; models: readonly PickModel[]; disabled?: boolean;
  /** The connector labels a switch to a routine starts with (the agent's own, or filled from its reads). */
  claudeTools?: string[];
  /** The id of the field's label, for screen readers. */
  labelId?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btnId = useId();
  const l = runsOnLabel(value, models);
  const groups = modelGroups(models);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away);
    box.current?.addEventListener("keydown", esc);
    const el = box.current;
    // focus the chosen option, so arrows start from it
    requestAnimationFrame(() => (el?.querySelector<HTMLButtonElement>('.ro-opt[aria-selected="true"]') ?? el?.querySelector<HTMLButtonElement>(".ro-opt:not([disabled])"))?.focus());
    return () => { document.removeEventListener("mousedown", away); el?.removeEventListener("keydown", esc); };
  }, [open]);

  const pick = (v: RunsOnChoice) => { onChange(v); setOpen(false); };
  const arrows = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const opts = [...(box.current?.querySelectorAll<HTMLButtonElement>(".ro-opt:not([disabled])") ?? [])];
    const i = opts.indexOf(document.activeElement as HTMLButtonElement);
    opts[(i + (e.key === "ArrowDown" ? 1 : -1) + opts.length) % opts.length]?.focus();
  };

  return (
    <div className="ro" ref={box}>
      <button type="button" id={btnId} className="ro-btn" aria-haspopup="listbox" aria-expanded={open} aria-labelledby={labelId ? `${labelId} ${btnId}` : undefined} disabled={disabled} onClick={() => setOpen((x) => !x)}>
        <span className="ro-mk" aria-hidden="true">{l.mark}</span>
        <span className="ro-t"><b>{l.name}</b><small>{l.where}</small></span>
        <span className="ro-car" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="ro-list" role="listbox" aria-labelledby={btnId} onKeyDown={arrows}>
          {groups.map((g) => (
            <div key={g.maker.id} role="group" aria-label={g.maker.name}>
              <div className="ro-grp">{g.maker.name}{g.noKey && <Link href="/connections">Add a key on Connections</Link>}</div>
              {g.models.map((m) => {
                const on = value.on === "operator" && value.model === m.id;
                return (
                  <button key={m.id} type="button" role="option" className="ro-opt" aria-selected={on} disabled={!m.ready && !on} onClick={() => pick({ on: "operator", model: m.id })}>
                    {m.label}{!m.ready && <small>Needs a key</small>}
                  </button>
                );
              })}
            </div>
          ))}
          <div className="ro-sep" />
          <div role="group" aria-label="In your Claude account">
            <div className="ro-grp">In your Claude account</div>
            <button type="button" role="option" className="ro-opt" aria-selected={value.on === "claude"} onClick={() => pick(value.on === "claude" ? value : { on: "claude", tools: claudeTools })}>
              {ROUTINE_MARK} A Claude routine<small>Your connectors, your account</small>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Uses in Claude": the connector labels a Claude routine names. Labels only: nothing is granted in OPERATOR. */
export function ClaudeToolsField({ tools, onChange, note = "Labels only: you give the routine these connectors on claude.ai.", disabled = false }: { tools: string[]; onChange: (t: string[]) => void; note?: string; disabled?: boolean }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const inputId = useId();
  const add = () => { const next = fillClaudeTools([...tools, text]); if (next.length > tools.length) onChange(next); setText(""); setAdding(false); };
  return (
    <div className="fld">
      <span className="lbl">Uses in Claude</span>
      <div className="dp-chipset">
        {tools.map((t) => (
          <span key={t} className="dp-chip">{t}<button type="button" className="ro-rm" aria-label={`Remove ${t}`} disabled={disabled} onClick={() => onChange(tools.filter((x) => x !== t))}>✕</button></span>
        ))}
        {adding
          ? <span className="ro-add"><label htmlFor={inputId} className="sr-only">Connector name</label><input id={inputId} autoFocus maxLength={CLAUDE_TOOLS.maxLabel} placeholder="Google Drive" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") { e.stopPropagation(); setAdding(false); } }} onBlur={() => (text.trim() ? add() : setAdding(false))} /></span>
          : tools.length < CLAUDE_TOOLS.max && <button type="button" className="dp-chip addtrig" disabled={disabled} onClick={() => setAdding(true)}>+ Add</button>}
      </div>
      <span className="dp-note">{tools.length ? note : "Name at least one connector the routine uses, like Gmail or Google Drive."}</span>
    </div>
  );
}
