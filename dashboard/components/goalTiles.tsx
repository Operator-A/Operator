// Goal tiles as in the approved mockup (docs/department-pages.md): each goal's number, measured in code, with
// its head's latest line. A department's Goals tab and the Company page's Goals tab (slice 8) draw the same
// tiles; tapping one opens that department's chat with a change to the goal typed in.
import Link from "next/link";
import { goalHref } from "@/dashboard/dept-rules";
import { goalNumber } from "@/dashboard/dept-feed";
import type { GoalView } from "@/dashboard/goals";

export function GoalTiles({ deptId, goals, word, dept }: { deptId: string; goals: GoalView[]; word: { who: string; text: string } | null; dept?: string }) {
  return (
    <div className="dp-goals">
      {goals.map((g) => {
        const n = goalNumber(g.line);
        return (
          <Link key={g.id} href={goalHref(deptId, g.title)} className="dp-goal">
            <span className="k">{dept ? `${dept} · ` : "Goal · "}{g.statusLabel}</span>
            <h4>{g.title}</h4>
            <div className="num">{n.big}{n.small && <> <small>{n.small}</small></>}</div>
            {g.pct != null && <div className="dp-bar" role="img" aria-label={`${Math.round(g.pct)}% of the target`}><i style={{ width: `${Math.max(2, g.pct)}%` }} /></div>}
            {word && <div className="by"><b>{word.who}:</b> {word.text}</div>}
            <span className="src">{g.how ? `Measured in code: ${g.how}` : g.measure ? `Measured in code from ${g.measure}.` : "No measure yet: tracked in words."}</span>
          </Link>
        );
      })}
    </div>
  );
}
