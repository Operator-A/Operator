// The department draft (card 156): at the top of Avery's chat panel while it fills in, and on the
// proposal page once proposed. Server-drawn; the buttons are client ActionButtons. Every state and
// number comes from code (dashboard/department.ts).
import Link from "next/link";
import { ActionButton } from "./client";
import { proposeDepartment, discardDepartmentDraft } from "@/dashboard/proposalActions";
import { usd } from "@/core/cost-rules";
import type { DraftView } from "@/dashboard/department";
import type { SourceView } from "@/core/departments";

const PILL: Record<string, { bg: string; fg: string; text: string }> = {
  code: { bg: "var(--mint-soft)", fg: "var(--mint-ink)", text: "in code" },
  words: { bg: "var(--soft)", fg: "var(--ink2)", text: "words only" },
  connected: { bg: "var(--mint-soft)", fg: "var(--mint-ink)", text: "connected" },
  add: { bg: "var(--yel-soft)", fg: "var(--yel-ink)", text: "add it" },
  ask: { bg: "var(--yel-soft)", fg: "var(--yel-ink)", text: "ask for it" },
};

function Pill({ k }: { k: keyof typeof PILL }) {
  const p = PILL[k];
  return <span className="pill sm" style={{ background: p.bg, color: p.fg, textTransform: "uppercase", letterSpacing: ".04em", fontWeight: 700, flex: "none" }}>{p.text}</span>;
}

const K = ({ children }: { children: React.ReactNode }) => <span className="ted-k" style={{ marginTop: 4 }}>{children}</span>;

function sourceNote(s: SourceView) {
  if (s.state.state === "connected") return s.state.how === "server" ? `your server ${s.state.label}` : s.state.label;
  if (s.state.state === "add") return <Link href={s.state.href}>add {s.state.label} on Connections</Link>;
  return "a connection request is logged when you approve";
}

/** The draft's body: what it tracks, goals, sources, people, total. */
export function DraftBody({ v }: { v: DraftView }) {
  const d = v.draft;
  return (
    <>
      {d.purpose && <span className="ink2" style={{ fontSize: 13.5 }}>{d.purpose}</span>}
      {!!d.tracks.length && (<><K>Tracks</K><ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }} className="ink2">{d.tracks.map((t) => <li key={t}>{t}</li>)}</ul></>)}
      {!!v.goals.length && (<><K>Goals</K>{v.goals.map((g) => (
        <span key={g.title} className="row wrap" style={{ gap: 6, fontSize: 13 }}>
          <Pill k={g.measure ? "code" : "words"} /><b style={{ fontWeight: 600 }}>{g.title}</b>
          <span className="muted" style={{ fontSize: 12 }}>{g.measureLabel ? `${g.measureLabel}${g.target != null ? `, target ${g.target}` : ""}` : "pick a measure once one exists"}</span>
        </span>
      ))}</>)}
      {!!v.sources.length && (<><K>Sources</K>{v.sources.map((s) => (
        <span key={s.service} className="row wrap" style={{ gap: 6, fontSize: 13 }}>
          <Pill k={s.state.state} /><b style={{ fontWeight: 600 }}>{s.service}</b><span className="muted" style={{ fontSize: 12 }}>{sourceNote(s)}</span>
        </span>
      ))}</>)}
      {!!v.people.length && (<><K>People</K>{v.people.map((p) => (
        <span key={p.name} style={{ border: "1px solid var(--bd)", borderRadius: 12, padding: 10, display: "flex", flexDirection: "column", gap: 2 }}>
          <span className="row wrap" style={{ gap: 6 }}><b style={{ fontWeight: 600, fontSize: 13.5 }}>{p.name}</b><span className="muted" style={{ fontSize: 12 }}>{p.head ? "Head" : p.seat} · {p.brain}</span></span>
          <span className="ink2" style={{ fontSize: 13 }}>{p.job}</span>
          <span className="muted" style={{ fontSize: 12 }}>{p.toolLabels.join(", ")}{p.perRun != null ? ` · about ${usd(p.perRun)} a run, ${usd(p.daily.month)} a month if daily` : ""}</span>
        </span>
      ))}</>)}
      {!!v.people.length && (
        <span className="row rule" style={{ justifyContent: "space-between", paddingTop: 8, fontSize: 13, gap: 8 }}>
          <span>{v.people.length} agent{v.people.length === 1 ? "" : "s"}, off duty until you put them on</span>
          <b>{usd(v.totalDaily)} a month if each runs daily</b>
        </span>
      )}
    </>
  );
}

/** The card at the top of the chat panel. */
export function DraftCard({ v, owner }: { v: DraftView; owner: boolean }) {
  return (
    <div className="card" style={{ gap: 8, border: "1.5px solid var(--acc)", padding: 14 }} aria-label="Department draft">
      <span className="row" style={{ gap: 8 }}>
        <span className="pill sm" style={{ background: "var(--acc-soft)", color: "var(--acc-ink)", textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>Department draft</span>
      </span>
      <b style={{ fontSize: 15.5, fontWeight: 600 }}>{v.draft.name || "New department"}</b>
      <DraftBody v={v} />
      {v.gaps.length > 0 && <span className="muted" style={{ fontSize: 12 }}>Still needs {v.gaps.join(", ")}.</span>}
      {owner && (
        <span className="row wrap" style={{ gap: 8 }}>
          <ActionButton className="btn dark sm" action={proposeDepartment} follow disabled={v.gaps.length > 0} title={v.gaps.length ? `Still needs ${v.gaps.join(", ")}` : undefined}>Propose this department</ActionButton>
          <ActionButton className="btn outline sm" action={discardDepartmentDraft} confirm={{ title: "Discard the draft?", body: "Avery’s department draft goes. The conversation stays.", confirmLabel: "Discard", kind: "danger" }}>Discard</ActionButton>
        </span>
      )}
    </div>
  );
}
