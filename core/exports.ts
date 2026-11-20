import "server-only";
// Uploaded exports (card 160, docs/exports.md): the file_sources table. The owner uploads a CSV for a
// tool that has no connection; agents read it through Uploaded export (core/tools/catalog.ts). Uploading
// also asks for a real connection (connector requests). When one arrives the export switches over and
// uploads stop. The rules are in core/export-rules.ts.
import { db } from "@/core/db";
import { serviceKey } from "@/core/connector-rules";
import { ageOf, exportName, freshDays, parseExport, uploadProblem, type Column, type ExportState } from "@/core/export-rules";

export interface ExportRow {
  id: string; service_key: string; name: string; columns: Column[]; row_count: number; bytes: number;
  fresh_days: number; state: ExportState; uploaded_at: string; uploaded_by: string | null; switched_at: string | null;
}
export interface ExportSummary extends ExportRow { days: number; stale: boolean }

export const EXPORTS_MISSING = "The file_sources table isn’t in Supabase yet: apply the migration 20261223090000_file_sources.sql.";
const COLS = "id, service_key, name, columns, row_count, bytes, fresh_days, state, uploaded_at, uploaded_by, switched_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const missing = (m: string) => (/file_sources/.test(m) ? EXPORTS_MISSING : m);

/** Every export, newest upload first, with its age. Null when the table isn't there. */
export async function listExports(now = Date.now()): Promise<ExportSummary[] | null> {
  const { data, error } = await db().from("file_sources").select(COLS).order("uploaded_at", { ascending: false }).limit(100);
  if (error) return null;
  return ((data ?? []) as ExportRow[]).map((r) => ({ ...r, ...ageOf(r.uploaded_at, r.fresh_days, now) }));
}

/** One export with its rows, by service key. */
export async function readExport(key: string): Promise<(ExportRow & { rows: string[][] }) | null> {
  const { data, error } = await db().from("file_sources").select(`${COLS}, rows`).eq("service_key", serviceKey(key)).maybeSingle();
  if (error) throw new Error(missing(error.message));
  return (data as (ExportRow & { rows: string[][] }) | null) ?? null;
}

/**
 * The owner's upload: checked against the limits, then it makes the export or replaces its rows.
 * Refused once the tool has a real connection. Returns the export's name and row count.
 */
export async function uploadExport(input: { name: unknown; text: string; bytes: number; fresh?: unknown; by: string }): Promise<{ name: string; key: string; rows: number; created: boolean }> {
  const n = exportName(input.name);
  if ("problem" in n) throw new Error(n.problem);
  const key = serviceKey(n.name);
  if (!key) throw new Error("Use letters or numbers in the name.");
  const p = parseExport(input.text, input.bytes);
  if ("problem" in p) throw new Error(p.problem);
  const { data: had, error: e1 } = await db().from("file_sources").select("id, state, fresh_days").eq("service_key", key).maybeSingle();
  if (e1) throw new Error(missing(e1.message));
  const no = uploadProblem((had?.state as ExportState | undefined) ?? null);
  if (no) throw new Error(no);
  const row = {
    name: n.name, columns: p.columns, rows: p.rows, row_count: p.rows.length, bytes: input.bytes,
    fresh_days: input.fresh === undefined || input.fresh === "" ? Number(had?.fresh_days ?? freshDays(undefined)) : freshDays(input.fresh),
    uploaded_at: new Date().toISOString(), uploaded_by: input.by.slice(0, 120),
  };
  if (had) {
    const { error } = await db().from("file_sources").update(row).eq("id", had.id).eq("state", "active");
    if (error) throw new Error(missing(error.message));
    return { name: n.name, key, rows: p.rows.length, created: false };
  }
  const { error } = await db().from("file_sources").insert({ ...row, service_key: key });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return uploadExport(input);
    throw new Error(missing(error.message));
  }
  return { name: n.name, key, rows: p.rows.length, created: true };
}

/** Removes an export and its rows (our own table only). */
export async function removeExport(id: string): Promise<string> {
  if (!UUID.test(id)) throw new Error("Unknown export.");
  const { data, error } = await db().from("file_sources").delete().eq("id", id).select("name");
  if (error) throw new Error(missing(error.message));
  if (!data?.length) throw new Error("That export isn’t there any more.");
  return data[0].name as string;
}

/**
 * The tool got a real connection (its request closed as ready, or a server for it was added): its
 * export switches over and uploads stop. Returns how many switched; never throws, so it can't stop
 * the action that called it.
 */
export async function switchExports(name: string): Promise<number> {
  const key = serviceKey(name);
  if (!key) return 0;
  const { data, error } = await db().from("file_sources").update({ state: "switched", switched_at: new Date().toISOString() }).eq("service_key", key).eq("state", "active").select("id");
  return error ? 0 : (data ?? []).length;
}
