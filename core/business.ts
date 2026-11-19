import "server-only";
// The business's own words (core/business-rules.ts), read from its row in orgs and written only
// by an owner on Settings, through the service-role helper in core/db.ts.
import { db, updateOrgRow } from "@/core/db";
import { orgId } from "@/core/tenancy";
import { UNKNOWN_BUSINESS, readBusiness, type Business } from "@/core/business-rules";
import { factsLine, isTopic, type FactState } from "@/core/setup-rules";

const cache = new Map<string, { b: Business; at: number }>();
const TTL_MS = 60_000;

/** The current org's name, about line, owner's name and known facts. Falls back to the name alone before the migration. */
export async function loadBusiness(): Promise<Business> {
  const org = await orgId();
  const hit = cache.get(org);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.b;
  let res = await db().from("orgs").select("name, about, owner_name").maybeSingle();
  if (res.error) res = await db().from("orgs").select("name").maybeSingle();
  if (res.error) { console.error("[business]", res.error.message); return UNKNOWN_BUSINESS; }
  const b = readBusiness(res.data as Record<string, unknown> | null);
  // facts from setup (card 151): known ones only; a missing table just means none yet
  const f = await db().from("business_facts").select("topic, text, state").eq("state", "known").order("created_at");
  if (!f.error) b.facts = factsLine((f.data ?? []).filter((r) => isTopic(r.topic)).map((r) => ({ topic: r.topic, text: String(r.text), state: r.state as FactState })));
  cache.set(org, { b, at: Date.now() });
  return b;
}

/** Forget the cached words, after a fact changes. */
export async function forgetBusiness(): Promise<void> { cache.delete(await orgId()); }

/** Saves the current org's words. The caller has checked the member is an owner. */
export async function saveBusiness(b: { name: string; about: string; ownerName: string }): Promise<void> {
  const org = await orgId();
  await updateOrgRow(org, { name: b.name.trim(), about: b.about.trim() || null, owner_name: b.ownerName.trim() || null });
  cache.delete(org);
}
