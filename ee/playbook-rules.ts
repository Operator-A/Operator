// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The shared brain, slice 5 (docs/shared-brain.md, card 235): the OPERATOR playbook's rules. Pure, so
// `npm run check:ee` can test them. A lesson is advice written by OPERATOR staff; it never carries a
// count, a percentage or an address, because figures a founder sees come from counts done in code.
import { isKind, type BusinessKind } from "@/core/brain-rules";
import { RETAIN_BATCH, kindPhrase, type Bank } from "./brain-rules";

/** Every playbook document's id starts with this; the pattern sync never touches these. */
export const PLAYBOOK_PREFIX = "play-";
export const TITLE_MAX = 80;
export const BODY_MAX = 600;

export interface Lesson { id: string; title: string; body: string; kind: BusinessKind | null }
export interface LessonInput { title: string; body: string; kind: BusinessKind | null }

/** Cleans a lesson from the form: trimmed, spaces folded, kind from the list or none. */
export function readLesson(f: { title?: unknown; body?: unknown; kind?: unknown }): LessonInput {
  const clean = (v: unknown) => (typeof v === "string" ? v : "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { title: clean(f.title).replace(/\n/g, " "), body: clean(f.body), kind: isKind(f.kind) ? f.kind : null };
}

/** What is wrong with a lesson, in words for the card, or null. */
export function lessonProblem(l: LessonInput): string | null {
  if (l.title.length < 3) return "Give the lesson a title.";
  if (l.title.length > TITLE_MAX) return `Keep the title under ${TITLE_MAX} characters.`;
  if (l.body.length < 20) return "Write a sentence or two for the lesson.";
  if (l.body.length > BODY_MAX) return `Keep the lesson under ${BODY_MAX} characters.`;
  const text = `${l.title}\n${l.body}`;
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text)) return "The lesson has a character that can't be saved.";
  if (/%|\bpercent\b/i.test(text)) return "Leave out percentages: figures founders see come from counts done in code.";
  if (/\b\d[\d,]*\s+(of|out of|in)\s+(every\s+)?\d[\d,]*\b/i.test(text)) return "Leave out counts like \"18 of 26\": figures founders see come from counts done in code.";
  if (/@|https?:|www\.|\.(com|io|co|net|org)\b/i.test(text)) return "Leave out addresses and links.";
  return null;
}

/** The document for a published lesson: its own id, so publishing again replaces it. */
export function lessonDoc(l: Lesson): { documentId: string; content: string; tags: string[]; metadata: Record<string, string> } {
  const who = l.kind ? `for ${kindPhrase(l.kind)}` : "for every business";
  return {
    documentId: `${PLAYBOOK_PREFIX}${l.id.replace(/[^a-z0-9-]/gi, "_")}`,
    content: `OPERATOR's playbook, ${who}: ${l.title}. ${l.body}`.slice(0, 900),
    tags: ["source:playbook", l.kind ? `kind:${l.kind}` : "kind:all"],
    metadata: { source: "playbook", lesson: l.id },
  };
}

/** The playbook in the bank: every published lesson, and every playbook document no longer published removed. */
export function playbookPlan(lessons: readonly Lesson[], existing: readonly string[]) {
  const retain = lessons.filter((l) => !lessonProblem(l)).map(lessonDoc);
  const keep = new Set(retain.map((d) => d.documentId));
  return { retain, remove: existing.filter((id) => id.startsWith(PLAYBOOK_PREFIX) && !keep.has(id)) };
}

/** The playbook against a bank: retain every published lesson, delete playbook documents no longer published. */
export async function syncPlaybook(bank: Bank, lessons: readonly Lesson[]): Promise<{ retained: number; removed: number }> {
  const plan = playbookPlan(lessons, await bank.documents());
  for (let i = 0; i < plan.retain.length; i += RETAIN_BATCH) await bank.retain(plan.retain.slice(i, i + RETAIN_BATCH));
  for (const id of plan.remove) await bank.remove(id);
  return { retained: plan.retain.length, removed: plan.remove.length };
}
