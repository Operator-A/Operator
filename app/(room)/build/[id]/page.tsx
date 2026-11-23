import { notFound, redirect } from "next/navigation";
import { agentHref } from "@/dashboard/dept-rules";
import { addStandard, dryRunBuilt, forgetMemoryLine, saveSpec, setBuiltBudget } from "@/dashboard/actions";
import { builderMenu, builderModelKeys, customMenuFor, getBuilder } from "@/dashboard/builder";
import { getCrewFloor, requireSession } from "@/dashboard/data";
import { controlsOn } from "@/dashboard/session";
import { Flow } from "@/dashboard/components/Flow";
import { placeAgent } from "@/dashboard/orgActions";
import { seatChoices, seatToolChoices } from "@/dashboard/org";
import { seatOf } from "@/core/org";

// An agent's step-by-step editor (docs/builder-flow.md), kept for fine detail until hiring in the chat
// (department pages slice 5): with ?edit it is the flow, steps 1-4, editing the draft (else the live
// version). Without it, the agent's sheet opens: Runs, Edit, Try it, Go live and versions live there now.

export default async function BuildAgent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string; step?: string; saved?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  if (!/^[a-z0-9_]{1,60}$/.test(id)) notFound();
  // one round (card 302, docs/speed.md); the login check goes with the reads and redirects before anything is drawn
  const [, b, f, custom, keys] = await Promise.all([requireSession(), getBuilder(id), getCrewFloor(), customMenuFor(), builderModelKeys()]);
  if (!b) notFound();
  const menu = builderMenu(f.crew, f.health, custom, keys);
  const org = f.chart;
  const controls = controlsOn();
  const live = b.active;
  const working = b.draft ?? (live ? { ...live, active: true } : null);
  const s = working?.spec ?? null;
  const top = b.versions[0]?.version ?? 0;

  if (sp.edit != null || !s) {
    const seatBlocks = await seatToolChoices(org);
    return (
      <Flow
        key={working?.version ?? 0}
        agentId={id}
        saved={s}
        nextVersion={top + 1}
        menu={menu}
        step={sp.step}
        controls={controls}
        others={b.others}
        standards={b.standards}
        budget={{ current: b.budget, spentToday: b.spentToday, ceiling: menu.budgetCeiling }}
        save={saveSpec.bind(null, id)}
        dryRun={dryRunBuilt.bind(null, id)}
        saveBudget={setBuiltBudget.bind(null, id)}
        addStandard={addStandard.bind(null, id)}
        forget={forgetMemoryLine}
        seats={org ? seatChoices(org, id) : undefined}
        seatBlocks={seatBlocks}
        seatId={org ? seatOf(org, id)?.id ?? null : null}
        place={placeAgent.bind(null, id)}
      />
    );
  }

  // the map, Try it, Go live and versions moved to the agent's sheet (department pages slice 4)
  redirect(agentHref(org, id));
}
