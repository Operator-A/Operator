// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The shared brain, slice 5 (docs/shared-brain.md, card 235): the OPERATOR playbook's lessons. They are
// rows of the admin business (ee/admin.ts), read and written only as that business; no other business
// reads them from the database. Published lessons reach other businesses only through the Hindsight
// bank (ee/brain.ts), as OPERATOR's advice.
import "server-only";
import { db } from "@/core/db";
import { withOrg } from "@/core/tenancy";
import { isKind } from "@/core/brain-rules";
import { adminOrgId } from "./admin";
import { howToOf, lessonProblem, type HowToFields, type Lesson, type LessonInput } from "./playbook-rules";
import { hasCheck, type CheckTile, type SetupHowTo } from "@/core/setup-check-rules";

export const PLAYBOOK_MISSING = "The playbook table isn’t in Supabase yet: apply the migration 20261227090000_ee_playbook.sql.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface LessonRow extends Lesson { status: "draft" | "published"; written_by: string; updated_at: string }

/** Runs `fn` as the admin business; nothing happens without one. */
function asAdmin<T>(fn: () => Promise<T>): Promise<T> {
  const admin = adminOrgId();
  if (!admin) return Promise.reject(new Error("The playbook belongs to the admin business, and none is set on this deployment."));
  return withOrg(admin, fn);
}
const fail = (message: string): never => { throw new Error(/ee_playbook_lessons|relation|schema cache/.test(message) ? PLAYBOOK_MISSING : message); };
const howToRow = (r: Record<string, unknown>): HowToFields | null =>
  hasCheck(r.setup_tile) && typeof r.setup_topic === "string" && typeof r.help_url === "string"
    ? { tile: r.setup_tile, topic: r.setup_topic, steps: Array.isArray(r.steps) ? r.steps.map(String) : [], help_url: r.help_url } : null;
const row = (r: Record<string, unknown>): LessonRow => ({
  id: String(r.id), title: String(r.title), body: String(r.body), kind: isKind(r.kind) ? r.kind : null, howTo: howToRow(r),
  status: r.status === "published" ? "published" : "draft", written_by: String(r.written_by), updated_at: String(r.updated_at),
});

/** Every lesson, newest first, for Settings > Playbook. */
export const listLessons = () => asAdmin(async () => {
  const { data, error } = await db().from("ee_playbook_lessons").select("id, title, body, kind, status, written_by, updated_at, setup_tile, setup_topic, steps, help_url").order("updated_at", { ascending: false }).limit(200);
  if (error) fail(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(row);
});

/** The published lessons, for the bank. Null when there is no admin business. */
export async function publishedLessons(): Promise<Lesson[] | null> {
  if (!adminOrgId()) return null;
  return (await listLessons()).filter((l) => l.status === "published").map(({ id, title, body, kind, howTo }) => ({ id, title, body, kind, howTo }));
}

/**
 * Card 285, the setupHowTos slot: published how-tos for one tool's setup check, read as the admin business
 * and checked again by the setup check's rules. Staff words only. Empty with no admin business.
 */
export async function setupHowTos(tile: CheckTile): Promise<SetupHowTo[]> {
  if (!adminOrgId()) return [];
  const lessons = (await publishedLessons()) ?? [];
  return lessons.filter((l) => l.howTo?.tile === tile).flatMap((l) => { const h = howToOf(l); return h && "howTo" in h ? [h.howTo] : []; });
}

/** Adds a lesson (as a draft) or changes one; a change to a published lesson stays published. */
export const saveLesson = (l: LessonInput, by: string, id: string | null) => asAdmin(async () => {
  const problem = lessonProblem(l);
  if (problem) throw new Error(problem);
  const now = new Date().toISOString();
  // card 285: the how-to's fields as the setup check's rules read them, or all empty
  const h = howToOf(l);
  const how = h && "howTo" in h ? { setup_tile: h.howTo.tile, setup_topic: h.howTo.topic, steps: h.howTo.steps, help_url: h.howTo.help_url } : { setup_tile: null, setup_topic: null, steps: [], help_url: null };
  if (id) {
    if (!UUID.test(id)) throw new Error("That lesson isn’t here.");
    const { error } = await db().from("ee_playbook_lessons").update({ title: l.title, body: l.body, kind: l.kind, ...how, written_by: by, updated_at: now }).eq("id", id);
    if (error) fail(error.message);
    return id;
  }
  const { data, error } = await db().from("ee_playbook_lessons").insert({ title: l.title, body: l.body, kind: l.kind, ...how, written_by: by }).select("id").single();
  if (error) fail(error.message);
  return String((data as { id: string }).id);
});

/** Publishes a lesson or takes it back to a draft. */
export const setPublished = (id: string, published: boolean) => asAdmin(async () => {
  if (!UUID.test(id)) throw new Error("That lesson isn’t here.");
  const now = new Date().toISOString();
  const { error } = await db().from("ee_playbook_lessons").update({ status: published ? "published" : "draft", published_at: published ? now : null, updated_at: now }).eq("id", id);
  if (error) fail(error.message);
});

/** Deletes a lesson for good (the bank drops it on the next push). */
export const removeLesson = (id: string) => asAdmin(async () => {
  if (!UUID.test(id)) throw new Error("That lesson isn’t here.");
  const { error } = await db().from("ee_playbook_lessons").delete().eq("id", id);
  if (error) fail(error.message);
});
