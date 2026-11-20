import "server-only";
// A department by talking to Avery (card 156, docs/company-mode.md "New department"): the draft Avery
// fills in (one per business, the policies row `department_draft`), the owner's Propose, and the yes
// that creates it through the app's own paths. The checks are in core/department-rules.ts.
import { db } from "@/core/db";
import { TOOLS } from "@/core/tools/catalog";
import { isCustomToolId } from "@/core/custom-mcp-rules";
import { MEASURES } from "@/core/goal-rules";
import { ownMeasureDefs, createGoal } from "@/core/goals";
import { addDepartment, headOf, loadOrg, addSeat, setHolder, editSeat, type Org } from "@/core/org";
import { createBuiltAgent, readSpec } from "@/core/agent-spec";
import { hireSpec } from "@/core/proposal-rules";
import { askFor } from "@/core/connector-requests";
import { KNOWN_SERVERS, serviceKey } from "@/core/connector-rules";
import { TOOL_TILES } from "@/core/tools-step-rules";
import { listCustomServers, mcpStatus } from "@/integrations/mcp";
import {
  EMPTY_DRAFT, applyPart, departmentTitle, draftGaps, peopleOf, readDraft, sourceState,
  type DeptDraft, type DraftCtx, type DraftPerson, type SourceState,
} from "@/core/department-rules";

const KEY = "department_draft";
export const DEPT_PROPOSAL_MISSING = "The proposals table doesn’t take a department yet: apply the migration 20261221090000_department_proposals.sql.";

export async function loadDraft(): Promise<DeptDraft | null> {
  const { data, error } = await db().from("policies").select("value_json").eq("key", KEY).maybeSingle();
  if (error || !data) return null;
  return readDraft((data as { value_json?: unknown }).value_json);
}

async function saveDraft(d: DeptDraft | null): Promise<void> {
  if (!d) {
    const { error } = await db().from("policies").delete().eq("key", KEY);
    if (error) throw new Error(error.message);
    return;
  }
  const { error } = await db().from("policies").upsert({ key: KEY, value_json: d, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export const discardDraft = () => saveDraft(null);


/** What the checks read now: the tool list, every measure, the chart's departments and the agents' names. */
export async function draftCtx(org?: Org | null): Promise<DraftCtx> {
  const [o, own, agents] = await Promise.all([org ?? loadOrg(), ownMeasureDefs().catch(() => []), db().from("agents").select("name")]);
  return {
    tools: Object.fromEntries(Object.values(TOOLS).map((t) => [t.id, { kind: t.kind, label: t.label }])),
    isCustom: isCustomToolId,
    measures: Object.fromEntries([...MEASURES, ...own].filter((m) => m.available).map((m) => [m.key, { label: m.label }])),
    departments: (o?.departments ?? []).map((d) => d.name),
    agentNames: (agents.data ?? []).map((a) => String(a.name)),
  };
}

/** Avery's updates from one chat run, in order. Returns one line per update, for the note under her reply. */
export async function updateDraft(parts: readonly Record<string, unknown>[]): Promise<string[]> {
  let d = (await loadDraft()) ?? { ...EMPTY_DRAFT };
  const ctx = await draftCtx();
  const done: string[] = [], not: string[] = [];
  const now = new Date().toISOString();
  for (const p of parts) {
    const r = applyPart(d, p, ctx, now);
    if ("problem" in r) { not.push(r.problem); continue; }
    d = r.draft; done.push(r.note);
  }
  if (done.length) await saveDraft(d);
  return [
    ...(done.length ? [`Updated the department draft: ${done.join(", ")}.`] : []),
    ...not.map((x) => `Not in the draft: ${x}.`),
  ];
}

export interface SourceView { service: string; what: string; state: SourceState }

/** Where each source stands now: a connected tile or server, one to add, or one to ask for. */
export async function sourcesNow(d: Pick<DeptDraft, "sources">): Promise<SourceView[]> {
  if (!d.sources.length) return [];
  const [servers, tiles] = await Promise.all([
    listCustomServers().catch(() => []),
    Promise.all(TOOL_TILES.map(async (t) => ({ name: t.name, connected: !!t.mcp && !!(await mcpStatus(t.mcp).catch(() => null))?.connected }))),
  ]);
  const w = { tiles, servers: servers.map((s) => s.name), known: KNOWN_SERVERS, keyOf: serviceKey };
  return d.sources.map((s) => ({ ...s, state: sourceState(s.service, w) }));
}

/** The owner's Propose: the draft becomes a pending department proposal, and the draft is cleared. */
export async function proposeDraft(): Promise<{ id: string; title: string }> {
  const d = await loadDraft();
  if (!d) throw new Error("There is no department draft. Tell Avery about the department you want.");
  const gaps = draftGaps(d);
  if (gaps.length) throw new Error(`The draft still needs ${gaps.join(", ")}. Tell Avery.`);
  const problems = await departmentProblems(d);
  if (problems.length) throw new Error(problems.join(" "));
  const title = departmentTitle(d);
  const why = `${d.purpose}${d.tracks.length ? ` Tracks: ${d.tracks.join("; ")}.` : ""} Drafted with Avery in the chat.`.slice(0, 600);
  const { data, error } = await db().from("proposals").insert({ kind: "department", title, source: "owner", from_agent: null, department_id: null, run_id: null, payload: { kind: "department", draft: d }, why }).select("id").single();
  if (error) throw new Error(/proposals_kind_check|violates check/.test(error.message) ? DEPT_PROPOSAL_MISSING : error.message);
  await saveDraft(null);
  return { id: data.id as string, title };
}

/** Everything that would stop the department being created now, checked against the chart and the lists as they are. */
export async function departmentProblems(d: DeptDraft): Promise<string[]> {
  const org = await loadOrg();
  const ctx = await draftCtx(org);
  const out: string[] = [];
  if (ctx.departments.some((n) => n.toLowerCase() === d.name.toLowerCase())) out.push(`There is already a ${d.name} department.`);
  for (const p of peopleOf(d)) {
    if (ctx.agentNames.some((n) => n.toLowerCase() === p.name.toLowerCase())) out.push(`There is already an agent called ${p.name}.`);
    const { problems } = readSpec(hireSpec({ kind: "hire", ...p }));
    for (const t of p.tools) {
      const info = TOOLS[t];
      if (!info) out.push(`${p.name}: ${t} isn’t on the tool list.`);
      else if (info.kind === "action") out.push(`${p.name}: ${info.label} is an action, which a proposal can’t hand out.`);
    }
    if (problems.length) out.push(`${p.name}: ${problems.join("; ")}.`);
  }
  for (const g of d.goals) if (g.measure && !ctx.measures[g.measure]) out.push(`The measure for “${g.title}” isn’t on the goal picker any more.`);
  return out;
}

const personSpec = (p: DraftPerson) => readSpec(hireSpec({ kind: "hire", ...p })).spec;

/**
 * The owner's yes on a department proposal: the department with its head seat, the head and the narrow
 * agents (each off duty with only read tools, seated), the goals, and a connection request for each source
 * still missing. Stops at the first failure and says what was done before it.
 */
export async function acceptDepartment(d: DeptDraft, proposalId: string, by: string): Promise<{ text: string; deptId: string }> {
  return buildDepartment(d, `proposal ${proposalId}`, by, proposalId);
}

/**
 * Creates a checked draft's department (card 156 acceptDepartment; card 193 setup's Start this company).
 * `note` is what each agent's first version says it came from; sources are asked for only on a proposal.
 */
export async function buildDepartment(d: DeptDraft, note: string, by: string, proposalId: string | null): Promise<{ text: string; deptId: string }> {
  const problems = await departmentProblems(d);
  if (problems.length) throw new Error(problems.join(" "));
  const done: string[] = [];
  const stop = (e: unknown): never => { throw new Error(`Stopped (${e instanceof Error ? e.message : e}). Done before it: ${done.join(", ") || "nothing"}.`); };
  const deptId = await addDepartment(d.name).catch(stop);
  done.push(`the ${d.name} department`);
  try {
    const org = await loadOrg();
    const head = org ? headOf(org, deptId) : null;
    if (!head) throw new Error("its head seat isn’t on the chart");
    if (d.head) {
      if (d.head.seat && d.head.seat !== "Head") await editSeat(head.id, d.head.seat, d.head.job.slice(0, 120));
      const id = await createBuiltAgent(personSpec(d.head), note);
      await setHolder(head.id, "agent", id);
      done.push(`${d.head.name} as head`);
    }
    for (const a of d.agents) {
      const seat = await addSeat(head.id, a.seat, a.job.slice(0, 120));
      const id = await createBuiltAgent(personSpec(a), note);
      await setHolder(seat, "agent", id);
      done.push(a.name);
    }
    for (const g of d.goals) {
      await createGoal(deptId, { title: g.title, measure: g.measure, target: g.target, dueOn: null });
      done.push(`goal “${g.title}”`);
    }
    const asked: string[] = [];
    for (const s of proposalId ? await sourcesNow(d) : []) {
      if (s.state.state !== "ask") continue;
      await askFor({ name: s.service, what: `${d.name}: ${s.what}`, by, proposalId: proposalId! });
      asked.push(s.service);
    }
    if (asked.length) done.push(`asked for ${asked.join(", ")}`);
  } catch (e) { stop(e); }
  return { text: `Created ${done.join(", ")}. Every agent is off duty; each one’s first run drafts its playbook for you to approve.`, deptId };
}

export { draftGaps, peopleOf };
