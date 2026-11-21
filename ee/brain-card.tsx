// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// Settings > Shared brain (docs/shared-brain.md, card 231): whether the business adds to what every
// business on OPERATOR learns, the kind of business it counts under, and exactly what it would add.
import "server-only";
import { requireSession } from "@/dashboard/data";
import { brainSettings, savedSnapshot } from "@/core/brain";
import { BRAIN_FLOOR, BUSINESS_KINDS, KIND_WORDS } from "@/core/brain-rules";
import { saveBrain } from "./brain-actions";

export async function BrainCard({ query }: { query: Readonly<Record<string, string | undefined>> }) {
  const [me, s, snap] = await Promise.all([requireSession(), brainSettings(), savedSnapshot()]);
  const owner = me.role === "owner";
  return (
    <div className="card" id="brain" style={{ padding: "16px 22px", gap: 8 }}>
      <span className="card-t">Shared brain</span>
      <span className="sub">
        Help OPERATOR learn from businesses like yours. Only counts leave your business, such as which tools and
        departments you use and how often approvals go through unedited, and only when at least {BRAIN_FLOOR} businesses
        share the same thing. Never your name, your customers, your messages or any amount.
      </span>
      {query.brain === "saved" && <span className="sub" style={{ color: "var(--mint-ink)" }}>Saved.</span>}
      {query.brain_problem && <span style={{ fontSize: 13, color: "var(--red-ink)" }}>{query.brain_problem.slice(0, 200)}</span>}
      <form action={saveBrain} className="stack" style={{ gap: 8 }}>
        <label className="row" style={{ gap: 8, alignItems: "center", fontSize: 14 }}>
          <input type="checkbox" name="share" id="brain-share" defaultChecked={s.share} disabled={!owner} />
          Add my business&apos;s counts
        </label>
        <label className="stack" style={{ gap: 4, fontSize: 13 }}>
          <span className="muted">Kind of business, so you&apos;re compared with businesses like yours</span>
          <select name="kind" id="brain-kind" defaultValue={s.kind ?? ""} disabled={!owner}>
            <option value="">Not picked yet</option>
            {BUSINESS_KINDS.map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
          </select>
        </label>
        {owner ? <button className="btn sm" style={{ alignSelf: "flex-start" }}>Save</button> : <span className="muted" style={{ fontSize: 12 }}>Only an owner can change this.</span>}
      </form>
      {s.share && (
        <details style={{ fontSize: 13 }}>
          <summary className="muted">What your business adds</summary>
          {snap ? (
            <div className="stack" style={{ gap: 2, paddingTop: 6 }}>
              <span>Counted on {snap.taken_on}. Revenue band: {snap.revenue_band.replace(/_/g, " ")}. Time on OPERATOR: {snap.age_band.replace("_plus", "+").replace("_", " to ")} days.</span>
              <span>Tools: {snap.tools.length ? snap.tools.join(", ") : "none yet"}.</span>
              <span>Starting kits: {snap.departments.length ? snap.departments.join(", ") : "none"}{snap.bespoke ? `, plus ${snap.bespoke} designed for you (counted, never named)` : ""}. Agents on duty: {snap.on_duty}.</span>
              <span>Approvals in the last 30 days: {Object.keys(snap.actions).length ? Object.entries(snap.actions).map(([t, c]) => `${t} ${c.unedited} of ${c.decided} unedited`).join("; ") : "none"}.</span>
            </div>
          ) : <span className="muted">Nothing yet. It&apos;s counted once a day.</span>}
        </details>
      )}
    </div>
  );
}
