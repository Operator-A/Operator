"use server";
// Control Room actions. Each one checks the signed-in member's role first (asRole, docs/tenancy.md). Anything that can spend money
// or wake an agent also needs DASHBOARD_CONTROLS=on; stopping things never does.
import { linkedOnDutyProblem, onDutyProblem } from "@/core/on-duty-rules";
import { zoneLabel } from "@/core/time";
import { audit } from "@/core/audit";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { withActor } from "@/core/actor";
import { after } from "next/server";
import { jobOf, loadCrew } from "@/agents/registry";
import { db } from "@/core/db";
import { withRun } from "@/core/runs";
import { discardLesson, editMemory, forgetMemory, keepLesson } from "@/core/memory";
import { saveReaction } from "@/core/reactions";
import { applyApproved, cancelScheduled, decide, decideWithTrust, loadCaps, retry } from "@/core/gateway";
import { acceptOffer, declineOffer, demote } from "@/core/trust";
import { LEVEL_WORDS, isRejectKind } from "@/core/trust-rules";
import { TOOLS as WRITE_TOOLS } from "@/core/gateway/policy";
import { CAPS, capChange, fmtCap, type CapKey } from "@/core/gateway/policy";
import { env } from "@/core/env";
import { approvalDecided, startStep } from "@/core/chain";
import { orgId, withOrg } from "@/core/tenancy";
import { activateFlow, flowLooser, flowProblems, listFlowVersions, loadFlow, saveFlowVersion, withAgentTime, withAgentAfter, dayWords, type AgentTime, type Chain, type Flow, type Step } from "@/core/flow";
import { ANNOTATE } from "@/core/gateway";
import { flowWithStarts, readStored, startsWords } from "@/core/draft-starts-rules";
import { BUDGET_CEILING, NO_MODEL_KEYS, RUN_LIMITS, createBuiltAgent, activateSpecVersion, versionStarts, draftOf, listSpecVersions, loadSpec, modelReady, readSpec, saveSpecVersion, specLooser, type AgentSpec } from "@/core/agent-spec";
import { MODEL_LIST, modelDef } from "@/integrations/models";
import { askWords, billedBy } from "@/core/ask-rules";
import { modelKeysReady, removeRoutine, routineState, saveRoutine } from "@/integrations/mcp";
import { markLinked, moveIntoOperator as moveAgentIntoOperator, runsOn } from "@/core/claude-agents";
import { readRunsOn, switchConfirm, switchKind } from "./runs-on-rules";
import { TOOLS as CATALOG } from "@/core/tools/catalog";
import { loadOrg as loadOrgChart, placeAgent, seatTitleFor } from "@/core/org";
import { closedActions, createdWords, jobLine, newSpecDraft, readNewAgent } from "./new-agent-rules";
import { customMenu } from "@/core/tools/custom";
import { isCustomToolId } from "@/core/custom-mcp-rules";
import { lastTry } from "./builder";
import { activePlaybook, approvePlaybook, holdAfterRejection, listPlaybooks, pendingPlaybook } from "@/core/playbook";
import { startTry as startTryRun, tryOnce, tryTarget } from "@/core/agent-try";
import { getFloor, getRoster, asRole } from "./data";
import { currentPick, needsOf } from "./firstJob";
import { markFirstJob, setupState } from "@/core/setup";
import { SETUP_AGENT } from "@/core/setup-rules";
import { firstJobChains, readFirstJobTap, runnableSteps } from "@/core/first-job-rules";
import { planOrgOn } from "./orgPlan";
import { when } from "./format";
import { schedWords } from "./schedule";
import { setOrg } from "@/core/org-switch";
import { planBlock } from "@/core/extensions";
import { controlsOn } from "./session";

export interface ActionResult { ok: boolean; text: string }

const CONTROLS_OFF = "Real runs are switched off on this OPERATOR. Whoever runs it can turn them on.";
/** An agent with a live version, as the Control Room shows it (docs/agent-roster.md); null otherwise. */
const crewAgent = async (id: string) => { const a = (await getRoster()).byId[id]; return a ?? null; };
/** An agent's name, or its id when it isn't on the roster. */
const nameOf = async (id: string) => (await getRoster()).byId[id]?.name ?? id;
const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });

/** Reads real data, writes nothing, calls no model, logs nothing. */
export async function dryRun(agentId: string): Promise<ActionResult> {
  const { no } = await asRole("approver"); if (no) return no;
  if (!(await crewAgent(agentId))) return { ok: false, text: "Unknown agent." };
  try {
    const res = await jobOf(agentId)({ dryRun: true });
    return { ok: true, text: res.summary };
  } catch (e) { return fail(e); }
}

/**
 * A real run, logged in agent_runs as manual. withRun still skips it when the agent is off duty or over budget.
 * The run keeps going in the background (after()), so this returns as soon as its row is written and the
 * dashboard stays usable; the layout polls until the row finishes. A skip or a failure to start comes back at once.
 */
export async function realRun(agentId: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  const who = await crewAgent(agentId);
  if (!who) return { ok: false, text: "Unknown agent." };
  const res = await startRun(agentId, who.name);
  await audit(me, "run_now", agentId);
  return res;
}

/** Starts a real run in the background (Run now, and the first job's tap). The caller checked the role and Controls. */
async function startRun(agentId: string, name: string): Promise<ActionResult> {
  // one at a time: a row still "running" inside the 6 minute window means a run is going
  const { data: going } = await db().from("agent_runs").select("id").eq("agent_id", agentId).eq("status", "running").gte("started_at", new Date(Date.now() - 6 * 6e4).toISOString()).limit(1);
  if (going?.length) return { ok: false, text: `${name} is already working. Wait for that run to finish.` };

  let markStarted: () => void = () => {};
  const started = new Promise<null>((resolve) => { markStarted = () => resolve(null); });
  // the run outlives this request, so it carries the org itself rather than reading the cookie later
  const org = await orgId();
  const run = withOrg(org, () => withRun(agentId, "manual", (runId, memory) => { markStarted(); return jobOf(agentId)({ runId, memory }); }))
    .then((res) => ({ res }), (err: unknown) => { console.error(`[control-room] ${agentId} run failed`, err); return { err }; });
  after(run);
  const first = await Promise.race([started, run]);
  revalidatePath("/", "layout");
  if (first === null) return { ok: true, text: `${name} is working. Keep using the app; ${name} pulses until the run is done.` };
  if ("err" in first) return fail(first.err);
  return { ok: first.res.status === "ok", text: `${name}: ${first.res.status === "skipped" ? "skipped, " : ""}${first.res.summary}` };
}

export async function setEnabled(agentId: string, on: boolean): Promise<ActionResult> {
  // taking an agent off duty is a stop, so approvers may; putting one back is the owner's
  const { me, no } = await asRole(on ? "owner" : "approver"); if (no) return no;
  const who = await crewAgent(agentId);
  if (!who) return { ok: false, text: "Unknown agent." };
  if (on && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
  if (on) {
    // only with an approved playbook (card 188): no path puts an agent on duty without one; an agent that
    // runs in Claude has no playbook, so it needs its routine connected instead (live events slice 2)
    const linked = (await runsOn(agentId)).on === "claude";
    const problem = linked ? linkedOnDutyProblem(who.name, await routineState(agentId).catch(() => null)) : onDutyProblem(who.name, await listPlaybooks(agentId).catch(() => null));
    if (problem) return { ok: false, text: problem };
    const plan = await planBlock({ kind: "agent_on", agentIds: [agentId] }); if (plan) return { ok: false, text: plan };
  }
  const { error } = await db().from("agents").update({ enabled: on }).eq("id", agentId);
  if (error) return fail(error.message);
  revalidatePath("/", "layout");
  const name = who.name;
  await audit(me, on ? "put_on_duty" : "take_off_duty", agentId);
  return { ok: true, text: on ? `${name} is back on the crew.` : `${name} is off duty. Every run is skipped at $0.` };
}

/**
 * When one agent runs (Crew > Schedule, docs/org-schedule.md): `t` days and a time, or null for by
 * hand. An edit of the flow (core/flow-rules.ts withAgentTime) saved as a new version, plus
 * agents.manual_only to match. By hand always works; letting an agent run on a schedule, or moving a
 * schedule that is on, needs Controls on and a confirm. It still runs only while the org is on and
 * the agent is on duty.
 */
export async function setAgentTime(agentId: string, t: AgentTime | null, confirmed = false): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const who = await crewAgent(agentId);
  if (!who) return { ok: false, text: "Unknown agent." };
  try {
    const crew = await loadCrew();
    const flow = await loadFlow(crew);
    const r = withAgentTime(flow.flow, agentId, who.name, t);
    if ("refuse" in r) return { ok: false, text: r.refuse };
    // the crew as it will be: the agent by hand or not
    const manualOnly = new Set(crew.manualOnly);
    if (t) manualOnly.delete(agentId); else manualOnly.add(agentId);
    const problems = flowProblems(r.flow, { ids: crew.ids, manualOnly });
    if (problems.length) return { ok: false, text: problems.join(" ") };
    const looser = flowLooser(flow.flow, r.flow);
    if (t && (looser.length || crew.manualOnly.has(agentId))) {
      if (!controlsOn()) return { ok: false, text: `${CONTROLS_OFF} ${who.name} would run on a schedule.` };
      if (!confirmed) return { ok: false, text: `Confirm first: ${who.name} would run ${schedWords({ kind: t.days, time: t.time })}.` };
    }
    // schedule: allow schedules first, then the flow; by hand: the flow first, then mark it by hand
    if (t) { const { error } = await db().from("agents").update({ manual_only: false }).eq("id", agentId); if (error) return fail(error.message); }
    if (JSON.stringify(r.flow) !== JSON.stringify(flow.flow)) await saveFlowVersion(r.flow, t ? `${who.name}: ${schedWords({ kind: t.days, time: t.time })}` : `${who.name}: by hand`, me.email, flow.version);
    if (!t) { const { error } = await db().from("agents").update({ manual_only: true }).eq("id", agentId); if (error) return fail(error.message); }
    revalidatePath("/", "layout");
    await audit(me, "set_agent_time", agentId, { when: t ? schedWords({ kind: t.days, time: t.time }) : "by hand" });
    return { ok: true, text: t ? `${who.name} runs ${schedWords({ kind: t.days, time: t.time })}, while the org is on.` : `${who.name} runs only when you press Run now.` };
  } catch (e) { return fail(e); }
}

/**
 * The agent sheet's "After another agent finishes" (card 400): `agentId` becomes the next step of the scheduled
 * chain `afterId` ends, with `afterId`'s summary passed along when asked (core/flow-rules withAgentAfter). The same
 * checks as Settings > Schedule: flowProblems, and a chain that is on gaining an agent needs Controls and a confirm.
 */
export async function followAgent(agentId: string, afterId: string, passAlong: boolean, confirmed = false): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const [who, prev] = await Promise.all([crewAgent(agentId), crewAgent(String(afterId ?? ""))]);
  if (!who || !prev) return { ok: false, text: "Unknown agent." };
  try {
    const crew = await loadCrew();
    const flow = await loadFlow(crew);
    const r = withAgentAfter(flow.flow, agentId, who.name, prev.id, prev.name, passAlong === true);
    if ("refuse" in r) return { ok: false, text: r.refuse };
    const manualOnly = new Set(crew.manualOnly); manualOnly.delete(agentId);
    const problems = flowProblems(r.flow, { ids: crew.ids, manualOnly });
    if (problems.length) return { ok: false, text: problems.join(" ") };
    const looser = flowLooser(flow.flow, r.flow);
    if (looser.length || crew.manualOnly.has(agentId)) {
      if (!controlsOn()) return { ok: false, text: `${CONTROLS_OFF} ${who.name} would run after ${prev.name}.` };
      if (!confirmed) return { ok: false, text: `Confirm first: ${who.name} would run after ${prev.name} finishes, in ${r.chain}${passAlong ? `, with ${prev.name}’s summary` : ""}.` };
    }
    if (crew.manualOnly.has(agentId)) { const { error } = await db().from("agents").update({ manual_only: false }).eq("id", agentId); if (error) return fail(error.message); }
    await saveFlowVersion(r.flow, `${who.name} after ${prev.name}`, me.email, flow.version);
    revalidatePath("/", "layout");
    await audit(me, "follow_agent", agentId, { after: prev.id, chain: r.chain, passAlong: passAlong === true });
    return { ok: true, text: `${who.name} now runs after ${prev.name} in ${r.chain}${passAlong ? `, with ${prev.name}’s summary` : ""}, while the org is on.` };
  } catch (e) { return fail(e); }
}

// ---- The org switch (docs/org-schedule.md). Turning on is launch: Controls on and a confirm.
// Turning off always works, since it only stops things.

/**
 * The first job (card 154, docs/setup.md): one tap approves the picked agent's first playbook and
 * Avery's, puts those two on duty, turns on only their chains and the org switch (every other agent stays
 * off duty with its playbook waiting), and starts the first run now. The pick is checked in code again.
 */
export async function startFirstJob(agentId: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: `${CONTROLS_OFF} The first job puts an agent on duty.` };
  try {
    const f = await getFloor();
    const [st, pick] = await Promise.all([setupState(), currentPick(f)]);
    const tap = readFirstJobTap(agentId, st, pick.job);
    if ("problem" in tap) return { ok: false, text: tap.problem };
    const who = f.byId[tap.agentId];
    if (!who) return { ok: false, text: "Unknown agent." };
    // card 194: a designed department's agent has no playbook yet, so it stays off duty and makes one try
    // that drafts its routine; only Avery goes on duty with it (card 188: never without an approved playbook)
    const isTry = pick.job!.kind === "try";
    const ids = [...(isTry ? [] : [tap.agentId]), ...(f.agents[SETUP_AGENT] ? [SETUP_AGENT] : [])];
    const block = await planBlock({ kind: "agent_on", agentIds: ids }); if (block) return { ok: false, text: block };
    // each first playbook, as the founder, with only the steps that can run now (card 189): the card
    // showed them, and a step whose tool isn't connected would fail the run and put the agent on hold
    for (const id of ids) {
      const p = pendingPlaybook(await listPlaybooks(id));
      const keep = p ? runnableSteps(p.steps.map((s) => s.tool), needsOf, pick.connected) : [];
      if (p && keep.length) await withActor(me.email, () => approvePlaybook(id, p.id, keep));
    }
    const { error } = ids.length ? await db().from("agents").update({ enabled: true }).in("id", ids) : { error: null };
    if (error) return fail(error.message);
    // only these two wake: their chains come on, every other agent's stay off
    const flow = await loadFlow(f.palette);
    const turned = firstJobChains(flow.flow.chains, ids);
    if (turned.on.length) await saveFlowVersion({ chains: turned.chains }, `First job: ${turned.on.join(", ")} on`, me.email, flow.version);
    const plan = firstJobPlan(f, ids, turned.chains);
    await setOrg(true, me.email);
    await markFirstJob(tap.agentId, isTry ? "try" : "playbook");
    await audit(me, "start_first_job", tap.agentId, { onDuty: ids, kind: isTry ? "try" : "playbook" });
    const run = isTry ? await startTry(tap.agentId, who.name) : await startRun(tap.agentId, who.name);
    revalidatePath("/", "layout");
    const avery = plan.wake.find((w) => w.id === SETUP_AGENT);
    return { ...run, text: `${run.text}${avery?.firstRun ? ` Avery’s first summary comes at ${when(avery.firstRun, f.tz)} ${zoneLabel(f.tz, avery.firstRun)}.` : ""}` };
  } catch (e) { return fail(e); }
}

/** Who wakes and when, for the first job's reply: only `ids` count as in the org. */
function firstJobPlan(f: Awaited<ReturnType<typeof getFloor>>, ids: readonly string[], chains: Parameters<typeof planOrgOn>[1]) {
  return planOrgOn(f.crew.map((a) => ({ id: a.id, name: a.name, inOrg: ids.includes(a.id), perRun: a.perRun ?? null })), chains, Date.now(), f.tz);
}

/**
 * After Stop everything: the org switch back on (card 188). No agent wakes with it; each goes on duty
 * from its own page (setEnabled), and only with an approved playbook. The first job turns it on first.
 */
export async function turnOrgBackOn(): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  try {
    await setOrg(true, me.email);
    revalidatePath("/", "layout");
    await audit(me, "turn_org_back_on");
    return { ok: true, text: "The org is on. Put each agent back on duty from its page; one with an approved playbook can go now." };
  } catch (e) { return fail(e); }
}

export async function turnOffOrg(): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  try {
    // the switch first, so the dispatcher stops starting chains at once
    await setOrg(false, me.email);
    // every agent, including ones built in the app and test agents
    const { error } = await db().from("agents").update({ enabled: false }).eq("enabled", true);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    await audit(me, "turn_off_org");
    return { ok: true, text: "The org is off. Every agent is off duty and nothing runs on its own." };
  } catch (e) { return fail(e); }
}

// ---- Approvals. Deciding only records the owner's choice. Writing the approved change to Mercury
// also needs DASHBOARD_CONTROLS=on, the gateway's Mercury sign-ins, and the agent on duty (withRun).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why approved actions can't be applied from here at all right now, or null. Each kind's own blocker (Mercury token, Gmail) is the gateway's to say. */
const applyBlocker = () => (!controlsOn() ? "Approved, not applied yet: real runs are switched off on this OPERATOR." : null);

/** This deployment's own address, for a chain step's request to /api/agents. */
async function selfOrigin() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "https"}://${host}` : env.dashboardUrl ?? "";
}

/** Chains that start when an approval is decided (core/flow.ts). Runs after the answer, never blocks it, as this org. */
async function fireApprovalChains(decision: "approve" | "reject") {
  const origin = await selfOrigin();
  if (!origin) return;
  const org = await orgId();
  after(() => withOrg(org, async () => {
    try {
      const flow = await loadFlow(await loadCrew());
      const started = await approvalDecided(origin, flow.flow, ANNOTATE, decision);
      if (started.length) console.log(`[chains] approval ${decision} started ${started.join(", ")}`);
    } catch (e) { console.error("[chains] approval", e); }
  }));
}

async function applyNow(ids?: string[]): Promise<ActionResult> {
  const blocked = applyBlocker();
  if (blocked) return { ok: true, text: blocked.startsWith("Approved") ? blocked : `Approved, not applied yet: ${blocked}` };
  return applyApproved(ids);
}

export async function approve(approvalId: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(approvalId)) return { ok: false, text: "Unknown approval." };
  try {
    const d = await decideWithTrust(approvalId, "approve", me.email);
    if (!d) { revalidatePath("/", "layout"); return { ok: false, text: "That item was already decided or has expired." }; }
    const res = await applyNow([d.actionId]);
    await fireApprovalChains("approve");
    revalidatePath("/", "layout");
    await audit(me, "approve", approvalId);
    return { ...res, text: `${res.text}${d.trust}` };
  } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

/**
 * Rejects an approval. A reason is the owner's own words, so it is a reaction (docs/company-mode.md): it
 * saves a rule for the agent (or its department, or everyone) straight away, with no Keep to tap.
 */
export async function reject(approvalId: string, reason?: string, scope?: string, keep?: string, replaces?: string | null, kind?: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(approvalId)) return { ok: false, text: "Unknown approval." };
  if (!isRejectKind(kind)) return { ok: false, text: "Say why: it got this wrong, against the rules, not now, or something else." };
  const why = String(reason ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
  try {
    const d = await decideWithTrust(approvalId, "reject", me.email, why || undefined, kind);
    if (!d) { revalidatePath("/", "layout"); return { ok: false, text: "That item was already decided or has expired." }; }
    await fireApprovalChains("reject");
    let more = "";
    const { data: ap } = await db().from("approvals").select("agent_id, title").eq("id", approvalId).single();
    if (why && ap) {
      try { more = ` ${await withActor(me.email, async () => saveReaction(ap.agent_id, await nameOf(ap.agent_id), { approvalId }, { verdict: "not", text: why, scope, keep, replaces }))}`; }
      catch (e) { more = ` Your words couldn’t be saved as a rule: ${e instanceof Error ? e.message : String(e)}`; }
    }
    // an agent on a playbook that proposed this goes back to needing approval for its next playbook
    try { if (ap && await holdAfterRejection(ap.agent_id, ap.title)) more += " Its next playbook will wait for your approval."; } catch { /* no playbook tables yet */ }
    revalidatePath("/", "layout");
    await audit(me, "reject", approvalId, why ? { reason: why, kind } : { kind });
    return { ok: true, text: `Rejected.${more}${d.trust}` };
  } catch (e) { return fail(e); }
}

export async function approveAll(approvalIds: string[]): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  const ids = approvalIds.filter((i) => UUID.test(i)).slice(0, 200);
  try {
    const actionIds: string[] = [];
    for (const id of ids) { const a = await decide(id, "approve", me.email); if (a) actionIds.push(a); }
    const res = actionIds.length ? await applyNow(actionIds) : { ok: false, text: "Nothing left to approve." };
    if (actionIds.length) await fireApprovalChains("approve");
    revalidatePath("/", "layout");
    if (actionIds.length) await audit(me, "approve_all", null, { approved: actionIds.length });
    return actionIds.length ? { ok: res.ok, text: `Approved ${actionIds.length}. ${res.text}` } : res;
  } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

/** Applies everything approved that is still waiting (also after a failure was put back with Retry). */
export async function applyWaiting(): Promise<ActionResult> {
  const { no } = await asRole("approver"); if (no) return no;
  try { const res = await applyNow(); revalidatePath("/", "layout"); return res; } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

export async function retryAction(actionId: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(actionId)) return { ok: false, text: "Unknown action." };
  try {
    const back = await retry(actionId);
    if (!back) return { ok: false, text: "Only a failed change can be retried." };
    const res = await applyNow([actionId]);
    revalidatePath("/", "layout");
    await audit(me, "retry_action", actionId);
    return res;
  } catch (e) { return fail(e); }
}


// ---- Memory. Teaching, editing and forgetting spend nothing and wake nothing, so they need only the login.

/**
 * Good or Not this on a run, or on one item of a run (a lead it found). The run and the item must
 * belong to the agent: both are looked up here, never taken from the page.
 */
export async function react(agentId: string, runId: string, itemId: string | null, verdict: string, text = "", scope = "agent", keep = "always", replaces: string | null = null): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  const who = await crewAgent(agentId);
  if (!who) return { ok: false, text: "Unknown agent." };
  if (!UUID.test(runId) || (itemId && !UUID.test(itemId))) return { ok: false, text: "Unknown run." };
  try {
    const { data: run } = await db().from("agent_runs").select("agent_id").eq("id", runId).maybeSingle();
    if (!run || run.agent_id !== agentId) return { ok: false, text: "That run isn’t this agent’s." };
    let itemLabel: string | null = null;
    if (itemId) {
      const { data: lead } = await db().from("wholesale_leads").select("business, run_id").eq("id", itemId).maybeSingle();
      if (!lead || lead.run_id !== runId) return { ok: false, text: "That lead isn’t from this run." };
      itemLabel = String(lead.business);
    }
    const said = await withActor(me.email, () => saveReaction(agentId, who.name, { runId, itemId, itemLabel }, { verdict, text, scope, keep, replaces }));
    revalidatePath("/", "layout");
    return { ok: true, text: said };
  } catch (e) { return fail(e); }
}

export async function editMemoryLine(memoryId: string, text: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown memory line." };
  try { await withActor(me.email, () => editMemory(memoryId, String(text))); revalidatePath("/", "layout"); return { ok: true, text: "Saved. The old words are in the timeline." }; } catch (e) { return fail(e); }
}

export async function forgetMemoryLine(memoryId: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown memory line." };
  try { await withActor(me.email, () => forgetMemory(memoryId)); revalidatePath("/", "layout"); return { ok: true, text: "Forgotten. It won’t be loaded from the next run." }; } catch (e) { return fail(e); }
}

export async function keepLessonLine(memoryId: string, forCrew: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown lesson." };
  try { await withActor(me.email, () => keepLesson(memoryId, !!forCrew)); revalidatePath("/", "layout"); return { ok: true, text: forCrew ? "Kept for the whole crew." : "Kept. It’s loaded from the next run." }; } catch (e) { return fail(e); }
}

export async function discardLessonLine(memoryId: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(memoryId)) return { ok: false, text: "Unknown lesson." };
  try { await withActor(me.email, () => discardLesson(memoryId)); revalidatePath("/", "layout"); return { ok: true, text: "Discarded. The timeline keeps a record of it." }; } catch (e) { return fail(e); }
}

// ---- Chains (chains slice 1, card 430): one chain saved from where it lives (a department's Chains tab, Settings >
// Schedule), merged into the saved flow so two places never overwrite each other's chains.

/**
 * The saved flow with one chain from the browser put in (by key: replaced, or added) or taken out (`raw` null),
 * checked against the crew. A chain that starts after it is taken out with it, said in the refusal instead.
 */
async function withChain(key: string, raw: unknown): Promise<{ now: Awaited<ReturnType<typeof loadFlow>>; next: Flow } | { problem: string }> {
  const crew = await loadCrew();
  const now = await loadFlow(crew);
  if (raw === null) {
    const c = now.flow.chains.find((x) => x.key === key);
    if (!c) return { problem: "That chain isn’t saved." };
    const after = now.flow.chains.filter((x) => x.start.type === "after" && x.start.chain === key);
    if (after.length) return { problem: `${after.map((x) => x.name).join(", ")} start${after.length === 1 ? "s" : ""} after ${c.name}. Change ${after.length === 1 ? "its" : "their"} start first.` };
    return { now, next: { chains: now.flow.chains.filter((x) => x.key !== key) } };
  }
  const c = raw as Chain;
  if (!c || typeof c !== "object" || c.key !== key) return { problem: "That isn’t a chain." };
  const has = now.flow.chains.some((x) => x.key === key);
  const next: Flow = { chains: has ? now.flow.chains.map((x) => (x.key === key ? c : x)) : [...now.flow.chains, c] };
  const problems = flowProblems(next, crew);
  if (problems.length) return { problem: `Not saved: ${problems.slice(0, 5).join(" ")}` };
  // Ask a model steps (chains slice 2): an agent must be there to pay, and the model must be able to run here
  const asks = c.steps.flatMap((s) => (s.ask ? [s.ask] : []));
  if (asks.length) {
    const payer = billedBy(c, await loadOrgChart());
    if ("problem" in payer) return { problem: `Not saved: ${payer.problem}` };
    const keys = await modelKeysReady().catch(() => NO_MODEL_KEYS);
    const off = asks.find((a) => !modelReady(a.model, keys));
    if (off) return { problem: `Not saved: ${modelDef(off.model)?.label ?? off.model} needs its provider’s key on Connections > Other models.` };
  }
  return { now, next };
}

/** A step in words: its agent's name, or the Ask a model step. */
const stepLabel = async (s: Step) => (s.ask ? `Ask ${modelDef(s.ask.model)?.label ?? s.ask.model}` : nameOf(s.agent));

/**
 * Saves one chain (new or changed) as a new flow version, noted with where it was saved. A chain that starts running
 * on its own, gains an agent or starts differently while on needs a confirm and DASHBOARD_CONTROLS=on (flowLooser).
 * Saving never turns an agent on: each run still goes through withRun, and an agent that is off duty is skipped.
 */
export async function saveChain(raw: unknown, place: string, confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const key = String((raw as Chain | null)?.key ?? "");
  try {
    const got = await withChain(key, raw);
    if ("problem" in got) return { ok: false, text: got.problem };
    if (JSON.stringify(got.now.flow) === JSON.stringify(got.next)) return { ok: false, text: "Nothing changed from the saved chain." };
    const looser = flowLooser(got.now.flow, got.next);
    if (looser.length && !controlsOn()) return { ok: false, text: `${CONTROLS_OFF} ${looser.join("; ")}.` };
    if (looser.length && !confirmed) return { ok: false, text: `Confirm first: ${looser.join("; ")}.` };
    const c = got.next.chains.find((x) => x.key === key)!;
    const v = await saveFlowVersion(got.next, `${c.name}: saved from ${String(place ?? "").slice(0, 60) || "a Chains tab"}`, me.email, got.now.version);
    revalidatePath("/", "layout");
    await audit(me, "save_chain", key, { version: v, chain: c.name });
    return { ok: true, text: c.on ? `${c.name} saved. It starts on its own while the org is on; an agent that is off duty is skipped and the chain stops there.` : `${c.name} saved. It’s off, so it runs only when you press Run chain.` };
  } catch (e) { return fail(e); }
}

/** Deletes one saved chain (a new flow version; Settings > Schedule can roll back). Only stops things, so no confirm. */
export async function deleteChain(key: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const got = await withChain(String(key ?? ""), null);
    if ("problem" in got) return { ok: false, text: got.problem };
    const name = got.now.flow.chains.find((x) => x.key === key)?.name ?? key;
    const v = await saveFlowVersion(got.next, `${name}: deleted`, me.email, got.now.version);
    revalidatePath("/", "layout");
    await audit(me, "delete_chain", key, { version: v, chain: name });
    return { ok: true, text: `${name} deleted. Settings > Schedule can bring it back from the versions list.` };
  } catch (e) { return fail(e); }
}

export async function rollBackFlow(version: number, confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!Number.isInteger(version) || version < 1) return { ok: false, text: "Unknown version." };
  try {
    const crew = await loadCrew();
    const [now, all] = await Promise.all([loadFlow(crew), listFlowVersions(crew)]);
    const target = all.find((v) => v.version === version);
    if (!target) return { ok: false, text: `There is no flow v${version}.` };
    if (target.version === now.version) return { ok: false, text: `v${version} is already active.` };
    const looser = flowLooser(now.flow, target.flow);
    if (looser.length && !controlsOn()) return { ok: false, text: `${CONTROLS_OFF} ${looser.join("; ")}.` };
    if (looser.length && !confirmed) return { ok: false, text: `Confirm first: ${looser.join("; ")}.` };
    await activateFlow(version, now.version);
    revalidatePath("/", "layout");
    await audit(me, "roll_back_flow", null, { version });
    return { ok: true, text: `Flow v${version} is active again.` };
  } catch (e) { return fail(e); }
}

/**
 * The Run chain button: starts a saved chain now, even while it is off (like the Run button on a
 * profile). Real runs, so DASHBOARD_CONTROLS=on; each agent still needs to be on duty.
 */
export async function runChainNow(key: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  try {
    const flow = await loadFlow(await loadCrew());
    const c = flow.flow.chains.find((x) => x.key === key);
    if (!c) return { ok: false, text: "That chain isn’t in the saved flow. Save first." };
    const origin = await selfOrigin();
    if (!origin) return { ok: false, text: "Can’t work out this app’s address to start the chain." };
    const chainId = crypto.randomUUID();
    await startStep(origin, c, { chainId, key: c.key, step: 0, manual: true });
    await audit(me, "run_chain_now", c.key, { chain: c.name });
    revalidatePath("/", "layout");
    const names = await Promise.all(c.steps.map(stepLabel));
    return { ok: true, text: `${c.name} started: ${names.join(", then ")}. An agent that is off duty is skipped and the chain stops there. Runs shows each step.` };
  } catch (e) { return fail(e); }
}

export interface ChainPreviewStep { agent: string; name: string; summary: string; next: string }

/**
 * Preview a chain from its Chains tab (saved or not): each step's dry run in order (real data, no
 * writes, no model, no cost, nothing logged), and what the chain would do after it. A dry run
 * reports no numbers, so a check is shown as not tested.
 */
export async function previewChain(raw: unknown): Promise<ActionResult & { steps?: ChainPreviewStep[] }> {
  const { no } = await asRole("approver"); if (no) return no;
  const key = String((raw as Chain | null)?.key ?? "");
  const got = await withChain(key, raw).catch((e) => ({ problem: e instanceof Error ? e.message : String(e) }));
  if ("problem" in got) return { ok: false, text: got.problem.replace(/^Not saved: /, "") };
  const c = got.next.chains.find((x) => x.key === key)!;
  const steps: ChainPreviewStep[] = [];
  const payer = c.steps.some((s) => s.ask) ? billedBy(c, await loadOrgChart()) : null;
  for (let k = 0; k < c.steps.length; k++) {
    const s = c.steps[k], name = await stepLabel(s);
    let summary: string, status: "ok" | "failed" = "ok";
    if (s.ask) {
      // a dry run sends nothing to a model: it says what would be asked, where and for how much
      const who = payer && "agent" in payer ? await nameOf(payer.agent) : null;
      summary = `Would ${askWords(s.ask, modelDef(s.ask.model)?.label ?? s.ask.model, who).replace(/^Ask/, "ask")}: “${s.ask.prompt.trim().slice(0, 200)}”${s.passAlong ? ", with the step before’s result as facts" : ""}. No tools, nothing sent.`;
    } else {
      try { summary = (await jobOf(s.agent)({ dryRun: true })).summary; }
      catch (e) { status = "failed"; summary = `Dry run failed: ${e instanceof Error ? e.message : String(e)}`; }
    }
    const nxt = c.steps[k + 1];
    let next = "End of the chain.";
    if (nxt) {
      const nn = await stepLabel(nxt);
      const when = nxt.when ?? "ok";
      const goes = when === "any" || (when === "ok" ? status === "ok" : status === "failed");
      next = !goes ? `${nn} would not run (${when === "ok" ? "only after a step that worked" : "only after a failure"}).`
        : `${nn} would run next${nxt.days && nxt.days !== "daily" ? ` ${dayWords(nxt.days)}` : ""}${nxt.notBefore ? `, not before ${nxt.notBefore}` : ""}${nxt.check ? `, if ${nxt.check.metric} ${nxt.check.op} ${nxt.check.value} (a dry run reports no numbers, so not tested)` : ""}${nxt.passAlong ? `, with ${name}’s summary passed along` : ""}.`;
      if (!goes) { steps.push({ agent: s.agent ?? "ask", name, summary, next }); break; }
    }
    steps.push({ agent: s.agent ?? "ask", name, summary, next });
  }
  return { ok: true, text: `Previewed ${c.name}: ${steps.length} step${steps.length === 1 ? "" : "s"}. Nothing was written or sent.`, steps };
}

// ---- Caps, vendors and suppressed addresses (Settings). Agents never call
// these: only a signed-in the owner. Tightening is always allowed; loosening needs a confirm and
// DASHBOARD_CONTROLS=on, and never passes the limit in code (CAPS in core/gateway/policy.ts).

export async function setCap(key: string, value: number, confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const caps = await loadCaps();
    const now = caps[key as CapKey]?.value;
    if (now === undefined) return { ok: false, text: `Unknown cap ${key}.` };
    const v = Number(value);
    const ch = capChange(key, now, v);
    if ("refuse" in ch) return { ok: false, text: ch.refuse };
    if (ch.looser && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
    if (ch.looser && !confirmed) return { ok: false, text: `Confirm first: ${CAPS[key as CapKey].label} from ${fmtCap(key as CapKey, now)} to ${fmtCap(key as CapKey, v)}.` };
    const { error } = await db().from("policies").upsert({ key, value_json: v, updated_at: new Date().toISOString() });
    if (error) return fail(error.message);
    await db().from("policy_log").insert({ key, old_value: caps[key as CapKey].raw ?? null, new_value: v, changed_by: me.email });
    revalidatePath("/", "layout");
    await audit(me, "set_cap", key, { value });
    return { ok: true, text: `${CAPS[key as CapKey].label}: ${fmtCap(key as CapKey, v)}. The gateway uses it from the next check.` };
  } catch (e) { return fail(e); }
}

const KINDS = ["importer", "packaging", "other"] as const;

/** Adds a payee. Only here, only the owner, DASHBOARD_CONTROLS=on. A first payment to a vendor always waits for approval. */
export async function addVendor(form: { name: string; kind: string; mercuryRecipientId: string; contactEmail: string }): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  const name = String(form.name ?? "").trim(), kind = KINDS.includes(form.kind as (typeof KINDS)[number]) ? form.kind : "other";
  const rid = String(form.mercuryRecipientId ?? "").trim(), email = String(form.contactEmail ?? "").trim().toLowerCase();
  if (!name || name.length > 120) return { ok: false, text: "Give the vendor a name (up to 120 characters)." };
  if (rid && !/^[0-9a-f-]{36}$/i.test(rid)) return { ok: false, text: "The Mercury recipient id is the long id from Mercury (Payments, Recipients). Leave it empty if the recipient isn’t in Mercury yet." };
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, text: "That contact email doesn’t look right." };
  const { error } = await db().from("vendors").insert({ name, kind, mercury_recipient_id: rid || null, contact_email: email || null, added_by: me.email });
  if (error) return fail(error.code === "23505" ? "That Mercury recipient is already a vendor." : error.message);
  revalidatePath("/settings", "layout");
  await audit(me, "add_vendor", form.name, { kind: form.kind });
  return { ok: true, text: `${name} added to vendors.${rid ? "" : " Add its Mercury recipient id before anything can be paid to it."}` };
}

/** Stops all email to an address. Always allowed: it only takes power away. */
export async function suppressEmail(address: string, reason: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  const email = String(address ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, text: "That isn’t an email address." };
  const { error } = await db().from("email_suppressions").upsert({ email, reason: String(reason ?? "").trim().slice(0, 200) || `Added by ${me.email}`, source: "owner" });
  if (error) return fail(error.message);
  revalidatePath("/settings", "layout");
  await audit(me, "suppress_email", address);
  return { ok: true, text: `No agent will email ${email}.` };
}

// ---- Agent builder (docs/agent-builder.md, docs/builder-flow.md). An agent built in the app is a
// versioned spec that picks from the tool list and models in code. Saving adds a draft, which
// spends nothing and changes nothing that runs, so it needs only the login. Try it is a real run of
// the draft that sends and saves nothing: it needs DASHBOARD_CONTROLS=on and counts against the
// agent's daily budget, even off duty. Go live makes the draft the version that runs, only after a
// try of that version where every step worked, with Controls on and a confirm for anything that
// lets it do or spend more. Going back to an earlier version is one tap, with the same confirm.
// The tool check is free. Being on or off duty is never changed here.


/** The active spec of an agent built in the app. Throws when the agent wasn't built here. */
async function builtAgent(agentId: string) {
  if (typeof agentId !== "string" || !/^[a-z0-9_]{1,60}$/.test(agentId)) throw new Error("Unknown agent.");
  const { data, error } = await db().from("agent_defs").select("version").eq("agent_id", agentId).limit(1);
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error("That agent wasn’t built in the app, so the builder can’t change it.");
  return loadSpec(agentId);
}

/** Tools from servers the owner added that aren't turned on now (or whose server is gone). */
async function customGone(spec: AgentSpec): Promise<string[]> {
  const ids = spec.tools.filter(isCustomToolId);
  if (!ids.length) return [];
  const on = new Set((await customMenu()).flatMap((s) => s.tools.map((t) => t.id)));
  return ids.filter((id) => !on.has(id)).map(() => "a tool from a server you added is no longer turned on (Connections)");
}

/** A model on another provider whose key isn't saved (or is paused) on Connections > Other models. */
async function modelGone(spec: AgentSpec): Promise<string[]> {
  if (modelDef(spec.model)?.provider === "anthropic") return [];
  const keys = await modelKeysReady().catch(() => NO_MODEL_KEYS);
  return modelReady(spec.model, keys) ? [] : [`${modelDef(spec.model)?.label ?? spec.model} needs its provider’s key on Connections > Other models`];
}

/** A draft from the builder, checked against code and, for tools from servers you added, against what is turned on. Problems refuse it; nothing is clamped. */
async function checkedDraft(draft: unknown, agentId: string): Promise<{ spec: AgentSpec } | { error: string }> {
  const { spec, problems } = readSpec(draft, agentId);
  const all = [...problems, ...(await customGone(spec)), ...(await modelGone(spec))];
  return all.length ? { error: `This draft asks for something code doesn’t offer: ${all.join("; ")}.` } : { spec };
}

/** Saves the flow's draft as the next version, a draft: today's version keeps running until Go live. */
export async function saveSpec(agentId: string, draft: unknown, note: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const why = String(note ?? "").trim().slice(0, 300) || "Edited in the builder";
  try {
    await builtAgent(agentId);
    const got = await checkedDraft(draft, agentId);
    if ("error" in got) return { ok: false, text: `Not saved. ${got.error}` };
    const versions = await listSpecVersions(agentId);
    const base = draftOf(versions) ?? versions.find((v) => v.active);
    if (base && JSON.stringify(base.spec) === JSON.stringify(got.spec)) return { ok: false, text: `Nothing changed from v${base.version}.` };
    const v = await saveSpecVersion(agentId, got.spec, why, me.email);
    revalidatePath("/", "layout");
    await audit(me, "save_spec", agentId, { version: v });
    return { ok: true, text: `Saved as draft v${v}. Try it, then go live; what runs today hasn’t changed.` };
  } catch (e) { return fail(e); }
}

/** Goes back to an earlier version in one tap. Anything that lets it do or spend more needs Controls on and a confirm. */
export async function goBack(agentId: string, version: number, confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!Number.isInteger(version) || version < 1) return { ok: false, text: "Unknown version." };
  try {
    const now = await builtAgent(agentId);
    const target = (await listSpecVersions(agentId)).find((v) => v.version === version);
    if (!target) return { ok: false, text: `There is no v${version}.` };
    if (now && version >= now.version) return { ok: false, text: `v${version} is newer than the live v${now.version}: try it, then go live.` };
    if (target.problems.length) return { ok: false, text: `v${version} asks for something code no longer offers: ${target.problems.join("; ")}.` };
    const looser = specLooser(now?.spec ?? null, target.spec);
    if (looser.length && !controlsOn()) return { ok: false, text: `${CONTROLS_OFF} v${version} lets a run do or spend more: ${looser.join("; ")}.` };
    if (looser.length && !confirmed) return { ok: false, text: `Confirm first: ${looser.join("; ")}.` };
    await activateSpecVersion(agentId, version);
    revalidatePath("/", "layout");
    await audit(me, "go_back", agentId, { version });
    return { ok: true, text: `Back on v${version}. The next run uses it.` };
  } catch (e) { return fail(e); }
}

/** A built agent's daily budget. Lowering is always allowed; raising needs DASHBOARD_CONTROLS=on. */
export async function setBuiltBudget(agentId: string, value: number): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!(Number.isFinite(value) && value >= 0 && value <= BUDGET_CEILING)) return { ok: false, text: `Pick a budget between $0 and $${BUDGET_CEILING} a day. $${BUDGET_CEILING} is the ceiling in code.` };
  try {
    await builtAgent(agentId);
    const { data: cur, error: e1 } = await db().from("agents").select("daily_budget_usd").eq("id", agentId).single();
    if (e1) return fail(e1.message);
    if (value > Number(cur.daily_budget_usd) && !controlsOn()) return { ok: false, text: CONTROLS_OFF };
    const v = Math.round(value * 100) / 100;
    const { error } = await db().from("agents").update({ daily_budget_usd: v }).eq("id", agentId);
    if (error) return fail(error.message);
    revalidatePath("/", "layout");
    await audit(me, "set_agent_budget", agentId, { usd: v });
    return { ok: true, text: `Budget saved: $${v.toFixed(2)} a day.` };
  } catch (e) { return fail(e); }
}

/**
 * Try it (step 5): one real run of the draft (or the live version when there is no draft) on
 * today's data, logged with trigger "preview" and its spec version, its steps saved as they happen
 * so the map can play it. It sends nothing, queues nothing and saves no output for other agents.
 * It follows the approved routine unless `fresh` asks the model to pick its own calls; afterwards
 * code drafts or updates the routine (core/playbook.ts), which Go live approves.
 */
export async function tryBuilt(agentId: string, fresh = false): Promise<ActionResult & { runId?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: `${CONTROLS_OFF} A try makes real model calls.` };
  try {
    const t = await tryTarget(agentId);
    if (typeof t === "string") return { ok: false, text: t };
    const { res, note, rid, version } = await tryOnce(agentId, t, fresh);
    revalidatePath("/", "layout");
    await audit(me, "try_agent", agentId, { version, cost_usd: res.costUsd ?? 0 });
    return { ok: res.status === "ok", text: `Try of v${version} done ($${(res.costUsd ?? 0).toFixed(4)}).${note}`, runId: rid ?? undefined };
  } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

/** A first try (card 194) in the background, like startRun: it answers once the run is logged. */
async function startTry(agentId: string, name: string): Promise<ActionResult> {
  const t = await tryTarget(agentId);
  if (typeof t === "string") return { ok: false, text: t };
  try {
    const first = await startTryRun(agentId, t, true);
    if (first.started) return { ok: true, text: `${name} is on a first try: it reads, sends nothing, and drafts the routine you approve.` };
    return { ok: first.done.res.status === "ok", text: `${name}: ${first.done.res.summary}${first.done.note}` };
  } catch (e) { return fail(e); }
}

/**
 * Go live (step 6): makes a version the one that runs, only after its latest try worked on every
 * step. It approves the routine that try drafted (with the steps the owner kept). On or off duty,
 * schedules and chains don't change.
 */
export async function goLive(agentId: string, version: number, keep: number[] | null, confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: `${CONTROLS_OFF} Going live changes what runs.` };
  if (!Number.isInteger(version) || version < 1) return { ok: false, text: "Unknown version." };
  try {
    const now = await builtAgent(agentId);
    const target = (await listSpecVersions(agentId)).find((v) => v.version === version);
    if (!target) return { ok: false, text: `There is no v${version}.` };
    if (target.problems.length) return { ok: false, text: `v${version} asks for something code no longer offers: ${target.problems.join("; ")}.` };
    const t = await lastTry(agentId, version);
    if (!t) return { ok: false, text: `Try v${version} first. Go live unlocks after a try where every step worked.` };
    if (!t.clean) return { ok: false, text: `Go live is locked: the latest try of v${version} ${t.why}. Try it again.` };
    // when it starts, if this version carries it (a draft from Claude, docs/operator-mcp.md slice 4): worked
    // out from today's flow, checked like any flow save, and listed on the confirm with the actions
    const starts = target.active ? null : readStored(await versionStarts(agentId, version));
    let plan: { flow: Flow; changed: boolean; manual: boolean; was: number; lines: string[] } | null = null;
    if (starts) {
      const [crew, roster] = await Promise.all([loadCrew(), getRoster()]);
      const fl = await loadFlow(crew);
      const r = flowWithStarts(fl.flow, crew.manualOnly.has(agentId), agentId, target.spec.name, starts);
      if ("refuse" in r) return { ok: false, text: `Go live is locked: ${r.refuse}. Save a new draft without that change, or change the schedule on Crew first.` };
      const manualOnly = new Set(crew.manualOnly);
      if (r.manual) manualOnly.add(agentId); else manualOnly.delete(agentId);
      const problems = flowProblems(r.flow, { ids: crew.ids.includes(agentId) ? crew.ids : [...crew.ids, agentId], manualOnly });
      if (problems.length) return { ok: false, text: `Go live is locked: ${problems.join(" ")}` };
      const names = Object.fromEntries(Object.values(roster.byId).map((a) => [a.id, a.name]));
      plan = { flow: r.flow, changed: JSON.stringify(r.flow) !== JSON.stringify(fl.flow), manual: r.manual, was: fl.version, lines: startsWords(starts, names) };
    }
    const looser = target.active ? [] : specLooser(now?.spec ?? null, target.spec);
    const asks = [...looser, ...(plan?.lines ?? [])];
    if (asks.length && !confirmed) return { ok: false, text: `Confirm first: ${asks.join("; ")}.` };
    const all = await listPlaybooks(agentId);
    const pending = pendingPlaybook(all);
    let routine = "";
    if (pending) {
      const v = await withActor(me.email, () => approvePlaybook(agentId, pending.id, Array.isArray(keep) ? keep.map(Number).filter(Number.isInteger) : pending.steps.map((_, i) => i)));
      routine = ` Routine v${v} approved.`;
    } else if (!activePlaybook(all)) return { ok: false, text: "No routine yet: try it fresh, so code can save the calls that worked." };
    if (!target.active) await activateSpecVersion(agentId, version);
    let sched = "";
    if (plan) {
      // like setAgentTime: allow schedules first, then the flow; by hand: the flow first, then mark it by hand
      try {
        if (!plan.manual) { const { error } = await db().from("agents").update({ manual_only: false }).eq("id", agentId); if (error) throw new Error(error.message); }
        if (plan.changed) await saveFlowVersion(plan.flow, `${target.spec.name}: from v${version}`.slice(0, 300), me.email, plan.was);
        if (plan.manual) { const { error } = await db().from("agents").update({ manual_only: true }).eq("id", agentId); if (error) throw new Error(error.message); }
        sched = ` ${plan.lines.join(". ")}.`;
      } catch (e) { sched = ` Its schedule didn’t change: ${e instanceof Error ? e.message : String(e)}. Set it on Crew.`; }
    }
    revalidatePath("/", "layout");
    await audit(me, "go_live", agentId, { version, playbook: routine ? "approved" : "unchanged", ...(plan ? { starts: plan.lines } : {}) });
    return { ok: true, text: `v${version} is live.${routine}${sched} On or off duty hasn’t changed.` };
  } catch (e) { return fail(e); }
}


// ---- Trust levels (card 7, docs/trust.md)

const TRUST_KEY = /^[a-z0-9_]{1,60}$/;
const toolOk = (t: string) => Object.prototype.hasOwnProperty.call(WRITE_TOOLS, t);

/** The owner accepts a promotion card: that agent's tool moves up one level, if its record still earns it. */
export async function acceptPromotion(agentId: string, tool: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!TRUST_KEY.test(agentId) || !toolOk(tool)) return { ok: false, text: "Unknown promotion." };
  try {
    const to = await acceptOffer(agentId, tool, me.email);
    revalidatePath("/", "layout");
    await audit(me, "accept_promotion", `${agentId}:${tool}`, { to });
    return { ok: true, text: `Promoted to ${LEVEL_WORDS[to]}. Back to Draft any time from Approvals.` };
  } catch (e) { revalidatePath("/", "layout"); return fail(e); }
}

/** "Not yet" on a promotion card: offered again after more decisions. */
export async function declinePromotion(agentId: string, tool: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!TRUST_KEY.test(agentId) || !toolOk(tool)) return { ok: false, text: "Unknown promotion." };
  try {
    await declineOffer(agentId, tool);
    revalidatePath("/", "layout");
    await audit(me, "decline_promotion", `${agentId}:${tool}`);
    return { ok: true, text: "Not yet. It stays where it is and is offered again after 10 more decisions." };
  } catch (e) { return fail(e); }
}

/** Back to Draft by hand: every one waits for an approval again, and anything in its undo window is cancelled. */
export async function trustToDraft(agentId: string, tool: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!TRUST_KEY.test(agentId) || !toolOk(tool)) return { ok: false, text: "Unknown action type." };
  try {
    const moved = await demote(agentId, tool, `Put back to Draft by ${me.email}.`, me.email);
    revalidatePath("/", "layout");
    await audit(me, "trust_to_draft", `${agentId}:${tool}`);
    return { ok: true, text: moved ? "Back to Draft: every one waits for your approval again." : "It was already at Draft." };
  } catch (e) { return fail(e); }
}

/** Cancels an action in its undo window. "Wrong" or "against the rules" drops its type back to Draft. */
export async function cancelAction(actionId: string, kind: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(actionId) || !isRejectKind(kind)) return { ok: false, text: "Unknown action." };
  try {
    const text = await cancelScheduled(actionId, kind, me.email);
    revalidatePath("/", "layout");
    if (!text) return { ok: false, text: "Too late: its undo window already ended, or it was cancelled." };
    await audit(me, "cancel_action", actionId, { kind });
    return { ok: true, text };
  } catch (e) { return fail(e); }
}

// ---- Agents that run in Claude (docs/live-events.md, slice 2): the routine a linked agent fires, and moving it in

/** Seals a linked agent's routine id and token. Owner only: it lets OPERATOR start sessions on the owner's Claude account. */
export async function routineSave(agentId: string, routine: string, token: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const who = await crewAgent(agentId);
  if (!who) return { ok: false, text: "Unknown agent." };
  if ((await runsOn(agentId)).on !== "claude") return { ok: false, text: `${who.name} runs in OPERATOR, so it has no Claude routine.` };
  try { await saveRoutine(agentId, routine, token); } catch (e) { return fail(e); }
  await audit(me, "routine_save", agentId);
  revalidatePath("/", "layout");
  return { ok: true, text: `Saved. Each run of ${who.name} now fires that routine. The token is locked away and isn't shown again.` };
}

/** Forgets a linked agent's routine token and takes it off duty, since it can't fire any more. Approvers may: it only stops things. */
export async function routineRemove(agentId: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  const who = await crewAgent(agentId);
  if (!who) return { ok: false, text: "Unknown agent." };
  try {
    await removeRoutine(agentId);
    const { error } = await db().from("agents").update({ enabled: false }).eq("id", agentId);
    if (error) throw new Error(error.message);
  } catch (e) { return fail(e); }
  await audit(me, "routine_remove", agentId);
  revalidatePath("/", "layout");
  return { ok: true, text: `${who.name}'s routine token is forgotten and ${who.name} is off duty. To revoke it at Claude too, delete the token on the routine at claude.ai.` };
}

/**
 * Where it runs (card 405, the Runs on picker): moves an agent to a Claude routine, or back into OPERATOR. Owner
 * only, since a routine starts sessions on the owner's Claude account. Either way it goes off duty and keeps its
 * runs, history, schedule and chains; its saved reads and can do stay in its versions (unused while in Claude, and
 * never carried there). A new model inside OPERATOR isn't this: it is a draft version (saveSpec), tried, then live.
 */
export async function setRunsOn(agentId: string, raw: unknown, confirmed: boolean): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const who = await crewAgent(agentId);
  if (!who) return { ok: false, text: "Unknown agent." };
  try {
    const [where, spec, keys] = await Promise.all([runsOn(agentId), loadSpec(agentId), modelKeysReady()]);
    const current = spec?.spec.model ?? null;
    const models = MODEL_LIST.map((m) => ({ id: m.id, label: m.label, provider: m.provider, ready: modelReady(m.id, keys) }));
    const to = readRunsOn(raw, models, current);
    if ("problem" in to) return { ok: false, text: to.problem };
    const kind = switchKind({ on: where.on, model: current }, to);
    if (kind === "same" || kind === "model") return { ok: true, text: "" };
    const ask = switchConfirm(kind, who.name);
    if (ask && !confirmed) return { ok: false, text: ask };
    const { error } = await db().from("agents").update({ enabled: false }).eq("id", agentId);
    if (error) throw new Error(error.message);
    const toClaude = to.on === "claude";
    if (to.on === "claude") await markLinked(agentId);
    else await moveAgentIntoOperator(agentId);
    await audit(me, toClaude ? "move_into_claude" : "move_into_operator", agentId, to.on === "claude" ? {} : { model: to.model });
    revalidatePath("/", "layout");
    return { ok: true, text: toClaude
      ? `${who.name} now runs in Claude, off duty. Connect its routine below, then put it on duty.`
      : `${who.name} now runs in OPERATOR, off duty. Give it the reads its job needs, try it, and go live.` };
  } catch (e) { return fail(e); }
}

/**
 * New agent (card 420): the owner builds an agent by hand on the blank agent sheet. The form is checked in code
 * (dashboard/new-agent-rules.ts), its spec like any builder save (readSpec, model keys, tools turned on), and its
 * actions only those open to any agent an approver grants. It is created off duty as v1 (createBuiltAgent), then
 * marked as running in Claude, seated, given its start and budget, each through the same code and checks as its
 * sheet. Nothing here puts it on duty. `tryIt` also starts one try in the background (Controls on).
 */
export async function createAgentByHand(raw: unknown, tryIt = false): Promise<ActionResult & { agentId?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const read = readNewAgent(raw, BUDGET_CEILING);
  if ("problem" in read) return { ok: false, text: read.problem };
  const f = read.form;
  const closed = closedActions(f.tools, (id) => (CATALOG[id]?.kind === "action" ? (CATALOG[id].agents === "granted" ? "granted" : CATALOG[id].agents ?? null) : undefined));
  if (closed.length) return { ok: false, text: `Not created. ${closed.map((id) => CATALOG[id]?.label ?? id).join(", ")} can’t be given to a new agent here.` };
  const linked = f.runsOn.on === "claude";
  if (tryIt && linked) return { ok: false, text: "An agent that runs in Claude tries once after its routine is connected. Press Create." };
  if (tryIt && !controlsOn()) return { ok: false, text: `${CONTROLS_OFF} A try makes real model calls. Press Create instead.` };
  try {
    const got = await checkedDraft(newSpecDraft(f, "claude-haiku-5-5", { maxSteps: RUN_LIMITS.maxSteps.default, maxCostUsd: RUN_LIMITS.maxCostUsd.default }), "");
    if ("error" in got) return { ok: false, text: `Not created. ${got.error}` };
    // the department and seat, named before anything is made, so a wrong pick makes nothing
    if (f.place) {
      const org = await loadOrgChart();
      const d = org?.departments.find((x) => x.id === f.place!.deptId);
      if (!org || !d) return { ok: false, text: "Not created. That department isn’t on the chart any more." };
      if (f.place.seatId && !org.seats.some((s) => s.id === f.place!.seatId && s.departmentId === d.id && s.holder === "open")) return { ok: false, text: "Not created. That seat isn’t open any more." };
    }
    if (f.start.kind === "after" && !(await crewAgent(f.start.agentId))) return { ok: false, text: "Not created. The agent it runs after isn’t on the crew." };
    const id = await createBuiltAgent(got.spec, me.email, linked ? "Created by hand, runs in Claude" : "Created by hand on its sheet");
    await audit(me, "create_agent", id, { name: got.spec.name, via: "new_agent_sheet", ...(linked ? { runs_on: "claude" } : {}) });
    const misses: string[] = [];
    const miss = (what: string, e: unknown) => misses.push(`${what} wasn’t set: ${e instanceof Error ? e.message : String(e)}`);
    if (f.role) { const { error } = await db().from("agents").update({ role: f.role }).eq("id", id); if (error) miss("Its role", error.message); }
    if (linked) {
      try {
        await markLinked(id);
        // its trigger and key, when typed on the New agent sheet: sealed the same way as on its sheet (routineSave)
        if (f.runsOn.on === "claude" && f.runsOn.routine) { await saveRoutine(id, f.runsOn.routine.routine, f.runsOn.routine.token); await audit(me, "routine_save", id); }
      } catch (e) { miss("Its Claude routine", e); }
    }
    let where: string | null = null;
    if (f.place) {
      try {
        const r = await withActor(me.email, () => placeAgent(id, f.place!.deptId, { seatId: f.place!.seatId, title: seatTitleFor({ name: f.name, role: f.role }), sub: jobLine(f.job).slice(0, 120) }));
        where = `in ${r.words}`;
      } catch (e) { miss("Its seat", e); }
    }
    if (f.budget !== 1) { const r = await setBuiltBudget(id, f.budget); if (!r.ok) misses.push(`Its budget stays $1.00 a day: ${r.text}`); }
    // its start, through the sheet's own actions; off duty, so it takes effect only once it is put on duty
    if (f.start.kind === "schedule") { const r = await setAgentTime(id, { days: f.start.days, time: f.start.time }, true); if (!r.ok) misses.push(`Its schedule wasn’t set: ${r.text}`); }
    if (f.start.kind === "after") { const r = await followAgent(id, f.start.agentId, f.start.passAlong, true); if (!r.ok) misses.push(`It doesn’t run after another agent yet: ${r.text}`); }
    let tried: string | null = null;
    if (tryIt) { const t = await startTry(id, f.name); tried = t.text; }
    revalidatePath("/", "layout");
    return { ok: true, text: createdWords(f.name, where, misses, tried), agentId: id };
  } catch (e) { return fail(e); }
}
