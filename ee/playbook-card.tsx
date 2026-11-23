// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Settings > Playbook (docs/shared-brain.md, card 235): shown only in the admin business, to its owners.
// OPERATOR staff write lessons here; a published lesson goes into the shared brain as OPERATOR's advice.
import "server-only";
import { requireSession } from "@/dashboard/data";
import { BUSINESS_KINDS, KIND_WORDS } from "@/core/brain-rules";
import { adminOrgId } from "./admin";
import { listLessons, type LessonRow } from "./playbook";
import { recurringGaps } from "./brain";
import { CHECKS, CHECK_TILES, MAX_STEPS, type CheckTile } from "@/core/setup-check-rules";
import { BODY_MAX, TITLE_MAX } from "./playbook-rules";
import { playbookRemove, playbookSave } from "./playbook-actions";

const DONE: Record<string, string> = { saved: "Saved.", published: "Published.", unpublished: "Taken back to a draft.", removed: "Deleted." };

/** One lesson's editor: labeled fields, then Save, Publish (or Take back to draft) and Delete. Publish saves the edits first. */
function LessonForm({ l, gap }: { l?: LessonRow; gap?: { tile: CheckTile; topic: string } }) {
  const key = l?.id ?? (gap ? `gap-${gap.tile}-${gap.topic}` : "new");
  const how = l?.howTo ?? (gap ? { tile: gap.tile, topic: gap.topic, steps: [], help_url: "" } : null);
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
      {/* card 285: a setup how-to the setup check uses instead of a web search */}
      <details className="set-fold" open={!!how}>
        <summary className="sub">Setup how-to (optional): steps the setup check gives for one gap</summary>
        <div className="stack" style={{ gap: 10, paddingTop: 8 }}>
          <div className="row wrap" style={{ gap: 12 }}>
            <label className="set-field">Tool
              <select className="input" id={`pb-tile-${key}`} name="setup_tile" defaultValue={how?.tile ?? ""} style={{ minWidth: 180 }}>
                <option value="">Not a how-to</option>
                {CHECK_TILES.map((t) => <option key={t} value={t}>{CHECKS[t].name}</option>)}
              </select>
            </label>
            <label className="set-field">Topic
              <input className="input" id={`pb-topic-${key}`} name="setup_topic" defaultValue={how?.topic ?? ""} maxLength={48} placeholder="Like: ga4.data_retention" />
            </label>
          </div>
          <label className="set-field">Steps
            <textarea className="input" id={`pb-steps-${key}`} name="steps" defaultValue={how?.steps.join("\n") ?? ""} rows={5} placeholder="One step per line, with the exact menus and buttons." />
            <span className="muted set-hint">At most {MAX_STEPS} steps, no links. The setup check gives these word for word.</span>
          </label>
          <label className="set-field">Help page
            <input className="input" id={`pb-help-${key}`} name="help_url" defaultValue={how?.help_url ?? ""} maxLength={400} placeholder="https://support.google.com/…" />
            <span className="muted set-hint">A page on the tool’s own help site.</span>
          </label>
        </div>
      </details>
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
  // card 285: gaps 5 or more businesses share, counted in the shared brain; ones with a how-to already are marked
  const gaps = await recurringGaps().catch(() => []);
  const covered = new Set(lessons.rows.flatMap((l) => (l.howTo ? [`${l.howTo.tile}:${l.howTo.topic}`] : [])));
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
      {gaps.length > 0 && (
        <details className="set-fold">
          <summary className="set-list-row"><span className="set-list-t">Setup gaps many businesses share</span>{chip(`${gaps.filter((g) => !covered.has(`${g.tile}:${g.topic}`)).length} without a how-to`, "plain")}</summary>
          <span className="muted set-hint" style={{ display: "block", padding: "0 0 8px" }}>From setup checks, counted by topic only, and only when 5 or more businesses share one. Write a how-to and the setup check gives its steps instead of searching the web.</span>
          {gaps.map((g) => (
            <details key={`${g.tile}:${g.topic}`} className="set-fold">
              <summary className="set-list-row">
                <span className="set-list-t">{CHECKS[g.tile].name}: {g.topic}</span>
                {chip(`${g.hits} of ${g.orgs} checked`, "plain")}
                {covered.has(`${g.tile}:${g.topic}`) ? chip("Has a how-to", "on") : <span className="btn ghost sm">Write a how-to</span>}
              </summary>
              {!covered.has(`${g.tile}:${g.topic}`) && <LessonForm gap={g} />}
            </details>
          ))}
        </details>
      )}
      <div>
        {lessons.rows.map((l) => (
          <details key={l.id} className="set-fold">
            <summary className="set-list-row">
              <span className="set-list-t">{l.title}</span>
              {chip(l.kind ? KIND_WORDS[l.kind] : "Every business", "plain")}
              {l.howTo && chip(`How-to: ${CHECKS[l.howTo.tile].name}`, "plain")}
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
