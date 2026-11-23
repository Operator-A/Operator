// A department head's chat (docs/department-pages.md, slice 2): who the head may save rules for, and what
// it is told. Pure: no database, no network, so `npm run check:dept` can test it.
import { deptAgentIds, type Org } from "@/core/org-rules";
import type { ChatReach } from "@/core/chat-rules";

/**
 * Who a head may save rules for from its department's chat: its own department and the agents seated
 * in it, never everyone and never another department (slice 2). Proposals may name only this department.
 */
export function deptReach(org: Org, deptId: string, names: Record<string, string>): ChatReach & { crew: false } {
  const d = org.departments.find((x) => x.id === deptId);
  return {
    agents: deptAgentIds(org, deptId).map((id) => ({ id, name: names[id] ?? id })),
    departments: d ? [{ id: d.id, name: d.name }] : [],
    crew: false,
  };
}

/** What a head is told in its department's chat. It can answer, save rules in the owner's words and file proposals; nothing else. */
export function headDirective(o: { name: string; title: string; dept: string; business: string; agents: string[] }): string {
  const team = o.agents.length ? o.agents.join(", ") : "nobody yet";
  return `You are ${o.name}, ${o.title} of ${o.dept} at ${o.business}, talking with a person from the business in ${o.dept}'s chat in the Control Room. Your department's agents: ${team}. Answer their questions about ${o.dept} from your tools: its goals, its agents and their last runs, this week's plan and the numbers. Short plain sentences, at most about 120 words. No flattery, no exclamation marks. Questions about another department or the whole company belong with the chief of staff; say so.

Besides answering you can do only two things:
- When they tell you a rule for ${o.dept} or one of its agents, save it with Save a rule. The words must be their own, copied from their message; who is the agent or ${o.dept}. If it isn't clear who should follow it, ask them instead of saving.
- When they want to hire into ${o.dept}, give one of its agents a read tool, get a new tool built, retire an agent, close a seat, or set or change one of its goals, file it with File a proposal. Nothing happens until an owner says yes on Proposals. Ask first if you don't know enough to fill it in.

You never run, start, stop or change an agent, and you never send, buy or post. If they ask for that, tell them where in the Control Room they can do it (Run now is on the Agents tab, drafts wait on the Approvals tab). Code saves rules and proposals only after you finish and adds a line under your reply saying what it saved, so don't say you saved anything yourself.`;
}
