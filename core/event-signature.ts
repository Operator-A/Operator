// Live events (docs/live-events.md, slice 1): checking that an event really came from the service.
// Pure apart from node:crypto: the signing secret comes in as an argument (integrations/mcp.ts opens
// it from the vault), so `npm run check:events` can test it. Every compare is constant-time.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Stripe's clock window: an event signed longer ago than this is a replay. */
export const STRIPE_TOLERANCE_S = 300;

const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

/** Whether two ids match, in constant time. */
export const sameId = (a: string, b: string) => same(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));

/** Shopify: X-Shopify-Hmac-Sha256 is the base64 HMAC-SHA256 of the raw body under the signing key. */
export function shopifySigned(raw: string, header: string | null, secret: string): boolean {
  if (!header || header.length > 100) return false;
  const want = createHmac("sha256", secret).update(raw, "utf8").digest();
  let got: Buffer;
  try { got = Buffer.from(header.trim(), "base64"); } catch { return false; }
  return same(want, got);
}

/**
 * Stripe: Stripe-Signature is `t=<seconds>,v1=<hex>[,v1=<hex>…]`, the hex HMAC-SHA256 of `<t>.<raw body>`
 * under the endpoint's signing secret. Refused outside STRIPE_TOLERANCE_S of `nowS`, so an old event
 * replayed is turned away even with a good signature.
 */
export function stripeSigned(raw: string, header: string | null, secret: string, nowS: number): boolean {
  if (!header || header.length > 1000) return false;
  let t = NaN;
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const [k, v] = part.split("=", 2).map((x) => x?.trim() ?? "");
    if (k === "t" && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/.test(v)) sigs.push(v);
  }
  if (!Number.isFinite(t) || !sigs.length || Math.abs(nowS - t) > STRIPE_TOLERANCE_S) return false;
  const want = createHmac("sha256", secret).update(`${t}.${raw}`, "utf8").digest();
  return sigs.some((s) => same(want, Buffer.from(s, "hex")));
}
