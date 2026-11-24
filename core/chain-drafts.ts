import "server-only";
// Chains drafted from Claude (card 435): the chain_drafts rows. draft_chain (core/operator-mcp.ts) saves one; the
// Chains tab lists them, uses one through saveChain (dashboard/actions.ts) or discards it; the scheduler deletes
// old ones. A draft never changes the saved chains by itself. The rules are core/chain-draft-rules.ts.
import { db } from "@/core/db";
import type { Chain } from "@/core/flow";
import { CHAIN_DRAFT } from "@/core/chain-draft-rules";

export interface ChainDraft { id: string; key: string; chain: Chain; base: Chain | null; note: string | null; by: string; at: string }

const COLS = "id, chain_key, chain, base, note, created_by, created_at";
const rowOf = (r: Record<string, unknown>): ChainDraft => ({ id: r.id as string, key: r.chain_key as string, chain: r.chain as Chain, base: (r.base ?? null) as Chain | null, note: (r.note ?? null) as string | null, by: r.created_by as string, at: r.created_at as string });

/** Saves Claude's draft of one chain, replacing an older draft of the same chain. */
export async function saveChainDraft(chain: Chain, base: Chain | null, note: string | null, by: string, now = Date.now()): Promise<{ id: string; replaced: boolean }> {
  const { data: had } = await db().from("chain_drafts").select("id").eq("chain_key", chain.key).maybeSingle();
  if (!had) {
    const { count } = await db().from("chain_drafts").select("id", { count: "exact", head: true });
    if ((count ?? 0) >= CHAIN_DRAFT.maxWaiting) throw new Error(`${CHAIN_DRAFT.maxWaiting} chain drafts are already waiting. Use or discard some in OPERATOR first.`);
  }
  const row = { chain_key: chain.key, chain, base, note, created_by: by.slice(0, 200), created_at: new Date(now).toISOString(), expires_at: new Date(now + CHAIN_DRAFT.keepDays * 864e5).toISOString() };
  const { data, error } = await db().from("chain_drafts").upsert(row, { onConflict: "org_id,chain_key" }).select("id").single();
  if (error) throw new Error(error.message);
  return { id: data.id as string, replaced: !!had };
}

/** Every draft waiting, newest first. */
export async function listChainDrafts(): Promise<ChainDraft[]> {
  const { data, error } = await db().from("chain_drafts").select(COLS).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(CHAIN_DRAFT.maxWaiting * 2);
  if (error) throw new Error(error.message);
  return (data ?? []).map(rowOf);
}

export async function getChainDraft(id: string): Promise<ChainDraft | null> {
  const { data, error } = await db().from("chain_drafts").select(COLS).eq("id", id).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw new Error(error.message);
  return data ? rowOf(data) : null;
}

export async function dropChainDraft(id: string): Promise<void> {
  const { error } = await db().from("chain_drafts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** Deletes drafts nobody used in their 14 days (the scheduler). */
export async function pruneChainDrafts(now = Date.now()): Promise<number> {
  const { data, error } = await db().from("chain_drafts").delete().lte("expires_at", new Date(now).toISOString()).select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
