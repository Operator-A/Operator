// Small pieces the Crew views share (docs/org-chart.md, docs/crew-canvas.md): an agent's face, the
// card for an agent that is in no seat yet, and a department's budget meter. Plain markup.
import Link from "next/link";
import type { DeptView, SeatAgent } from "../org";
import { Icon } from "./Icon";

export function Face({ a, size = 32 }: { a: SeatAgent; size?: number }) {
  return <span className="av" style={{ width: size, height: size, background: a.hue ?? undefined }}><Icon name={a.icon} size={Math.round(size * 0.47)} style={a.hue ? undefined : { opacity: 0.6 }} /></span>;
}

export function AgentCard({ a }: { a: SeatAgent }) {
  return (
    <Link href={a.href} className="card crew-card">
      <span className="row" style={{ gap: 12 }}>
        <Face a={a} />
        <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{a.name}</span><span className="muted clip" style={{ fontSize: 12.5 }}>{a.role}</span></span>
        <span className="pill sm" style={{ background: a.look.bg, color: a.look.fg }}>{a.look.label}</span>
      </span>
      <span className="muted" style={{ fontSize: 12 }}>{a.last}</span>
    </Link>
  );
}

const usd = (n: number) => `$${n.toFixed(2)}`;

/** The budget meter on a department: spent this month against its budget, or just spent when it has none. */
export function DeptLimits({ d }: { d: Pick<DeptView, "budget" | "spent"> }) {
  if (d.budget == null) return <span className="muted" style={{ fontSize: 12 }}>{usd(d.spent)} of AI this month · no department budget</span>;
  const pct = d.budget > 0 ? Math.min(100, (d.spent / d.budget) * 100) : 100;
  const out = Math.round(d.spent * 100) >= Math.round(d.budget * 100);
  return (
    <div className="stack" style={{ gap: 5 }}>
      <div className="row" style={{ gap: 8, fontSize: 12 }}>
        <span className={out ? "" : "ink2"} style={out ? { color: "var(--red-ink)", fontWeight: 600 } : undefined}>{usd(d.spent)} of {usd(d.budget)} this month</span>
        {out && <span className="tag" style={{ color: "var(--red-ink)" }}>RUNS PAUSED</span>}
      </div>
      <div className="bar" style={{ height: 6, borderRadius: 999 }} role="img" aria-label={`${Math.round(pct)}% of the monthly budget used`}><span style={{ width: `${pct}%`, background: out ? "var(--red)" : pct >= 80 ? "var(--yel)" : "var(--mint)" }} /></div>
    </div>
  );
}
