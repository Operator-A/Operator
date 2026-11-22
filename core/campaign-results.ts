import "server-only";
// The shared brain, slice 4b (docs/shared-brain.md, card 234): how the business's campaign drafts turned
// out, in its own tables (campaign_results), through db(). The gateway records each applied draft's shape;
// once a day, before the snapshot (core/brain.ts, cloud edition), code reads the reports of campaigns the
// owner sent through the read tools the business already connected, and keeps only bands.
import { db } from "@/core/db";
import { orgTz } from "@/core/tz";
import { klaviyoReport } from "@/integrations/klaviyo";
import { mailchimpCampaigns } from "@/integrations/mailchimp";
import { RESULT_WINDOW_DAYS, nextStep, resultBands, sentParts, shapeOf, type CampaignResult, type CampaignType } from "@/core/result-rules";

const ID_RX = /^[A-Za-z0-9_-]{1,80}$/;

/** Records an applied draft's shape. Never fails the action: a missing table (before the migration) is skipped. */
export async function recordCampaign(actionId: string, type: CampaignType, externalId: string, args: Record<string, unknown>): Promise<void> {
  if (!ID_RX.test(externalId)) return;
  try {
    await db().from("campaign_results").upsert({ action_id: actionId, action_type: type, external_id: externalId, ...shapeOf(args) }, { onConflict: "org_id,action_id", ignoreDuplicates: true });
  } catch { /* the result is advice only; the draft is already in the service */ }
}

interface Open { action_id: string; action_type: CampaignType; external_id: string; status: string; sent_at: string | null; created_at: string }
interface Found { sent: string; delivered: number; opens: number; clicks: number; unsubscribes: number }

/** Reports for campaigns sent in the last 90 days, by campaign id. A service that isn't connected gives nothing. */
async function reports(types: Set<string>): Promise<Map<string, Found>> {
  const out = new Map<string, Found>();
  if (types.has("klaviyo.campaign_draft")) {
    try {
      for (const r of (await klaviyoReport("campaign", "last_90_days")).rows) if (r.id) out.set(`klaviyo.campaign_draft:${r.id}`, { sent: r.sent, delivered: r.delivered, opens: r.opens, clicks: r.clicks, unsubscribes: r.unsubscribes });
    } catch { /* not connected, or the read failed: try again tomorrow */ }
  }
  if (types.has("mailchimp.campaign_draft")) {
    try {
      for (const r of (await mailchimpCampaigns("last_90_days")).campaigns) if (r.id) out.set(`mailchimp.campaign_draft:${r.id}`, { sent: r.sent_at, delivered: r.sent, opens: r.opens, clicks: r.clicks, unsubscribes: r.unsubscribes });
    } catch { /* as above */ }
  }
  return out;
}

/** Checks the business's open campaigns. Returns what changed, for the scheduler's log. */
export async function checkCampaignResults(now = new Date()): Promise<string> {
  const { data, error } = await db().from("campaign_results").select("action_id, action_type, external_id, status, sent_at, created_at").in("status", ["waiting", "sent"]).limit(200);
  if (error) return /campaign_results/.test(error.message) ? "no table" : `failed: ${error.message.slice(0, 120)}`;
  const open = (data ?? []) as Open[];
  if (!open.length) return "nothing open";
  const tz = await orgTz();
  const found = await reports(new Set(open.map((o) => o.action_type)));
  let changed = 0;
  for (const o of open) {
    const f = found.get(`${o.action_type}:${o.external_id}`);
    const sent = f ? sentParts(f.sent, tz) : null;
    const sentAt = o.sent_at ? new Date(o.sent_at) : sent?.at ?? null;
    const step = nextStep({ createdAt: new Date(o.created_at), sentAt, now, found: !!f });
    let patch: Record<string, unknown> | null = null;
    if (step === "not_sent") patch = { status: "not_sent" };
    else if (step === "sent" && o.status !== "sent") patch = { status: "sent", sent_at: sentAt?.toISOString() ?? now.toISOString(), day_band: sent?.day ?? null, time_band: sent?.time ?? null };
    else if (step === "check" && f) {
      const b = resultBands(f);
      if (b) patch = { status: "checked", checked_at: now.toISOString(), sent_at: sentAt!.toISOString(), ...(sent ? { day_band: sent.day, time_band: sent.time } : {}), ...b };
    }
    if (!patch) continue;
    const { error: e2 } = await db().from("campaign_results").update(patch).eq("action_id", o.action_id);
    if (!e2) changed++;
  }
  return `${changed} of ${open.length} updated`;
}

/** The business's recorded campaigns from the last 90 days, for its snapshot. */
export async function recentCampaigns(now = new Date()): Promise<CampaignResult[]> {
  const since = new Date(now.getTime() - RESULT_WINDOW_DAYS * 864e5).toISOString();
  const { data, error } = await db().from("campaign_results").select("action_type, status, subject_band, has_preview, body_band, day_band, time_band, open_band").gte("created_at", since).limit(1000);
  if (error) return [];
  return (data ?? []) as CampaignResult[];
}
