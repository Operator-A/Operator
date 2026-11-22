"use server";
// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Settings > Shared brain (docs/shared-brain.md, card 231): owners only. Off deletes the business's
// snapshot at once (core/brain.ts saveBrainSettings).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asRole } from "@/dashboard/data";
import { saveBrainSettings } from "@/core/brain";
import { isKind } from "@/core/brain-rules";

const back = (q: string): never => redirect(`/settings/brain?${q}`);

export async function saveBrain(form: FormData): Promise<void> {
  const { no } = await asRole("owner"); if (no) back(`brain_problem=${encodeURIComponent(no.text.slice(0, 200))}`);
  const kind = form.get("kind");
  try { await saveBrainSettings({ share: form.get("share") === "on", kind: isKind(kind) ? kind : null }); }
  catch (e) { back(`brain_problem=${encodeURIComponent((e instanceof Error ? e.message : String(e)).slice(0, 200))}`); }
  revalidatePath("/settings", "layout");
  back("brain=saved");
}
