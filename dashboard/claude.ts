import "server-only";
// How this business's agents think (card 162): its own Claude key, or OPERATOR's hosted Claude on
// credits (cloud edition only). Read once per page for setup step 1 and Connections > Claude.
import { CLAUDE_KEY_ID, mcpStatus, type McpStatus } from "@/integrations/mcp";
import { edition, hostedClaudeReady } from "@/core/extensions";
import type { ClaudeState } from "@/core/claude-choice-rules";

/** `pre`: the Claude key's status when the caller already read every connection (getHealth, card 202). */
export async function claudeState(pre?: { status: McpStatus | null }): Promise<ClaudeState> {
  const st = pre ? pre.status : await mcpStatus(CLAUDE_KEY_ID).catch(() => null);
  const ownKey = !!st?.connected;
  const ed = edition();
  // the hosted key is only asked about when a run would ask for it: no key of its own, on the cloud
  const hostedReady = !ownKey && ed === "cloud" ? await hostedClaudeReady() : false;
  return { edition: ed, ownKey, ownKeyPaused: ownKey && !!st?.paused, hostedReady };
}
