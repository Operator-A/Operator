import "server-only";
// Google Analytics, read only (card 152b, docs/mcp-everywhere.md). Calls our own GA4 server through
// integrations/mcp.ts on the "Google Analytics" sign-in, granted analytics.readonly alone. Each call
// runs one fixed report on the property the owner picked on Connections.
import { callMcpTool } from "./mcp";
import type { Ga4Period, Ga4Setup, Overview } from "@/core/ga4-rules";

export type { Overview } from "@/core/ga4-rules";

/** The properties the sign-in can see, for the owner to pick one. */
export const ga4PropertyList = async () => (await callMcpTool("ga4", "ga4_properties", {})) as { id: string; name: string; account: string }[];

export const ga4Overview = async (period: Ga4Period) => (await callMcpTool("ga4", "ga4_overview", { period })) as Overview;

export const ga4TopPages = async (period: Ga4Period, limit: number) =>
  (await callMcpTool("ga4", "ga4_top_pages", { period, limit })) as { pages: { path: string; page_views: number; sessions: number }[]; page_views_listed: number };

export const ga4Channels = async (period: Ga4Period, limit: number) =>
  (await callMcpTool("ga4", "ga4_channels", { period, limit })) as { channels: { channel: string; sessions: number; key_events: number; key_events_per_100_sessions: number }[]; sessions_listed: number };

/** How the property is set up, for the setup check (card 281). */
export const ga4Setup = async () => (await callMcpTool("ga4", "ga4_setup", {})) as Ga4Setup;
