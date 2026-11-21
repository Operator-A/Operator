import "server-only";
// Google Calendar's API for our own Calendar MCP server (card 251, docs/mcp-everywhere.md). Two calls
// only, both on the primary calendar: list events in a window, and insert one private hold. The
// list asks Google for a fixed set of fields that holds no email address, description, place or link,
// so none of those ever reach the app. The insert sends sendUpdates=none and a body fixed in
// core/calendar-rules.ts (no guests). There is no update, move or delete call. Every function takes an
// access token: integrations/mcp.ts opens the sign-in from the vault. Only integrations/calendar-server.ts
// imports this (lint enforces it).
import { holdBody, type HoldArgs } from "@/core/calendar-rules";

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TIMEOUT_MS = 25_000;
/** What Google sends back for a list: no attendee emails, descriptions, places or links. */
export const LIST_FIELDS = "timeZone,summary,items(status,summary,transparency,eventType,start,end,attendees(self,responseStatus))";

async function cal<T>(token: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`Calendar ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

/** Events on the primary calendar from `fromMs` to `toMs`, recurring ones expanded (raw; core/calendar-rules.ts readEvents reads it). */
export function listEvents(token: string, fromMs: number, toMs: number): Promise<unknown> {
  const q = new URLSearchParams({ timeMin: new Date(fromMs).toISOString(), timeMax: new Date(toMs).toISOString(), singleEvents: "true", orderBy: "startTime", maxResults: "250", fields: LIST_FIELDS });
  return cal<unknown>(token, `${BASE}?${q}`);
}

/** One private hold on the primary calendar, emailing no one. Returns Google's event id. */
export async function insertHold(token: string, a: HoldArgs): Promise<string> {
  const out = await cal<{ id?: unknown }>(token, `${BASE}?sendUpdates=none&fields=id`, holdBody(a));
  if (typeof out.id !== "string" || !out.id) throw new Error("Calendar didn't return an event id");
  return out.id;
}
