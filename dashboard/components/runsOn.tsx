"use client";
// The Runs on picker (card 405), as in the approved mockup: one control for where an agent runs. Models OPERATOR
// runs, grouped by maker (Claude, OpenAI, Gemini, Grok; a maker without a key shows "Add a key on Connections"),
// then "A Claude routine" in the owner's own Claude account. Used on the agent sheet's Edit tab and on the New agent
// sheet. It only holds the choice: saving goes through the server (setRunsOn), which checks the role and the model.
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { makerOf, modelGroups, type PickModel, type RunsOnChoice } from "@/dashboard/runs-on-rules";
import { promptLine } from "@/core/routine-rules";

const ROUTINE_MARK = "✦";

/** What the closed picker shows for a choice: the mark, the name and where it runs. */
export function runsOnLabel(v: RunsOnChoice, models: readonly PickModel[]): { mark: string; name: string; where: string } {
  if (v.on === "claude") return { mark: ROUTINE_MARK, name: "A Claude routine", where: "In your Claude account" };
  const m = models.find((x) => x.id === v.model);
  const mk = makerOf(m?.provider ?? "");
  return { mark: mk?.mark ?? "?", name: m?.label ?? v.model, where: `In OPERATOR${mk ? ` · ${mk.name}` : ""}` };
}

export function RunsOnPicker({ value, onChange, models, disabled = false, labelId }: {
  value: RunsOnChoice; onChange: (v: RunsOnChoice) => void; models: readonly PickModel[]; disabled?: boolean;
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
            <button type="button" role="option" className="ro-opt" aria-selected={value.on === "claude"} onClick={() => pick({ on: "claude" })}>
              {ROUTINE_MARK} A Claude routine<small>Your connectors, your account</small>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A Claude routine's trigger and key (decided 2026-11-24: that's all OPERATOR needs; the routine's own connectors
 * are set in Claude, never named here): the steps on claude.ai, the line to paste into its prompt, and the two fields.
 * Only holds what was typed: the server checks both (readRoutine) and seals the token in the vault.
 */
export function RoutineFields({ name, value, onChange, disabled = false }: { name: string; value: { routine: string; token: string }; onChange: (v: { routine: string; token: string }) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <>
      <ol className="dp-note ro-steps">
        <li>On claude.ai, open Routines and click New routine. Give it the connectors its job needs, and your OPERATOR connector, which it uses to post its result back here.</li>
        <li>Paste this line into its prompt: <code style={{ userSelect: "all" }}>{promptLine(name.trim() || "this agent")}</code></li>
        <li>Click Edit, then Trigger, then API, then Generate token. Copy the routine id (trig_…) and the token. Claude shows the token once.</li>
      </ol>
      <div className="ro-keys">
        <label htmlFor={`${id}-r`} className="sr-only">Routine trigger id</label>
        <input id={`${id}-r`} type="text" placeholder="Routine trigger id, trig_…" value={value.routine} disabled={disabled} autoComplete="off" spellCheck={false} onChange={(e) => onChange({ ...value, routine: e.target.value })} />
        <label htmlFor={`${id}-t`} className="sr-only">Routine key</label>
        <input id={`${id}-t`} placeholder="Routine key, sk-ant-oat01-…" type="password" value={value.token} disabled={disabled} autoComplete="off" spellCheck={false} onChange={(e) => onChange({ ...value, token: e.target.value })} />
      </div>
      <span className="dp-note">The key is locked away and never shown again. It can only start this one routine. OPERATOR grants the routine nothing: what it does with its connectors happens in Claude.</span>
    </>
  );
}
