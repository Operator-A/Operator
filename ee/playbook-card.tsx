// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Settings > Playbook (docs/shared-brain.md, card 235): shown only in the admin business, to its owners.
// OPERATOR staff write lessons here; a published lesson goes into the shared brain as OPERATOR's advice.
import "server-only";
import { requireSession } from "@/dashboard/data";
import { BUSINESS_KINDS, KIND_WORDS } from "@/core/brain-rules";
import { adminOrgId } from "./admin";
import { listLessons, type LessonRow } from "./playbook";
import { BODY_MAX, TITLE_MAX } from "./playbook-rules";
import { playbookRemove, playbookSave } from "./playbook-actions";

const DONE: Record<string, string> = { saved: "Saved.", published: "Published.", unpublished: "Taken back to a draft.", removed: "Deleted." };

/** One lesson's editor: labeled fields, then Save, Publish (or Take back to draft) and Delete. Publish saves the edits first. */
function LessonForm({ l }: { l?: LessonRow }) {
  const key = l?.id ?? "new";
  const published = l?.status === "published";
  return (
    <form action={playbookSave} className="set-editor">
      {l && <input type="hidden" name="id" value={l.id} />}
      <label className="set-field">Title
        <input className="input" id={`pb-title-${key}`} name="title" defaultValue={l?.title ?? ""} maxLength={TITLE_MAX} placeholder="Like: Start email with a welcome series" required />
      </label>
      <label className="set-field">Lesson
        <textarea className="input" id={`pb-body-${key}`} name="body" defaultValue={l?.body ?? ""} rows={4} maxLength={BODY_MAX} placeholder="The lesson in a few sentences." required />
        <span className="muted set-hint">A few sentences. No counts, percentages or links: figures founders see come from counts done in code.</span>
      </label>
      <div className="row wrap" style={{ justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
        <label className="set-field">Who it’s for
          <select className="input" id={`pb-kind-${key}`} name="kind" defaultValue={l?.kind ?? ""} style={{ minWidth: 200 }}>
            <option value="">Every business</option>
            {BUSINESS_KINDS.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
          </select>
        </label>
        <span className="row wrap" style={{ gap: 8 }}>
          {l && <button className="btn sm" formAction={playbookRemove} formNoValidate style={{ background: "transparent", color: "var(--red-ink)" }}>Delete</button>}
          <button className="btn outline sm">{l ? "Save" : "Save as a draft"}</button>
          <button className="btn dark sm" name="then" value={published ? "unpublish" : "publish"}>{published ? "Take back to draft" : l ? "Publish" : "Save and publish"}</button>
        </span>
      </div>
    </form>
  );
}

const chip = (text: string, look: "plain" | "on" | "draft") => (
  <span className="pill sm" style={look === "on" ? { background: "var(--mint-soft)", color: "var(--mint-ink)" } : look === "draft" ? { background: "var(--yel-soft)", color: "var(--yel-ink)" } : { background: "var(--soft)", color: "var(--ink2)", fontWeight: 500 }}>{text}</span>
);

export async function PlaybookCard({ query }: { query: Readonly<Record<string, string | undefined>> }) {
  const me = await requireSession();
  if (me.orgId !== adminOrgId() || me.role !== "owner") return null;
  const lessons = await listLessons().then((rows) => ({ rows, problem: null as string | null }), (e: unknown) => ({ rows: [] as LessonRow[], problem: e instanceof Error ? e.message : String(e) }));
  const published = lessons.rows.filter((l) => l.status === "published").length;
  return (
    <div className="card set-card pad" id="playbook">
      <details className="set-fold" open={!lessons.rows.length}>
        <summary className="row" style={{ justifyContent: "space-between", gap: 16 }}>
          <span className="set-row-k">
            <span className="card-t">Playbook</span>
            <span className="sub">OPERATOR’s own lessons for every business, written by OPERATOR staff. A published lesson goes into the shared brain as advice; a draft goes nowhere. {published} published, {lessons.rows.length - published} {lessons.rows.length - published === 1 ? "draft" : "drafts"}.</span>
          </span>
          <span className="btn dark sm" style={{ flex: "none" }}>Add a lesson</span>
        </summary>
        <div style={{ paddingTop: 12 }}><LessonForm /></div>
      </details>
      {query.playbook && DONE[query.playbook] && <span className="sub" style={{ color: "var(--mint-ink)" }}>{DONE[query.playbook]}{query.playbook_push === "later" ? " The shared brain gets it on the weekly sync." : ""}</span>}
      {query.playbook_problem && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{query.playbook_problem.slice(0, 200)}</span>}
      {lessons.problem && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{lessons.problem}</span>}
      <div>
        {lessons.rows.map((l) => (
          <details key={l.id} className="set-fold">
            <summary className="set-list-row">
              <span className="set-list-t">{l.title}</span>
              {chip(l.kind ? KIND_WORDS[l.kind] : "Every business", "plain")}
              {l.status === "published" ? chip("Published", "on") : chip("Draft", "draft")}
              <span className="btn ghost sm">Edit</span>
            </summary>
            <span className="muted set-hint" style={{ display: "block", padding: "0 0 8px" }}>Last changed by {l.written_by}.</span>
            <LessonForm l={l} />
          </details>
        ))}
      </div>
    </div>
  );
}
