// Settings > Schedule (docs/org-schedule.md; moved from Crew > Schedule in department pages slice 11): the org switch,
// your org's day (when each agent runs, what it costs, on or off), and every chain (chains slice 1: the same board as a
// department's Chains tab, plus the company's chains and the versions).
import { deleteChain, discardChainDraft, previewChain, rollBackFlow, runChainNow, saveChain, setAgentTime, setEnabled, turnOffOrg, turnOrgBackOn } from "@/dashboard/actions";
import { orgDay } from "@/dashboard/orgDay";
import { OrgDay } from "@/dashboard/components/OrgDay";
import { planOrgOn } from "@/dashboard/orgPlan";
import { OrgSwitch } from "@/dashboard/components/OrgSwitch";
import { getChains, getFloor } from "@/dashboard/data";
import { controlsOn } from "@/dashboard/session";
import { ChainsBoard } from "@/dashboard/components/chains";
import { SectionHead } from "@/dashboard/components/settingsHead";

// Try it dry-runs up to eight agents in a row.
export const maxDuration = 300;

export default async function SchedulePage({ searchParams }: { searchParams: Promise<{ chain?: string; new?: string }> }) {
  const [f, sp] = await Promise.all([getFloor(), searchParams]);
  const pick = typeof sp.chain === "string" && /^[a-z0-9_-]{1,40}$/.test(sp.chain) ? sp.chain : undefined;
  const startWith = typeof sp.new === "string" ? sp.new.slice(0, 80) : undefined;
  return (
    <>
      <SectionHead title="Schedule" sub="When your org works, what it costs, and when you hear from it." />
      <Schedule f={f} pick={pick} startWith={startWith} />
    </>
  );
}

async function Schedule({ f, pick, startWith }: { f: Awaited<ReturnType<typeof getFloor>>; pick?: string; startWith?: string }) {
  const [d, org] = [await getChains(f, f.tz, true), f.chart];
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
      <section className="stack" id="chains" style={{ gap: 10 }}>
        <div className="card-h"><span className="card-t">Every chain</span><span className="sub" style={{ flex: 1 }}>The company’s chains, and each department’s (also on its Chains tab). Chains run only while the org is on, and a chain never turns an agent on.</span></div>
        <ChainsBoard d={d} scope="all" place="Settings" pick={pick} startWith={startWith} actions={{ save: saveChain, remove: deleteChain, runNow: runChainNow, preview: previewChain, rollBack: rollBackFlow, discardDraft: discardChainDraft }} />
      </section>
    </>
  );
}
