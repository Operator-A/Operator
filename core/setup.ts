import "server-only";
// First-run setup, step 1 (card 151, docs/setup.md). A new business talks to Avery before it has a
// crew. Each message is one logged run through withRun with the trigger "setup", which core/runs.ts
// lets through while she is off duty, and only while the business has no departments. Her two
// setup-only tools hand rows to code: Save a fact and Lean toward departments. Code saves them after a
// run that finishes. When the run read a web page, every fact it saves is a suggestion until the
// founder taps Confirm. Nothing here hires, connects, sends, pays or posts.
import { db } from "@/core/db";
import { loadSpec, type AgentSpec } from "@/core/agent-spec";
import { runExplore } from "@/core/runner";
import { withRun } from "@/core/runs";
import { forgetBusiness } from "@/core/business";
import { installTemplates } from "@/core/install";
import { templateList } from "@/core/templates";
import { TOOLS } from "@/core/tools/catalog";
import type { ToolDef } from "@/core/tools/types";
import { checkAddress } from "@/core/custom-mcp-rules";
import { chatHistory, keepChat, type ChatAnswer } from "@/core/avery-chat";
import { MAX_REPLY } from "@/core/chat-rules";
import {
  FACT_TOPICS, FITS, MAX_FACTS_PER_MESSAGE, MAX_LEANING, NO_SETUP, SETUP_AGENT, SETUP_TEMPLATE,
  cleanFact, factProblem, isTopic, needsSetup, readLeaning, readSetupState, setupDirective, setupPrompt, stateFor,
  type Fact, type FactState, type Leaning, type SetupState,
} from "@/core/setup-rules";

export const FACTS_MISSING = "The business facts table isn’t in Supabase yet: apply the migration 20261220090000_business_facts.sql.";
const SETUP_KEY = "setup";

/** The departments Avery may lean toward: every template but the Chief of Staff's. */
export const departmentTemplates = () => templateList().filter((t) => t.id !== SETUP_TEMPLATE);

export async function setupState(): Promise<SetupState> {
  const { data, error } = await db().from("policies").select("value_json").eq("key", SETUP_KEY).maybeSingle();
  if (error) return NO_SETUP;
  return readSetupState((data as { value_json?: unknown } | null)?.value_json, departmentTemplates().map((t) => t.id));
}

async function saveSetupState(s: SetupState): Promise<void> {
  const { error } = await db().from("policies").upsert({ key: SETUP_KEY, value_json: s, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

/** Whether the current business goes to setup instead of the Desk. */
export async function inSetup(): Promise<boolean> {
  const [s, agents, depts] = await Promise.all([setupState(), db().from("agents").select("id"), db().from("departments").select("id", { count: "exact", head: true })]);
  if (agents.error || depts.error) return false;
  return needsSetup({ done: s.done, departments: depts.count ?? 0, agentIds: (agents.data ?? []).map((a) => String(a.id)) });
}

/** Setup is over: the founder installed departments (`offer`: the Desk offers a first job, card 154) or chose to start empty. */
export async function finishSetup(offer = false): Promise<void> {
  await saveSetupState({ ...(await setupState()), done: true, offer });
}

/** The first job started (card 154): which agent, and when. */
export async function markFirstJob(agentId: string): Promise<void> {
  await saveSetupState({ ...(await setupState()), firstJob: { agentId, at: new Date().toISOString() } });
}

/** Avery, off duty in the company seat, so the conversation has someone to talk to. Only into an empty business. */
export async function ensureAvery(): Promise<void> {
  const { data, error } = await db().from("agents").select("id").limit(1);
  if (error) throw new Error(error.message);
  if (data?.length) return;
  await installTemplates([SETUP_TEMPLATE]);
}

// ---- Facts

export async function listFacts(): Promise<Fact[] | null> {
  const { data, error } = await db().from("business_facts").select("id, topic, text, state, source").order("created_at");
  if (error) return null;
  return (data ?? []).filter((r) => isTopic(r.topic)).map((r) => ({ id: String(r.id), topic: r.topic, text: String(r.text), state: r.state as FactState, source: r.source }));
}

async function factCount(): Promise<number> {
  const { count, error } = await db().from("business_facts").select("id", { count: "exact", head: true });
  if (error) throw new Error(FACTS_MISSING);
  return count ?? 0;
}

/** A fact the founder typed on the panel: known at once. */
export async function addFact(topic: string, text: string): Promise<void> {
  const why = factProblem(topic, text, await factCount());
  if (why) throw new Error(why[0].toUpperCase() + why.slice(1) + ".");
  const { error } = await db().from("business_facts").insert({ topic, text: cleanFact(text), state: "known", source: "owner" });
  if (error) throw new Error(error.message);
  await forgetBusiness();
}

/** The founder's own words for a fact: it is known from then on. */
export async function editFact(id: string, text: string): Promise<void> {
  const t = cleanFact(text);
  if (!t) throw new Error("A fact needs words. Remove it instead.");
  const { error } = await db().from("business_facts").update({ text: t, state: "known", source: "owner", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  await forgetBusiness();
}

export async function confirmFact(id: string): Promise<void> {
  const { error } = await db().from("business_facts").update({ state: "known", updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
  await forgetBusiness();
}

export async function removeFact(id: string): Promise<void> {
  const { error } = await db().from("business_facts").delete().eq("id", id);
  if (error) throw new Error(error.message);
  await forgetBusiness();
}

// ---- The conversation

/** Save a fact: rows are held, and saved by askSetup after a run that finishes. */
function saveFactTool(held: { topic: string; text: string }[], have: number): ToolDef {
  return {
    id: "save_fact", label: "Save a fact", detail: "Saves one thing you learned about the business, as a topic and one short line. The founder sees it at once and can correct it",
    kind: "report", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [
      { name: "topic", type: "enum", options: [...FACT_TOPICS], description: "business: its name and kind. sells: what it sells. customers: who buys. channels: where it sells. goals: what the founder wants. hand_off: jobs the founder wants taken off their plate. other: anything else worth knowing." },
      { name: "text", type: "text", maxLength: 160, description: "One short plain line." },
    ],
    collect: (input, rows) => {
      if (rows.length >= MAX_FACTS_PER_MESSAGE) return { problem: `at most ${MAX_FACTS_PER_MESSAGE} facts from one message` };
      const why = factProblem(input.topic, input.text, have + rows.length);
      if (why) return { problem: why };
      if (rows.some((r) => r.topic === input.topic && cleanFact(r.text) === cleanFact(input.text))) return { problem: "already saved" };
      return { row: input };
    },
    deliver: async (o) => { held.push(...o.rows.map((r) => ({ topic: String(r.topic), text: String(r.text) }))); return "kept"; },
  };
}

/** Lean toward departments: one call per department, ids from the template list only. */
function leanTool(held: Leaning[]): ToolDef {
  const ids = departmentTemplates().map((t) => t.id);
  return {
    id: "lean_departments", label: "Lean toward departments", detail: `Notes one department from the list you think fits, as a strong fit or likely. Up to ${MAX_LEANING}, one call each`,
    kind: "report", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [
      { name: "id", type: "enum", options: ids, description: "The department's id from the list." },
      { name: "fit", type: "enum", options: [...FITS], description: "strong or likely." },
    ],
    collect: (input, rows) => {
      const l = readLeaning([...rows, input], ids);
      return "problem" in l ? { problem: l.problem } : { row: input };
    },
    deliver: async (o) => { const l = readLeaning(o.rows, ids); if ("leaning" in l) held.push(...l.leaning); return "kept"; },
  };
}

/** Read a web page, held to the founder's own site: Claude's fetch, allowed only on that host. */
function siteTool(host: string): ToolDef {
  const base = TOOLS.web_fetch;
  return { ...base, server: { ...base.server!, maxUses: 2, allowedDomains: [host] } };
}

export interface SetupAnswer extends ChatAnswer { saved: number; suggested: number }

/** One setup message: a logged run (trigger "setup") inside Avery's budget. Saves both sides of the conversation. */
export async function askSetup(message: string, siteRaw: string): Promise<SetupAnswer> {
  const none = (reply: string): SetupAnswer => ({ ok: false, reply, notes: [], runId: null, costUsd: 0, kept: false, saved: 0, suggested: 0 });
  let site: string | null = null;
  if (siteRaw.trim()) {
    const c = checkAddress(/^https?:\/\//i.test(siteRaw.trim()) ? siteRaw.trim() : `https://${siteRaw.trim()}`);
    if ("problem" in c) return none(`About your site: ${c.problem}`);
    site = c.url;
  }
  await ensureAvery();
  const loaded = await loadSpec(SETUP_AGENT);
  if (!loaded) return none("The Chief of Staff has no saved version, so there's no one to talk to yet.");
  const facts = await listFacts();
  if (!facts) return none(FACTS_MISSING);
  const history = (await chatHistory(12)) ?? [];
  const kept = await keepChat({ role: "owner", text: site ? `${message}\n\n(My site: ${site})` : message });
  const heldFacts: { topic: string; text: string }[] = [], heldLean: Leaning[] = [];
  const tools = [saveFactTool(heldFacts, facts.length), leanTool(heldLean), ...(site ? [siteTool(new URL(site).hostname)] : [])];
  const base = loaded.spec;
  const spec: AgentSpec = {
    ...base,
    directive: setupDirective(base.name, facts, departmentTemplates()),
    goodResult: "A short plain reply, at most about 90 words, ending with a question or the next step.",
    effort: "low",
    tools: tools.map((t) => t.id),
    limits: { maxSteps: Math.min(base.limits.maxSteps, 6), maxCostUsd: base.limits.maxCostUsd },
    outputName: "setup reply",
  };
  let finished = false, said: string | null = null, readAPage = false;
  const res = await withRun(SETUP_AGENT, "setup", async (runId) => {
    const r = await runExplore(spec, {
      agentId: SETUP_AGENT, runId, deliver: true, chat: true,
      prompt: setupPrompt(history.map((h) => ({ role: h.role, text: h.text })), message, site),
      tools: { ...TOOLS, ...Object.fromEntries(tools.map((t) => [t.id, t])) },
    });
    finished = r.finished; said = r.result;
    readAPage = r.steps.some((s) => s.kind === "tool" && s.tool === "web_fetch");
    return { status: r.status, summary: r.summary, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd, metrics: r.metrics };
  }).catch((e: unknown) => ({ status: "failed" as const, summary: `I couldn't answer that: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`, costUsd: 0, runId: null }));
  // facts and leanings are saved only after a run that finished; code says what it saved
  const notes: string[] = [];
  let saved = 0, suggested = 0;
  if (res.status === "ok" && finished) {
    const state = stateFor(readAPage);
    for (const f of heldFacts) {
      const { error } = await db().from("business_facts").insert({ topic: f.topic, text: cleanFact(f.text), state, source: readAPage ? "site" : "chat", run_id: res.runId });
      if (error) { notes.push(`Not saved (“${f.text}”): ${error.message}`); continue; }
      if (state === "suggested") suggested++; else saved++;
    }
    if (saved) notes.push(`Saved ${saved} fact${saved === 1 ? "" : "s"}. Edit or remove any on the right.`);
    if (suggested) notes.push(`${suggested} fact${suggested === 1 ? "" : "s"} from your site wait for you to confirm.`);
    if (heldLean.length) { await saveSetupState({ ...(await setupState()), leaning: heldLean }); notes.push("Updated the departments I'm thinking of."); }
    if (saved || suggested) await forgetBusiness();
  }
  const reply = res.status === "skipped" ? `I can't answer right now: ${res.summary}` : (finished && said ? said : res.summary).slice(0, MAX_REPLY);
  const keptReply = kept && await keepChat({ role: "avery", text: reply, run_id: res.runId, notes });
  return { ok: res.status === "ok", reply, notes, runId: res.runId, costUsd: res.costUsd ?? 0, kept: !!keptReply, saved, suggested };
}
