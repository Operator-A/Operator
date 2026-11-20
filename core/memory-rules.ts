// Memory follows the org chart (card 157, docs/agent-memory.md "Who reads whose memory"). Pure, so
// check:memory-reach can test it. Who an agent shares memory with comes from the chart on every run,
// never from the model:
//
// - a narrow agent: its department's rules and the working memory of everyone else in its department;
// - a department head: the same for its own department, plus the leadership level (the chief of
//   staff's and the other heads' working memory);
// - the chief of staff (the company seat): every head's working memory;
// - off the chart: nothing shared.
//
// Everyone also loads its own lines and the owner's rules for everyone (grp crew), which are the owner's
// instructions, not something an agent learned. Shared lines are other agents' working memory: a model
// wrote them, so they stay data and are the first thing left out of the budget.
import { agentsIn, companySeat, headOf, seatOf, type Org } from "@/core/org-rules";

export type Level = "narrow" | "head" | "company" | "off";
/** Why one agent reads another's working memory. */
export type Why = "your_head" | "your_department" | "your_team" | "chief_of_staff" | "leadership";

export interface SharedFrom { agentId: string; why: Why; deptId: string | null }
export interface Reach {
  level: Level;
  /** The department whose rules it loads, or null. */
  deptId: string | null;
  /** Whose working memory it reads, in load order. */
  shared: SharedFrom[];
}

export const WHY_WORDS: Record<Why, string> = {
  your_head: "your head",
  your_department: "in your department",
  your_team: "on your team",
  chief_of_staff: "chief of staff",
  leadership: "a department head",
};

const OFF: Reach = { level: "off", deptId: null, shared: [] };

/** Whose memory an agent reads, from the chart as it is. `live` is the agents that exist. */
export function memoryReach(o: Org | null, agentId: string, live: ReadonlySet<string>): Reach {
  if (!o) return OFF;
  const seat = seatOf(o, agentId);
  if (!seat) return OFF;
  const holder = (s: { holder: string; agentId: string | null } | null) => (s && s.holder === "agent" && s.agentId && s.agentId !== agentId && live.has(s.agentId) ? s.agentId : null);
  const heads = () => o.departments.map((d) => ({ d, a: holder(headOf(o, d.id)) })).filter((x): x is { d: typeof x.d; a: string } => !!x.a);
  if (seat.departmentId == null) {
    return { level: "company", deptId: null, shared: heads().map(({ d, a }) => ({ agentId: a, why: "leadership", deptId: d.id })) };
  }
  const deptId = seat.departmentId;
  const head = headOf(o, deptId);
  const mates = agentsIn(o, deptId).filter((a) => a !== agentId && live.has(a));
  if (head && head.id === seat.id) {
    const cos = holder(companySeat(o));
    return {
      level: "head", deptId,
      shared: [
        ...mates.map((a) => ({ agentId: a, why: "your_team" as Why, deptId })),
        ...(cos ? [{ agentId: cos, why: "chief_of_staff" as Why, deptId: null }] : []),
        ...heads().filter(({ d }) => d.id !== deptId).map(({ d, a }) => ({ agentId: a, why: "leadership" as Why, deptId: d.id })),
      ],
    };
  }
  const headId = holder(head);
  return {
    level: "narrow", deptId,
    shared: [
      ...(headId ? [{ agentId: headId, why: "your_head" as Why, deptId }] : []),
      ...mates.filter((a) => a !== headId).map((a) => ({ agentId: a, why: "your_department" as Why, deptId })),
    ],
  };
}

const SLUG = /^[a-z][a-z0-9_]{1,39}$/;
const AGENT = /^[a-z_]{1,40}$/;

/**
 * The PostgREST filter for the lines an agent loads as its own: its own lines, the owner's rules for
 * everyone, and its department's rules. Ids are checked, so they are safe in the filter.
 */
export function ownFilter(agentId: string, deptId: string | null): string {
  if (!AGENT.test(agentId)) throw new Error("Unknown agent.");
  return `agent_id.eq.${agentId},grp.eq.crew${deptId && SLUG.test(deptId) ? `,department_id.eq.${deptId}` : ""}`;
}

/** The agent ids whose working memory it reads, checked for the filter. */
export const sharedIds = (r: Reach) => [...new Set(r.shared.map((s) => s.agentId).filter((a) => AGENT.test(a)))];

/** "Tess, your head" / "Rico, a department head (Sales)". */
export function sharedLabel(s: SharedFrom, name: string, deptName?: string | null): string {
  return `${name}, ${WHY_WORDS[s.why]}${s.why === "leadership" && deptName ? ` (${deptName})` : ""}`;
}
