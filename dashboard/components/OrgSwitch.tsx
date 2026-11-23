// The org switch at the top of Crew > Schedule (docs/org-schedule.md). It first comes on with the
// first job (card 188); no button wakes every agent at once. After a stop, the owner turns the switch
// back on and puts agents on duty one at a time, each only with an approved playbook. On: one button
// that stops everything, always allowed.
import type { ActionResult } from "@/dashboard/actions";
import type { OrgPlan } from "@/dashboard/orgPlan";
import type { OrgState } from "@/core/org-switch";
import { m2, when } from "@/dashboard/format";
import { zoneLabel } from "@/core/time";
import Link from "next/link";
import { ActionButton } from "./client";
import { Icon } from "./Icon";

type Act = () => Promise<ActionResult>;

const perMonth = (v: number) => (v > 0 && v < 0.01 ? "under $0.01" : m2(v));

export function OrgSwitch({ org, plan, controls, turnOn, turnOff, tz }: { tz: string; org: OrgState; plan: OrgPlan; controls: boolean; turnOn: Act; turnOff: Act }) {
  const scheduled = plan.wake.filter((w) => w.firstRun);
  const first = scheduled[0];
  const total = `about ${perMonth(plan.totalMonth)} a month${plan.unknownCost.length ? ` plus ${plan.unknownCost.join(", ")} (no runs yet)` : ""}`;
  const n = plan.wake.length;
  return (
    <section className="card" aria-label="The org" style={{ background: "var(--dark)", color: "#fff", border: 0, borderRadius: 24, padding: "24px 26px", display: "flex", flexDirection: "row", flexWrap: "wrap", gap: 20, alignItems: "center" }}>
      <div className="row" style={{ gap: 16, flex: "1 1 380px", minWidth: 0, alignItems: "center" }}>
        <span aria-hidden style={{ width: 52, height: 52, borderRadius: 999, background: "var(--dark2)", display: "grid", placeItems: "center", flex: "none", color: org.on ? "var(--mint)" : "#8A8A93" }}><Icon name="power" size={24} /></span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <span style={{ fontSize: 21, fontWeight: 700, letterSpacing: "-.01em" }}>{org.on ? "The org is on" : "The org is off"}</span>
          <span style={{ fontSize: 13.5, color: "#C3C3CB", lineHeight: 1.5 }}>
            {org.on
              ? `${n} agent${n === 1 ? "" : "s"} in the org, ${scheduled.length} on a schedule${first ? `. Next: ${first.name}, ${when(first.firstRun!, tz)} ${zoneLabel(tz, first.firstRun!)}` : ""}. ${total[0].toUpperCase()}${total.slice(1)}.`
              : org.at
                ? "Nothing runs on its own. Turn it back on, then put each agent on duty from its page once its playbook is approved."
                : "Nothing runs on its own. The org comes on with your first job, on the Company page; then each agent goes on duty once you approve its playbook."}
          </span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
        {org.on ? (
          <ActionButton className="btn danger on-dark" action={turnOff}
            confirm={{ title: "Turn off the org?", body: "Every agent goes off duty and nothing runs on its own. Anything you start is skipped and logged at $0. Turning it back on brings back the same schedule.", confirmLabel: "Turn off the org", kind: "danger" }}>
            Turn off the org
          </ActionButton>
        ) : org.at ? (
          <ActionButton className="btn primary" action={turnOn} disabled={!controls}
            title={!controls ? "Real runs are switched off on this OPERATOR. Whoever runs it can turn them on." : undefined}
            confirm={{ title: "Turn the org back on?", body: "No agent wakes with it. Put each one back on duty from its page; only an agent with an approved playbook can go.", confirmLabel: "Turn the org back on" }}>
            Turn the org back on
          </ActionButton>
        ) : (
          <Link href="/" className="btn primary">Start your first job</Link>
        )}
        {!org.on && !controls && <span style={{ fontSize: 12, color: "#C3C3CB" }}>Needs real runs switched on</span>}
        {org.on && org.at && <span style={{ fontSize: 12, color: "#C3C3CB" }}>On since {when(org.at, tz)} {zoneLabel(tz, org.at)}</span>}
      </div>
    </section>
  );
}
