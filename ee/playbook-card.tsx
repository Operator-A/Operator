// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Settings > Playbook (docs/shared-brain.md, card 235): shown only in the admin business, to its owners.
// OPERATOR staff write lessons here; a published lesson goes into the shared brain as OPERATOR's advice.
import "server-only";
import { requireSession } from "@/dashboard/data";
import { BUSINESS_KINDS, KIND_WORDS } from "@/core/brain-rules";
import { adminOrgId } from "./admin";
import { listLessons, type LessonRow } from "./playbook";
import { BODY_MAX, TITLE_MAX } from "./playbook-rules";
import { playbookPublish, playbookRemove, playbookSave } from "./playbook-actions";

const DONE: Record<string, string> = { saved: "Saved.", published: "Published.", unpublished: "Taken back to a draft.", removed: "Deleted." };

function LessonForm({ l }: { l?: LessonRow }) {
  const key = l?.id ?? "new";
  return (
    <form action={playbookSave} className="stack" style={{ gap: 6 }}>
      {l && <input type="hidden" name="id" value={l.id} />}
      <input className="input" id={`pb-title-${key}`} name="title" defaultValue={l?.title ?? ""} maxLength={TITLE_MAX} placeholder="Title, like: Start email with a welcome series" aria-label="Lesson title" required />
      <textarea className="input" id={`pb-body-${key}`} name="body" defaultValue={l?.body ?? ""} rows={3} maxLength={BODY_MAX} placeholder="The lesson in a few sentences. No counts, percentages or links." aria-label="Lesson" required />
      <select id={`pb-kind-${key}`} name="kind" defaultValue={l?.kind ?? ""} aria-label="Who it’s for">
        <option value="">Every business</option>
        {BUSINESS_KINDS.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
      </select>
      <button className="btn sm" style={{ alignSelf: "flex-start" }}>{l ? "Save changes" : "Add as a draft"}</button>
    </form>
  );
}

export async function PlaybookCard({ query }: { query: Readonly<Record<string, string | undefined>> }) {
  const me = await requireSession();
  if (me.orgId !== adminOrgId() || me.role !== "owner") return null;
  const lessons = await listLessons().then((rows) => ({ rows, problem: null as string | null }), (e: unknown) => ({ rows: [] as LessonRow[], problem: e instanceof Error ? e.message : String(e) }));
  const published = lessons.rows.filter((l) => l.status === "published").length;
  return (
    <div className="card" id="playbook" style={{ padding: "16px 22px", gap: 10 }}>
      <span className="card-t">Playbook</span>
      <span className="sub">
        OPERATOR&apos;s own lessons for every business, written here by OPERATOR staff. A published lesson goes into the
        shared brain as OPERATOR&apos;s advice; a draft goes nowhere. Leave out counts and percentages: figures founders see
        come from counts done in code. {published} published, {lessons.rows.length - published} drafts.
      </span>
      {query.playbook && DONE[query.playbook] && <span className="sub" style={{ color: "var(--mint-ink)" }}>{DONE[query.playbook]}{query.playbook_push === "later" ? " The shared brain gets it on the weekly sync." : ""}</span>}
      {query.playbook_problem && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{query.playbook_problem.slice(0, 200)}</span>}
      {lessons.problem && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{lessons.problem}</span>}
      {lessons.rows.map((l) => (
        <details key={l.id} style={{ fontSize: 13, borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <summary>
            <b>{l.title}</b>{" "}
            <span className="muted">· {l.kind ? KIND_WORDS[l.kind] : "Every business"} · {l.status === "published" ? "Published" : "Draft"}</span>
          </summary>
          <div className="stack" style={{ gap: 8, paddingTop: 8 }}>
            <span style={{ whiteSpace: "pre-wrap" }}>{l.body}</span>
            <span className="muted" style={{ fontSize: 12 }}>Last changed by {l.written_by}.</span>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <form action={playbookPublish}>
                <input type="hidden" name="id" value={l.id} />
                <input type="hidden" name="publish" value={l.status === "published" ? "0" : "1"} />
                <button className="btn sm">{l.status === "published" ? "Take back to draft" : "Publish"}</button>
              </form>
              <form action={playbookRemove}>
                <input type="hidden" name="id" value={l.id} />
                <button className="btn sm ghost">Delete</button>
              </form>
            </div>
            <LessonForm l={l} />
          </div>
        </details>
      ))}
      <details style={{ fontSize: 13, borderTop: "1px solid var(--line)", paddingTop: 8 }} open={!lessons.rows.length}>
        <summary className="muted">Add a lesson</summary>
        <div style={{ paddingTop: 8 }}><LessonForm /></div>
      </details>
    </div>
  );
}
