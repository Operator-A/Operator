// Google Analytics 4 (card 152b, docs/mcp-everywhere.md "Google Analytics"). Pure, so `npm run
// check:mcp` can test it. Our own server (integrations/ga4-server.ts) runs one fixed report per tool
// on the one property the owner picked: the metrics, dimensions and order are written here, a tool
// takes only a period (and a row limit), and the property never comes from a tool's input. Sums and
// rates are worked out in code.
import { REPORT_PERIODS } from "@/core/mcp-rules";

export const GA4_TOOLS = ["ga4_properties", "ga4_overview", "ga4_top_pages", "ga4_channels"] as const;
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
  | { tool: "ga4_overview"; period: Ga4Period }
  | { tool: "ga4_top_pages" | "ga4_channels"; period: Ga4Period; limit: number };

/** A tool call's input, checked again on our server. Anything not named here is refused. */
export function checkGa4Args(tool: string, raw: unknown): Ga4Args | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed: Record<string, string[]> = { ga4_properties: [], ga4_overview: ["period"], ga4_top_pages: ["period", "limit"], ga4_channels: ["period", "limit"] };
  if (!(tool in allowed)) return { problem: `${tool || "that"} isn't a Google Analytics tool` };
  const extra = Object.keys(a).filter((k) => !allowed[tool].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  if (tool === "ga4_properties") return { tool };
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
export function reportBodies(a: Exclude<Ga4Args, { tool: "ga4_properties" }>): Record<string, unknown>[] {
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
