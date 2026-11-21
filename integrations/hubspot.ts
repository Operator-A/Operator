import "server-only";
// HubSpot, reads (card 253, docs/mcp-everywhere.md). Calls our own HubSpot server through
// integrations/mcp.ts on the agents' read key. The one write, a deal move with a note, is the gateway's
// (core/gateway, "HubSpot deal moves" key), never called here.
import { callMcpTool } from "./mcp";
import type { DealRow, HsPeriod } from "@/core/hubspot-rules";

export const hubspotDeals = async () =>
  (await callMcpTool("hubspot", "hubspot_deals", {})) as {
    deals: DealRow[]; stages: { pipeline: string; stage: string; deals: number; amount: number }[];
    totals: Record<string, number>; truncated: boolean; stage_ids: { id: string; stage: string; pipeline: string }[];
  };

export const hubspotContacts = async (period: HsPeriod) =>
  (await callMcpTool("hubspot", "hubspot_contacts", { period })) as { contacts: number; new_contacts: number; companies: number; new_companies: number; period: HsPeriod };
