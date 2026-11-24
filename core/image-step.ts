import "server-only";
// Runs one Make an image step (chains slice 4, docs/chains.md) inside withRun: one picture on the business's own key,
// kept privately in OPERATOR for that business, cost worked out in code from the provider's counts. The rules are in
// core/image-rules.ts. The picture is never posted, sent or attached anywhere: a later step gets only a line about it.
import { db } from "@/core/db";
import { orgId } from "@/core/tenancy";
import { costOf, imageExpires, imageModel, imagePath, imagePrompt, madeWords, type ImageFacts, type Img } from "@/core/image-rules";
import type { RunResult } from "@/core/runs";
import { imageClient, type ImageClient } from "@/integrations/llm";

export const IMAGE_BUCKET = "chain-images";

export async function runImage(i: Img, facts: ImageFacts | null, runId: string, chainKey: string, client?: ImageClient): Promise<RunResult> {
  const m = imageModel(i.model);
  if (!m) return { status: "skipped", summary: `Make an image: ${i.model} isn’t on OPERATOR’s image model list any more. Pick another on the chain.` };
  const prompt = imagePrompt(i, facts);
  const pic = await (client ?? imageClient(m.provider)).make({ model: m.id, prompt, size: i.size, quality: i.quality });
  const cost = costOf(m, pic.usage);
  const base = { tokensIn: pic.usage.textIn, tokensOut: pic.usage.imageOut, costUsd: cost };
  const org = await orgId();
  const path = imagePath(org, runId);
  const { error: up } = await db().storage.from(IMAGE_BUCKET).upload(path, pic.bytes, { contentType: "image/png", upsert: true });
  if (up) return { ...base, status: "skipped", summary: `Make an image: the picture was made but couldn’t be kept (${up.message.slice(0, 120)}), so the chain stops here.` };
  const { error } = await db().from("chain_images").insert({
    run_id: runId, chain_key: chainKey, path, model: m.id, prompt: prompt.slice(0, 3000), size: i.size, quality: i.quality,
    cost_usd: Math.round(cost * 1e4) / 1e4, expires_at: new Date(imageExpires(Date.now())).toISOString(),
  });
  if (error) {
    await db().storage.from(IMAGE_BUCKET).remove([path]).catch(() => undefined);
    return { ...base, status: "skipped", summary: `Make an image: the picture couldn’t be recorded (${error.message.slice(0, 120)}), so the chain stops here.` };
  }
  return { ...base, status: "ok", summary: madeWords(i, m.label, true), metrics: { images: 1 } };
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
