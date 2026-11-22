import "server-only";
// Square's REST API (card 242). The only file that calls a business's Square, and only
// integrations/square-server.ts imports it (lint and check:mcp enforce both). A request carrying a
// token never follows a redirect, the API version is pinned, and every path is one
// core/square-rules.ts wrote.
import { SQUARE_VERSION, squareApi, squareError } from "@/core/square-rules";

const TIMEOUT_MS = 25_000;

/** `host` is Square's (or its sandbox's) address, chosen by code; `token` is the business's sign-in. */
export interface SquareConn { host: string; token: string }

const headers = (c: SquareConn, json: boolean): Record<string, string> => ({
  Authorization: `Bearer ${c.token}`, "Square-Version": SQUARE_VERSION, Accept: "application/json", ...(json ? { "Content-Type": "application/json" } : {}),
});

/** One request from core/square-rules.ts squareRequest. */
export async function squareFetch(c: SquareConn, r: { method: "GET" | "POST"; path: string; query?: Record<string, string>; body?: unknown }): Promise<Response> {
  const qs = r.query ? new URLSearchParams(r.query).toString() : "";
  return fetch(`${squareApi(c.host)}/${r.path}${qs ? `?${qs}` : ""}`, {
    method: r.method, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: headers(c, r.body !== undefined), ...(r.body !== undefined ? { body: JSON.stringify(r.body) } : {}),
  });
}

/** A request that must succeed, as JSON. */
export async function squareJson(c: SquareConn, r: { method: "GET" | "POST"; path: string; query?: Record<string, string>; body?: unknown }): Promise<unknown> {
  const res = await squareFetch(c, r);
  if (!res.ok) throw new Error(`Square ${res.status} on ${r.path.split("/")[0]}: ${await errorText(res)}`);
  return res.json();
}

/** What Square says this token carries (its scopes), from Square's sign-in service. */
export async function squareTokenStatus(c: SquareConn): Promise<unknown> {
  const res = await fetch(`${c.host}/oauth2/token/status`, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS), headers: headers(c, true), body: "{}" });
  if (res.status === 401) throw new Error("Square 401: the sign-in wasn't accepted");
  if (!res.ok) throw new Error(`Square ${res.status} on token status: ${await errorText(res)}`);
  return res.json();
}

/** Square's own error message, short. */
export async function errorText(res: Response): Promise<string> {
  return squareError(await res.json().catch(() => null)) || res.statusText || "error";
}
