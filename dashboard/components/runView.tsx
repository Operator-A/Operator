// Run view (chains slice 5, docs/chains.md): one chain run as a timeline of its steps, drawn in the lane of the
// approved chains mockup: a card per step with where it ran, how it went, what it cost and what it said, and between
// steps what was passed on. core/run-view-rules.ts works it all out; this only draws it.
import Link from "next/link";
import { m4, when } from "@/dashboard/format";
import { STATE_LOOK, type Kind, type Timeline, type TimelineItem } from "@/core/run-view-rules";
import { Summary } from "@/dashboard/components/ui";
import { Icon } from "@/dashboard/components/Icon";

const ICON: Record<Kind, { cls: string; mark: string }> = {
  agent: { cls: "k-agent", mark: "" }, claude: { cls: "k-claude", mark: "✦" }, ask: { cls: "k-model", mark: "AI" },
  image: { cls: "k-image", mark: "▣" }, ok: { cls: "k-ok", mark: "✓" },
};
const BADGE: Record<Kind, string> = { agent: "b-op", claude: "b-cl", ask: "b-op", image: "b-img", ok: "b-ok" };

function Step({ it, here, image, tz, hue }: { it: TimelineItem; here: boolean; image: string | null; tz: string; hue: string | null }) {
  const look = STATE_LOOK[it.state];
  const ic = ICON[it.kind];
  const body = (
    <>
      <span className={`ch-ico ${ic.cls}`} style={it.kind === "agent" && hue ? { background: hue, color: "#111114" } : undefined} aria-hidden="true">{ic.mark || it.title.slice(0, 1)}</span>
      <span className="rv-t"><b>Step {it.step + 1}: {it.title}</b><small>{it.at ? when(it.at, tz) : "Didn’t start"}{it.costUsd > 0 ? ` · ${m4(it.costUsd)}` : ""}</small></span>
      <span className={`ch-badge ${BADGE[it.kind]}`}>{it.where}</span>
      <span className="ch-what rv-what">
        <span className={`rv-state t-${look.tone}`}><span className="dot" />{look.label}{here ? " · this run" : ""}</span>
        {it.said && <span className="rv-said"><Summary text={it.said} /></span>}
        {/* eslint-disable-next-line @next/next/no-img-element -- a short signed link to a private picture, not a static asset */}
        {image && <a href={image} target="_blank" rel="noreferrer" className="rv-img"><img src={image} alt={`The picture step ${it.step + 1} made`} loading="lazy" /></a>}
      </span>
    </>
  );
  return it.runId && !here
    ? <Link href={`/runs/${it.runId}`} className={`ch-st rv-st s-${look.tone}`}>{body}</Link>
    : <div className={`ch-st rv-st s-${look.tone}${here ? " here" : ""}`}>{body}</div>;
}

export function RunView({ name, timeline: t, images, current, tz, hue }: { name: string; timeline: Timeline; images: Record<string, string>; current: string; tz: string; hue: (agentId: string) => string | null }) {
  return (
    <div className="card rv dp-tok" style={{ gap: 12 }}>
      <div className="card-h">
        <span className="node-ic"><Icon name="git-pull-request" size={13} /></span>
        <span className="card-t">Chain: {name}</span>
        <span className="muted" style={{ fontSize: 12, flex: 1 }}>{t.ran} of {t.steps} step{t.steps === 1 ? "" : "s"} ran</span>
        <span style={{ fontSize: 15, fontWeight: 600 }}>{m4(t.totalUsd)}</span>
      </div>
      <div className="ch-lane">
        {t.items.map((it, k) => (
          <div key={it.step} className="ch-stwrap">
            {k > 0 && (
              <div className="ch-link">
                {t.items[k - 1].passed ? <><span className="ch-pill">passed on</span><span className="rv-passed">{t.items[k - 1].passed}</span></> : <span className="ch-pill">then</span>}
              </div>
            )}
            <Step it={it} here={it.runId === current} image={it.runId ? images[it.runId] ?? null : null} tz={tz} hue={it.agentId ? hue(it.agentId) : null} />
          </div>
        ))}
      </div>
      <div className="ch-foot"><span className="ch-note rv-end">{t.ending}</span><span className="ch-cost">Total <b>{m4(t.totalUsd)}</b>, worked out in code</span></div>
    </div>
  );
}
