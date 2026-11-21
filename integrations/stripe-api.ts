import "server-only";
// Stripe's REST API (card 240). The only file that calls Stripe for a business's own account, and
// only integrations/stripe-server.ts imports it (lint and check:mcp enforce both). OPERATOR's own
// billing (ee/stripe.ts) is a different account and never reached from here. A request carrying a
// key never follows a redirect, and the API version is pinned.
import { STRIPE_BASE, STRIPE_VERSION } from "@/core/stripe-rules";

const TIMEOUT_MS = 25_000;

function headers(key: string, form = false): Record<string, string> {
  return { Authorization: `Bearer ${key}`, "Stripe-Version": STRIPE_VERSION, ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) };
}

/** A GET. `path` is fixed in core/stripe-rules.ts; `query` holds only values code made. */
export async function stripeGet(key: string, path: string, query: Record<string, string> = {}): Promise<Response> {
  const qs = new URLSearchParams(query).toString();
  return fetch(`${STRIPE_BASE}/${path}${qs ? (path.includes("?") ? "&" : "?") + qs : ""}`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS), headers: headers(key) });
}

/** A GET that must succeed, as JSON. */
export async function stripeJson(key: string, path: string, query: Record<string, string> = {}): Promise<unknown> {
  const res = await stripeGet(key, path, query);
  if (!res.ok) throw new Error(`Stripe ${res.status} on ${path.split("?")[0]}: ${await errorText(res)}`);
  return res.json();
}

/** A form POST. Only the key check (an update of an object that can't exist) and the draft invoice use it. */
export async function stripePost(key: string, path: string, body: Record<string, string>, idempotencyKey?: string): Promise<Response> {
  const h = headers(key, true);
  if (idempotencyKey) h["Idempotency-Key"] = idempotencyKey;
  return fetch(`${STRIPE_BASE}/${path}`, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS), headers: h, body: new URLSearchParams(body).toString() });
}

/** Stripe's own error message, short. */
export async function errorText(res: Response): Promise<string> {
  const j = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null;
  return String(j?.error?.message ?? res.statusText ?? "error").slice(0, 200);
}
