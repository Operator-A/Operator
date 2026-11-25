import "server-only";
// Runs one Make an image step (chains slice 4, docs/chains.md) inside withRun: one picture on the business's own key
// (its OpenAI key, or its AI Gateway key for gateway models),
// kept privately in OPERATOR for that business, cost worked out in code from the provider's counts. The rules are in
// core/image-rules.ts. The picture is never posted, sent or attached anywhere: a later step gets only a line about it.
import { db } from "@/core/db";
import { orgId } from "@/core/tenancy";
import { costOf, imageExpires, imageKind, imageModel, imagePath, imagePrompt, madeWords, takesQuality, type ImageFacts, type Img } from "@/core/image-rules";
import type { RunResult } from "@/core/runs";
import { imageClient, type ImageClient } from "@/integrations/llm";

export const IMAGE_BUCKET = "chain-images";

export async function runImage(i: Img, facts: ImageFacts | null, runId: string, chainKey: string, client?: ImageClient): Promise<RunResult> {
  const m = imageModel(i.model);
  if (!m) return { status: "skipped", summary: `Make an image: ${i.model} isn’t on OPERATOR’s image model list any more. Pick another on the chain.` };
  const prompt = imagePrompt(i, facts);
  const pic = await (client ?? imageClient(m.provider)).make({ model: m.id, prompt, size: i.size, ...(takesQuality(m) ? { quality: i.quality } : {}) });
  const cost = costOf(m, pic.usage, i);
  const base = { tokensIn: pic.usage.textIn, tokensOut: pic.usage.imageOut, costUsd: cost };
  // only a picture is kept: bytes that aren't PNG, JPEG or WebP stop the step
  const kind = imageKind(pic.bytes);
  if (!kind) return { ...base, status: "skipped", summary: `Make an image: ${m.label} sent back something that isn’t a picture, so nothing was kept and the chain stops here.` };
  const org = await orgId();
  const path = imagePath(org, runId, kind.ext);
  const { error: up } = await db().storage.from(IMAGE_BUCKET).upload(path, pic.bytes, { contentType: kind.type, upsert: true });
  if (up) return { ...base, status: "skipped", summary: `Make an image: the picture was made but couldn’t be kept (${up.message.slice(0, 120)}), so the chain stops here.` };
  const { error } = await db().from("chain_images").insert({
    run_id: runId, chain_key: chainKey, path, model: m.id, prompt: prompt.slice(0, 3000), size: i.size, quality: i.quality,
    cost_usd: Math.round(cost * 1e4) / 1e4, expires_at: new Date(imageExpires(Date.now())).toISOString(),
  });
  if (error) {
    await db().storage.from(IMAGE_BUCKET).remove([path]).catch(() => undefined);
    return { ...base, status: "skipped", summary: `Make an image: the picture couldn’t be recorded (${error.message.slice(0, 120)}), so the chain stops here.` };
  }
  return { ...base, status: "ok", summary: madeWords(i, m, true), metrics: { images: 1 } };
}

/** What pictures cost since a time, by model: for the AI Gateway card on Connections (conductor ticket 1). Sums in code. */
export async function imageSpend(since: number): Promise<{ model: string; usd: number; pictures: number }[]> {
  const { data, error } = await db().from("chain_images").select("model, cost_usd").gte("created_at", new Date(since).toISOString()).limit(5000);
  if (error) throw new Error(error.message);
  const by = new Map<string, { usd: number; pictures: number }>();
  for (const r of data ?? []) {
    const t = by.get(r.model as string) ?? { usd: 0, pictures: 0 };
    t.usd += Number(r.cost_usd) || 0; t.pictures += 1;
    by.set(r.model as string, t);
  }
  return [...by].map(([model, t]) => ({ model, usd: Math.round(t.usd * 1e4) / 1e4, pictures: t.pictures }));
}

/** Picture spend this month (UTC) and over the last 7 days, by model, for the AI Gateway card. */
export async function imageSpendNow(now = Date.now()): Promise<{ month: Awaited<ReturnType<typeof imageSpend>>; week: Awaited<ReturnType<typeof imageSpend>> }> {
  const m = new Date(now); m.setUTCDate(1); m.setUTCHours(0, 0, 0, 0);
  const [month, week] = await Promise.all([imageSpend(m.getTime()), imageSpend(now - 7 * 864e5)]);
  return { month, week };
}

/** A short signed link to the picture a run made, for the run page and an OK card; null when there is none. */
export async function imageLink(runId: string, seconds = 600): Promise<string | null> {
  const { data } = await db().from("chain_images").select("path").eq("run_id", runId).maybeSingle();
  if (!data?.path) return null;
  const { data: s } = await db().storage.from(IMAGE_BUCKET).createSignedUrl(data.path as string, seconds);
  return s?.signedUrl ?? null;
}

/** Deletes pictures past their 90 days (the scheduler, every 15 minutes), files first. Returns how many. */
export async function pruneImages(now = Date.now(), limit = 100): Promise<number> {
  const { data, error } = await db().from("chain_images").select("id, path").lte("expires_at", new Date(now).toISOString()).limit(limit);
  if (error) throw new Error(error.message);
  if (!data?.length) return 0;
  const { error: rm } = await db().storage.from(IMAGE_BUCKET).remove(data.map((r) => r.path as string));
  if (rm) throw new Error(rm.message);
  const { error: del } = await db().from("chain_images").delete().in("id", data.map((r) => r.id as string));
  if (del) throw new Error(del.message);
  return data.length;
}
