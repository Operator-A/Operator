"use client";
// Find a tool (card 160, docs/exports.md): upload a CSV export for a tool with no connection. The
// server checks the name, the file and every limit again before anything is kept.
import { useRef, useState, useTransition } from "react";
import type { ActionResult } from "../actions";
import { Toast } from "./client";

const input = { width: "100%", minWidth: 0, background: "var(--card)", border: "1px solid var(--bd)", fontSize: 14 } as const;

export function ExportForm({ upload, name: startName, maxMb }: { upload: (form: FormData) => Promise<ActionResult>; name?: string; maxMb: number }) {
  const [name, setName] = useState(startName ?? "");
  const [fresh, setFresh] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [toast, setToast] = useState<ActionResult | null>(null);
  const [busy, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const tooBig = !!file && file.size > maxMb * 1_000_000;
  const go = () => start(async () => {
    const form = new FormData();
    form.set("name", name);
    if (fresh) form.set("fresh", fresh);
    if (file) form.set("file", file);
    let r: ActionResult;
    try { r = await upload(form); } catch (e) { r = { ok: false, text: e instanceof Error ? e.message : "Something went wrong." }; }
    setToast(r);
    if (r.ok) { setFile(null); if (fileRef.current) fileRef.current.value = ""; if (!startName) setName(""); }
  });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>The tool it comes from
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Production log, Square, a spreadsheet…" maxLength={60} style={input} readOnly={!!startName} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>CSV file (at most {maxMb} MB, 5,000 rows, 40 columns, with a header row)
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ fontSize: 13 }} />
      </label>
      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, fontWeight: 600 }}>Fresh for (days, 1 to 90; agents ask for a new export after that)
        <input className="input" inputMode="numeric" value={fresh} onChange={(e) => setFresh(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))} placeholder="7" style={{ ...input, maxWidth: 120 }} />
      </label>
      {tooBig && <span style={{ fontSize: 12.5, color: "var(--red-ink)" }}>That file is over {maxMb} MB.</span>}
      <span className="row wrap" style={{ gap: 8 }}>
        <button className="btn dark sm" disabled={busy || !name.trim() || !file || tooBig} onClick={go}>{busy ? "Uploading…" : "Upload"}</button>
      </span>
      <Toast t={toast} onDone={() => setToast(null)} />
    </div>
  );
}
