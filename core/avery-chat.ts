import "server-only";
// Avery's chat, the front door (docs/company-mode.md, slice 5). The owner types to the agent in the company
// seat from any screen; each message is one run through withRun, so it is logged in agent_runs and
// stays inside her daily budget. The run uses the shared runner (core/runner.ts) with:
//
// - her active spec's model and cost cap, her read and calculate tools, Goal progress, and The crew
//   now (below);
// - two chat-only report tools, offered nowhere else (they are not in the builder's tool list):
//   Save a rule, whose words must be the owner's own from this message (checked in code), and File a
//   proposal, which goes through fileProposal like a head's and does nothing until his yes.
//
// Nothing here runs, starts or changes an agent, and nothing sends, pays or posts. Rules and
// proposals are saved only after a run that finishes; code, not the model, says what it saved.
import { orgDate, orgTz } from "@/core/tz";
import { db } from "@/core/db";
import { loadSpec, type AgentSpec } from "@/core/agent-spec";
import { loadMemory } from "@/core/memory";
import { agentNames, companySeat, liveAgentIds, loadOrg, seatOf, type Org } from "@/core/org";
import { planReaction } from "@/core/reaction-rules";
import { saveRule } from "@/core/reactions";
import { runExplore } from "@/core/runner";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS, type Business } from "@/core/business-rules";
import { withRun } from "@/core/runs";
import { dayTitle, localDate } from "@/core/time";
import { TOOLS } from "@/core/tools/catalog";
import type { ToolDef } from "@/core/tools/types";
import { weekOf } from "@/core/plan-rules";
import { DRAFT_PARTS, MAX_DRAFT_PARTS } from "@/core/department-rules";
import { similarTool } from "@/core/brain-tools";
import { similarNote, type Similar } from "@/core/brain-rules";
import { MAX_FILED, MAX_REPLY, MAX_RULES, chatPrompt, deptNamed, inOwnWords, resolveRuleWho, savedLines, type ChatLine, type ChatReach } from "@/core/chat-rules";

export const CHAT_MISSING = "The chat table isn’t in Supabase yet: apply the migration 20261124090000_avery_chat.sql. Until then Avery answers but the conversation isn’t kept.";
export interface ChatRow { id: string; role: "owner" | "avery"; text: string; run_id: string | null; notes: string[]; created_at: string }

/** The latest messages, oldest first. Null when the table isn't there. */
export async function chatHistory(limit = 30): Promise<ChatRow[] | null> {
  const { data, error } = await db().from("avery_chat").select("id, role, text, run_id, notes, created_at").order("created_at", { ascending: false }).limit(limit);
  if (error) return null;
  return ((data ?? []) as ChatRow[]).map((r) => ({ ...r, notes: Array.isArray(r.notes) ? r.notes : [] })).reverse();
}

/** What the owner asked, for the replay of the chat run that answered it: Avery's chat or a department head's. Null when it isn't kept. */
export async function askedIn(runId: string): Promise<string | null> {
  const { data: reply } = await db().from("avery_chat").select("created_at").eq("run_id", runId).eq("role", "avery").maybeSingle();
  if (reply) {
    const { data } = await db().from("avery_chat").select("text").eq("role", "owner").lt("created_at", reply.created_at).order("created_at", { ascending: false }).limit(1).maybeSingle();
    return (data?.text as string | undefined) ?? null;
  }
  const { data: head } = await db().from("dept_chat").select("created_at, department_id").eq("run_id", runId).eq("role", "head").maybeSingle();
  if (!head) return null;
  const { data } = await db().from("dept_chat").select("text").eq("department_id", head.department_id).eq("role", "owner").lt("created_at", head.created_at).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return (data?.text as string | undefined) ?? null;
}

/** Saves one side of the conversation (also used by setup, core/setup.ts). */
export async function keepChat(row: { role: "owner" | "avery"; text: string; run_id?: string | null; notes?: string[] }): Promise<boolean> {
  const { error } = await db().from("avery_chat").insert({ role: row.role, text: row.text.slice(0, 4000), run_id: row.run_id ?? null, notes: row.notes ?? [] });
  return !error;
}

/** Who holds the company seat, from the chart. */
async function frontDoor(): Promise<{ org: Org; agentId: string; spec: AgentSpec } | { problem: string }> {
  const org = await loadOrg();
  if (!org) return { problem: "The org chart isn't set up, so there is no company seat for Avery." };
  const seat = companySeat(org);
  if (!seat || seat.holder !== "agent" || !seat.agentId) return { problem: "Nobody holds the company seat. Put Avery in it on Company › Departments › Chart › Edit seats." };
  const loaded = await loadSpec(seat.agentId);
  if (!loaded) return { problem: "The agent in the company seat has no saved version." };
  return { org, agentId: seat.agentId, spec: loaded.spec };
}

const directive = (name: string, biz: Business) => `You are ${name}, chief of staff at ${biz.name}, talking in the Control Room with a person from the business. Answer their questions about the company from your tools: goals, department reports, this week's plans, proposals, the crew and the numbers. Short plain sentences, at most about 120 words. No flattery, no exclamation marks.

Besides answering you can do only these things:
- When they tell you a rule for an agent, a department or everyone ("Rowan: skip chains", "Quinn keeps putting Costco in supplies, it's groceries"), save it with Save a rule. The words must be their own, copied from their message; who is the agent, the department or everyone they mean. If it isn't clear who should follow it, ask them instead of saving.
- When they want to hire, give an agent a read tool, get a new tool built, or retire an agent or close a seat, file it with File a proposal. Nothing happens until an owner says yes on Proposals. Ask first if you don't know enough to fill it in.
- When they want an agent put in a department (one in no department, which The crew now lists, or one moving from another department), file a move_agent with File a proposal: the agent, the department, and seat only when they named an open seat (otherwise it gets a new seat under the head). It shows as a move card in that department's chat for them to approve; only where the agent sits changes.
- When they describe new work, first decide whether it needs one new agent or a new department, using The crew now. Suggest one agent (a hire into the department it fits) when it is one job, or when an existing department's purpose already covers it. Suggest a new department only when it is its own area: its own goals to measure, more than one job, and no department that fits. Say which you suggest and why in a sentence. If they ask for a department and one agent would do, say so and offer both; it's their call.
- When they want a new department, find out what it is for and what to track. As soon as you know that, fill in the whole draft yourself with Update the department draft, in the same reply: the name, purpose and tracks; at least one goal (a measure from Department menu when one fits, otherwise in words); where the information lives (a tool they connected, a server they added, or a service to ask for, by name, never an address); and a head with a name, a seat, a job and the closest read tools from Department menu (Read a web page, Web search or Goal progress when nothing reads the source yet; with no tools at all the head starts with Goal progress). Add up to 2 narrow agents only when the work needs them. Then tell them what you suggested in a few lines and ask them to confirm or change it. Never end a reply about a department while the draft still needs something you could suggest. They propose the draft themselves from the card in the chat; you never create a department.

You never run, start, stop or change an agent, and you never send, buy or post. If they ask for that, tell them where in the Control Room they can do it. Code saves rules, proposals and draft parts only after you finish and adds a line under your reply saying what it saved or refused, so don't say you saved anything yourself, and never say a part is in the draft unless you called Update the department draft for it.`;

/**
 * The crew now: who sits where, on duty or not, how each agent's last run went, this week's plans and the
 * proposals waiting. With `deptId` (a head's chat, core/head-chat.ts) it shows only that department.
 */
export function crewNowTool(org: Org, deptId?: string): ToolDef {
  return {
    id: "crew_now", label: "The crew now", detail: "Every department with its seats (who holds each, on duty or not, the last run), this week's plan and review per department, agents not in a department, and the proposals waiting for a decision",
    kind: "read", group: "agents", params: [], trusted: false, needs: [], costUsd: 0,
    run: async () => {
      const live = await liveAgentIds();
      const ids = [...live];
      const [names, agents, runs, plans, props] = await Promise.all([
        agentNames(ids),
        db().from("agents").select("id, enabled").in("id", ids),
        db().from("agent_runs").select("agent_id, status, started_at, summary, error").in("agent_id", ids).not("trigger", "in", "(preview,chat)").order("started_at", { ascending: false }).limit(300),
        db().from("plans").select("department_id, summary, items, review").eq("week_of", weekOf((await orgDate(0)))),
        db().from("proposals").select("title, kind, from_agent, created_at").eq("state", "pending").order("created_at").limit(30),
      ]);
      const onDuty = new Map((agents.data ?? []).map((a) => [a.id as string, !!a.enabled]));
      const last = new Map<string, { status: string; at: string; said: string }>();
      for (const r of runs.data ?? []) if (!last.has(r.agent_id)) last.set(r.agent_id, { status: r.status, at: r.started_at, said: String(r.error ?? r.summary ?? "").replace(/\s+/g, " ").slice(0, 240) });
      const who = (id: string | null | undefined) => (id ? { agent: names[id] ?? id, onDuty: onDuty.get(id) ?? false, lastRun: last.get(id) ?? null } : null);
      const planOf = (deptId: string) => {
        const p = (plans.data ?? []).find((x) => x.department_id === deptId);
        if (!p) return null;
        const items = (Array.isArray(p.items) ? p.items : []) as { title: string; who: string; kind: string; doneAt?: string }[];
        return { words: p.summary, lines: items.map((i) => ({ job: i.title, who: i.who, ...(i.kind === "owner" ? { done: !!i.doneAt } : {}) })), review: p.review };
      };
      const departments = org.departments.filter((d) => !deptId || d.id === deptId).map((d) => ({
        department: d.name,
        seats: org.seats.filter((s) => s.departmentId === d.id).map((s) => ({ seat: s.title, head: s.parentId == null, holder: s.holder === "agent" ? who(s.agentId) : s.holder === "owner" ? "a person" : "open" })),
        planThisWeek: planOf(d.id),
      }));
      const loose = deptId ? [] : ids.filter((id) => !seatOf(org, id)).map((id) => who(id));
      const waiting = (props.data ?? []).map((p) => ({ title: p.title, kind: p.kind, from: p.from_agent ? names[p.from_agent] ?? p.from_agent : "a person" }));
      return {
        data: { departments, notInADepartment: loose, proposalsWaiting: props.error ? "the proposals table isn't there" : waiting },
        numbers: { agents_on_duty: [...onDuty.values()].filter(Boolean).length, agents: ids.length, open_seats: org.seats.filter((s) => s.holder === "open").length, proposals_waiting: waiting.length },
      };
    },
  };
}

/** Save a rule: the person's words for an agent, a department or everyone. Checked against their message in code. */
export function saveRuleTool(message: string, reach: ChatReach, companyId: string): ToolDef {
  return {
    id: "save_rule", label: "Save a rule", detail: "Saves a rule the person just dictated, in their own words, for an agent, a department or everyone. Saved after you finish; code says what it saved",
    kind: "report", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [
      { name: "words", type: "text", maxLength: 280, description: "The rule, copied word for word from their message. Never your own words." },
      { name: "who", type: "text", maxLength: 60, description: "An agent's name, a department's name, or everyone." },
      { name: "keep", type: "enum", options: ["always", "days_30", "next_run"], default: "always", description: "How long: always, 30 days, or the next run only. Only an agent's own rule can be short-lived." },
    ],
    collect: (input, held) => {
      if (held.length >= MAX_RULES) return { problem: `at most ${MAX_RULES} rules from one message` };
      if (!inOwnWords(String(input.words), message)) return { problem: "the words must be their own, copied from their message" };
      const w = resolveRuleWho(String(input.who), reach);
      if ("problem" in w) return w;
      return { row: input };
    },
    deliver: async (o, ctx) => {
      const notes: string[] = [];
      for (const r of o.rows) {
        const w = resolveRuleWho(String(r.who), reach);
        if ("problem" in w) { notes.push(`Not saved (“${r.words}”): ${w.problem}.`); continue; }
        const got = planReaction({ verdict: "not", text: String(r.words), scope: w.scope, keep: String(r.keep ?? "always") }, { hasDept: true });
        if ("error" in got || !got.plan.rule) { notes.push(`Not saved (“${r.words}”): ${"error" in got ? got.error : "no words"}`); continue; }
        try {
          await saveRule({ scope: w.scope, agentId: w.scope === "agent" ? w.agentId : companyId, deptId: w.scope === "department" ? w.deptId : null, keep: got.plan.rule.keep, text: got.plan.rule.text, tag: `chat:${ctx.runId ?? ""}` });
          const forWho = w.scope === "crew" ? "every agent" : w.name;
          const when = got.plan.rule.keep === "next_run" ? ", for the next run only" : got.plan.rule.keep === "days_30" ? ", for 30 days" : "";
          notes.push(`Saved for ${forWho} in your words${when}: “${got.plan.rule.text}”. Undo on the Memory tab.`);
        } catch (e) { notes.push(`Not saved (“${r.words}”): ${e instanceof Error ? e.message : e}`); }
      }
      return notes.join(" | ") || "nothing to save";
    },
  };
}

/**
 * File a proposal: the same checks as a head's Propose to the owner, plus which department it is for.
 * `ownDept` (a head's chat): a proposal that names no department is for the head's own.
 */
export function fileProposalTool(reach: ChatReach, ownDept?: string): ToolDef {
  const base = TOOLS.propose;
  return {
    id: "file_proposal", label: "File a proposal", detail: `Files a proposal for an owner to decide on Proposals: hire an agent, give an agent a read tool, build a new tool, retire an agent or close a seat, set, change or drop a department's goal${ownDept ? "" : ", or put an agent in a department (move_agent)"}. Nothing happens until an owner says yes`,
    kind: "report", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [
      // card 370: Avery (no ownDept) may also put an agent in a department; a head's chat can't
      ...base.params.map((x) => (x.name === "kind" && x.type === "enum" && !ownDept
        ? { ...x, options: [...x.options, "move_agent"], description: `${x.description} move_agent: put an agent in a department (agent, department, and seat only for an open seat they named).` }
        : x.name === "agent" && !ownDept ? { ...x, description: `${x.description.replace(/\.$/, "")}; move_agent: the agent to put in a department.` } : x)),
      { name: "department", type: "text", maxLength: 60, optional: true, description: `hire for a new seat: the department it joins (it goes under that department's head). goal: the department the goal is for.${ownDept ? "" : " move_agent: the department it goes to."}` },
    ],
    collect: (input, held) => {
      if (held.length >= MAX_FILED) return { problem: `at most ${MAX_FILED} proposals from one message` };
      const d = deptNamed(input.department as string | undefined, reach.departments);
      if ("problem" in d) return d;
      return base.collect!(input, held);
    },
    deliver: async (o, ctx) => {
      if (!o.rows.length) return "no proposals";
      const { fileProposal } = await import("@/core/proposals");
      const notes: string[] = [];
      for (const r of o.rows) {
        const d = deptNamed(r.department as string | undefined, reach.departments);
        try {
          await fileProposal(r, { agentId: ctx.agentId, runId: ctx.runId ?? null, source: "agent", deptId: ("id" in d ? d.id : null) ?? ownDept ?? null });
          notes.push(r.kind === "hire" && ownDept ? `Drafted a hire card for you: ${r.title}.`
            : r.kind === "move_agent" ? `Filed a move card for you: ${r.title}. Approve it in that department's chat or on Proposals.`
            : `Filed for you to decide: ${r.title}. It waits on Proposals.`);
        } catch (e) { notes.push(`Not filed (${r.title}): ${e instanceof Error ? e.message : e}`); }
      }
      return notes.join(" | ");
    },
  };
}

/** Card 156: what a department can use, and the draft so far, for the interview. */
function departmentMenuTool(): ToolDef {
  return {
    id: "department_menu", label: "Department menu", detail: "For designing a new department with the person: the measures a goal can use (key, label, unit; the business's own goal numbers included), the read tools an agent may have (id, label, what it reads), the tools connected and the servers they added, and the department draft so far with what it still needs",
    kind: "read", group: "agents", params: [], trusted: true, needs: [], costUsd: 0,
    run: async () => {
      const [{ loadDraft, draftCtx, sourcesNow }, { draftGaps }, { MEASURES }, { ownMeasureDefs }, { listCustomServers }] = await Promise.all([
        import("@/core/departments"), import("@/core/department-rules"), import("@/core/goal-rules"), import("@/core/goals"), import("@/integrations/mcp"),
      ]);
      const [d, own, servers, ctx] = await Promise.all([loadDraft(), ownMeasureDefs().catch(() => []), listCustomServers().catch(() => []), draftCtx()]);
      const measures = [...MEASURES, ...own].filter((m) => m.available).map((m) => ({ key: m.key, label: m.label, unit: m.unit, kind: m.shape }));
      const tools = Object.values(TOOLS).filter((t) => (t.kind === "read" || t.kind === "calculate") && !t.server && !t.codeOnly).map((t) => ({ id: t.id, label: t.label, reads: t.detail.slice(0, 140) }));
      return {
        data: {
          measures, readTools: tools,
          serversYouAdded: servers.map((c) => c.name),
          departmentsNow: ctx.departments,
          draft: d ? { ...d, sources: await sourcesNow(d).catch(() => d.sources), stillNeeds: draftGaps(d) } : null,
        },
        numbers: { measures: measures.length, read_tools: tools.length },
      };
    },
  };
}

/** Card 156: Update the department draft, one part per call. Code checks and saves each part after the run. */
function departmentDraftTool(): ToolDef {
  return {
    id: "update_department_draft", label: "Update the department draft", detail: "Fills in the draft of a new department as the person describes it, one part per call: about (name, purpose, tracks), a goal, a source, the head, a narrow agent, or remove one. Saved after you finish; code checks every part and says what it saved. It never creates anything: the person proposes the draft, then approves it",
    kind: "report", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [
      { name: "part", type: "enum", options: ["about", "goal", "source", "head", "agent", "remove"], description: "Which part this call changes." },
      { name: "name", type: "text", maxLength: 40, optional: true, description: "about: the department's name. head or agent: a short first name, starting with a capital. remove: the agent's name." },
      { name: "purpose", type: "text", maxLength: 200, optional: true, description: "about: what the department is for, in one sentence." },
      { name: "tracks", type: "text", maxLength: 500, optional: true, description: "about: what it keeps track of, separated by semicolons (at most 6)." },
      { name: "title", type: "text", maxLength: 120, optional: true, description: "goal: the goal in words. remove: the goal's title." },
      { name: "measure", type: "text", maxLength: 40, optional: true, description: "goal: a measure key from Department menu, or none when no number exists yet." },
      { name: "target", type: "text", maxLength: 20, optional: true, description: "goal: the number the person said, only with a measure." },
      { name: "service", type: "text", maxLength: 60, optional: true, description: "source: the service's name (Shopify, Cropster, their own server's name). Never an address. remove: the service." },
      { name: "what", type: "text", maxLength: 200, optional: true, description: "source: what the department reads there." },
      { name: "seat", type: "text", maxLength: 60, optional: true, description: "head or agent: the seat's title, like Head of operations or Cover watcher." },
      { name: "job", type: "text", maxLength: 200, optional: true, description: "head or agent: what it does, in one sentence." },
      { name: "each_run", type: "text", maxLength: 1500, optional: true, multiline: true, description: "head or agent: what it does on each run, step by step." },
      { name: "good_result", type: "text", maxLength: 400, optional: true, description: "head or agent: what a good result looks like." },
      { name: "tools", type: "text", maxLength: 300, optional: true, description: "head or agent: read tool ids from Department menu, comma separated (at most 8). A head may leave it empty when nothing reads its source yet: it starts with goal_progress." },
      { name: "brain", type: "enum", options: ["quick", "thinking"], default: "quick", description: "head or agent: quick for most jobs; thinking only when the job needs judgment." },
    ],
    collect: (input, held) => {
      if (held.length >= MAX_DRAFT_PARTS) return { problem: `at most ${MAX_DRAFT_PARTS} draft updates from one message` };
      if (!DRAFT_PARTS.includes(String(input.part) as (typeof DRAFT_PARTS)[number])) return { problem: "part must be about, goal, source, head, agent or remove" };
      return { row: input };
    },
    deliver: async (o) => {
      if (!o.rows.length) return "nothing to save";
      const { updateDraft } = await import("@/core/departments");
      return (await updateDraft(o.rows)).join(" | ") || "nothing to save";
    },
  };
}

/** Card 440: the gaps line for a chat run that touched the department draft or talked about one; "" otherwise. */
async function draftGapLine(reports: readonly { tool: string; note: string }[], reply: string, message: string): Promise<string> {
  // every report tool is delivered after a finished run, so only a draft update that saved or refused something counts
  const about = reports.some((r) => r.tool === "update_department_draft" && !!r.note && r.note !== "nothing to save") || /department/i.test(`${reply} ${message}`);
  if (!about) return "";
  const [{ loadDraft }, { draftGaps, gapNote }] = await Promise.all([import("@/core/departments"), import("@/core/department-rules")]);
  const d = await loadDraft();
  return d ? gapNote(draftGaps(d)) : "";
}

export interface ChatAnswer { ok: boolean; reply: string; notes: string[]; runId: string | null; costUsd: number; kept: boolean }

/** One message to Avery: a logged run (trigger "chat") inside her budget. Saves both sides of the conversation. */
export async function askAvery(message: string): Promise<ChatAnswer> {
  const door = await frontDoor();
  if ("problem" in door) return { ok: false, reply: door.problem, notes: [], runId: null, costUsd: 0, kept: false };
  const { org, agentId, spec: base } = door;
  const history = (await chatHistory(12)) ?? [];
  const kept = await keepChat({ role: "owner", text: message });
  const live = await liveAgentIds();
  const names = await agentNames([...live]);
  const reach: ChatReach = { agents: [...live].map((id) => ({ id, name: names[id] ?? id })), departments: org.departments.map((d) => ({ id: d.id, name: d.name })) };
  // the shared brain (card 233, cloud edition only): what businesses like this one found
  const heldSimilar: { got: Similar[] } = { got: [] };
  const similar = similarTool(heldSimilar);
  const chatTools = [crewNowTool(org), saveRuleTool(message, reach, agentId), fileProposalTool(reach), departmentMenuTool(), departmentDraftTool(), ...(similar ? [similar] : [])];
  const reads = base.tools.filter((id) => (TOOLS[id]?.kind === "read" || TOOLS[id]?.kind === "calculate") && !TOOLS[id]?.server);
  const spec: AgentSpec = {
    ...base,
    directive: directive(base.name, await loadBusiness().catch(() => UNKNOWN_BUSINESS)),
    goodResult: "A short plain answer, at most about 120 words. Every number exactly as a tool gave it.",
    effort: "low",
    tools: [...new Set([...reads, "goal_progress", ...chatTools.map((t) => t.id)])],
    limits: { maxSteps: Math.min(base.limits.maxSteps, 8), maxCostUsd: base.limits.maxCostUsd },
    outputName: "chat reply",
  };
  let block = "";
  try { block = (await loadMemory(agentId)).block; } catch { /* chat without her notes is fine */ }
  const tz = await orgTz();
  const today = localDate(tz, 0);
  let reports: { tool: string; ok: boolean; note: string }[] = [];
  let finished = false, said: string | null = null;
  const res = await withRun(agentId, "chat", async (runId) => {
    const r = await runExplore(spec, {
      agentId, runId, memoryBlock: block, deliver: true, chat: true,
      prompt: chatPrompt(history.map((h): ChatLine => ({ role: h.role, text: h.text })), message, `${dayTitle(today)}, ${today} (${tz} time)`),
      tools: { ...TOOLS, ...Object.fromEntries(chatTools.map((t) => [t.id, t])) },
    });
    reports = r.reports; finished = r.finished; said = r.result;
    return { status: r.status, summary: r.summary, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd, metrics: r.metrics };
  }).catch((e: unknown) => ({ status: "failed" as const, summary: `I couldn't answer that: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, costUsd: 0, runId: null }));
  const notes = savedLines(reports);
  const like = finished ? similarNote(heldSimilar.got.at(-1) ?? null) : null;
  if (like) notes.push(like);
  // card 440: a reply about the department draft says, from code, what it still needs
  const gap = await draftGapLine(reports, said ?? "", message).catch(() => "");
  if (gap) notes.push(gap);
  const reply = res.status === "skipped" ? `I can't answer right now: ${res.summary}` : (finished && said ? said : res.summary).slice(0, MAX_REPLY);
  const keptReply = kept && await keepChat({ role: "avery", text: reply, run_id: res.runId, notes });
  return { ok: res.status === "ok", reply, notes, runId: res.runId, costUsd: res.costUsd ?? 0, kept: !!keptReply };
}
