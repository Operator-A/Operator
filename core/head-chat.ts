import "server-only";
// A department's chat with its head (docs/department-pages.md, slice 2). The owner types on the
// department's page; each message is one run of the head through withRun (trigger "chat"), so it is
// logged in agent_runs and stays inside the head's daily budget. The run uses the shared runner with:
//
// - the head's active spec's model and cost cap, its read and calculate tools, Goal progress, and The
//   crew now for its own department only;
// - Save a rule (the owner's own words, checked in code) for its department or one of its agents, never
//   everyone or another department; and File a proposal, for its own department, which does nothing
//   until an owner says yes.
//
// Nothing here runs, starts or changes an agent, and nothing sends, pays or posts. Rules and proposals
// are saved only after a run that finishes; code, not the model, says what it saved.
import { orgTz } from "@/core/tz";
import { db } from "@/core/db";
import { loadSpec, type AgentSpec } from "@/core/agent-spec";
import { loadMemory } from "@/core/memory";
import { agentNames, loadOrg } from "@/core/org";
import { headOf } from "@/core/org-rules";
import { runExplore } from "@/core/runner";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS } from "@/core/business-rules";
import { withRun } from "@/core/runs";
import { dayTitle, localDate } from "@/core/time";
import { TOOLS } from "@/core/tools/catalog";
import { MAX_REPLY, chatPrompt, savedLines, type ChatLine } from "@/core/chat-rules";
import { deptReach, headDirective } from "@/core/head-chat-rules";
import { crewNowTool, fileProposalTool, saveRuleTool, type ChatAnswer } from "@/core/avery-chat";

export const HEAD_CHAT_MISSING = "The department chat table isn’t in Supabase yet: apply the migration 20270104090000_dept_chat.sql. Until then the head answers but the conversation isn’t kept.";
export interface HeadChatRow { id: string; role: "owner" | "head"; text: string; run_id: string | null; notes: string[]; created_at: string }

/** A department's latest messages, oldest first. Null when the table isn't there. */
export async function headHistory(deptId: string, limit = 30): Promise<HeadChatRow[] | null> {
  const { data, error } = await db().from("dept_chat").select("id, role, text, run_id, notes, created_at").eq("department_id", deptId).order("created_at", { ascending: false }).limit(limit);
  if (error) return null;
  return ((data ?? []) as HeadChatRow[]).map((r) => ({ ...r, notes: Array.isArray(r.notes) ? r.notes : [] })).reverse();
}

async function keepHeadChat(deptId: string, row: { role: "owner" | "head"; text: string; run_id?: string | null; notes?: string[] }): Promise<boolean> {
  const { error } = await db().from("dept_chat").insert({ department_id: deptId, role: row.role, text: row.text.slice(0, 4000), run_id: row.run_id ?? null, notes: row.notes ?? [] });
  return !error;
}

/** One message to a department's head: a logged run (trigger "chat") inside the head's budget. Saves both sides. */
export async function talkToHead(deptId: string, message: string): Promise<ChatAnswer> {
  const no = (reply: string): ChatAnswer => ({ ok: false, reply, notes: [], runId: null, costUsd: 0, kept: false });
  const org = await loadOrg();
  if (!org) return no("The org chart isn't set up, so this department has no head to talk to.");
  const dept = org.departments.find((d) => d.id === deptId);
  if (!dept) return no("That department isn't on the chart any more.");
  const seat = headOf(org, deptId);
  if (!seat || seat.holder !== "agent" || !seat.agentId) return no(seat?.holder === "owner" ? `You lead ${dept.name}, so there's no head agent to talk to here. Ask Avery instead.` : `${dept.name} has no head yet. Fill its head seat on the Agents tab to talk to one.`);
  const headId = seat.agentId;
  const loaded = await loadSpec(headId);
  if (!loaded) return no(`${dept.name}'s head has no saved version yet.`);
  const base = loaded.spec;

  const history = (await headHistory(deptId, 12)) ?? [];
  const kept = await keepHeadChat(deptId, { role: "owner", text: message });
  const reach = deptReach(org, deptId, await agentNames(org.seats.filter((s) => s.departmentId === deptId && s.agentId).map((s) => s.agentId as string)));
  const chatTools = [crewNowTool(org, deptId), saveRuleTool(message, reach, headId), fileProposalTool(reach, deptId)];
  const reads = base.tools.filter((id) => (TOOLS[id]?.kind === "read" || TOOLS[id]?.kind === "calculate") && !TOOLS[id]?.server);
  const biz = await loadBusiness().catch(() => UNKNOWN_BUSINESS);
  const spec: AgentSpec = {
    ...base,
    directive: headDirective({ name: base.name, title: seat.title, dept: dept.name, business: biz.name, agents: reach.agents.filter((a) => a.id !== headId).map((a) => a.name) }),
    goodResult: "A short plain answer, at most about 120 words. Every number exactly as a tool gave it.",
    effort: "low",
    tools: [...new Set([...reads, "goal_progress", ...chatTools.map((t) => t.id)])],
    limits: { maxSteps: Math.min(base.limits.maxSteps, 8), maxCostUsd: base.limits.maxCostUsd },
    outputName: "chat reply",
  };
  let block = "";
  try { block = (await loadMemory(headId)).block; } catch { /* chat without its notes is fine */ }
  const tz = await orgTz();
  const today = localDate(tz, 0);
  let reports: { tool: string; ok: boolean; note: string }[] = [];
  let finished = false, said: string | null = null;
  const res = await withRun(headId, "chat", async (runId) => {
    const r = await runExplore(spec, {
      agentId: headId, runId, memoryBlock: block, deliver: true, chat: true,
      prompt: chatPrompt(history.map((h): ChatLine => ({ role: h.role === "head" ? "avery" : "owner", text: h.text })), message, `${dayTitle(today)}, ${today} (${tz} time)`),
      tools: { ...TOOLS, ...Object.fromEntries(chatTools.map((t) => [t.id, t])) },
    });
    reports = r.reports; finished = r.finished; said = r.result;
    return { status: r.status, summary: r.summary, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd, metrics: r.metrics };
  }).catch((e: unknown) => ({ status: "failed" as const, summary: `I couldn't answer that: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, costUsd: 0, runId: null }));
  const notes = savedLines(reports);
  const reply = res.status === "skipped" ? `I can't answer right now: ${res.summary}` : (finished && said ? said : res.summary).slice(0, MAX_REPLY);
  const keptReply = kept && await keepHeadChat(deptId, { role: "head", text: reply, run_id: res.runId, notes });
  return { ok: res.status === "ok", reply, notes, runId: res.runId, costUsd: res.costUsd ?? 0, kept: !!keptReply };
}
