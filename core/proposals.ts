import "server-only";
// Proposals store (docs/company-mode.md, slice 3). A head files proposals at the end of a run (the
// `propose` report tool); the owner decides each one. Nothing a proposal says happens until their tap, and
// then only through the app's own paths: a hire is created off duty with no actions (like New
// agent), a tool grant becomes a draft version that still needs Try it and Go live, a new tool opens
// Find a tool (use a connection, add a server, or ask for a connector), a retirement takes an agent off duty and opens its seat. Every check runs again
// at the tap, against the chart and the tool list as they are then.
import { orgDate } from "@/core/tz";
import { db } from "@/core/db";
import { createBuiltAgent, draftOf, listSpecVersions, readSpec, saveSpecVersion } from "@/core/agent-spec";
import { teach } from "@/core/memory";
import { addSeat, agentNames, below, headOf, liveAgentIds, loadOrg, placeAgent, placedWords, planPlacement, removeSeat, seatOf, seatTitleFor, setHolder, unseat, type Org, type Seat } from "@/core/org";
import { TOOLS } from "@/core/tools/catalog";
import { createGoal, editGoal, getGoal, GOALS_MISSING, listGoals, ownMeasureDefs, setGoalState, type Goal } from "@/core/goals";
import { MAX_GOALS_PER_DEPT, planGoal, type GoalInput } from "@/core/goal-rules";

import { changeWhat, changesSpec, hireSpec, planProposal, proposalTitle, toolInfoOf, type ProposalKind, type ProposalPlan } from "@/core/proposal-rules";
import { CHECKS, RECHECK_DAYS, checkHref, hasCheck, type CheckTile } from "@/core/setup-check-rules";

export type ProposalState = "pending" | "accepted" | "declined" | "built" | "failed";
export interface Proposal {
  id: string; kind: ProposalKind; title: string; source: "agent" | "claude" | "owner";
  from_agent: string | null; department_id: string | null; run_id: string | null;
  payload: Resolved; why: string; state: ProposalState; outcome: string | null; result_ref: string | null;
  decided_at: string | null; created_at: string;
}
/** A plan with names resolved against the chart when it was filed (checked again at the tap). */
export type Resolved = ProposalPlan & { seatId?: string | null; parentSeatId?: string | null; agentId?: string | null; goalId?: string | null; deptId?: string | null; fromDeptId?: string | null };

export const PROPOSALS_MISSING = "The proposals table isn’t in Supabase yet: apply the migration 20261122090000_proposals.sql.";
const COLS = "id, kind, title, source, from_agent, department_id, run_id, payload, why, state, outcome, result_ref, decided_at, created_at";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_PENDING_PER_AGENT = 6;
const toolInfo = () => toolInfoOf(TOOLS);
export const toolLabel = (id: string) => TOOLS[id]?.label ?? id;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The seat a proposer speaks for: a department head (its department), or the company seat (every department). */
export function proposerSeat(org: Org, agentId: string): Seat | null {
  const s = seatOf(org, agentId);
  return s && (s.parentId == null) ? s : null;
}

/** Seats a proposal may touch: the proposer's department (every department for the company seat). */
const scope = (org: Org, seat: Seat | null) => org.seats.filter((s) => s.departmentId != null && (!seat?.departmentId || s.departmentId === seat.departmentId));

/**
 * Card 158: a goal proposal against the department's goals as they are now: the goal it changes or
 * drops, and the goal as it would be, checked by planGoal like the Goals page. Run when it is filed,
 * on the proposal page and again at the owner's yes.
 */
async function goalCheck(p: Extract<ProposalPlan, { kind: "goal" }>, deptId: string, goalId: string | null = null): Promise<{ goal: Goal | null; input: GoalInput | null } | { problem: string }> {
  const open = await listGoals([deptId]);
  if (open == null) return { problem: GOALS_MISSING };
  let goal: Goal | null = null;
  if (p.change !== "new") {
    goal = goalId ? await getGoal(goalId) : open.find((g) => same(g.title, p.goal ?? "")) ?? null;
    if (!goal || goal.state === "dropped" || goal.department_id !== deptId) return { problem: `there is no goal called “${p.goal}” in that department` };
    if (p.change === "pause" && goal.state !== "active") return { problem: `“${goal.title}” isn't running, so it can't be paused` };
    if (p.change === "resume" && goal.state !== "paused") return { problem: `“${goal.title}” isn't paused` };
    if (p.change !== "change") return { goal, input: null };
  } else {
    if (open.length >= MAX_GOALS_PER_DEPT) return { problem: `that department already has ${MAX_GOALS_PER_DEPT} goals; propose dropping one first` };
    if (open.some((g) => same(g.title, p.title ?? ""))) return { problem: `that department already has a goal called “${p.title}”` };
  }
  const measure = p.measure === "none" ? null : p.measure ?? goal?.measure ?? null;
  const input: GoalInput = {
    title: p.title ?? goal?.title, measure,
    // a new measure needs its own target; the old one would be in the wrong unit
    target: p.target ?? (measure === goal?.measure ? goal?.target : null) ?? undefined,
    dueOn: p.dueOn ?? goal?.due_on ?? null,
  };
  const got = planGoal(input, (await orgDate(0)), await ownMeasureDefs());
  if ("error" in got) return { problem: got.error.replace(/\.$/, "") };
  return { goal, input };
}

/**
 * Resolves names in a plan to seats and agents on the chart, within the proposer's reach. `seat`
 * null means the owner or Claude filed it: any department.
 */
async function resolve(org: Org, plan: ProposalPlan, seat: Seat | null, deptId: string | null): Promise<{ r: Resolved; dept: string | null } | { problem: string }> {
  const seats = scope(org, seat);
  const live = await liveAgentIds();
  const inReach = seats.filter((s) => s.holder === "agent" && s.agentId).map((s) => s.agentId as string);
  const names = await agentNames(inReach);
  const agentNamed = (n: string) => inReach.find((id) => same(names[id] ?? "", n) || same(id, n)) ?? null;
  if (plan.kind === "hire") {
    const open = seats.find((s) => s.holder === "open" && same(s.title, plan.seat));
    if (open) return { r: { ...plan, seatId: open.id, parentSeatId: null }, dept: open.departmentId };
    // a new seat goes under the proposer's own seat; the owner and Claude name an open seat or a department head
    const parent = seat?.departmentId ? seat : deptId ? headOf(org, deptId) : null;
    if (!parent) return { problem: `there is no open seat called “${plan.seat}”` };
    return { r: { ...plan, seatId: null, parentSeatId: parent.id }, dept: parent.departmentId };
  }
  if (plan.kind === "grant_tool") {
    const id = agentNamed(plan.agent);
    if (!id || !live.has(id)) return { problem: `${plan.agent} isn't an agent in your department` };
    if (id === seat?.agentId) return { problem: "a head can't propose tools for itself" };
    return { r: { ...plan, agentId: id }, dept: seats.find((s) => s.agentId === id)?.departmentId ?? null };
  }
  if (plan.kind === "retire") {
    if (plan.agent) {
      const id = agentNamed(plan.agent);
      if (!id) return { problem: `${plan.agent} isn't an agent in your department` };
      if (id === seat?.agentId) return { problem: "a head can't propose retiring itself" };
      const at = seats.find((s) => s.agentId === id);
      if (at?.parentId == null) return { problem: "a department head isn't retired by a proposal; the owner does that on Crew" };
      return { r: { ...plan, agentId: id }, dept: at.departmentId };
    }
    const s = seats.find((x) => same(x.title, plan.seat ?? ""));
    if (!s) return { problem: `there is no seat called “${plan.seat}” in your department` };
    if (s.parentId == null) return { problem: "a department's head seat can't be closed this way" };
    return { r: { ...plan, seatId: s.id }, dept: s.departmentId };
  }
  if (plan.kind === "change_agent") {
    // slice 6: a head changes only a teammate in its own department, never itself; the owner and Claude name any
    const id = agentNamed(plan.agent);
    if (!id || !live.has(id)) return { problem: `${plan.agent} isn't an agent in your department` };
    if (id === seat?.agentId) return { problem: "a head can't propose changes to itself; the owner changes a head in its sheet" };
    return { r: { ...plan, agentId: id }, dept: seats.find((s) => s.agentId === id)?.departmentId ?? null };
  }
  if (plan.kind === "move_agent") {
    // card 370: Avery (the company seat), the owner and Claude reach every agent and department; a head doesn't
    if (seat?.departmentId) return { problem: "a head doesn't move agents between departments; the owner asks Avery, or adds it on Crew" };
    const want = plan.department ? org.departments.find((d) => same(d.name, plan.department!) || d.id === plan.department) : null;
    const dept = want ?? (deptId ? org.departments.find((d) => d.id === deptId) : null);
    if (!dept) return { problem: plan.department ? `there is no department called “${plan.department}”` : "department must name the department it goes to" };
    const all = [...live];
    const every = await agentNames(all);
    const id = all.find((x) => same(every[x] ?? "", plan.agent) || same(x, plan.agent)) ?? null;
    if (!id) return { problem: `there is no agent called ${plan.agent}` };
    const open = plan.seat ? org.seats.find((s) => s.departmentId === dept.id && s.holder === "open" && same(s.title, plan.seat!)) : null;
    if (plan.seat && !open) return { problem: `${dept.name} has no open seat called “${plan.seat}”; leave seat out for a new seat under its head` };
    const ok = planPlacement(org, id, dept.id, open?.id ?? null, every[id] ?? id);
    if ("problem" in ok) return { problem: ok.problem.replace(/\.$/, "") };
    return { r: { ...plan, agent: every[id] ?? plan.agent, department: dept.name, agentId: id, deptId: dept.id, seatId: open?.id ?? null, fromDeptId: seatOf(org, id)?.departmentId ?? null }, dept: dept.id };
  }
  if (plan.kind === "goal") {
    // a head reaches only its own department; Avery (the company seat), the owner and Claude name one
    const dept = seat?.departmentId ?? deptId;
    if (!dept || !org.departments.some((d) => d.id === dept)) return { problem: "department must name the department the goal is for" };
    const c = await goalCheck(plan, dept);
    if ("problem" in c) return c;
    return { r: { ...plan, goalId: c.goal?.id ?? null, deptId: dept }, dept };
  }
  return { r: plan, dept: seat?.departmentId ?? deptId };
}

/** Files one checked proposal. Returns its id. */
export async function fileProposal(input: Record<string, unknown>, from: { agentId: string | null; runId?: string | null; source: Proposal["source"]; deptId?: string | null }): Promise<string> {
  const got = planProposal(input, toolInfo());
  if ("problem" in got) throw new Error(got.problem);
  const org = await loadOrg();
  if (!org) throw new Error("The org chart isn't set up.");
  let seat: Seat | null = null;
  if (from.agentId) {
    seat = proposerSeat(org, from.agentId);
    if (!seat) throw new Error("only a department head (or the company seat) files proposals");
  }
  const res = await resolve(org, got.plan, seat, from.deptId ?? null);
  if ("problem" in res) throw new Error(res.problem);
  // a move's title names the department as it is on the chart, not as it was typed
  const title = proposalTitle(res.r, toolLabel);
  const { data: open, error: e1 } = await db().from("proposals").select("id, title").eq("state", "pending").eq("source", from.source).limit(200);
  if (e1) throw new Error(/proposals/.test(e1.message) ? PROPOSALS_MISSING : e1.message);
  const mine = (open ?? []) as { id: string; title: string }[];
  // a hire filed again for the same name in the same department replaces the one waiting (Change something
  // on the hire card, docs/department-pages.md slice 5); anything else filed twice is refused
  // slice 6: so does a change filed again for the same agent or goal (Change something on a change card)
  const again = got.plan.kind === "hire" ? await waitingHire(got.plan.name, res.dept)
    : got.plan.kind === "change_agent" || got.plan.kind === "goal" || got.plan.kind === "move_agent" ? await waitingChange(res.r, res.dept) : null;
  if (!again && mine.some((p) => same(p.title, title))) throw new Error(`“${title}” is already waiting for the owner`);
  if (from.agentId) {
    const { count } = await db().from("proposals").select("id", { count: "exact", head: true }).eq("state", "pending").eq("from_agent", from.agentId);
    if ((count ?? 0) >= MAX_PENDING_PER_AGENT) throw new Error(`${MAX_PENDING_PER_AGENT} proposals are already waiting for the owner; wait for an answer`);
  }
  const { data, error } = await db().from("proposals").insert({
    kind: got.plan.kind, title, source: from.source, from_agent: from.agentId, department_id: res.dept, run_id: from.runId ?? null, payload: res.r, why: got.why,
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (again) await close(again, "declined", `Replaced by a newer draft of the same ${got.plan.kind === "hire" ? "hire" : "change"}.`).catch(() => undefined);
  return data.id as string;
}

/**
 * Card 284: a skipped setup check finding, back once from the head who owns that tool. Filed by code from
 * the scheduler (core/setup-check.ts returnSkipped), not by a head's propose tool, so planProposal never
 * sees this kind. The why is the finding's own why, already shown on the card.
 */
export async function fileSetupFinding(f: { tile: string; index: number; title: string; why: string }, from: { agentId: string; deptId: string | null }): Promise<string> {
  const plan: ProposalPlan = { kind: "setup_finding", tile: f.tile, index: f.index, title: f.title.slice(0, 120) };
  const { data, error } = await db().from("proposals").insert({
    kind: plan.kind, title: proposalTitle(plan), source: "agent", from_agent: from.agentId, department_id: from.deptId, run_id: null, payload: plan,
    why: `You skipped this in setup ${RECHECK_DAYS} days ago or more. ${f.why}`.slice(0, 600),
  }).select("id").single();
  if (error) throw new Error(/proposals/.test(error.message) ? PROPOSALS_MISSING : error.message);
  return data.id as string;
}

/** The finding a setup_finding proposal names, as it is now, or why it can't be opened again. */
async function setupFindingNow(p: Extract<Resolved, { kind: "setup_finding" }>): Promise<{ tile: CheckTile; problem: string | null }> {
  if (!hasCheck(p.tile)) return { tile: "analytics", problem: "That tool has no setup check any more." };
  const { setupCheck } = await import("@/core/setup-check");
  const f = (await setupCheck(p.tile))?.findings[p.index];
  if (!f || f.title !== p.title) return { tile: p.tile, problem: "That check ran again since, so this finding isn't on it any more. Its new findings are on Connections." };
  if (f.state !== "skipped") return { tile: p.tile, problem: "It's already open on Connections." };
  return { tile: p.tile, problem: null };
}

export async function listProposals(states: ProposalState[], limit = 50): Promise<Proposal[] | null> {
  const { data, error } = await db().from("proposals").select(COLS).in("state", states).order("created_at", { ascending: false }).limit(limit);
  return error ? null : (data ?? []) as Proposal[];
}

export async function getProposal(id: string): Promise<Proposal | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db().from("proposals").select(COLS).eq("id", id).maybeSingle();
  return error || !data ? null : data as Proposal;
}

async function close(id: string, state: ProposalState, outcome: string, ref: string | null = null) {
  const { error } = await db().from("proposals").update({ state, outcome: outcome.slice(0, 400), result_ref: ref, decided_at: new Date().toISOString() }).eq("id", id).eq("state", "pending");
  if (error) throw new Error(error.message);
}

/** A pending hire for this name in this department, if one is waiting. */
async function waitingHire(name: string, deptId: string | null): Promise<string | null> {
  if (!deptId) return null;
  const { data } = await db().from("proposals").select("id, payload").eq("state", "pending").eq("kind", "hire").eq("department_id", deptId).limit(50);
  return ((data ?? []) as { id: string; payload: { name?: string } }[]).find((r) => same(r.payload?.name ?? "", name))?.id ?? null;
}

/** A pending change card for the same agent, or the same goal (by id, or a new goal's title), in this department. */
async function waitingChange(r: Resolved, deptId: string | null): Promise<string | null> {
  if (!deptId || (r.kind !== "change_agent" && r.kind !== "goal" && r.kind !== "move_agent")) return null;
  const { data } = await db().from("proposals").select("id, payload").eq("state", "pending").eq("kind", r.kind).eq("department_id", deptId).limit(50);
  return ((data ?? []) as { id: string; payload: Resolved }[]).find(({ payload: q }) =>
    r.kind === "change_agent" || r.kind === "move_agent" ? q.kind === r.kind && q.agentId === r.agentId
      : q.kind === "goal" && (r.goalId ? q.goalId === r.goalId : !q.goalId && same(q.title ?? "", r.title ?? "")))?.id ?? null;
}

/**
 * The version a change card would save (slice 6): the agent's draft, else its live version, with the job,
 * good result, reads and cost cap changed. Read tools only; checked by readSpec like any save. Null when the
 * change touches only the schedule or budget.
 */
export async function changeDraft(p: Extract<Resolved, { kind: "change_agent" }>) {
  if (!changesSpec(p)) return null;
  for (const t of [...p.add, ...p.drop]) {
    const k = TOOLS[t]?.kind;
    if (k !== "read" && k !== "calculate") throw new Error(`${toolLabel(t)} can't be changed by a proposal: actions are granted only on the Can do toggles.`);
  }
  const versions = await listSpecVersions(p.agentId!);
  const base = draftOf(versions) ?? versions.find((v) => v.active);
  if (!base) throw new Error(`${p.agent} wasn't built in the app, so it can't be changed here.`);
  const tools = [...base.spec.tools.filter((t) => !p.drop.includes(t)), ...p.add.filter((t) => !base.spec.tools.includes(t))];
  const next = {
    ...base.spec, tools,
    ...(p.job ? { directive: p.job } : {}),
    ...(p.goodResult ? { goodResult: p.goodResult } : {}),
    ...(p.costCap != null ? { limits: { ...base.spec.limits, maxCostUsd: p.costCap } } : {}),
  };
  const { spec, problems } = readSpec(next, p.agentId!);
  if (problems.length) throw new Error(`Not saved: ${problems.join("; ")}.`);
  return { spec, base };
}

/** Is the hire's name free, and is its seat still where it was? Throws with what changed. */
async function hireChecks(p: Extract<Resolved, { kind: "hire" }>, org: Org) {
  const { data } = await db().from("agents").select("id").ilike("name", p.name).limit(1);
  if (data?.length) throw new Error(`There is already an agent called ${p.name}. Change it first and pick another name.`);
  if (p.seatId && org.seats.find((s) => s.id === p.seatId)?.holder !== "open") throw new Error("That seat isn't open any more. Change it first and pick a seat.");
  if (!p.seatId && !org.seats.some((s) => s.id === p.parentSeatId)) throw new Error("The seat it would sit under isn't on the chart any more.");
}

/**
 * The spec a hire would create, checked against code like any save. `grants` are the actions an approver
 * turned on on the hire card: only ones the hire suggested and an approver may give (slice 5).
 */
export function hireDraft(p: Extract<Resolved, { kind: "hire" }>, grants: readonly string[] = []) {
  const ok = grants.filter((g) => (p.can ?? []).includes(g) && TOOLS[g]?.kind === "action" && TOOLS[g]?.agents === "granted");
  const base = hireSpec(p);
  const { spec, problems } = readSpec({ ...base, tools: [...base.tools, ...ok] });
  const actions = spec.tools.filter((t) => TOOLS[t]?.kind === "action" && !ok.includes(t));
  // only the owner grants a tool from a server they added, in the agent's sheet
  const custom = spec.tools.filter((t) => !TOOLS[t]);
  return { spec, problems: [...problems, ...actions.map((t) => `${toolLabel(t)} is an action, which a new agent can't have`), ...custom.map(() => "a tool from a server you added is granted only in the agent's sheet")] };
}

/** Seats the hire: its open seat, or a new one under the proposer. Returns the seat's words. */
async function seatHire(p: Extract<Resolved, { kind: "hire" }>, agentId: string): Promise<string> {
  const seatId = p.seatId ?? await addSeat(p.parentSeatId!, p.seat, p.job.slice(0, 120));
  await setHolder(seatId, "agent", agentId);
  return p.seatId ? `the ${p.seat} seat` : `a new ${p.seat} seat`;
}

/**
 * The owner's yes. Each kind goes through the app's own path, checked again now. `grants`: on a hire, the
 * actions an approver turned on on the hire card (slice 5); `agentId` is the agent a hire created.
 */
export async function acceptProposal(id: string, opts: { grants?: readonly string[] } = {}): Promise<{ text: string; href: string | null; agentId?: string }> {
  const pr = await getProposal(id);
  if (!pr || pr.state !== "pending") throw new Error("That proposal isn't waiting any more.");
  const org = await loadOrg();
  if (!org) throw new Error("The org chart isn't set up.");
  const p = pr.payload;
  try {
    if (p.kind === "hire") {
      await hireChecks(p, org);
      const d = hireDraft(p, opts.grants ?? []);
      if (d.problems.length) throw new Error(`It asks for something code doesn’t offer: ${d.problems.join("; ")}.`);
      const agentId = await createBuiltAgent(d.spec, pr.from_agent ? `proposal from ${pr.from_agent}` : "proposal");
      let where = "";
      try { where = ` in ${await seatHire(p, agentId)}`; } catch (e) { where = `, but not on the chart yet: ${e instanceof Error ? e.message : e}`; }
      await close(id, "accepted", `Created ${p.name} (${agentId}) off duty as v1${where}.`, agentId);
      return { text: `${p.name} is hired, off duty, as v1${where}. Try it, then put it on duty.`, href: `/agents/${agentId}`, agentId };
    }
    if (p.kind === "grant_tool") {
      const t = TOOLS[p.tool];
      if (!t || t.kind === "action") throw new Error(`${toolLabel(p.tool)} can't be handed out by a proposal.`);
      const versions = await listSpecVersions(p.agentId!);
      const base = draftOf(versions) ?? versions.find((v) => v.active);
      if (!base) throw new Error("That agent wasn't built in the app, so a tool can't be added to it here.");
      if (base.spec.tools.includes(p.tool)) throw new Error(`It already has ${t.label}.`);
      const { spec, problems } = readSpec({ ...base.spec, tools: [...base.spec.tools, p.tool] }, p.agentId!);
      if (problems.length) throw new Error(`Not saved: ${problems.join("; ")}.`);
      const v = await saveSpecVersion(p.agentId!, spec, `Adds ${t.label}, proposed${pr.from_agent ? ` by ${pr.from_agent}` : ""}`, "proposal");
      await close(id, "accepted", `Draft v${v} adds ${t.label}. It runs only after Try it and Go live.`, p.agentId!);
      return { text: `Saved as draft v${v} with ${t.label}. Try it, then Go live; what runs today hasn’t changed.`, href: `/agents/${p.agentId}?edit=1` };
    }
    if (p.kind === "change_agent") {
      // slice 6: the version part here, checked like any save; the schedule and budget are set by the action
      // that called this (dashboard/proposalActions.ts), through the sheet's own actions and their checks
      if (!p.agentId) throw new Error("That change names no agent.");
      const d = await changeDraft(p);
      const what = changeWhat(p).join(", ");
      if (!d) {
        await close(id, "accepted", `Approved: ${what}.`, p.agentId);
        return { text: `Approved: ${what}.`, href: null, agentId: p.agentId };
      }
      const v = await saveSpecVersion(p.agentId, d.spec, `Changes ${what}, asked for in the chat${pr.from_agent ? ` (filed by ${pr.from_agent})` : ""}`, "proposal");
      await close(id, "accepted", `Draft v${v} changes ${what}. It runs only after a clean try and Go live.`, p.agentId);
      return { text: `Saved as draft v${v}. Try it once; it goes live only after a clean try. What runs today hasn’t changed.`, href: null, agentId: p.agentId };
    }
    if (p.kind === "move_agent") {
      // card 370: the same path as Crew's Add to a department, checked again against the chart as it is now
      if (!p.agentId || !p.deptId) throw new Error("That move names no agent or department.");
      const { data: row } = await db().from("agents").select("name, role").eq("id", p.agentId).maybeSingle();
      if (!row) throw new Error(`${p.agent} isn't on the crew any more.`);
      const at = await placeAgent(p.agentId, p.deptId, { seatId: p.seatId ?? null, title: seatTitleFor({ name: p.agent, role: row.role as string | null }) });
      await close(id, "accepted", `${p.agent} is in ${at.words}.${at.closed ? ` Its old ${at.closed} seat is closed.` : ""}`, p.agentId);
      return { text: placedWords(p.agent, at), href: null, agentId: p.agentId };
    }
    if (p.kind === "department") {
      // card 156: the department, its people off duty, its goals and asks, through the app's own paths
      const { acceptDepartment } = await import("@/core/departments");
      const r = await acceptDepartment(p.draft, id, "the owner (new department)");
      await close(id, "accepted", r.text, r.deptId);
      return { text: r.text, href: "/?tab=departments&view=chart" };
    }
    if (p.kind === "goal") {
      // card 158: through the Goals page's own paths, checked again against the goals as they are now
      const dept = p.deptId ?? pr.department_id;
      if (!dept) throw new Error("That proposal names no department.");
      const c = await goalCheck(p, dept, p.goalId ?? null);
      if ("problem" in c) throw new Error(`${c.problem[0].toUpperCase()}${c.problem.slice(1)}.`);
      if (p.change === "new") {
        const gid = await createGoal(dept, c.input!);
        await close(id, "accepted", `Goal set: ${p.title}.`, gid);
        return { text: `Goal set: ${p.title}. Its head plans around it from the next run.`, href: `/goals/${gid}` };
      }
      if (p.change !== "change") {
        // drop, and slice 6's pause, resume and done: the goal page's own state change
        const to = ({ drop: "dropped", pause: "paused", resume: "active", done: "done" } as const)[p.change];
        const said = ({ drop: "Dropped", pause: "Paused", resume: "Back on", done: "Marked done" } as const)[p.change];
        await setGoalState(c.goal!.id, to);
        await close(id, "accepted", `${said}: ${c.goal!.title}.`, c.goal!.id);
        return { text: `${said}: ${c.goal!.title}.`, href: null };
      }
      await editGoal(c.goal!.id, c.input!);
      await close(id, "accepted", `Goal changed: ${c.goal!.title}.`, c.goal!.id);
      return { text: "Goal changed.", href: `/goals/${c.goal!.id}` };
    }
    if (p.kind === "setup_finding") {
      // card 284: the yes opens the finding again where its steps (and any Fix it for me) are; nothing else changes
      const now = await setupFindingNow(p);
      if (now.problem) throw new Error(now.problem);
      const { setFindingState } = await import("@/core/setup-check");
      await setFindingState(now.tile, p.index, "open");
      await close(id, "accepted", "Opened again on Connections.");
      return { text: `Opened again on ${CHECKS[now.tile].name} in Connections, with its steps.`, href: checkHref(now.tile) };
    }
    if (p.kind === "new_tool") {
      // a yes hands out nothing: the owner picks how on Find a tool, where an ask for a connector is counted
      await close(id, "accepted", "Sent to Find a tool.");
      return { text: "Pick how on Find a tool: a connection you have, a server you add, or an ask for a connector.", href: `/connections/find?for=${id}` };
    }
    // retire
    if (p.agentId) {
      const { error } = await db().from("agents").update({ enabled: false }).eq("id", p.agentId);
      if (error) throw new Error(error.message);
      await unseat(p.agentId);
      await close(id, "accepted", "Off duty, and its seat is open.", p.agentId);
      return { text: "Off duty, and its seat is open. Its versions and runs stay.", href: `/agents/${p.agentId}` };
    }
    const s = org.seats.find((x) => x.id === p.seatId);
    if (!s) throw new Error("That seat isn't on the chart any more.");
    if (s.holder === "agent") throw new Error("Someone sits in that seat now. Move them out first.");
    if (below(org, s.id).length) throw new Error("That seat has seats under it. Remove those first.");
    await removeSeat(s.id);
    await close(id, "accepted", `The ${s.title} seat is closed.`);
    return { text: `The ${s.title} seat is closed.`, href: "/?tab=departments&view=chart" };
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** The owner's no. With words, they become a 30-day note for the head that proposed it. */
export async function declineProposal(id: string, reason: string): Promise<string> {
  const pr = await getProposal(id);
  if (!pr || pr.state !== "pending") throw new Error("That proposal isn't waiting any more.");
  const words = reason.replace(/\s+/g, " ").trim().slice(0, 240);
  let noted = "";
  if (pr.from_agent && words) {
    try {
      await teach({ agentId: pr.from_agent, text: `The owner said not now to “${pr.title}”: ${words}`.slice(0, 280), keepAs: "note", forget: "days_30", sourceTag: `proposal:${id}` });
      noted = " Your words are a 30-day note for the head that asked.";
    } catch { noted = " (Your words couldn’t be saved as a note.)"; }
  }
  await close(id, "declined", words ? `Not now: ${words}` : "Not now.");
  return `Not now.${noted}`;
}

/** Pending proposals per seat, for the org chart: a hire on its seat (or the seat it goes under), a retirement on its seat. */
export function proposalsBySeat(org: Org, list: Proposal[]): Record<string, { id: string; text: string }[]> {
  const out: Record<string, { id: string; text: string }[]> = {};
  for (const p of list) {
    const r = p.payload;
    const seatId = r.kind === "hire" ? r.seatId ?? r.parentSeatId : r.kind === "retire" ? r.seatId ?? (r.agentId ? seatOf(org, r.agentId)?.id : null) : null;
    if (seatId) (out[seatId] ??= []).push({ id: p.id, text: p.title });
  }
  return out;
}

export interface Check { ok: boolean; text: string }

/** What code checks again at the tap, as a list for the proposal page. Read-only. */
export async function proposalChecks(pr: Proposal, org: Org): Promise<Check[]> {
  const p = pr.payload;
  const seatTitle = (id: string | null | undefined) => org.seats.find((s) => s.id === id)?.title ?? null;
  if (p.kind === "hire") {
    const { data } = await db().from("agents").select("id").ilike("name", p.name).limit(1);
    const d = hireDraft(p);
    const seat = p.seatId ? org.seats.find((s) => s.id === p.seatId) : null;
    return [
      { ok: !data?.length, text: data?.length ? `There is already an agent called ${p.name}` : `No other agent is called ${p.name}` },
      p.seatId
        ? { ok: seat?.holder === "open", text: seat?.holder === "open" ? `The ${p.seat} seat is open` : `The ${p.seat} seat isn’t open any more` }
        : { ok: !!seatTitle(p.parentSeatId), text: seatTitle(p.parentSeatId) ? `A new ${p.seat} seat goes under ${seatTitle(p.parentSeatId)}` : "The seat it would sit under is gone" },
      { ok: !d.problems.length, text: d.problems.length ? d.problems.join("; ") : `Every tool is on the list, and none is an action` },
      { ok: true, text: "Starts off duty, so nothing runs until you Try it and Go live" },
    ];
  }
  if (p.kind === "grant_tool") {
    const t = TOOLS[p.tool];
    const live = await liveAgentIds();
    return [
      { ok: !!t && t.kind !== "action", text: !t ? `${p.tool} isn’t on the tool list` : t.kind === "action" ? `${t.label} is an action` : `${t.label} is a ${t.kind} tool, not an action` },
      { ok: !!p.agentId && live.has(p.agentId), text: p.agentId && live.has(p.agentId) ? `${p.agent} is on the crew` : `${p.agent} isn’t on the crew any more` },
      { ok: true, text: "Saved as a draft version: what runs today doesn’t change until Go live" },
    ];
  }
  if (p.kind === "retire") {
    if (p.agentId) {
      const s = seatOf(org, p.agentId);
      return [
        { ok: !!s && s.parentId != null, text: s ? `${p.agent} sits in ${s.title}` : `${p.agent} isn’t on the chart` },
        { ok: true, text: "Off duty, not deleted: its versions and runs stay, and you can turn it back on" },
      ];
    }
    const s = org.seats.find((x) => x.id === p.seatId);
    return [
      { ok: !!s && s.holder !== "agent", text: !s ? "That seat is gone" : s.holder === "agent" ? "Someone sits there now" : `The ${s.title} seat is empty` },
      { ok: !!s && !below(org, s.id).length, text: s && below(org, s.id).length ? "It has seats under it" : "No seats under it" },
    ];
  }
  if (p.kind === "move_agent") {
    const ok = p.agentId && p.deptId ? planPlacement(org, p.agentId, p.deptId, p.seatId ?? null, p.agent) : { problem: "It names no agent or department." };
    const dept = org.departments.find((d) => d.id === p.deptId)?.name ?? p.department ?? "the department";
    return [
      "problem" in ok ? { ok: false, text: ok.problem.replace(/\.$/, "") } : { ok: true, text: p.seatId ? `The ${org.seats.find((s) => s.id === p.seatId)?.title} seat in ${dept} is open` : `${dept} has room for a new seat under its head` },
      { ok: true, text: "Only where it sits changes: what it reads, can do, its budget and when it runs stay as they are" },
    ];
  }
  if (p.kind === "department") {
    const { departmentProblems, sourcesNow } = await import("@/core/departments");
    const [problems, sources] = await Promise.all([departmentProblems(p.draft), sourcesNow(p.draft)]);
    const asks = sources.filter((s) => s.state.state === "ask").map((s) => s.service);
    return [
      ...(problems.length ? problems.map((text) => ({ ok: false, text })) : [{ ok: true, text: `No ${p.draft.name} department yet, every name is free, and every tool is a read tool on the list` }]),
      ...(asks.length ? [{ ok: true, text: `No connection for ${asks.join(", ")}: a request is logged when you approve` }] : []),
      { ok: true, text: "Every agent starts off duty with no actions; each one’s first run drafts its playbook for you to approve" },
    ];
  }
  if (p.kind === "setup_finding") {
    const now = await setupFindingNow(p);
    return [
      now.problem ? { ok: false, text: now.problem } : { ok: true, text: `It is still skipped on the ${CHECKS[now.tile].name} check` },
      { ok: true, text: "A yes only opens it again on Connections: nothing in the tool changes, and any fix still goes through Approvals" },
    ];
  }
  if (p.kind === "goal") {
    const dept = p.deptId ?? pr.department_id;
    const name = org.departments.find((d) => d.id === dept)?.name ?? "its department";
    const c = dept ? await goalCheck(p, dept, p.goalId ?? null) : { problem: "it names no department" };
    return [
      "problem" in c ? { ok: false, text: c.problem } : { ok: true, text: p.change === "new" ? `${name} has room for another goal, and the measure and target pass the Goals page's checks` : p.change === "drop" ? `“${c.goal?.title}” is a goal in ${name}` : `“${c.goal?.title}” is a goal in ${name}, and the change passes the Goals page's checks` },
      { ok: true, text: "Numbers are counted in code from the measure, never by a model; you can still edit goals by hand on Goals" },
    ];
  }
  return [{ ok: true, text: "A yes hands out nothing: it opens Find a tool, where you pick a connection, add a server, or ask for a connector" }];
}
