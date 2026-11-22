// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The shared brain, slice 3 (docs/shared-brain.md, card 232): how a counted pattern becomes one plain
// statement in the Hindsight bank. Pure, so `npm run check:ee` can test it. Words come only from lists
// in code; numbers only from the count (brain_patterns(), over the floor). Nothing else is ever sent.
import { BRAIN_FLOOR, REVEAL_COUNTS, SIMILAR_COUNTS, SIMILAR_LESSONS, isKind, patternOnAction, patternOnTopic, toolSlug, type BusinessKind, type PatternRow, type RevenueBand, type Similar, type SimilarAsk } from "@/core/brain-rules";
import { TOOL_CATEGORIES } from "@/core/tools-step-rules";
import { SHAPE_WORDS, isCampaignType } from "@/core/result-rules";

export const BANK_ID = "operator-patterns";
/** Every pattern document's id starts with this; anything else in the bank (slice 5's playbook) is never deleted by the sync. */
export const PATTERN_PREFIX = "pat-";
export const SYNC_KEY = "brain_sync";
/** A week, less an hour so a scheduler round that runs a little early still syncs. */
export const SYNC_EVERY_MS = 7 * 864e5 - 36e5;
export const STATEMENT_MAX = 300;

/** How the bank is set, from code on every sync (createBank creates or updates). */
export const BANK_SETTINGS = {
  reflectMission: "I help small businesses on OPERATOR decide what to set up and how to run it. Each memory is either a pattern counted across at least five businesses (never one business), or a lesson from OPERATOR's playbook written by OPERATOR staff (tagged source:playbook).",
  retainMission: "Keep each statement exactly as written. Each one is a pattern counted across at least five businesses, or a lesson from OPERATOR's playbook.",
  retainExtractionMode: "verbatim",
  enableObservations: false,
} as const;
export const BANK_DIRECTIVE = {
  name: "No business, no invented numbers",
  content: "Never name, guess or describe a single business. Never state a number that does not appear in a memory, and never combine memories into a new number.",
};

const KIND_PHRASE: Record<BusinessKind, string> = {
  online_store: "online stores",
  local_shop: "local shops and studios",
  food_drink: "food and drink businesses",
  services: "service businesses",
  agency: "agencies and consultancies",
  software: "software and app businesses",
  b2b_goods: "businesses selling goods to other businesses",
  creator: "creators and media businesses",
  other: "businesses",
};
/** "online stores": a kind of business in words, plural. */
export const kindPhrase = (k: BusinessKind) => KIND_PHRASE[k];
const REVENUE_PHRASE: Partial<Record<RevenueBand, string>> = {
  none: "with no revenue yet",
  under_10k: "under $10k a month",
  "10k_50k": "making $10k to $50k a month",
  "50k_250k": "making $50k to $250k a month",
  over_250k: "making over $250k a month",
};
/** Gateway action types in words. A type not here reads from its id. */
const ACTION_WORDS: Record<string, string> = {
  "mercury.annotate_transaction": "receipt, category and memo updates in Mercury",
  "gmail.create_draft": "Gmail drafts to leads",
  "klaviyo.campaign_draft": "Klaviyo campaign drafts",
  "calendar.hold": "calendar holds",
  "shopify.add_tags": "Shopify order and customer tags",
  "stripe.invoice_draft": "Stripe invoice drafts",
  "mailchimp.campaign_draft": "Mailchimp campaign drafts",
  "woocommerce.order_note": "WooCommerce order notes",
  "hubspot.deal_stage": "HubSpot deal moves",
  "meta.pause_ad": "Meta ad pauses",
};
const actionWords = (type: string) => ACTION_WORDS[type] ?? `${type.replace(/[._]+/g, " ").trim()} actions`;

/** "Among online stores under $10k a month on OPERATOR". Null for a cohort not built from the lists. */
export function cohortWords(cohort: string): string | null {
  if (cohort === "all") return "Among businesses on OPERATOR";
  const m = /^kind:([a-z0-9_]+)(?:\|rev:([a-z0-9_]+))?$/.exec(cohort);
  if (!m || !isKind(m[1])) return null;
  const kind = KIND_PHRASE[m[1]];
  if (!m[2]) return `Among ${kind} on OPERATOR`;
  const rev = REVENUE_PHRASE[m[2] as RevenueBand];
  return rev ? `Among ${kind} ${rev} on OPERATOR` : null;
}

/**
 * The plain statement for one counted pattern, or null when it can't be said from the lists (or is
 * under the floor). `kits` names each starting kit's department id.
 */
export function statementOf(r: PatternRow, kits: Readonly<Record<string, string>>): string | null {
  if (r.orgs < BRAIN_FLOOR || r.hits < BRAIN_FLOOR || r.hits > r.orgs) return null;
  const who = cohortWords(r.cohort);
  if (!who) return null;
  const parts = r.pattern.split(":");
  if (parts.length > 3) return null;
  const [kind, a, b] = parts;
  if (kind === "tool" && a && b) {
    const part = TOOL_CATEGORIES.find((c) => c.id === a);
    const tool = part?.tools.find((t) => toolSlug(t.name) === b);
    if (!part || !tool) return null;
    return `${who}, ${r.hits} of ${r.orgs} use ${tool.name} for ${part.area.toLowerCase()}.`;
  }
  if (kind === "dept" && a && !b) {
    const name = kits[a];
    return name ? `${who}, ${r.hits} of ${r.orgs} that are 60 or more days in run a ${name} department.` : null;
  }
  if (kind === "action" && a && !b) {
    if (r.num === null || r.den === null || r.den <= 0 || r.num < 0 || r.num > r.den) return null;
    return `${who}, ${r.orgs} businesses decided ${r.den} ${actionWords(a)} in the last 30 days, and ${Math.round((r.num / r.den) * 100)}% went through unedited.`;
  }
  if (kind === "level" && a && !b) {
    return `${who}, ${r.hits} of ${r.orgs} that used ${actionWords(a)} earned enough trust to let them act with an undo window or on their own.`;
  }
  if (kind === "result" && a && b) {
    const shape = SHAPE_WORDS[b];
    if (!isCampaignType(a) || !shape) return null;
    return `${who}, ${r.hits} of ${r.orgs} that sent ${actionWords(a)} with ${shape} usually saw opens of 35% or more.`;
  }
  return null;
}

/** What a statement may hold: list words, the counted numbers, a $ and a %. Returns what is wrong, or null. */
export function statementProblem(text: string): string | null {
  if (!text || text.length > STATEMENT_MAX) return "too long";
  if (!/^[A-Za-z0-9 ,.$%'()-]+$/.test(text)) return "a character that no list word uses";
  if (/@|https?:|www\./i.test(text)) return "an address";
  return null;
}

/** The document id for a pattern: stable, so retaining it again replaces it. */
export const docIdOf = (r: Pick<PatternRow, "cohort" | "pattern">) => `${PATTERN_PREFIX}${r.cohort}--${r.pattern}`.replace(/\|/g, "--").replace(/[^a-z0-9_.:-]/g, "_");
/** Tags for recall: the cohort and the kind of pattern. */
export function tagsOf(r: Pick<PatternRow, "cohort" | "pattern">): string[] {
  const tags = [`cohort:${r.cohort}`, `pattern:${r.pattern.split(":")[0]}`];
  const kind = /^kind:([a-z0-9_]+)/.exec(r.cohort)?.[1];
  if (kind) tags.push(`kind:${kind}`);
  return tags;
}

export interface Retain { documentId: string; content: string; tags: string[]; metadata: Record<string, string> }

/** This week's sync: one document per pattern that can be said, and every older pattern document that is no longer counted. */
export function syncPlan(rows: readonly PatternRow[], existing: readonly string[], kits: Readonly<Record<string, string>>): { retain: Retain[]; remove: string[] } {
  const retain: Retain[] = [];
  for (const r of rows) {
    const content = statementOf(r, kits);
    if (!content || statementProblem(content)) continue;
    retain.push({ documentId: docIdOf(r), content, tags: tagsOf(r), metadata: { cohort: r.cohort, pattern: r.pattern } });
  }
  const keep = new Set(retain.map((x) => x.documentId));
  return { retain, remove: existing.filter((id) => id.startsWith(PATTERN_PREFIX) && !keep.has(id)) };
}

/** Whether a week has passed since the last sync (none yet: yes). */
export const syncDue = (lastAt: string | null, now: number) => !lastAt || !Number.isFinite(Date.parse(lastAt)) || now - Date.parse(lastAt) >= SYNC_EVERY_MS;

/** Documents per retain call; Hindsight processes each batch in the background, so a sync fits in a scheduler round. */
export const RETAIN_BATCH = 50;

/** What the sync needs from Hindsight, so check:ee can run it against a fake bank. */
export interface Bank {
  setBank(): Promise<void>;
  directives(): Promise<string[]>;
  addDirective(name: string, content: string): Promise<void>;
  documents(): Promise<string[]>;
  /** Up to RETAIN_BATCH documents in one call, processed by Hindsight in the background. */
  retain(docs: readonly { documentId: string; content: string; tags: string[]; metadata: Record<string, string> }[]): Promise<void>;
  remove(documentId: string): Promise<void>;
}

/** One sync against a bank: set the bank, add the directive once, retain every pattern, delete the rest. */
export async function syncWith(bank: Bank, rows: readonly PatternRow[], kits: Readonly<Record<string, string>>): Promise<{ retained: number; removed: number }> {
  await bank.setBank();
  if (!(await bank.directives()).includes(BANK_DIRECTIVE.name)) await bank.addDirective(BANK_DIRECTIVE.name, BANK_DIRECTIVE.content);
  const plan = syncPlan(rows, await bank.documents(), kits);
  for (let i = 0; i < plan.retain.length; i += RETAIN_BATCH) await bank.retain(plan.retain.slice(i, i + RETAIN_BATCH));
  for (const id of plan.remove) await bank.remove(id);
  return { retained: plan.retain.length, removed: plan.remove.length };
}

/** The cohorts a business counts under, most specific first: kind and revenue band, then kind, then every business. */
export function cohortsFor(kind: BusinessKind | null, revenue: RevenueBand): string[] {
  if (!kind) return ["all"];
  return [...(REVENUE_PHRASE[revenue] ? [`kind:${kind}|rev:${revenue}`] : []), `kind:${kind}`, "all"];
}

/** Tags a recall is limited to: this kind's patterns and lessons, and those for every business. */
export const recallTags = (kind: BusinessKind | null) => (kind ? [`kind:${kind}`, "kind:all", "cohort:all"] : ["kind:all", "cohort:all"]);

/**
 * What Avery is given (slice 4, card 233). Hindsight only orders what fits (`ranked`, document ids,
 * best first; null when it can't be asked); every count is said again by code from the live count, so
 * one that has fallen under the floor is dropped, and every lesson is the playbook table's own text.
 * Each pattern shows once, for the most specific cohort the business is in.
 */
export function pickSimilar(o: {
  ask: SimilarAsk; rows: readonly PatternRow[]; lessons: readonly { id: string; title: string; body: string; kind: BusinessKind | null }[];
  kits: Readonly<Record<string, string>>; ranked: readonly string[] | null;
}): Similar {
  const cohorts = cohortsFor(o.ask.kind, o.ask.revenue);
  const rank = new Map((o.ranked ?? []).map((id, i) => [id, i]));
  const best = new Map<string, PatternRow>();
  for (const r of o.rows) {
    const at = cohorts.indexOf(r.cohort);
    const on = o.ask.action ? patternOnAction(r.pattern, o.ask.action) : patternOnTopic(r.pattern, o.ask.topic);
    if (at < 0 || !on || !statementOf(r, o.kits)) continue;
    const had = best.get(r.pattern);
    if (!had || at < cohorts.indexOf(had.cohort)) best.set(r.pattern, r);
  }
  const order = (id: string, fallback: number) => (rank.has(id) ? rank.get(id)! : 1e6 + fallback);
  const counts = [...best.values()]
    .sort((a, b) => order(docIdOf(a), -a.hits / a.orgs) - order(docIdOf(b), -b.hits / b.orgs) || b.orgs - a.orgs)
    .slice(0, o.ask.many ? REVEAL_COUNTS : SIMILAR_COUNTS)
    .map((r) => ({ statement: statementOf(r, o.kits)!, cohort: r.cohort, pattern: r.pattern, orgs: r.orgs, hits: r.hits }));
  // a lesson carries no topic: with Hindsight, only the lessons it found for this topic; without, this kind's first
  const lessons = o.lessons.filter((l) => (!l.kind || l.kind === o.ask.kind) && (!o.ranked || rank.has(`play-${l.id}`)));
  const playbook = lessons
    .map((l, i) => ({ l, at: order(`play-${l.id}`, (l.kind ? 0 : 1000) + i) }))
    .sort((a, b) => a.at - b.at)
    .slice(0, SIMILAR_LESSONS)
    .map(({ l }) => ({ title: l.title, lesson: l.body, for: l.kind ? KIND_PHRASE[l.kind] : "every business" }));
  return { counts, playbook };
}
