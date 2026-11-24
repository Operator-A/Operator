// Settings > Schedule (docs/org-schedule.md; moved from Crew > Schedule in department pages slice 11): the org switch,
// your org's day (when each agent runs, what it costs, on or off), and the chains, the one place a schedule is turned on.
import { previewChain, rollBackFlow, runChainNow, saveCrewFlow, setAgentTime, setEnabled, turnOffOrg, turnOrgBackOn } from "@/dashboard/actions";
import { orgDay } from "@/dashboard/orgDay";
import { OrgDay } from "@/dashboard/components/OrgDay";
import { planOrgOn } from "@/dashboard/orgPlan";
import { OrgSwitch } from "@/dashboard/components/OrgSwitch";
import { getCrewCanvas, getFloor } from "@/dashboard/data";
import { controlsOn } from "@/dashboard/session";
import { CrewCanvas } from "@/dashboard/components/CrewCanvas";
import { SectionHead } from "@/dashboard/components/settingsHead";

// Preview dry-runs up to three agents in a row.
export const maxDuration = 300;

export default async function SchedulePage() {
  const f = await getFloor();
  return (
    <>
      <SectionHead title="Schedule" sub="When your org works, what it costs, and when you hear from it." />
      <Schedule f={f} />
    </>
  );
}

async function Schedule({ f }: { f: Awaited<ReturnType<typeof getFloor>> }) {
  const [d, org] = [await getCrewCanvas(f), f.chart];
  const members = f.crew.map((a) => ({ id: a.id, name: a.name, inOrg: a.inOrg !== false, perRun: a.perRun ?? null }));
  const plan = planOrgOn(members, d.flow.chains, f.now, f.tz);
  const day = orgDay({
    members: f.crew,
    enabled: Object.fromEntries(Object.values(f.agents).map((x) => [x.id, x.enabled])),
    budget: Object.fromEntries(Object.values(f.agents).map((x) => [x.id, x.daily_budget_usd])),
    grants: f.grants, org, now: f.now, tz: f.tz,
  });
  return (
    <>
      <OrgSwitch tz={f.tz} org={f.org} plan={plan} controls={controlsOn()} turnOn={turnOrgBackOn} turnOff={turnOffOrg} />
      <OrgDay day={day} controls={controlsOn()} orgOn={f.org.on} setTime={setAgentTime} setOn={setEnabled} />
      <details className="card" style={{ gap: 10 }}>
        <summary style={{ cursor: "pointer", fontSize: 14.5, fontWeight: 600 }}>Edit chains: hand-offs between agents</summary>
        <span className="ink2" style={{ fontSize: 13, lineHeight: 1.55 }}>
          For more than a time: one agent after another, checks on numbers, waits and hand-offs. Chains run only while the org is on, and a chain never turns an agent on.
          Every step still checks that its agent is on duty and under its daily budget; a skipped step stops the chain.
          The next agent only gets facts from the one before (its summary and numbers), never instructions, and nothing an email or web page says can choose what runs.
        </span>
        <CrewCanvas d={d} actions={{ save: saveCrewFlow, rollBack: rollBackFlow, runNow: runChainNow, preview: previewChain }} />
      </details>
    </>
  );
}
