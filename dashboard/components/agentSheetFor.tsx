import "server-only";
// The agent sheet on a page (docs/department-pages.md, slice 4): reads the agent and binds the same server
// actions the old agent and builder pages used, so every check stays where it was.
import { discardLessonLine, followAgent, forgetMemoryLine, keepLessonLine, goBack, goLive, realRun, routineRemove, routineSave, saveSpec, setAgentTime, setBuiltBudget, setEnabled, setRunsOn, tryBuilt } from "@/dashboard/actions";
import { agentSheet } from "@/dashboard/agentSheet";
import { orgPlaceAgent } from "@/dashboard/orgActions";
import { controlsOn } from "@/dashboard/session";
import { AgentSheet } from "./agentSheet";

export async function AgentSheetFor({ id, closeHref, tz, now, edit = false, fill = null }: { id: string; closeHref: string; tz: string; now: number; edit?: boolean; fill?: { time: string; days: number[] } | null }) {
  const d = await agentSheet(id);
  if (!d) return null;
  return (
    <AgentSheet key={id} d={d} closeHref={closeHref} tz={tz} now={now} controls={controlsOn()} edit={edit || !!fill} fill={fill} act={{
      duty: setEnabled.bind(null, id), run: realRun.bind(null, id), time: setAgentTime.bind(null, id), budget: setBuiltBudget.bind(null, id),
      save: saveSpec.bind(null, id), tryIt: tryBuilt.bind(null, id), goLive: goLive.bind(null, id), forget: forgetMemoryLine, keep: keepLessonLine, discard: discardLessonLine, goBack: goBack.bind(null, id),
      routineSave: routineSave.bind(null, id), routineRemove: routineRemove.bind(null, id), runsOn: setRunsOn.bind(null, id), place: orgPlaceAgent.bind(null, id), follow: followAgent.bind(null, id),
    }} />
  );
}
