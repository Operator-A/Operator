// Google Analytics 4 (card 152b, docs/mcp-everywhere.md "Google Analytics"). Pure, so `npm run
// check:mcp` can test it. Our own server (integrations/ga4-server.ts) runs one fixed report per tool
// on the one property the owner picked: the metrics, dimensions and order are written here, a tool
// takes only a period (and a row limit), and the property never comes from a tool's input. Sums and
// rates are worked out in code.
import { REPORT_PERIODS } from "@/core/mcp-rules";

export const GA4_TOOLS = ["ga4_properties", "ga4_overview", "ga4_top_pages", "ga4_channels", "ga4_setup"] as const;
export type Ga4Tool = (typeof GA4_TOOLS)[number];
export type Ga4Period = (typeof REPORT_PERIODS)[number];

/** A GA4 property id: digits only. */
export const PROPERTY_ID = /^\d{4,15}$/;
export const MAX_ROWS = 20;

const DAYS: Record<Ga4Period, number> = { last_7_days: 7, last_30_days: 30, last_90_days: 90, last_365_days: 365 };
/** The period as GA4 dates: from N days ago through yesterday (today isn't finished). */
export const dateRange = (p: Ga4Period) => ({ startDate: `${DAYS[p]}daysAgo`, endDate: "yesterday" });

export type Ga4Args =
  | { tool: "ga4_properties" }
  | { tool: "ga4_setup" }
  | { tool: "ga4_overview"; period: Ga4Period }
  | { tool: "ga4_top_pages" | "ga4_channels"; period: Ga4Period; limit: number };

/** A tool call's input, checked again on our server. Anything not named here is refused. */
export function checkGa4Args(tool: string, raw: unknown): Ga4Args | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed: Record<string, string[]> = { ga4_properties: [], ga4_overview: ["period"], ga4_top_pages: ["period", "limit"], ga4_channels: ["period", "limit"], ga4_setup: [] };
  if (!(tool in allowed)) return { problem: `${tool || "that"} isn't a Google Analytics tool` };
  const extra = Object.keys(a).filter((k) => !allowed[tool].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  if (tool === "ga4_properties" || tool === "ga4_setup") return { tool };
  const period = (a.period ?? "last_30_days") as Ga4Period;
  if (!REPORT_PERIODS.includes(period)) return { problem: `period is one of ${REPORT_PERIODS.join(", ")}` };
  if (tool === "ga4_overview") return { tool, period };
  const limit = a.limit === undefined ? 10 : Number(a.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ROWS) return { problem: `limit is a whole number from 1 to ${MAX_ROWS}` };
  return { tool: tool as "ga4_top_pages" | "ga4_channels", period, limit };
}

const m = (...names: string[]) => names.map((name) => ({ name }));
const OVERVIEW_METRICS = ["sessions", "totalUsers", "screenPageViews", "keyEvents"];

/** The runReport bodies for a call, fixed in code. The overview is two: the period's totals, then one row a day. */
export function reportBodies(a: Exclude<Ga4Args, { tool: "ga4_properties" } | { tool: "ga4_setup" }>): Record<string, unknown>[] {
  const dateRanges = [dateRange(a.period)];
  switch (a.tool) {
    case "ga4_overview":
      return [
        { dateRanges, metrics: m(...OVERVIEW_METRICS) },
        { dateRanges, metrics: m(...OVERVIEW_METRICS), dimensions: m("date"), orderBys: [{ dimension: { dimensionName: "date" } }], limit: 400 },
      ];
    case "ga4_top_pages":
      return [{ dateRanges, metrics: m("screenPageViews", "sessions"), dimensions: m("pagePath"), orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }], limit: a.limit }];
    case "ga4_channels":
      return [{ dateRanges, metrics: m("sessions", "keyEvents"), dimensions: m("sessionDefaultChannelGroup"), orderBys: [{ metric: { metricName: "sessions" }, desc: true }], limit: a.limit }];
  }
}

const num = (v: unknown) => { const n = Number((v as { value?: unknown } | undefined)?.value); return Number.isFinite(n) ? n : 0; };
const str = (v: unknown, max = 200) => String((v as { value?: unknown } | undefined)?.value ?? "").slice(0, max);
type Report = { rows?: { dimensionValues?: unknown[]; metricValues?: unknown[] }[] };
const rowsOf = (j: unknown) => ((j ?? {}) as Report).rows ?? [];
/** Key events per 100 sessions, to one decimal, worked out here. */
export const rate = (events: number, sessions: number) => (sessions > 0 ? Math.round((events / sessions) * 1000) / 10 : 0);

/** The properties a sign-in can see, from accountSummaries. */
export function readProperties(j: unknown): { id: string; name: string; account: string }[] {
  const acc = ((j ?? {}) as { accountSummaries?: { displayName?: unknown; propertySummaries?: { property?: unknown; displayName?: unknown }[] }[] }).accountSummaries ?? [];
  return acc.flatMap((a) => (a.propertySummaries ?? []).map((p) => ({ id: String(p.property ?? "").replace(/^properties\//, ""), name: String(p.displayName ?? "").slice(0, 120), account: String(a.displayName ?? "").slice(0, 120) })))
    .filter((p) => PROPERTY_ID.test(p.id)).slice(0, 200);
}

export interface Overview {
  totals: { sessions: number; users: number; page_views: number; key_events: number; key_events_per_100_sessions: number };
  days: { date: string; sessions: number; users: number; page_views: number; key_events: number }[];
}

/** The overview from its two reports: GA4's own totals for the period (users can't be added up by day) and one row a day. */
export function readOverview(totals: unknown, daily: unknown): Overview {
  const t = rowsOf(totals)[0]?.metricValues ?? [];
  const [sessions, users, page_views, key_events] = [0, 1, 2, 3].map((i) => num(t[i]));
  const days = rowsOf(daily).map((r) => {
    const d = str(r.dimensionValues?.[0], 8);
    const v = r.metricValues ?? [];
    return { date: /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d, sessions: num(v[0]), users: num(v[1]), page_views: num(v[2]), key_events: num(v[3]) };
  });
  return { totals: { sessions, users, page_views, key_events, key_events_per_100_sessions: rate(key_events, sessions) }, days };
}

/** Top pages: each path with its views and sessions, and the share of views the list covers. */
export function readTopPages(j: unknown): { pages: { path: string; page_views: number; sessions: number }[]; page_views_listed: number } {
  const pages = rowsOf(j).map((r) => ({ path: str(r.dimensionValues?.[0]), page_views: num(r.metricValues?.[0]), sessions: num(r.metricValues?.[1]) }));
  return { pages, page_views_listed: pages.reduce((s, p) => s + p.page_views, 0) };
}

/** Channels: sessions and key events from each of Google's default channel groups. */
export function readChannels(j: unknown): { channels: { channel: string; sessions: number; key_events: number; key_events_per_100_sessions: number }[]; sessions_listed: number } {
  const channels = rowsOf(j).map((r) => { const s = num(r.metricValues?.[0]), k = num(r.metricValues?.[1]); return { channel: str(r.dimensionValues?.[0], 60), sessions: s, key_events: k, key_events_per_100_sessions: rate(k, s) }; });
  return { channels, sessions_listed: channels.reduce((s, c) => s + c.sessions, 0) };
}

// ---- The setup check's settings read (card 281, docs/setup-check.md) ----
// One wide read of how the property is set up, so the setup agent can judge it. The Admin API paths
// are fixed here (GET only, on the picked property); the two reports are fixed bodies. Every value is
// cut to a known shape: names typed by people (event names, stream hosts, traffic sources) are
// untrusted, and the catalog says so.

/** The Admin API reads, relative to properties/<id>. GET only; integrations/ga4-api.ts refuses any other. */
export const SETUP_ADMIN_PATHS = ["", "/dataRetentionSettings", "/keyEvents?pageSize=50", "/dataStreams?pageSize=50", "/googleAdsLinks?pageSize=20"] as const;
export type SetupAdminPath = (typeof SETUP_ADMIN_PATHS)[number];
export const SETUP_DAYS = 30;

/** The two reports: the last 30 days' purchases, revenue and visits, and purchases by traffic source. */
export function setupReportBodies(): Record<string, unknown>[] {
  const dateRanges = [dateRange("last_30_days")];
  return [
    { dateRanges, metrics: m("purchaseRevenue", "ecommercePurchases", "sessions") },
    { dateRanges, metrics: m("ecommercePurchases"), dimensions: m("sessionSource"), orderBys: [{ metric: { metricName: "ecommercePurchases" }, desc: true }], limit: MAX_ROWS },
  ];
}

export interface Ga4Setup {
  time_zone: string | null;
  currency: string | null;
  industry: string | null;
  /** Google's own words, like TWO_MONTHS or FOURTEEN_MONTHS. */
  data_retention: string | null;
  key_events: string[] | null;
  purchase_is_key_event: boolean | null;
  web_streams: number | null;
  app_streams: number | null;
  /** The host of each web stream's address, nothing else of it. */
  stream_hosts: string[] | null;
  google_ads_links: number | null;
  purchases_30d: number | null;
  purchase_revenue_30d: number | null;
  sessions_30d: number | null;
  /** Purchases by traffic source, with each one's share of all purchases worked out here. */
  purchase_sources: { source: string; purchases: number; share_pct: number }[] | null;
  /** The parts Google wouldn't hand over (no access, or an error), so the agent judges nothing from them. */
  unread: string[];
}

/** The keys of a settings read that a finding may name as its evidence. */
export const GA4_SETUP_KEYS = ["time_zone", "currency", "industry", "data_retention", "key_events", "purchase_is_key_event", "web_streams", "app_streams", "stream_hosts", "google_ads_links", "purchases_30d", "purchase_revenue_30d", "sessions_30d", "purchase_sources"] as const;

const word = (v: unknown, re: RegExp, max: number) => { const t = typeof v === "string" ? v.slice(0, max) : ""; return re.test(t) ? t : null; };
const listOf = (j: unknown, key: string): Record<string, unknown>[] | null => {
  if (!j || typeof j !== "object") return null;
  const v = (j as Record<string, unknown>)[key];
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
};
const hostOf = (u: unknown) => { try { const h = new URL(String(u)).hostname.toLowerCase(); return /^[a-z0-9.-]{1,100}$/.test(h) ? h : null; } catch { return null; } };

/** The settings read, from the five Admin replies and two reports (null for each that failed). */
export function readSetup(p: { property: unknown; retention: unknown; keyEvents: unknown; streams: unknown; adsLinks: unknown; totals: unknown; sources: unknown }): Ga4Setup {
  const unread: string[] = [];
  const prop = p.property && typeof p.property === "object" ? (p.property as Record<string, unknown>) : null;
  if (!prop) unread.push("time_zone", "currency", "industry");
  const ret = p.retention && typeof p.retention === "object" ? (p.retention as Record<string, unknown>) : null;
  if (!ret) unread.push("data_retention");
  const kes = listOf(p.keyEvents, "keyEvents");
  if (!kes) unread.push("key_events", "purchase_is_key_event");
  const key_events = kes ? kes.map((k) => word(k.eventName, /^[A-Za-z0-9_]{1,40}$/, 40)).filter((x): x is string => !!x).slice(0, 30) : null;
  const streams = listOf(p.streams, "dataStreams");
  if (!streams) unread.push("web_streams", "app_streams", "stream_hosts");
  const web = streams?.filter((s) => s.type === "WEB_DATA_STREAM") ?? null;
  const ads = listOf(p.adsLinks, "googleAdsLinks");
  if (!ads) unread.push("google_ads_links");
  const tRows = p.totals ? rowsOf(p.totals) : null;
  if (!tRows) unread.push("purchases_30d", "purchase_revenue_30d", "sessions_30d");
  const t = tRows?.[0]?.metricValues ?? [];
  const sRows = p.sources ? rowsOf(p.sources) : null;
  if (!sRows) unread.push("purchase_sources");
  const src = (sRows ?? []).map((r) => ({ source: str(r.dimensionValues?.[0], 60), purchases: num(r.metricValues?.[0]) })).filter((r) => r.purchases > 0);
  const allPurchases = tRows ? num(t[1]) : 0;
  return {
    time_zone: prop ? word(prop.timeZone, /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/, 60) : null,
    currency: prop ? word(prop.currencyCode, /^[A-Z]{3}$/, 3) : null,
    industry: prop ? word(prop.industryCategory, /^[A-Z_]{1,60}$/, 60) : null,
    data_retention: ret ? word(ret.eventDataRetention, /^[A-Z_]{1,40}$/, 40) : null,
    key_events,
    purchase_is_key_event: key_events ? key_events.includes("purchase") : null,
    web_streams: web ? web.length : null,
    app_streams: streams && web ? streams.length - web.length : null,
    stream_hosts: web ? [...new Set(web.map((s) => hostOf((s.webStreamData as Record<string, unknown> | undefined)?.defaultUri)).filter((h): h is string => !!h))].slice(0, 10) : null,
    google_ads_links: ads ? ads.length : null,
    purchases_30d: tRows ? num(t[1]) : null,
    purchase_revenue_30d: tRows ? Math.round(num(t[0]) * 100) / 100 : null,
    sessions_30d: tRows ? num(t[2]) : null,
    purchase_sources: sRows ? src.map((r) => ({ ...r, share_pct: allPurchases > 0 ? Math.round((r.purchases / allPurchases) * 1000) / 10 : 0 })) : null,
    unread,
  };
}
