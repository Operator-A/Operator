// Things on the floor that want the owner, worked out from real runs and settings. Card 158: each
// item says where it comes from, and interruptKind (dashboard/needs-rules.ts) alone decides whether it
// is one of the four that reach Needs you; the rest wait for the chief of staff's summary.
import { CONNECTIONS, usersOfCheck } from "./connections";
import type { Floor } from "./data";
import type { Seen } from "./seen";
import { stateOf } from "./status";
import { INTERRUPTS, interruptKind, type Interrupt, type Source } from "./needs-rules";
import { companyHref } from "./company-rules";

export type Priority = "High" | "Medium" | "Low";
/**
 * `run` marks an alert about one run. Those clear once the owner opens the agent or the run; the rest stay until fixed.
 * `interrupt` is set only by interruptKind; `n` is how many things the line stands for.
 */
export interface Need { pri: Priority; title: string; sub: string; href: string; agentId?: string; run?: boolean; source: Source; interrupt: Interrupt | null; n: number }
type Item = Omit<Need, "interrupt" | "n"> & { n?: number };

// what waits on you lives on Company > Approvals (slice 10)
const APPROVALS = companyHref("approvals");
const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const APPROVAL_SUB: Record<Interrupt, string> = {
  first_time: "Kinds of action your agents haven’t earned trust for yet. Nothing goes out until you approve.",
  money: "Each one spends money, inside your caps. Nothing is paid until you approve.",
  new_agent: "", goal: "",
};
const PROPOSAL_LINE: Record<Interrupt, [string, string]> = {
  new_agent: ["new agent", "Hires and new departments. Each starts off duty."],
  goal: ["goal change", "New goals, changes and drops your heads would like."],
  first_time: ["", ""], money: ["", ""],
};

/** Everything that wants the owner. Split it with `split`: the four kinds, and what waits for the summary. */
export function needs(f: Floor, now = Date.now(), seen: Seen = {}): Need[] {
  const out: Item[] = [];
  // the latest real (not dry) run that worked, per agent: a failure before it is old news
  const lastOk: Record<string, number> = {};
  for (const r of f.runs) {
    if (r.status !== "ok" || r.summary?.startsWith("[dry run")) continue;
    lastOk[r.agent_id] = Math.max(lastOk[r.agent_id] ?? 0, Date.parse(r.started_at));
  }
  if (!f.ok) out.push({ pri: "High", title: "Can’t read the agent database", sub: f.problem ?? "", href: "/connections", source: { from: "database" } });
  for (const r of f.runs) {
    const a = f.byId[r.agent_id];
    if (!a) continue;
    const at = Date.parse(r.started_at);
    const age = now - at;
    if (at <= (seen[a.id] ?? 0) || at < (lastOk[a.id] ?? 0)) continue;
    if (r.status === "failed" && age < 864e5) out.push({ pri: "High", title: `${a.name}’s run failed`, sub: r.error ?? r.summary ?? "", href: `/runs/${r.id}`, agentId: a.id, run: true, source: { from: "run_failed" } });
    if (r.status === "running" && age > 6 * 6e4 && age < 7 * 864e5) out.push({ pri: "Medium", title: `${a.name}’s run never finished`, sub: "It passed the 5 minute limit without writing a result.", href: `/runs/${r.id}`, agentId: a.id, run: true, source: { from: "run_stuck" } });
  }
  for (const a of f.crew) {
    if (f.ok && stateOf(a, f.agents[a.id], f.runs, f.spentToday[a.id] ?? 0) === "over") out.push({ pri: "High", title: `${a.name} reached today’s budget`, sub: "Further runs today are skipped.", href: `/agents/${a.id}?edit=1`, agentId: a.id, source: { from: "budget" } });
  }
  // approval cards, one line per kind; a card is never out of Needs you unless its action type earned trust (card 7)
  const cards: Partial<Record<Interrupt | "later", number>> = {};
  for (const tool of f.approvalTools) { const k = interruptKind({ from: "approval", tool }) ?? "later"; cards[k] = (cards[k] ?? 0) + 1; }
  for (const k of INTERRUPTS) {
    const n = cards[k];
    if (n) out.push({ pri: "High", title: `${s(n, "approval")} waiting for your OK`, sub: APPROVAL_SUB[k], href: APPROVALS, n, source: { from: "approval", tool: f.approvalTools.find((t) => interruptKind({ from: "approval", tool: t }) === k) ?? "" } });
  }
  // chains held at a Wait for my OK step (chains slice 3): each stops by itself after 3 days
  if (f.chainOks) out.push({ pri: "High", title: `${s(f.chainOks, "chain")} waiting for your OK`, sub: "Each shows the step before’s result. Approve and the chain goes on; no answer in 3 days stops it.", href: APPROVALS, n: f.chainOks, source: { from: "chain_ok" } });
  // chains drafted from Claude (card 435): they change nothing until used, so they wait for the summary
  if (f.chainDrafts) out.push({ pri: "Medium", title: `${s(f.chainDrafts, "chain draft")} from Claude`, sub: "New or changed chains Claude drafted. Open one on the Chains tab to use or discard it; nothing changes until you save it.", href: "/settings/schedule#chains", n: f.chainDrafts, source: { from: "chain_draft" } });
  // proposals: the four's kinds show as cards on the Company page; the rest are one line for later
  const kinds: Record<string, number> = {};
  for (const k of f.proposalKinds) kinds[k] = (kinds[k] ?? 0) + 1;
  for (const k of INTERRUPTS) {
    const n = Object.entries(kinds).filter(([kind]) => interruptKind({ from: "proposal", kind }) === k).reduce((t, [, c]) => t + c, 0);
    const kind = Object.keys(kinds).find((x) => interruptKind({ from: "proposal", kind: x }) === k);
    if (n && kind) out.push({ pri: "High", title: s(n, PROPOSAL_LINE[k][0]), sub: PROPOSAL_LINE[k][1], href: APPROVALS, n, source: { from: "proposal", kind } });
  }
  const laterKinds = Object.entries(kinds).filter(([kind]) => !interruptKind({ from: "proposal", kind }));
  const later = laterKinds.reduce((t, [, c]) => t + c, 0);
  if (later) out.push({ pri: "Medium", title: `${s(later, "proposal")} to decide`, sub: "Tool grants, new tools and retirements. Nothing happens until you say yes.", href: APPROVALS, n: later, source: { from: "proposal", kind: laterKinds[0][0] } });
  for (const j of f.jobsForYou) {
    const head = j.head ? f.byId[j.head]?.name ?? j.head : "A head";
    out.push({ pri: "Low", title: j.title, sub: `A job for you in ${head}’s plan this week. Mark it done on the goal page.`, href: j.href, ...(j.head ? { agentId: j.head } : {}), source: { from: "job" } });
  }
  for (const [agentId, n] of Object.entries(f.lessonsWaiting)) {
    const a = f.byId[agentId];
    if (a && n) out.push({ pri: "Low", title: `Review ${n} lesson${n === 1 ? "" : "s"} for ${a.name}`, sub: "Proposed from your rejections. Keep, edit or discard each one.", href: `/agents/${agentId}?tab=memory`, agentId, source: { from: "lesson" } });
  }
  if (f.photosWaiting) out.push({ pri: "Medium", title: `${f.photosWaiting} charge${f.photosWaiting === 1 ? "" : "s"} need a receipt photo`, sub: "The bookkeeper couldn’t find a receipt for these. The list is in its latest run and the latest Books page in Notion.", href: "/agents/bookkeeper", agentId: "bookkeeper", source: { from: "photos" } });
  for (const c of CONNECTIONS) {
    for (const k of c.checks) {
      if (f.health[k.key] || k.key === "supabase") continue;
      const users = usersOfCheck(c, k, f.grants);
      if (!users.length) continue;
      const names = users.map((u) => f.byId[u]?.name ?? u);
      const what = c.checks.length > 1 ? `${c.name} ${k.label.toLowerCase()}` : c.name;
      out.push({
        pri: c.id === "gmail" || c.id === "email" ? "Low" : "Medium",
        title: `Connect ${what}`,
        sub: `${names.join(" and ")} ${names.length > 1 ? "need" : "needs"} it. ${k.setup}`,
        href: `/connections?c=${c.id}`,
        agentId: users[0],
        source: { from: "connection" },
      });
    }
  }
  const order: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
  return out.map((x) => ({ ...x, n: x.n ?? 1, interrupt: interruptKind(x.source) })).sort((a, b) => order[a.pri] - order[b.pri]);
}

/** The four kinds, in their order, and everything that waits for the summary. */
export function split(list: readonly Need[]): { now: Need[]; later: Need[] } {
  const now = list.filter((x) => x.interrupt).sort((a, b) => INTERRUPTS.indexOf(a.interrupt!) - INTERRUPTS.indexOf(b.interrupt!));
  return { now, later: list.filter((x) => !x.interrupt) };
}

/**
 * What may put a red mark on the frame (an agent's badge, the bell): everything but "connect a tool".
 * A tool not connected yet is setup, not a fault: it shows on the Company page and on Connections (card 189).
 */
export const alerting = (list: readonly Need[]) => list.filter((x) => x.source.from !== "connection");

/** How many things interrupt the owner: the menu badge and the greeting line. */
export const interruptCount = (list: readonly Need[]) => list.reduce((t, x) => t + (x.interrupt ? x.n : 0), 0);

export const PRI_COLOR: Record<Priority, string> = { High: "var(--acc)", Medium: "var(--yel)", Low: "var(--mint)" };
