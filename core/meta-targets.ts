// The owner's Meta Ads cost targets (card 255), read from policies rows for the current org. Set on
// Connections (Meta Ads pauses) by an owner; read by the Meta Ads results tool to mark ads over target,
// and by the gateway right before a pause. Agents never set them.
import { db } from "@/core/db";
import { RESULT_KINDS, TARGET_KEYS, readTarget, type MetaResult } from "@/core/meta-rules";

export async function metaTargets(): Promise<Record<MetaResult, number | null>> {
  const { data } = await db().from("policies").select("key, value_json").in("key", Object.values(TARGET_KEYS));
  const by = new Map(((data ?? []) as { key: string; value_json: unknown }[]).map((r) => [r.key, r.value_json]));
  return Object.fromEntries(RESULT_KINDS.map((k) => [k, readTarget(by.get(TARGET_KEYS[k]))])) as Record<MetaResult, number | null>;
}
