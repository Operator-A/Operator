import "server-only";
// The agent sheet on a page (docs/department-pages.md, slice 4): reads the agent and binds the same server
// actions the old agent and builder pages used, so every check stays where it was.
import { createAgentByHand, discardLessonLine, followAgent, forgetMemoryLine, keepLessonLine, goBack, goLive, moveIntoOperator, realRun, routineRemove, routineSave, saveSpec, setAgentTime, setBuiltBudget, setEnabled, tryBuilt } from "@/dashboard/actions";
import { agentSheet, newAgentSheet } from "@/dashboard/agentSheet";
import { NEW_AGENT } from "@/dashboard/new-agent-rules";
import { requireSession } from "@/dashboard/data";
import { orgPlaceAgent } from "@/dashboard/orgActions";
import { controlsOn } from "@/dashboard/session";
import { AgentSheet } from "./agentSheet";
import { NewAgentSheet } from "./newAgentSheet";

export async function AgentSheetFor({ id, closeHref, tz, now, edit = false, fill = null, dept = null, openHref }: {
  id: string; closeHref: string; tz: string; now: number; edit?: boolean; fill?: { time: string; days: number[] } | null;
  /** New agent (card 420): the department the blank sheet presets, and where the agent's own sheet opens once made ("{id}" for its id). */
  dept?: string | null; openHref?: string;
}) {
  if (id === NEW_AGENT) {
    // owner only, like the action it calls; anyone else sees no sheet
    if ((await requireSession()).role !== "owner" || !openHref) return null;
    const n = await newAgentSheet(dept);
    if (!n) return null;
    return <NewAgentSheet d={n} closeHref={closeHref} openHref={openHref} controls={controlsOn()} create={createAgentByHand} />;
  }
  const d = await agentSheet(id);
  if (!d) return null;
  return (
    <AgentSheet key={id} d={d} closeHref={closeHref} tz={tz} now={now} controls={controlsOn()} edit={edit || !!fill} fill={fill} act={{
      duty: setEnabled.bind(null, id), run: realRun.bind(null, id), time: setAgentTime.bind(null, id), budget: setBuiltBudget.bind(null, id),
      save: saveSpec.bind(null, id), tryIt: tryBuilt.bind(null, id), goLive: goLive.bind(null, id), forget: forgetMemoryLine, keep: keepLessonLine, discard: discardLessonLine, goBack: goBack.bind(null, id),
      routineSave: routineSave.bind(null, id), routineRemove: routineRemove.bind(null, id), moveIn: moveIntoOperator.bind(null, id), place: orgPlaceAgent.bind(null, id), follow: followAgent.bind(null, id),
    }} />
  );
}
