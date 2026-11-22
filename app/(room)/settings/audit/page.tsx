// Settings > Audit log (docs/settings.md): who did what. The latest 25; "Show more" for 100.
import Link from "next/link";
import { requireSession } from "@/dashboard/data";
import { listAudit } from "@/core/audit";
import { SectionHead } from "@/dashboard/components/settingsHead";
import { orgTz } from "@/core/tz";

const FIRST = 25, MORE = 100;

export default async function AuditLog({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const all = (await searchParams).all === "1";
  const [, tz, audit] = await Promise.all([
    requireSession(), orgTz(),
    listAudit(all ? MORE : FIRST + 1).then((rows) => ({ rows, problem: null as string | null }), (e: unknown) => ({ rows: [], problem: e instanceof Error ? e.message : String(e) })),
  ]);
  const when = (at: string) => new Date(at).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const facts = (d: Record<string, unknown> | null) => (d ? Object.entries(d).map(([k, v]) => `${k.replace(/_/g, " ")} ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · ") : "");
  const more = !all && audit.rows.length > FIRST;
  const rows = all ? audit.rows : audit.rows.slice(0, FIRST);
  return (
    <>
      <SectionHead title="Audit log" sub="Who did what: approvals, the org switch and duty, real runs, caps and vendors, Connections, people and roles, agents, routines and chains. Nobody can change or delete a line, not even an owner." />
      <div className="card set-card pad" style={{ gap: 0 }}>
        {audit.problem ? <span className="sub">{/audit_log|relation|schema cache/.test(audit.problem) ? "The audit log migration (20261208090000_audit_log.sql) isn’t applied yet." : audit.problem}</span>
          : rows.length === 0 ? <span className="sub">Nothing yet. Each change from now on lands here.</span>
          : rows.map((r, i) => (
            <div key={i} className={"set-row" + (i ? " rule" : "")}>
              <span className="set-row-k">{r.action.replace(/_/g, " ")}{r.target ? <span className="ink2"> · {r.target}</span> : null}<span className="muted set-hint">{r.actor}{r.detail ? ` · ${facts(r.detail)}` : ""}</span></span>
              <span className="sub" style={{ whiteSpace: "nowrap" }}>{when(r.at)}</span>
            </div>
          ))}
        {more && <div className="rule" style={{ paddingTop: 12 }}><Link href="/settings/audit?all=1" className="btn ghost sm">Show more</Link></div>}
        {all && audit.rows.length >= MORE && <span className="sub rule" style={{ paddingTop: 12 }}>The latest {MORE}.</span>}
      </div>
    </>
  );
}
