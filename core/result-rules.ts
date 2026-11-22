// The shared brain, slice 4b (docs/shared-brain.md, card 234): how a campaign draft turned out, in
// bands. Pure. Code records each applied campaign draft's shape (never its words), reads its report
// once 7 days have passed since it was sent, and keeps only bands. The business's daily snapshot then
// says, per shape, whether its campaigns of that shape usually reached the good open band.

/** The action types whose results can be measured: email campaigns the owner sends. */
export const CAMPAIGN_TYPES = ["klaviyo.campaign_draft", "mailchimp.campaign_draft"] as const;
export type CampaignType = (typeof CAMPAIGN_TYPES)[number];
export const isCampaignType = (t: unknown): t is CampaignType => typeof t === "string" && (CAMPAIGN_TYPES as readonly string[]).includes(t);

/** Days after the send before the report is read, and days after the draft before it counts as not sent. */
export const CHECK_AFTER_DAYS = 7;
export const NOT_SENT_DAYS = 14;
/** How far back a business's checked campaigns count in its snapshot. */
export const RESULT_WINDOW_DAYS = 90;

export const SUBJECT_BANDS = ["short", "medium", "long"] as const;
export const BODY_BANDS = ["short", "medium", "long"] as const;
export const DAY_BANDS = ["weekday", "weekend"] as const;
export const TIME_BANDS = ["morning", "afternoon", "evening"] as const;
export const OPEN_BANDS = ["under_20", "20_35", "35_50", "50_plus"] as const;
export const CLICK_BANDS = ["under_1", "1_3", "3_plus"] as const;
export const UNSUB_BANDS = ["under_0_3", "0_3_plus"] as const;
export type OpenBand = (typeof OPEN_BANDS)[number];
/** The open bands that count as good: 35% or more. */
export const GOOD_OPENS: readonly OpenBand[] = ["35_50", "50_plus"];

export const subjectBand = (s: string) => (s.length <= 40 ? "short" : s.length <= 60 ? "medium" : "long");
export const bodyBand = (s: string) => (s.length < 600 ? "short" : s.length <= 1500 ? "medium" : "long");

/** The shape of a draft from its own arguments: lengths as bands, preview text or not. Never a word of it. */
export function shapeOf(args: Record<string, unknown>): { subject_band: string; has_preview: boolean; body_band: string } {
  const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return { subject_band: subjectBand(text(args.subject)), has_preview: text(args.preview).length > 0, body_band: bodyBand(text(args.body)) };
}

/**
 * When it was sent, as a day band and a time band. An ISO time with an offset is read in the business's
 * time zone; Klaviyo's "November 15, 2025, 17:08" is read as written. Null when it can't be read.
 */
export function sentParts(sent: string, tz: string): { at: Date; day: string; time: string } | null {
  const s = sent.trim();
  if (!s) return null;
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s);
  const at = new Date(iso ? s : `${s} UTC`);
  if (Number.isNaN(at.getTime())) return null;
  let weekday: number, hour: number;
  if (iso) {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" }).formatToParts(at);
    weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(f.find((p) => p.type === "weekday")?.value ?? "");
    hour = Number(f.find((p) => p.type === "hour")?.value);
  } else { weekday = at.getUTCDay(); hour = at.getUTCHours(); }
  if (weekday < 0 || !Number.isInteger(hour)) return null;
  return { at, day: weekday === 0 || weekday === 6 ? "weekend" : "weekday", time: hour >= 5 && hour < 12 ? "morning" : hour >= 12 && hour < 17 ? "afternoon" : "evening" };
}

/** Rates in percent of delivered (or sent), as bands. Null when nothing was delivered. */
export function resultBands(r: { delivered: number; opens: number; clicks: number; unsubscribes: number }): { open_band: OpenBand; click_band: string; unsub_band: string } | null {
  if (!(r.delivered > 0)) return null;
  const pct = (n: number) => (Math.max(0, n) / r.delivered) * 100;
  const o = pct(r.opens), c = pct(r.clicks), u = pct(r.unsubscribes);
  return {
    open_band: o < 20 ? "under_20" : o < 35 ? "20_35" : o < 50 ? "35_50" : "50_plus",
    click_band: c < 1 ? "under_1" : c < 3 ? "1_3" : "3_plus",
    unsub_band: u < 0.3 ? "under_0_3" : "0_3_plus",
  };
}

/** One recorded campaign, as campaign_results holds it. */
export interface CampaignResult {
  action_type: string;
  status: "waiting" | "sent" | "not_sent" | "checked";
  subject_band: string; has_preview: boolean; body_band: string;
  day_band: string | null; time_band: string | null; open_band: string | null;
}

/** What to do with a waiting or sent campaign on a check: wait, mark it sent, check it, or mark it not sent. */
export function nextStep(o: { createdAt: Date; sentAt: Date | null; now: Date; found: boolean }): "wait" | "sent" | "check" | "not_sent" {
  const days = (from: Date) => (o.now.getTime() - from.getTime()) / 864e5;
  if (o.sentAt) return days(o.sentAt) >= CHECK_AFTER_DAYS ? "check" : "sent";
  if (o.found) return "sent";
  return days(o.createdAt) >= NOT_SENT_DAYS ? "not_sent" : "wait";
}

/** A shape key, like subject_short: one dimension and its band. */
export const SHAPE_KEYS = [
  ...SUBJECT_BANDS.map((b) => `subject_${b}`), "preview_with", "preview_none", ...BODY_BANDS.map((b) => `body_${b}`),
  ...DAY_BANDS.map((b) => `day_${b}`), ...TIME_BANDS.map((b) => `time_${b}`),
] as const;
export const isShapeKey = (k: unknown): k is string => typeof k === "string" && (SHAPE_KEYS as readonly string[]).includes(k);

/** The words for a shape key, in a statement: "subjects of 40 characters or fewer". */
export const SHAPE_WORDS: Record<string, string> = {
  subject_short: "subjects of 40 characters or fewer", subject_medium: "subjects of 41 to 60 characters", subject_long: "subjects over 60 characters",
  preview_with: "preview text", preview_none: "no preview text",
  body_short: "short emails", body_medium: "medium-length emails", body_long: "long emails",
  day_weekday: "a weekday send", day_weekend: "a weekend send",
  time_morning: "a morning send", time_afternoon: "an afternoon send", time_evening: "an evening send",
};

function keysOf(r: CampaignResult): string[] {
  const k = [`subject_${r.subject_band}`, r.has_preview ? "preview_with" : "preview_none", `body_${r.body_band}`];
  if (r.day_band) k.push(`day_${r.day_band}`);
  if (r.time_band) k.push(`time_${r.time_band}`);
  return k.filter(isShapeKey);
}

/**
 * The snapshot's results: per campaign type and shape key, "good" when more than half of the business's
 * checked campaigns of that shape reached 35% opens or more, else "low". Only checked campaigns count.
 */
export function snapshotResults(rows: readonly CampaignResult[]): Record<string, Record<string, "good" | "low">> {
  const tally: Record<string, Record<string, { good: number; all: number }>> = {};
  for (const r of rows) {
    if (r.status !== "checked" || !isCampaignType(r.action_type) || !r.open_band) continue;
    const good = (GOOD_OPENS as readonly string[]).includes(r.open_band);
    for (const k of keysOf(r)) {
      const t = ((tally[r.action_type] ??= {})[k] ??= { good: 0, all: 0 });
      t.all++;
      if (good) t.good++;
    }
  }
  const out: Record<string, Record<string, "good" | "low">> = {};
  for (const [type, shapes] of Object.entries(tally)) {
    out[type] = {};
    for (const [k, t] of Object.entries(shapes)) out[type][k] = t.good * 2 > t.all ? "good" : "low";
  }
  return out;
}

/** The snapshot's results against the lists: what is wrong, or null. */
export function resultsProblem(r: unknown): string | null {
  if (!r || typeof r !== "object" || Array.isArray(r)) return "results isn't an object";
  for (const [type, shapes] of Object.entries(r as Record<string, unknown>)) {
    if (!isCampaignType(type)) return `${type} isn't a campaign type`;
    if (!shapes || typeof shapes !== "object" || Array.isArray(shapes)) return `${type}: not an object`;
    for (const [k, v] of Object.entries(shapes as Record<string, unknown>)) {
      if (!isShapeKey(k)) return `${type}: ${k} isn't a shape`;
      if (v !== "good" && v !== "low") return `${type}: ${k} isn't good or low`;
    }
  }
  return null;
}
