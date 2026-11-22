"use server";
// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Settings > Playbook (docs/shared-brain.md, card 235): owners of the admin business only. Every change
// is audited, then the published playbook is pushed to the Hindsight bank (ee/brain.ts).
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { asRole } from "@/dashboard/data";
import { audit } from "@/core/audit";
import { adminOrgId } from "./admin";
import { pushPlaybook } from "./brain";
import { readLesson } from "./playbook-rules";
import { removeLesson, saveLesson, setPublished } from "./playbook";

const back: (q: string) => never = (q) => redirect(`/settings?${q}#playbook`);
const problem: (e: unknown) => never = (e) => back(`playbook_problem=${encodeURIComponent((e instanceof Error ? e.message : String(e)).slice(0, 200))}`);
const ADMIN_ONLY = "The playbook is written in the admin business.";

/** Pushes to the bank; a push that fails is said on the card, and the weekly sync puts it right. */
async function pushed(done: string): Promise<never> {
  revalidatePath("/settings");
  try { await pushPlaybook(); } catch { back(`playbook=${done}&playbook_push=later`); }
  return back(`playbook=${done}`);
}

export async function playbookSave(form: FormData): Promise<void> {
  const { me, no } = await asRole("owner"); if (no) problem(no.text);
  if (me.orgId !== adminOrgId()) problem(ADMIN_ONLY);
  const id = String(form.get("id") ?? "") || null;
  const l = readLesson(Object.fromEntries(form));
  let saved = "";
  try { saved = await saveLesson(l, me.email, id); } catch (e) { problem(e); }
  await audit(me, id ? "playbook_edit" : "playbook_add", saved, { title: l.title.slice(0, 60), kind: l.kind ?? "all" });
  await pushed("saved");
}

export async function playbookPublish(form: FormData): Promise<void> {
  const { me, no } = await asRole("owner"); if (no) problem(no.text);
  if (me.orgId !== adminOrgId()) problem(ADMIN_ONLY);
  const id = String(form.get("id") ?? "");
  const publish = form.get("publish") === "1";
  try { await setPublished(id, publish); } catch (e) { problem(e); }
  await audit(me, publish ? "playbook_publish" : "playbook_unpublish", id);
  await pushed(publish ? "published" : "unpublished");
}

export async function playbookRemove(form: FormData): Promise<void> {
  const { me, no } = await asRole("owner"); if (no) problem(no.text);
  if (me.orgId !== adminOrgId()) problem(ADMIN_ONLY);
  const id = String(form.get("id") ?? "");
  try { await removeLesson(id); } catch (e) { problem(e); }
  await audit(me, "playbook_remove", id);
  await pushed("removed");
}
