import "server-only";
// How this business's agents think (card 162): its own Claude key, or OPERATOR's hosted Claude on
// credits (cloud edition only). Read once per page for setup step 1 and Connections > Claude.
import { CLAUDE_KEY_ID, mcpStatus, type McpStatus } from "@/integrations/mcp";
import { PROVIDER_BY_ID } from "@/core/model-key-rules";
import { edition, hostedClaudeReady } from "@/core/extensions";
import type { ClaudeState } from "@/core/claude-choice-rules";
import { claudeVia } from "@/core/claude-via";

/** `pre`: the Claude key's status when the caller already read every connection (getHealth, card 202). */
export async function claudeState(pre?: { status: McpStatus | null; gateway?: McpStatus | null }): Promise<ClaudeState> {
  const [st, gw] = pre ? [pre.status, pre.gateway ?? null] : await Promise.all([mcpStatus(CLAUDE_KEY_ID).catch(() => null), mcpStatus(PROVIDER_BY_ID.gateway.vaultId).catch(() => null)]);
  const ownKey = !!st?.connected;
  const ed = edition();
  // the hosted key is only asked about when a run would ask for it: no key of its own, on the cloud
  const hostedReady = !ownKey && ed === "cloud" ? await hostedClaudeReady() : false;
  const gateway = !!gw?.connected && !gw?.paused, ownKeyPaused = ownKey && !!st?.paused;
  // the choice of key matters only with both saved, and only Connections shows it (callers with `pre` don't)
  const via = !pre && gateway && ownKey && !ownKeyPaused ? await claudeVia().catch(() => "gateway" as const) : undefined;
  return { edition: ed, ownKey, ownKeyPaused, hostedReady, gateway, via };
}
