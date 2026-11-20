import type { DeptIdea } from "@/core/setup-rules";
import { ideaStart, setupIdeaWant } from "@/dashboard/setupActions";
import { ActionButton } from "./client";

/**
 * Avery's department idea (card 185, docs/setup.md): one department outside the template list that
 * Avery suggested from the setup chat, to show what else the crew could take on. On the reveal it sits
 * beside the chart, dashed, and builds nothing; Build it with Avery only puts it on the plan. After the
 * first job, the Desk offers Start with Avery, which opens a department draft with its name and purpose.
 */
export function IdeaAside({ idea, owner }: { idea: DeptIdea; owner: boolean }) {
  return (
    <aside className="wg-idea wg-pop" aria-label={`Avery's idea: ${idea.name}`} style={{ animationDelay: "1.4s" }}>
      <span className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "center", flexWrap: "nowrap" }}>
        <span className="wg-eyebrow" style={{ fontSize: 11, minWidth: 0 }}>Avery’s idea, from our chat</span>
        {idea.want && <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)", flex: "none" }}>On your plan</span>}
      </span>
      <b style={{ fontSize: 16 }}>{idea.name}</b>
      <span className="ink2" style={{ fontSize: 13.5, lineHeight: 1.45 }}>{idea.why}</span>
      {idea.roles.length > 0 && <span className="muted" style={{ fontSize: 12.5 }}>Could have: {idea.roles.join(", ")}</span>}
      <span className="sub" style={{ fontSize: 12.5 }}>Not part of this company yet. {idea.want ? "Avery starts it with you after your first job." : "Avery can build it with you after your first job, one question at a time."}</span>
      {owner && (
        <div className="row wrap" style={{ gap: 8 }}>
          {idea.want
            ? <ActionButton className="btn ghost sm" action={setupIdeaWant.bind(null, false)}>Take it off</ActionButton>
            : <>
                <ActionButton className="btn outline sm" action={setupIdeaWant.bind(null, true)}>Build it with Avery</ActionButton>
                <ActionButton className="btn ghost sm" action={setupIdeaWant.bind(null, false)}>Not now</ActionButton>
              </>}
        </div>
      )}
    </aside>
  );
}

/** The Desk card after the first job: Start with Avery opens the draft; the founder still answers every question. */
export function IdeaCard({ idea, owner }: { idea: DeptIdea | null; owner: boolean }) {
  if (!idea) return null;
  return (
    <section className="card" style={{ gap: 10 }} aria-labelledby="idea-h">
      <div className="stack" style={{ gap: 2 }}>
        <span className="card-t" id="idea-h">Next: your {idea.name} department</span>
        <span className="sub">{idea.why}</span>
      </div>
      {idea.roles.length > 0 && <span className="muted" style={{ fontSize: 13 }}>Could have: {idea.roles.join(", ")}</span>}
      <span className="sub">Avery asks what it should own, its goals, where its information lives and who works in it. Nothing is hired until you approve the proposal.</span>
      {owner ? (
        <div className="row wrap" style={{ gap: 8 }}>
          <ActionButton className="btn dark sm" action={ideaStart}>Start with Avery</ActionButton>
          <ActionButton className="btn ghost sm" action={setupIdeaWant.bind(null, false)}>Not now</ActionButton>
        </div>
      ) : <span className="sub">An owner starts it.</span>}
    </section>
  );
}
