import "server-only";
// Meta Ads, reads (card 255, docs/mcp-everywhere.md "Meta Ads"). Calls our own Meta server through
// integrations/mcp.ts on the agents' sign-in. The one write, pausing an ad, is the gateway's
// (core/gateway, "Meta Ads pauses" sign-in), never called here.
import { callMcpTool } from "./mcp";
import type { AccountRow, AdRow, MetaPeriod, MetaResult } from "@/core/meta-rules";

export const metaAdAccounts = async () => (await callMcpTool("meta", "meta_ad_accounts", {})) as { accounts: AccountRow[] };

export const metaAdResults = async (account: string, period: MetaPeriod, result: MetaResult) =>
  (await callMcpTool("meta", "meta_ad_results", { account, period, result })) as {
    account: string; currency: string; period: MetaPeriod; result: MetaResult; truncated: boolean;
    ads: AdRow[]; totals: { ads: number; active_ads: number; spend: number; results: number; cost_per_result: number | null; active_over_target: number };
  };
