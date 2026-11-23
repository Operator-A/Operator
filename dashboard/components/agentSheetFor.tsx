import "server-only";
// The agent sheet on a page (docs/department-pages.md, slice 4): reads the agent and binds the same server
// actions the old agent and builder pages used, so every check stays where it was.
import { discardLessonLine, forgetMemoryLine, keepLessonLine, goBack, goLive, realRun, saveSpec, setAgentTime, setBuiltBudget, setEnabled, tryBuilt } from "@/dashboard/actions";
import { agentSheet } from "@/dashboard/agentSheet";
import { controlsOn } from "@/dashboard/session";
import { AgentSheet } from "./agentSheet";

export async function AgentSheetFor({ id, closeHref, tz, now }: { id: string; closeHref: string; tz: string; now: number }) {
  const d = await agentSheet(id);
  if (!d) return null;
  return (
    <AgentSheet key={id} d={d} closeHref={closeHref} tz={tz} now={now} controls={controlsOn()} act={{
      duty: setEnabled.bind(null, id), run: realRun.bind(null, id), time: setAgentTime.bind(null, id), budget: setBuiltBudget.bind(null, id),
      save: saveSpec.bind(null, id), tryIt: tryBuilt.bind(null, id), goLive: goLive.bind(null, id), forget: forgetMemoryLine, keep: keepLessonLine, discard: discardLessonLine, goBack: goBack.bind(null, id),
    }} />
  );
}
