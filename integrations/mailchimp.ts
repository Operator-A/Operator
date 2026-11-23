import "server-only";
// Mailchimp, reads (card 252, docs/mcp-everywhere.md). Calls our own Mailchimp server through
// integrations/mcp.ts on the agents' key. The one write, a draft campaign, is the gateway's
// (core/gateway, "Mailchimp campaign drafts" key), never called here.
import { callMcpTool } from "./mcp";
import type { Audience, CampaignRow, McAutomation, McPeriod, McSetupNumbers } from "@/core/mailchimp-rules";

export const mailchimpAudiences = async () => (await callMcpTool("mailchimp", "mailchimp_audiences", {})) as { audiences: Audience[]; members: number };

export const mailchimpCampaigns = async (period: McPeriod) =>
  (await callMcpTool("mailchimp", "mailchimp_campaigns", { period })) as { campaigns: CampaignRow[]; totals: Record<string, number> };
/** The setup check's read (card 284): settings counted in code, automation titles untrusted. */
export const mailchimpSetup = async () => (await callMcpTool("mailchimp", "mailchimp_setup", {})) as { totals: McSetupNumbers; automations: McAutomation[] | null; unread: string[] };
