// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The shared brain, slice 3 (docs/shared-brain.md, card 232): the only file that talks to Hindsight.
// Once a week it reads the totals across businesses (brainPatterns in core/db.ts, over the floor only),
// turns each into one plain statement (ee/brain-rules.ts) and keeps the bank exactly that: one document
// per pattern, replaced each week, and every pattern no longer counted deleted for good.
import "server-only";
import { HindsightClient } from "@vectorize-io/hindsight-client";
import { brainPatterns, db } from "@/core/db";
import { withOrg } from "@/core/tenancy";
import { TEMPLATES } from "@/core/templates";
import { adminOrgId } from "./admin";
import { BANK_ID, BANK_SETTINGS, SYNC_KEY, pickSimilar, recallTags, syncDue, syncWith, type Bank } from "./brain-rules";
import { topicWords, type Similar, type SimilarAsk } from "@/core/brain-rules";
import { syncPlaybook } from "./playbook-rules";
import { publishedLessons } from "./playbook";

const url = () => process.env.HINDSIGHT_API_URL?.trim() ?? "";
const key = () => process.env.HINDSIGHT_API_KEY?.trim() ?? "";
/** Both settings are there: the shared brain can sync. */
export const hindsightReady = () => /^https:\/\//.test(url()) && key().length > 0;

function hindsightBank(): Bank {
  const c = new HindsightClient({ baseUrl: url(), apiKey: key(), userAgent: "operator-shared-brain" });
  return {
    async setBank() { await c.createBank(BANK_ID, { ...BANK_SETTINGS }); },
    async directives() { return (await c.listDirectives(BANK_ID, { limit: 100 })).items.map((d) => d.name); },
    async addDirective(name, content) { await c.createDirective(BANK_ID, name, content, { priority: 10 }); },
    async documents() {
      const ids: string[] = [];
      for (let offset = 0; offset < 20_000; offset += 200) {
        const page = await c.listDocuments(BANK_ID, { limit: 200, offset });
        ids.push(...page.items.map((d) => d.id));
        if (page.items.length < 200) break;
      }
      return ids;
    },
    async retain(docs) {
      await c.retainBatch(BANK_ID, docs.map((d) => ({ content: d.content, document_id: d.documentId, tags: d.tags, metadata: d.metadata, update_mode: "replace" as const })), { async: true });
    },
    async remove(id) { await c.deleteDocument(BANK_ID, id); },
  };
}

/** The kits' department names by id, from the templates in code. */
export const kitNames = (): Record<string, string> => Object.fromEntries(TEMPLATES.flatMap((t) => t.departments.map((d) => [d.id, d.name])));

/**
 * The weekly sync (the afterSchedule slot, once per scheduler round). Does nothing without both
 * Hindsight settings and an admin business (where the last sync is kept), or before a week has passed.
 */
export async function syncBrain(now: number): Promise<string> {
  const admin = adminOrgId();
  if (!hindsightReady() || !admin) return "off";
  return withOrg(admin, async () => {
    const { data } = await db().from("policies").select("value_json").eq("key", SYNC_KEY).maybeSingle();
    const last = (data as { value_json?: { at?: unknown } } | null)?.value_json?.at;
    if (!syncDue(typeof last === "string" ? last : null, now)) return "not due";
    // the time is kept first, so a sync that fails partway waits a week rather than retrying every round
    const { error } = await db().from("policies").upsert({ key: SYNC_KEY, value_json: { at: new Date(now).toISOString() }, updated_at: new Date(now).toISOString() });
    if (error) throw new Error(error.message);
    const bank = hindsightBank();
    const r = await syncWith(bank, await brainPatterns(), kitNames());
    const p = await syncPlaybook(bank, (await publishedLessons()) ?? []);
    return `patterns: retained ${r.retained}, removed ${r.removed}; playbook: retained ${p.retained}, removed ${p.removed}`;
  });
}

/**
 * Puts the published playbook in the bank now (after a lesson is published, changed, taken back or
 * deleted on Settings > Playbook). Without the Hindsight settings it does nothing; the weekly sync
 * does the same again, so a push that fails is put right within a week.
 */
export async function pushPlaybook(): Promise<"off" | "pushed"> {
  if (!hindsightReady()) return "off";
  const bank = hindsightBank();
  await bank.setBank();
  await syncPlaybook(bank, (await publishedLessons()) ?? []);
  return "pushed";
}

/**
 * Businesses like this one (slice 4, card 233), for Avery's tool, asked as the current business. Hindsight
 * is searched with the topic's words from code and this kind's tags, and only orders what fits; code says
 * every count again from the live count (brainPatterns, over the floor) and gives each lesson's text from
 * the playbook table. Without Hindsight, or if it fails, code orders them itself. Nothing the business
 * wrote is sent anywhere.
 */
export async function similarBusinesses(ask: SimilarAsk): Promise<Similar | null> {
  const [rows, lessons] = await Promise.all([brainPatterns(), publishedLessons().then((l) => l ?? [])]);
  let ranked: string[] | null = null;
  if (hindsightReady()) {
    try {
      const c = new HindsightClient({ baseUrl: url(), apiKey: key(), userAgent: "operator-shared-brain" });
      const r = await c.recall(BANK_ID, topicWords(ask.topic), { tags: recallTags(ask.kind), tagsMatch: "any_strict", maxTokens: 2048, budget: "low" });
      const ids = [...new Set(r.results.map((x) => x.document_id).filter((d): d is string => typeof d === "string"))];
      ranked = ids.length ? ids : null;
    } catch { ranked = null; }
  }
  return pickSimilar({ ask, rows, lessons, kits: kitNames(), ranked });
}
