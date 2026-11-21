// The snapshot (card 195 slice B, docs/setup.md): once a tool connects in setup, code reads a few fixed
// numbers from it and saves them as facts Avery reads on her next turn. Pure, so check:tools-step can
// test it. Every number is worked out in code from the tool's own data; no text from the tool (a product,
// merchant or page name) ever goes into a fact, so nothing untrusted reaches the directive this way.
import type { FactTopic } from "@/core/setup-rules";
import type { ToolTileId } from "@/core/tools-step-rules";

export interface SnapshotFact { topic: FactTopic; text: string }
/** At most this many facts from one tool, so a snapshot stays short and setup stays inside its free model cost. */
export const SNAPSHOT_MAX = 4;
export const SNAPSHOT_DAYS = 30;
/** The tiles that have a snapshot. Gmail has none: an inbox has no numbers worth a fact. */
export const SNAPSHOT_TILES = ["shopify", "mercury", "klaviyo", "analytics"] as const satisfies readonly ToolTileId[];
export type SnapshotTile = (typeof SNAPSHOT_TILES)[number];
export const hasSnapshot = (t: unknown): t is SnapshotTile => typeof t === "string" && (SNAPSHOT_TILES as readonly string[]).includes(t);

/** Each snapshot fact starts with this, so a new snapshot replaces the old one and the card can find them. */
export const snapshotPrefix = (toolName: string) => `From ${toolName}: `;

const ok = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const whole = (n: number) => Math.round(n).toLocaleString("en-US");
const money = (n: number) => `$${whole(n)}`;
const pct = (part: number, all: number) => (all > 0 ? Math.round((part / all) * 100) : 0);
const plural = (n: number, one: string, many = `${one}s`) => `${whole(n)} ${n === 1 ? one : many}`;

/** Shopify: the last 30 days of orders (code's own totals and repeat flags) and what waits to ship. */
export function storeFacts(orders: readonly { total: number; repeat: boolean }[], toShip: number | null): SnapshotFact[] {
  const p = snapshotPrefix("Shopify");
  const valid = orders.filter((o) => ok(o.total) && o.total >= 0);
  if (!valid.length) return [{ topic: "sells", text: `${p}no orders in the last ${SNAPSHOT_DAYS} days` }];
  const revenue = valid.reduce((t, o) => t + o.total, 0);
  const out: SnapshotFact[] = [
    { topic: "sells", text: `${p}${plural(valid.length, "order")} and ${money(revenue)} in the last ${SNAPSHOT_DAYS} days, ${money(revenue / valid.length)} on average` },
    { topic: "customers", text: `${p}${pct(valid.filter((o) => o.repeat).length, valid.length)}% of those orders came from repeat customers` },
  ];
  if (ok(toShip) && toShip > 0) out.push({ topic: "other", text: `${p}${plural(toShip, "order")} waiting to ship` });
  return out;
}

/** Mercury: the burn-rate numbers code already works out (cash, money out and in per 30 days, runway). */
export function bankFacts(n: Record<string, number>): SnapshotFact[] {
  const p = snapshotPrefix("Mercury");
  const out: SnapshotFact[] = [];
  if (ok(n.cash_usd)) out.push({ topic: "other", text: `${p}${money(n.cash_usd)} cash across the business accounts` });
  if (ok(n.spend_per_30d_usd) && ok(n.income_per_30d_usd)) out.push({ topic: "other", text: `${p}about ${money(n.spend_per_30d_usd)} goes out and ${money(n.income_per_30d_usd)} comes in a month` });
  if (ok(n.runway_months)) out.push({ topic: "other", text: `${p}${n.runway_months < 1 ? "less than a month" : `about ${plural(Math.floor(n.runway_months), "month")}`} of runway at that rate` });
  return out;
}

/** Klaviyo: how many lists, and the last 30 days of campaigns from Klaviyo's own counts, totals in code. */
export function emailFacts(lists: number | null, n: Record<string, number>): SnapshotFact[] {
  const p = snapshotPrefix("Klaviyo");
  const out: SnapshotFact[] = [];
  if (ok(lists)) out.push({ topic: "channels", text: `${p}${plural(lists, "email list")}` });
  if (ok(n.messages) && n.messages > 0) {
    out.push({ topic: "channels", text: `${p}${plural(n.messages, "campaign")} sent in the last ${SNAPSHOT_DAYS} days, ${whole(n.open_rate_pct ?? 0)}% opened, ${whole(n.click_rate_pct ?? 0)}% clicked` });
    if (ok(n.revenue_usd) && n.revenue_usd > 0) out.push({ topic: "sells", text: `${p}those campaigns brought in ${plural(n.orders ?? 0, "order")} and ${money(n.revenue_usd)}` });
  } else if (ok(n.messages)) out.push({ topic: "channels", text: `${p}no campaigns sent in the last ${SNAPSHOT_DAYS} days` });
  return out;
}

/** Google Analytics: the period's totals from Google's own report. */
export function siteFacts(n: Record<string, number>): SnapshotFact[] {
  const p = snapshotPrefix("Google Analytics");
  if (!ok(n.sessions)) return [];
  const out: SnapshotFact[] = [{ topic: "channels", text: `${p}${plural(n.sessions, "visit")} from ${plural(n.users ?? 0, "person", "people")} in the last ${SNAPSHOT_DAYS} days` }];
  if (ok(n.key_events)) out.push({ topic: "channels", text: `${p}${plural(n.key_events, "key event")} (sales, sign-ups and the like), ${n.key_events_per_100_sessions ?? 0} per 100 visits` });
  return out;
}

/** A snapshot as saved: at most SNAPSHOT_MAX facts, each one line of at most 160 characters. */
export const capSnapshot = (facts: readonly SnapshotFact[]): SnapshotFact[] => facts.slice(0, SNAPSHOT_MAX).map((f) => ({ ...f, text: f.text.slice(0, 160) }));
