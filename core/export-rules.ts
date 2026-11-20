// Uploaded exports (card 160, docs/exports.md): when a tool the business uses has no connection, the
// owner uploads a CSV export of it and the department's agents read it through Uploaded export. Pure,
// so `npm run check:exports` can test it.
//
// An uploaded file is untrusted data: its rows never choose a recipient, URL, product or category,
// and every number an agent sees from it is computed here, in code.

export const EXPORT_LIMITS = { bytes: 1_000_000, rows: 5000, columns: 40, cell: 500, header: 60, name: 60 } as const;
export const FRESH_DAYS = { start: 7, min: 1, max: 90 } as const;
/** Rows an agent may read in one call. */
export const READ_ROWS = { start: 100, max: 200 } as const;

export type ColumnType = "number" | "date" | "text";
export interface Column { name: string; type: ColumnType }
export interface Parsed { columns: Column[]; rows: string[][] }

const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/**
 * RFC 4180 CSV: commas, double-quoted cells with "" for a quote, newlines inside quotes, CRLF or LF.
 * Returns the records, or why the text isn't CSV we accept.
 */
export function readCsv(text: string): string[][] | { problem: string } {
  const out: string[][] = [];
  let row: string[] = [], cell = "", quoted = false, i = 0;
  const s = text.replace(/^﻿/, "");
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"') {
      if (cell.length) return { problem: `a quote in the middle of a cell on line ${out.length + 1}` };
      quoted = true; i++; continue;
    }
    if (c === ",") { row.push(cell); cell = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      row.push(cell); cell = "";
      out.push(row); row = [];
      i += c === "\r" && s[i + 1] === "\n" ? 2 : 1;
      continue;
    }
    cell += c; i++;
  }
  if (quoted) return { problem: "a quoted cell that never closes" };
  if (cell.length || row.length) { row.push(cell); out.push(row); }
  // blank lines (a lone empty cell) are skipped
  return out.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

const NUM = /^-?\$?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\$?\d+(\.\d+)?$/;
/** A number as written in an export: optional minus, $, thousands commas, decimals. Null when it isn't one. */
export function numberOf(cell: string): number | null {
  const t = cell.trim();
  if (!t || !NUM.test(t)) return null;
  const n = Number(t.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : null;
}
const DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$|^\d{1,2}\/\d{1,2}\/\d{4}$/;
export const isDate = (cell: string) => DATE.test(cell.trim()) && !Number.isNaN(Date.parse(cell.trim().replace(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, "$3-$1-$2").replace(/-(\d)(?=-|$)/g, "-0$1")));

/** A column's type, from every non-empty cell: number when all are numbers, date when all are dates, else text. */
export function typeOf(cells: readonly string[]): ColumnType {
  const filled = cells.filter((c) => c.trim() !== "");
  if (!filled.length) return "text";
  if (filled.every((c) => numberOf(c) !== null)) return "number";
  if (filled.every(isDate)) return "date";
  return "text";
}

/** Checks an upload against the limits and reads it into typed columns and clean rows. */
export function parseExport(text: string, bytes: number): Parsed | { problem: string } {
  if (bytes > EXPORT_LIMITS.bytes) return { problem: `The file is over ${EXPORT_LIMITS.bytes / 1_000_000} MB.` };
  if (/\u0000/.test(text)) return { problem: "That isn't a text CSV file." };
  const recs = readCsv(text);
  if ("problem" in recs) return { problem: `That isn't a CSV file we can read: ${recs.problem}.` };
  if (recs.length < 2) return { problem: "The file needs a header row and at least one row of data." };
  const header = recs[0].map((h) => h.replace(CONTROL, " ").trim());
  if (header.length > EXPORT_LIMITS.columns) return { problem: `The file has ${header.length} columns; at most ${EXPORT_LIMITS.columns}.` };
  if (header.some((h) => !h)) return { problem: "Every column needs a name in the header row." };
  if (header.some((h) => h.length > EXPORT_LIMITS.header)) return { problem: `Column names can be at most ${EXPORT_LIMITS.header} characters.` };
  const lower = header.map((h) => h.toLowerCase());
  const twice = lower.find((h, i) => lower.indexOf(h) !== i);
  if (twice) return { problem: `Two columns are named “${header[lower.indexOf(twice)]}”.` };
  const body = recs.slice(1);
  if (body.length > EXPORT_LIMITS.rows) return { problem: `The file has ${body.length} rows; at most ${EXPORT_LIMITS.rows}.` };
  const rows: string[][] = [];
  for (const [n, r] of body.entries()) {
    if (r.length > header.length) return { problem: `Row ${n + 1} has more cells than the header has columns.` };
    const clean = header.map((_, i) => (r[i] ?? "").replace(CONTROL, " ").trim());
    const long = clean.find((c) => c.length > EXPORT_LIMITS.cell);
    if (long !== undefined) return { problem: `Row ${n + 1} has a cell over ${EXPORT_LIMITS.cell} characters.` };
    rows.push(clean);
  }
  const columns = header.map((name, i) => ({ name, type: typeOf(rows.map((r) => r[i])) }));
  return { columns, rows };
}

/** A tool's name for an export, checked: one line, letters first, at most EXPORT_LIMITS.name characters. */
export function exportName(raw: unknown): { name: string } | { problem: string } {
  const name = typeof raw === "string" ? raw.replace(CONTROL, " ").replace(/\s+/g, " ").trim() : "";
  if (!name) return { problem: "Name the tool the export comes from." };
  if (name.length > EXPORT_LIMITS.name) return { problem: `The name can be at most ${EXPORT_LIMITS.name} characters.` };
  if (!/^[\p{L}\p{N}]/u.test(name) || /https?:|www\.|[<>{}]/i.test(name)) return { problem: "Use the tool’s plain name, without links." };
  return { name };
}

/** How many days an export stays fresh: a whole number held between FRESH_DAYS.min and max. */
export function freshDays(raw: unknown): number {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return FRESH_DAYS.start;
  return Math.min(FRESH_DAYS.max, Math.max(FRESH_DAYS.min, Math.round(n)));
}

/** Whole days since the upload, and whether it is past its fresh-for days. */
export function ageOf(uploadedAt: string, fresh: number, now = Date.now()): { days: number; stale: boolean } {
  const days = Math.max(0, Math.floor((now - Date.parse(uploadedAt)) / 864e5));
  return { days, stale: days > fresh };
}

/** Count, sum, average, min and max of every number column, over all rows. Worked out here, never by a model. */
export function columnNumbers(columns: readonly Column[], rows: readonly string[][]): Record<string, number> {
  const out: Record<string, number> = { rows: rows.length };
  const key = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40) || "column";
  columns.forEach((c, i) => {
    if (c.type !== "number") return;
    const ns = rows.map((r) => numberOf(r[i] ?? "")).filter((n): n is number => n !== null);
    if (!ns.length) return;
    const sum = ns.reduce((a, b) => a + b, 0);
    const k = key(c.name);
    out[`${k}_count`] = ns.length;
    out[`${k}_sum`] = Math.round(sum * 100) / 100;
    out[`${k}_avg`] = Math.round((sum / ns.length) * 100) / 100;
    out[`${k}_min`] = Math.min(...ns);
    out[`${k}_max`] = Math.max(...ns);
  });
  return out;
}

export type ExportState = "active" | "switched";
/** Whether an upload may replace this export's rows: never once the tool has a real connection. */
export const uploadProblem = (state: ExportState | null) => (state === "switched" ? "This tool has a real connection now, so uploads have stopped. Agents read it through its connection." : null);

/** What an agent is told when the export is stale. */
export const staleNote = (name: string, days: number) => `This export is ${days} day${days === 1 ? "" : "s"} old. Ask the owner for a fresh export of ${name} in your result.`;
