import "server-only";
// Google Analytics' APIs for our own GA4 MCP server (card 152b, docs/mcp-everywhere.md). Two calls
// only: the properties a sign-in can see (Admin API, accountSummaries) and a report on one property
// (Data API, runReport). Both are reads; the sign-in is granted analytics.readonly alone, so Google
// refuses it anything else. Every function takes an access token: integrations/mcp.ts opens the
// sign-in from the vault. Only integrations/ga4-server.ts imports this (lint enforces it).
import { PROPERTY_ID } from "@/core/ga4-rules";

const ADMIN = "https://analyticsadmin.googleapis.com/v1beta";
const DATA = "https://analyticsdata.googleapis.com/v1beta";
const TIMEOUT_MS = 25_000;

async function ga<T>(token: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Analytics ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

/** Every account and property the sign-in can see (raw; core/ga4-rules.ts readProperties reads it). */
export const accountSummaries = (token: string) => ga<unknown>(token, `${ADMIN}/accountSummaries?pageSize=200`);

/** One report on one property. The body is fixed in code (core/ga4-rules.ts reportBodies). */
export function runReport(token: string, propertyId: string, body: Record<string, unknown>): Promise<unknown> {
  if (!PROPERTY_ID.test(propertyId)) throw new Error("not a Google Analytics property id");
  return ga<unknown>(token, `${DATA}/properties/${propertyId}:runReport`, body);
}
