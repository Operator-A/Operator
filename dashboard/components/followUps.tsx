import Link from "next/link";
import type { FollowUp } from "@/core/tools-step-rules";
import { setupPlanClear } from "@/dashboard/setupActions";
import { ActionButton } from "./client";
import type { SkippedFinding } from "@/dashboard/followUps";
import { reopenFinding } from "@/dashboard/setupCheckActions";
import { SEVERITY_WORDS } from "@/core/setup-check-rules";

/**
 * The Company page's "Finish setting up" card (card 183): for a part the founder had no tool for, the steps to
 * create the account themselves and then connect it the normal way; for a tool with no connection,
 * where to upload an export. A part leaves when it is connected, uploaded, or the owner taps Not now.
 */
export function FollowUpsCard({ items, owner }: { items: FollowUp[]; owner: boolean }) {
  if (!items.length) return null;
  return (
    <section className="card" style={{ gap: 14 }} aria-labelledby="finish-h">
      <div className="stack" style={{ gap: 2 }}>
        <span className="card-t" id="finish-h">Finish setting up</span>
        <span className="sub">From what you told Avery in setup. Each part of your company starts working once its step here is done.</span>
      </div>
      {items.map((it) => (
        <div key={it.cat} className="stack rule" style={{ gap: 8, paddingTop: 12 }}>
          <span className="row wrap" style={{ gap: 8, justifyContent: "space-between" }}>
            <b style={{ fontSize: 15 }}>{it.kind === "guide" ? `${it.area}: set up ${it.starter.name}` : `${it.area}: upload an export of ${it.tool}`}</b>
            <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{it.kind === "guide" ? "About 10 minutes" : "A CSV file"}</span>
          </span>
          {it.kind === "guide" ? (
            <>
              <span className="sub">{it.starter.promise}</span>
              <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6, fontSize: 14, lineHeight: 1.5 }}>
                {it.starter.steps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </>
          ) : (
            <span className="sub">There’s no direct line to {it.tool} yet, and it’s on our build list. Export a CSV from {it.tool}, then upload it under “Upload an export until it’s connected”. Your team reads the file until the connection exists.</span>
          )}
          {owner ? (
            <div className="row wrap" style={{ gap: 8 }}>
              {it.kind === "guide"
                ? <Link className="btn dark sm" href={`/connections?c=${it.starter.tile}`}>Connect {it.starter.name}</Link>
                : <Link className="btn dark sm" href="/connections/find#exports">Upload the export</Link>}
              <ActionButton className="btn outline sm" action={setupPlanClear.bind(null, it.cat)}>Not now</ActionButton>
            </div>
          ) : <span className="sub">An owner of this business finishes this.</span>}
        </div>
      ))}
    </section>
  );
}

/**
 * Skipped setup check findings (card 281): each with its Show me how steps and help page, and Open again,
 * which puts it back on the tool's card. Nothing here changes the tool.
 */
export function SkippedFindingsCard({ items, approver }: { items: SkippedFinding[]; approver: boolean }) {
  if (!items.length) return null;
  return (
    <section className="card" style={{ gap: 14 }} aria-labelledby="skipped-h">
      <div className="stack" style={{ gap: 2 }}>
        <span className="card-t" id="skipped-h">Setup you skipped</span>
        <span className="sub">From the setup checks of your tools. Each has the steps from the tool’s own help, for whenever you have a minute.</span>
      </div>
      {items.map((it) => (
        <details key={`${it.tile}-${it.index}`} className="stack rule" style={{ gap: 8, paddingTop: 12 }}>
          <summary className="row wrap" style={{ gap: 8, cursor: "pointer" }}>
            <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>{it.name} · {SEVERITY_WORDS[it.finding.severity]}</span>
            <b style={{ fontSize: 14.5 }}>{it.finding.title}</b>
          </summary>
          <span className="sub" style={{ fontSize: 13.5 }}>{it.finding.why}</span>
          {it.finding.steps.length > 0 && <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 4, fontSize: 14, lineHeight: 1.5 }}>{it.finding.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>}
          {it.finding.help_url && <span className="ink2" style={{ fontSize: 12.5 }}>From <a href={it.finding.help_url} target="_blank" rel="noopener noreferrer nofollow">{it.finding.help_url}</a></span>}
          {approver && <div><ActionButton className="btn outline sm" action={reopenFinding.bind(null, it.tile, it.index)}>Open again</ActionButton></div>}
        </details>
      ))}
    </section>
  );
}
