import "server-only";
// Which key Claude runs on first when both are saved (Connections > Claude, decided 2026-11-25): the business's own
// row in policies, through db(). integrations/llm.ts reads it on every Claude turn that has a gateway key.
import { db } from "@/core/db";
import { CLAUDE_VIA_KEY, readClaudeVia, type ClaudeVia } from "@/core/model-key-rules";

/** The business's choice; the gateway when nothing is saved or the row can't be read. */
export async function claudeVia(): Promise<ClaudeVia> {
  const { data, error } = await db().from("policies").select("value_json").eq("key", CLAUDE_VIA_KEY).maybeSingle();
  if (error) return "gateway";
  return readClaudeVia((data as { value_json?: unknown } | null)?.value_json);
}

/** Saves the choice. The caller has checked the member is an owner. */
export async function saveClaudeVia(via: ClaudeVia): Promise<void> {
  const { error } = await db().from("policies").upsert({ key: CLAUDE_VIA_KEY, value_json: { via: via === "own" ? "own" : "gateway" }, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
