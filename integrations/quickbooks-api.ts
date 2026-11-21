import "server-only";
// The QuickBooks Online Accounting API (card 241). The only file that calls a business's QuickBooks,
// and only integrations/quickbooks-server.ts imports it (lint and check:mcp enforce both). A request
// carrying a token never follows a redirect, the minor version is pinned, and every path is one
// core/quickbooks-rules.ts wrote.
import { QBO_MINOR_VERSION } from "@/core/quickbooks-rules";

const TIMEOUT_MS = 25_000;

export interface QboConn { base: string; realm: string; token: string }

function url(c: QboConn, path: string, query: Record<string, string>): string {
  const qs = new URLSearchParams({ ...query, minorversion: QBO_MINOR_VERSION }).toString();
  return `${c.base}/${c.realm}/${path}?${qs}`;
}

/** A GET. `path` and `query` come from core/quickbooks-rules.ts qboRequest. */
export async function qboGet(c: QboConn, r: { path: string; query: Record<string, string> }): Promise<Response> {
  return fetch(url(c, r.path, r.query), { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Authorization: `Bearer ${c.token}`, Accept: "application/json" } });
}

/** A GET that must succeed, as JSON. */
export async function qboJson(c: QboConn, r: { path: string; query: Record<string, string> }): Promise<unknown> {
  const res = await qboGet(c, r);
  if (!res.ok) throw new Error(`QuickBooks ${res.status} on ${r.path.split("/")[0]}: ${await errorText(res)}`);
  return res.json();
}

/** A JSON POST. Only the categorize write (a sparse purchase update) uses it. */
export async function qboPost(c: QboConn, r: { path: string; query: Record<string, string> }, body: unknown): Promise<Response> {
  return fetch(url(c, r.path, r.query), {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${c.token}`, Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}

/** QuickBooks' own error message, short. */
export async function errorText(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { Fault?: { Error?: { Message?: unknown; Detail?: unknown }[] } } | null;
  const e = j?.Fault?.Error?.[0];
  return String(e?.Detail ?? e?.Message ?? res.statusText ?? "error").slice(0, 200);
}
