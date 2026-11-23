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
import { TEMPLATES, templateList } from "@/core/templates";
import { TOOLS } from "@/core/tools/catalog";
import type { ToolDef } from "@/core/tools/types";
import { CATEGORY_IDS, TILE_BY_ID, TOOL_CATEGORIES, answerFact, partWords, categoryState, listedTool, readPlans, readSkipped, type CategoryId, type CategoryPlan, type ToolTileId } from "@/core/tools-step-rules";
import { checkAddress } from "@/core/custom-mcp-rules";
import { SNAPSHOT_DAYS, bankFacts, capSnapshot, emailFacts, siteFacts, snapshotPrefix, storeFacts, type SnapshotFact, type SnapshotTile } from "@/core/snapshot-rules";
import { chatHistory, keepChat, type ChatAnswer } from "@/core/avery-chat";
import { MAX_REPLY } from "@/core/chat-rules";
import { kindTool, similarTool, similarUpFront } from "@/core/brain-tools";
import { similarNote, type Similar } from "@/core/brain-rules";
import {
  FACT_TOPICS, MAX_FACTS_PER_MESSAGE, NO_SETUP, SETUP_AGENT, SETUP_TEMPLATE,
  cleanFact, coverage, factProblem, SETUP_EFFORT, SETUP_MODEL, isStage, isTopic, MAX_FACTS, needsSetup, readAsked, readSetupState, setupDirective, setupPrompt, stateFor,
  type Fact, type FactState, type SetupState, type Stage,
  SETUP_HANDOFF, SETUP_MAX_OUT, SETUP_STOPPED, setupLimits,
} from "@/core/setup-rules";
import { applyDesign, designGaps, pickId, BESPOKE_PREFIX, DESIGN_PARTS, MAX_DESIGN_PARTS, MAX_DESIGNS, REASON_MAX, type Design, type Kit } from "@/core/design-rules";

export const FACTS_MISSING = "The business facts table isn’t in Supabase yet: apply the migration 20261220090000_business_facts.sql.";
const SETUP_KEY = "setup";

/** The departments Avery may lean toward: every template but the Chief of Staff's. */
const departmentTemplates = () => templateList().filter((t) => t.id !== SETUP_TEMPLATE);

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
/**
 * Start this company (card 193): the picked kits install from their templates (renamed to Avery's
 * names), then each picked bespoke department is built from its checked draft, everyone off duty.
 * A bespoke department with a gap stops it before anything is written.
 */
export async function startCompany(ids: readonly string[], by: string): Promise<{ agents: number; departments: number }> {
  const s = await setupState();
  const bespoke = ids.filter((id) => id.startsWith(BESPOKE_PREFIX)).map((id) => s.designs.find((d) => pickId(d) === id));
  if (bespoke.some((d) => !d || !d.draft)) throw new Error("A department on the chart isn't in Avery's sketch any more. Reload the page.");
  for (const d of bespoke as Design[]) {
    const gaps = designGaps(d);
    if (gaps.length) throw new Error(`${d.name} still needs ${gaps.join(" and ")}. Tell Avery, or leave it out.`);
  }
  const kitIds = ids.filter((id) => !id.startsWith(BESPOKE_PREFIX));
  await ensureAvery();
  let agents = 0, departments = 0;
  if (kitIds.length) {
    const { counts } = await installTemplates(kitIds);
    agents += counts.agents ?? 0; departments += counts.departments ?? 0;
    const { renameDepartment } = await import("@/core/org");
    for (const d of s.designs.filter((x) => x.kit && kitIds.includes(x.kit))) {
      const dept = TEMPLATES.find((t) => t.id === d.kit)?.departments[0];
      if (dept && dept.name !== d.name) await renameDepartment(dept.id, d.name);
    }
  }
  const { buildDepartment } = await import("@/core/departments");
  for (const d of bespoke as Design[]) {
    await buildDepartment(d.draft!, "setup: designed by Avery", by, null);
    departments++; agents += (d.draft!.head ? 1 : 0) + d.draft!.agents.length;
  }
  return { agents, departments };
}

export async function finishSetup(offer = false): Promise<void> {
  const was = await setupState();
  // with departments installed, /start keeps the founder for the wrap-up: credits, then the first job (card 186)
  await saveSetupState({ ...was, done: true, offer, wrapUp: offer, ...(offer ? { stage: "first" as const } : {}) });
  // card 197: the interview's last question would stay as Avery's latest message on the Desk; code's own hand-off line closes it, once
  if (!was.done) await keepChat({ role: "avery", text: SETUP_HANDOFF }).catch(() => false);
}

/** Go to your Desk (card 186): the wrap-up ends, and /start sends the founder to the Desk from now on. */
export async function endWrapUp(): Promise<void> {
  await saveSetupState({ ...(await setupState()), wrapUp: false });
}

/** The step of setup the founder is on (card 181). Only a step on the list is kept. */
export async function setStage(stage: Stage): Promise<void> {
  if (!isStage(stage)) throw new Error("Unknown step.");
  await saveSetupState({ ...(await setupState()), stage });
}

/** A part of the company the founder will connect later (card 182). `on: false` asks it again. */
export async function skipCategory(cat: CategoryId, on = true): Promise<void> {
  const s = await setupState();
  await saveSetupState({ ...s, skipped: readSkipped(on ? [...s.skipped, cat] : s.skipped.filter((c) => c !== cat)) });
}

/** What the founder chose for a part they can't connect today (card 183); null takes the choice back. A plan replaces a skip. */
export async function planCategory(cat: CategoryId, plan: CategoryPlan | null): Promise<void> {
  const s = await setupState();
  const plans = { ...s.plans };
  if (plan) plans[cat] = plan; else delete plans[cat];
  await saveSetupState({ ...s, plans: readPlans(plans), skipped: plan ? s.skipped.filter((c) => c !== cat) : s.skipped });
}

/**
 * The founder's answer on a part's card (card 195): a tool from the part's list, or none. Code saves it
 * as one known fact (replacing its own earlier answer for the part) and, for a tool that doesn't connect
 * yet or none, as the part's plan. Returns the tile to connect, when the tool has one. No model call.
 */
export async function answerCategory(cat: CategoryId, tool: string | null): Promise<{ tile: ToolTileId | null; name: string | null }> {
  const c = TOOL_CATEGORIES.find((x) => x.id === cat)!;
  const t = tool === null ? null : listedTool(cat, tool);
  if (tool !== null && !t) throw new Error("That tool isn’t on this card.");
  await keepAnswerFact(cat, t?.name ?? null);
  if (!t) await planCategory(cat, c.starter ? { kind: "guide" } : { kind: "none" });
  else if (!t.tile) await planCategory(cat, { kind: "uses", tool: t.name });
  else await planCategory(cat, null);
  return { tile: t?.tile ?? null, name: t?.name ?? null };
}

/** The fact for a part's answer: code's own line, one per part, known at once. Quietly skipped when the panel is full. */
export async function keepAnswerFact(cat: CategoryId, tool: string | null): Promise<void> {
  const c = TOOL_CATEGORIES.find((x) => x.id === cat)!;
  const old = (await listFacts())?.filter((f) => f.source === "owner" && f.text.startsWith(`${c.area}: `)) ?? [];
  for (const f of old) await db().from("business_facts").delete().eq("id", f.id);
  if ((await factCount()) >= MAX_FACTS) return;
  const { error } = await db().from("business_facts").insert({ topic: c.topic, text: cleanFact(answerFact(c, tool)), state: "known", source: "owner" });
  if (error) throw new Error(error.message);
  await forgetBusiness();
}

/**
 * The snapshot (card 195 slice B): a few fixed reads from a tool that just connected, every number
 * worked out in code, saved as known facts that replace the tool's last snapshot. One logged run
 * (trigger "setup") with no model call. Returns the facts saved.
 */
export async function takeSnapshot(tile: SnapshotTile): Promise<SnapshotFact[]> {
  let facts: SnapshotFact[] = [];
  const res = await withRun(SETUP_AGENT, "setup", async () => {
    facts = capSnapshot(await readSnapshot(tile));
    return { status: "ok", summary: `Snapshot from ${TILE_BY_ID[tile].name}: ${facts.length} fact${facts.length === 1 ? "" : "s"}.`, tokensIn: 0, tokensOut: 0, costUsd: 0 };
  });
  if (res.status !== "ok") throw new Error(res.summary);
  const prefix = snapshotPrefix(TILE_BY_ID[tile].name);
  for (const f of (await listFacts())?.filter((x) => x.source === "owner" && x.text.startsWith(prefix)) ?? []) await db().from("business_facts").delete().eq("id", f.id);
  const room = MAX_FACTS - (await factCount());
  const keep = facts.slice(0, Math.max(0, room));
  if (keep.length) {
    const { error } = await db().from("business_facts").insert(keep.map((f) => ({ topic: f.topic, text: cleanFact(f.text), state: "known", source: "owner", run_id: res.runId })));
    if (error) throw new Error(error.message);
    await forgetBusiness();
  }
  return keep;
}

/** The fixed reads for each tool: the catalog's own read tools (numbers in code) or Shopify's orders query. */
async function readSnapshot(tile: SnapshotTile): Promise<SnapshotFact[]> {
  const ctx = { agentId: SETUP_AGENT, notionPages: [], outputSources: [] };
  const { callTool } = await import("@/core/tools/call");
  const numbers = async (id: string, input: Record<string, string | number> = {}) => (await callTool(id, input, ctx)).numbers ?? {};
  if (tile === "shopify") {
    const { orgDate } = await import("@/core/tz");
    const { ordersBetween } = await import("@/integrations/shopify/orders");
    const [orders, open] = await Promise.all([ordersBetween(await orgDate(SNAPSHOT_DAYS), await orgDate(0)), numbers("shopify_open_orders").catch(() => ({} as Record<string, number>))]);
    return storeFacts(orders.map((o) => ({ total: Number(o.totalPriceSet.shopMoney.amount), repeat: Number(o.customer?.numberOfOrders ?? 0) > 1 })), open.to_ship ?? null);
  }
  if (tile === "mercury") return bankFacts(await numbers("calc_burn_rate", { days: 90 }));
  if (tile === "klaviyo") {
    const [lists, campaigns] = await Promise.all([numbers("klaviyo_lists"), numbers("klaviyo_campaigns", { period: "last_30_days" })]);
    return emailFacts(lists.lists ?? null, campaigns);
  }
  return siteFacts(await numbers("analytics_overview", { period: "last_30_days" }));
}

/** The first job started (card 154): which agent, and when. */
export async function markFirstJob(agentId: string, kind: "playbook" | "try" = "playbook"): Promise<void> {
  await saveSetupState({ ...(await setupState()), firstJob: { agentId, at: new Date().toISOString(), kind } });
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
      { name: "topic", type: "enum", options: [...FACT_TOPICS], description: "business: its name and kind. sells: what it sells and how it makes money. customers: who buys. channels: where it sells and how customers find it. goals: what the founder wants this year. hand_off: where the founder's week goes and the jobs they want taken off their plate. other: anything else worth knowing." },
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

/**
 * Ask about a tool (card 195): Avery names one part of the business by its id, nothing else. Code
 * shows the founder that part's card in the chat after a run that finishes. Only an open part.
 */
function askToolTool(held: { cat: CategoryId | null }, open: ReadonlySet<CategoryId>): ToolDef {
  return {
    id: "ask_tool", label: "Ask about a tool", detail: "Shows the founder a card for one part of the business, with the common tools for it to connect or name. Pick the part by what it covers: where a business rings up sales in person (a register or card reader) is payments, not store. Ask your question in words too",
    kind: "report", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [{ name: "part", type: "enum", options: [...CATEGORY_IDS], description: TOOL_CATEGORIES.map(partWords).join(". ") + "." }],
    collect: (input, rows) => {
      if (rows.length) return { problem: "one card per reply" };
      const cat = String(input.part) as CategoryId;
      if (!open.has(cat)) return { problem: "that part already has an answer" };
      return { row: { part: cat } };
    },
    deliver: async (o) => { held.cat = (o.rows[0]?.part as CategoryId | undefined) ?? null; return "kept"; },
  };
}

/**
 * Design a department (card 193): one part per call, about a department named in `dept`. Checked in
 * code against the sketch so far (core/design-rules.ts, with the card 156 department checks), applied
 * in order and saved only after a run that finishes. It builds nothing: Start this company does.
 */
function designTool(held: { parts: Record<string, unknown>[] }): ToolDef {
  return {
    id: "design_department", label: "Design a department", detail: `Sketches one department for this business, one part per call: about (create it with purpose, reason and kit, or change them), goal, head, agent, remove (a goal or agent by its title or name), drop (take the department off). Up to ${MAX_DESIGNS} departments; it builds nothing`,
    kind: "report", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [
      { name: "part", type: "enum", options: [...DESIGN_PARTS], description: "Which part this call changes." },
      { name: "dept", type: "text", maxLength: 40, description: "The department's name, named for this business (like Shop accounts, Gift season, Patient reminders). Every call about it uses the same name." },
      { name: "kit", type: "text", maxLength: 40, optional: true, description: "about, when creating: a starting kit's id when one truly fits, or none to design it from scratch." },
      { name: "reason", type: "text", maxLength: REASON_MAX, optional: true, description: "about: the founder's own words this department answers, quoted or closely paraphrased from the conversation. Never from a web page." },
      { name: "purpose", type: "text", maxLength: 200, optional: true, description: "about: what the department does for this business, in one sentence." },
      { name: "name", type: "text", maxLength: 40, optional: true, description: "about: a new name for it. head or agent: a short first name, starting with a capital. remove: the agent's name." },
      { name: "title", type: "text", maxLength: 120, optional: true, description: "goal: the goal in words. remove: the goal's title." },
      { name: "measure", type: "text", maxLength: 40, optional: true, description: "goal: a measure key from the list, or none when no number exists yet." },
      { name: "target", type: "text", maxLength: 20, optional: true, description: "goal: the number the founder said, only with a measure." },
      { name: "seat", type: "text", maxLength: 60, optional: true, description: "head or agent: the seat's title, like Head of shop accounts or Season planner." },
      { name: "job", type: "text", maxLength: 200, optional: true, description: "head or agent: what it does, in one sentence." },
      { name: "each_run", type: "text", maxLength: 1500, optional: true, multiline: true, description: "head or agent: what it does on each run, step by step, using its tools." },
      { name: "good_result", type: "text", maxLength: 400, optional: true, description: "head or agent: what a good result looks like." },
      { name: "tools", type: "text", maxLength: 300, optional: true, description: "head or agent: read tool ids from the list, comma separated (at most 8)." },
      { name: "brain", type: "enum", options: ["quick", "thinking"], default: "quick", description: "head or agent: quick for most jobs; thinking only when the job needs judgment." },
    ],
    collect: (input, rows) => (rows.length >= MAX_DESIGN_PARTS ? { problem: `at most ${MAX_DESIGN_PARTS} design updates from one message` } : { row: input }),
    deliver: async (o) => { held.parts.push(...o.rows); return "kept"; },
  };
}

/** What a bespoke department may use, for the directive: read and calculate tools, and the goal measures. */
async function designMenu(): Promise<string> {
  const [{ MEASURES }, { ownMeasureDefs }] = await Promise.all([import("@/core/goal-rules"), import("@/core/goals")]);
  const own = await ownMeasureDefs().catch(() => []);
  const tools = Object.values(TOOLS).filter((t) => (t.kind === "read" || t.kind === "calculate") && !t.server && !t.codeOnly).map((t) => `${t.id} (${t.label}: ${t.detail.slice(0, 90)})`);
  const measures = [...MEASURES, ...own].filter((m) => m.available).map((m) => `${m.key} (${m.label})`);
  return `Read tools a bespoke person may have: ${tools.join("; ")}.\nGoal measures: ${measures.join("; ")}.`;
}

/** The kits Avery may start from: every department template, with the agent names it brings. */
const kits = (): Kit[] => TEMPLATES.filter((t) => t.id !== SETUP_TEMPLATE).map((t) => ({ id: t.id, name: t.name, agentNames: t.agents.map((a) => a.name) }));
/** The kits for the directive: what each brings, so Avery starts from one only when it truly fits. */
const kitLines = () => TEMPLATES.filter((t) => t.id !== SETUP_TEMPLATE).map((t) => ({ id: t.id, name: t.name, about: `${t.about} Brings: ${t.agents.map((a) => `${a.name} (${a.role})`).join(", ")}.` }));

/** Avery's design parts from one run, applied in order to the saved sketch. Returns the sketch and one line per part. */
async function applyDesigns(parts: readonly Record<string, unknown>[]): Promise<{ designs: Design[]; done: string[]; not: string[] }> {
  let designs = (await setupState()).designs;
  const ctx = await (await import("@/core/departments")).draftCtx();
  const now = new Date().toISOString(), k = kits();
  const done: string[] = [], not: string[] = [];
  for (const p of parts) {
    const r = applyDesign(designs, p, { ctx: { ...ctx, agentNames: [...ctx.agentNames, ...k.flatMap((x) => x.agentNames)] }, kits: k, now });
    if ("problem" in r) { not.push(r.problem); continue; }
    designs = r.designs; done.push(r.note);
  }
  return { designs, done, not };
}

/** Read a web page, held to the founder's own site: Claude's fetch, allowed only on that host. */
function siteTool(host: string): ToolDef {
  const base = TOOLS.web_fetch;
  return { ...base, server: { ...base.server!, maxUses: 2, allowedDomains: [host] } };
}

export interface SetupAnswer extends ChatAnswer { saved: number; suggested: number }

/** One setup message: a logged run (trigger "setup") inside Avery's budget. Saves both sides of the conversation. */
export async function askSetup(message: string, siteRaw: string, connected: ReadonlySet<ToolTileId> = new Set()): Promise<SetupAnswer> {
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
  const heldFacts: { topic: string; text: string }[] = [], heldDesign: { parts: Record<string, unknown>[] } = { parts: [] }, heldAsk: { cat: CategoryId | null } = { cat: null };
  const st = await setupState();
  // the parts of the business a tool runs (card 195), each with its state, so she asks only an open one
  const parts = TOOL_CATEGORIES.map((c) => ({ id: c.id, state: categoryState(c, connected, st.skipped, st.plans) }));
  const open = new Set(parts.filter((p) => p.state === "open").map((p) => p.id));
  // the interview comes first (card 192): Avery designs (card 193) only once code counts enough of it
  const ready = coverage(facts).ready;
  // the shared brain (card 233, cloud edition only): what businesses like this one found, and its kind
  const heldSimilar: { got: Similar[] } = { got: [] }, heldKind: { said: string | null } = { said: null };
  // card 200: once she can sketch, code asks the shared brain once and puts it in her prompt instead of a tool turn
  const upFront = ready ? await similarUpFront("starting").catch(() => null) : null;
  if (upFront) heldSimilar.got.push(upFront.got);
  const brain = [ready ? null : similarTool(heldSimilar), kindTool(heldKind)].filter((t): t is ToolDef => !!t);
  const tools = [saveFactTool(heldFacts, facts.length), askToolTool(heldAsk, open), ...(ready ? [designTool(heldDesign)] : []), ...(site ? [siteTool(new URL(site).hostname)] : []), ...brain];
  const base = loaded.spec;
  const spec: AgentSpec = {
    ...base,
    directive: setupDirective(base.name, facts, kitLines(), ready ? await designMenu() : null, st.designs, parts),
    goodResult: "A short plain reply, at most about 90 words, ending with a question or the next step.",
    model: SETUP_MODEL,
    effort: SETUP_EFFORT,
    tools: tools.map((t) => t.id),
    limits: setupLimits(ready),
    outputName: "setup reply",
  };
  // card 281: what the finished setup checks found, counted in code, so she can mention it once
  const checked = await import("@/core/setup-check").then((m) => m.checkNote()).catch(() => null);
  let finished = false, said: string | null = null, readAPage = false;
  const res = await withRun(SETUP_AGENT, "setup", async (runId) => {
    const r = await runExplore(spec, {
      agentId: SETUP_AGENT, runId, deliver: true, chat: true, maxOut: SETUP_MAX_OUT,
      prompt: `${setupPrompt(history.map((h) => ({ role: h.role, text: h.text })), message, site)}${upFront ? `\n\n${upFront.block}` : ""}${checked ? `\n\n${checked}` : ""}`,
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
    if (saved) notes.push(`Saved ${saved} fact${saved === 1 ? "" : "s"}. Edit or remove any under What I’ve learned so far.`);
    if (suggested) notes.push(`${suggested} fact${suggested === 1 ? "" : "s"} from your site wait for you to confirm.`);
    if (heldDesign.parts.length) {
      const d = await applyDesigns(heldDesign.parts);
      if (d.done.length) { await saveSetupState({ ...(await setupState()), designs: d.designs }); notes.push(`Sketched: ${d.done.join("; ")}.`); }
      for (const x of d.not) notes.push(`Not in the sketch: ${x}.`);
    }
    if (heldAsk.cat) { const now = await setupState(); await saveSetupState({ ...now, asked: readAsked([...now.asked, heldAsk.cat]) }); }
    if (saved || suggested) await forgetBusiness();
    if (heldKind.said) notes.push(heldKind.said);
    const like = similarNote(heldSimilar.got.at(-1) ?? null);
    if (like) notes.push(like);
  }
  const reply = res.status === "skipped" ? `I can't answer right now: ${res.summary}` : res.status === "ok" && !finished ? SETUP_STOPPED : (finished && said ? said : res.summary).slice(0, MAX_REPLY);
  const keptReply = kept && await keepChat({ role: "avery", text: reply, run_id: res.runId, notes });
  return { ok: res.status === "ok", reply, notes, runId: res.runId, costUsd: res.costUsd ?? 0, kept: !!keptReply, saved, suggested };
}
