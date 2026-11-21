import "server-only";
// Shopify's Admin GraphQL API for our own Shopify MCP server (docs/mcp-everywhere.md, slice 7).
// Every call takes the pasted key as an argument: integrations/mcp.ts opens it from the token vault
// for each call. Only the documents listed in core/shopify-queries.ts run here, each checked to be a single
// query first, plus the fixed store actions in core/shopify-actions.ts, each checked to be one of them.
// Only integrations/shopify-server.ts imports this (lint enforces it).
import { createHash } from "node:crypto";
import { env } from "@/core/env";
import { settings } from "@/core/settings";
import { WHO, assertReadOnly, shopifyKeyKind } from "@/core/shopify-queries";
import { assertFixedMutation } from "@/core/shopify-actions";

const TIMEOUT_MS = 25_000;
// the store and the app's client id are the business's own (Settings), not the app's
const domain = async () => {
  const d = (await settings()).shopifyDomain ?? "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(d)) throw new Error("set the Shopify store (its .myshopify.com address) on Settings > Where things go");
  return d;
};

// a client secret is traded for a short-lived token (client credentials grant), kept per instance by the secret's hash
const cache = new Map<string, { token: string; exp: number }>();
async function tokenFor(key: string, fresh = false): Promise<string> {
  const kind = shopifyKeyKind(key);
  if (kind === "token") return key;
  if (kind !== "secret") throw new Error("Shopify key isn't an Admin API access token or a client secret");
  const clientId = (await settings()).shopifyClientId;
  if (!clientId) throw new Error("set the Shopify app's client id on Settings > Where things go to use a client secret");
  const h = createHash("sha256").update(key).digest("base64url");
  const c = cache.get(h);
  if (!fresh && c && c.exp > Date.now() + 60_000) return c.token;
  const res = await fetch(`https://${await domain()}/admin/oauth/access_token`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: key }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status === 400 || res.status === 401 ? 401 : res.status}: the key wasn't accepted for a token`);
  const j = await res.json() as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("Shopify 401: no token came back");
  cache.set(h, { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 });
  return j.access_token;
}

async function post<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${await domain()}/admin/api/${env.shopifyApiVersion}/graphql.json`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/json", Accept: "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  const json = await res.json() as { data?: T; errors?: unknown };
  if (json.errors) {
    const msg = Array.isArray(json.errors) ? json.errors.map((e: { message?: string }) => e.message).filter(Boolean).join("; ") : "";
    throw new Error(`Shopify GraphQL error${msg ? `: ${msg.slice(0, 200)}` : ""}`);
  }
  return json.data as T;
}

/** Runs one read query with the pasted key. A token issued earlier is renewed once if Shopify refuses it. */
export async function shopifyQuery<T>(key: string, doc: string, variables: Record<string, unknown>): Promise<T> {
  assertReadOnly(doc);
  return withRenewal(key, (token) => post<T>(token, doc, variables));
}

/** Runs one of the fixed store actions (core/shopify-actions.ts) with the pasted key. Nothing else can change the store. */
export async function shopifyMutate<T>(key: string, doc: string, variables: Record<string, unknown>): Promise<T> {
  assertFixedMutation(doc);
  return withRenewal(key, (token) => post<T>(token, doc, variables));
}

async function withRenewal<T>(key: string, run: (token: string) => Promise<T>): Promise<T> {
  try {
    return await run(await tokenFor(key));
  } catch (e) {
    if (shopifyKeyKind(key) !== "secret" || !/^Shopify 401\b|access denied/i.test(e instanceof Error ? e.message : "")) throw e;
    return run(await tokenFor(key, true));
  }
}

/** Which shop a key opens and every scope its app was granted. */
export async function whoIs(key: string): Promise<{ name: string; domain: string; scopes: string[] }> {
  const r = await shopifyQuery<{ shop: { name: string; myshopifyDomain: string }; currentAppInstallation: { accessScopes: { handle: string }[] } }>(key, WHO, {});
  return { name: r.shop.name, domain: r.shop.myshopifyDomain, scopes: r.currentAppInstallation.accessScopes.map((s) => s.handle) };
}
