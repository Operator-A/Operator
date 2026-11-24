import "server-only";
// Everything the Control Room reads. Server only: the service-role client never reaches
// the browser, and every function checks the login first.
import { imageLink } from "@/core/image-step";
import type { Step } from "@/core/flow-rules";
import { when } from "@/dashboard/format";
import { timeline as buildTimeline, type Timeline, type TimelineOk, type TimelineRun } from "@/dashboard/run-view-rules";
import { IMAGE_MODELS } from "@/core/image-rules";
import { pendingOks } from "@/core/chain-ok";
import type { OkCard } from "@/core/chain-ok-rules";
import { orgTz } from "@/core/tz";
import { DEFAULT_TZ } from "@/core/time";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { settings } from "@/core/settings";
import { openJobsThisWeek } from "@/core/plans";
import { DEFAULT_BUDGET, loadMemory, memoryView, proposedLessons, readPages, type MemoryEvent, type MemoryLoad, type MemoryRow, type PageLoad, type SharedLine } from "@/core/memory";
import type { Reach } from "@/core/memory-rules";
import { agentDepartment, agentNames, loadOrg, seatOf, type Org } from "@/core/org";
import { reactionTally, reactionsOf, reactionsOnRun, type Reaction } from "@/core/reactions";
import type { Tally } from "@/core/reaction-rules";
import { APPROVAL_LABELS, APPROVAL_TOOLS, MAX_CHAINS, MAX_STEPS, METRICS, listFlowVersions, loadFlow, nextFirings, readFlow, type Chain, type Crew } from "@/core/flow";
import { TOOLS } from "@/core/tools/catalog";
import { CLAUDE_KEY_ID, mcpStatuses, modelKeysReady, vaultReady, type McpStatus } from "@/integrations/mcp";
import { claudeState } from "./claude";
import { claudeReady } from "@/core/claude-choice-rules";
import { withOrg } from "@/core/tenancy";
import { MCP_IDS } from "@/core/mcp-rules";
import { orgState, type OrgState } from "@/core/org-switch";
import type { CrewMember, IntegrationId } from "./crew";
import { buildCrew, memberOf, type RosterRow, type RosterSpec } from "./roster";
import { runCostOf, type CostSpec } from "./cost";
import { realCost } from "@/core/cost-rules";
import type { ChainAgent, ChainImageModel, ChainModel, ChainsData } from "./components/chains";
import { payers } from "@/core/ask-rules";
import { NO_MODEL_KEYS, modelReady } from "@/core/agent-spec";
import { MODEL_LIST } from "@/integrations/models";
import { SESSION_COOKIE, controlsOn, sessionOf } from "./session";
import { memberById } from "@/core/members";
import { atLeast, refusal, type Member, type Role } from "@/core/roles";

/** A signed-in member: who they are and the org this session is in. */
export type SessionMember = Member & { orgId: string };

/**
 * The member a session cookie names, read again from the database inside the org the cookie names;
 * null when signed out or removed from that org.
 */
export async function memberFromCookie(token: string | undefined): Promise<SessionMember | null> {
  const s = sessionOf(token);
  if (!s) return null;
  const m = await withOrg(s.orgId, () => memberById(s.memberId));
  return m ? { id: m.id, email: m.email, role: m.role, orgId: s.orgId } : null;
}

/** The signed-in member (any role), once per request; anyone else goes to sign-in. */
export const requireSession = cache(async (): Promise<SessionMember> => {
  const jar = await cookies();
  const me = await memberFromCookie(jar.get(SESSION_COOKIE)?.value);
  if (!me) redirect("/login");
  return me;
});

/**
 * For an action: the signed-in member when their role reaches `min`, else a refusal to return.
 * `const { me, no } = await asRole("owner"); if (no) return no;`
 */
export async function asRole(min: Role): Promise<{ me: SessionMember; no?: undefined } | { me?: undefined; no: { ok: false; text: string } }> {
  const me = await requireSession();
  return atLeast(me.role, min) ? { me } : { no: { ok: false, text: refusal(me.role, min) } };
}

export type RunStatus = "running" | "ok" | "failed" | "skipped";
export interface Run {
  id: string;
  agent_id: string;
  trigger: string;
  started_at: string;
  ended_at: string | null;
  status: RunStatus;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  summary: string | null;
  error: string | null;
  /** What the run loaded from memory (core/memory.ts loadSummary); null for runs that load none. */
  memory_json: RunMemory | null;
}
export interface RunMemory {
  budget: number; tokens: number; dropped: number; over_budget: boolean;
  groups: Record<string, { lines: number; tokens: number }>;
  pages?: { page_id: string; title: string; tokens: number; cut: boolean; problem: string | null }[];
}
export interface AgentRow { id: string; name: string; model: string; enabled: boolean; daily_budget_usd: number }

/** The gateway tool behind an approval card, from its embedded action row. */
const toolOfCard = (a: unknown): string => {
  const row = (Array.isArray(a) ? a[0] : a) as { tool?: unknown } | null | undefined;
  return typeof row?.tool === "string" ? row.tool : "";
};

/** The crew piece of the floor (card 304): getRoster. */
export interface Roster {
  ok: boolean;
  problem?: string;
  /** When this request read the floor; pages use it instead of calling Date.now() while rendering. */
  now: number;
  agents: Record<string, AgentRow>;
  runs: Run[];
  spentToday: Record<string, number>;
  /** Tool ids in each agent's active saved setup (agent_defs), by agent id; empty before the runner migration. */
  grants: Record<string, string[]>;
  /** The live (active) saved-setup version of each agent, by agent id. */
  liveVersion: Record<string, number>;
  /** The org chart (core/org.ts loadOrg), read once here so pages and the frame don't read it again (card 302); null before the org chart migration. */
  chart: Org | null;
  /** Every agent with a live version, oldest first (dashboard/roster.ts). */
  crew: CrewMember[];
  byId: Record<string, CrewMember>;
  /** The agents a chain may pick, for Crew > Schedule and the chain actions. */
  palette: Crew;
  /** The active flow's chains (read once here), for the agent sheet's hand-offs (card 400). */
  chains: Chain[];
}

/** What waits on the owner (card 304): getCounts. */
export interface Counts {
  /** Charges waiting on a receipt photo (Quinn); null when expense_docs isn't there yet. */
  photosWaiting: number | null;
  /** Approvals waiting on the owner; null when the approvals table isn't there yet. */
  approvalsPending: number | null;
  /** Proposals from heads waiting on the owner (company mode slice 3); null when the proposals table isn't there yet. */
  proposalsPending: number | null;
  /** Card 158: the gateway tool of each approval waiting on the owner, and the kind of each pending proposal (dashboard/needs-rules.ts). */
  approvalTools: string[];
  proposalKinds: string[];
  /** Who made each approval waiting on the owner and its department (null: not in one), for the red counts on each department and agent (docs/department-pages.md). */
  approvalOwners: { agent: string; dept: string | null }[];
  /** Chains held at a Wait for my OK step (chains slice 3); also counted in approvalsPending and approvalOwners (agent ""). */
  chainOks: number;
  /** Person's jobs from this week's head plans that the owner hasn't marked done (slice 4). */
  jobsForYou: { planId: string; head: string | null; title: string; href: string }[];
  /** Proposed lessons waiting for the owner's Keep, per agent; empty until the memory tables exist. */
  lessonsWaiting: Record<string, number>;
}

/** The whole floor: every piece (getFloor). */
export interface Floor extends Roster, Counts {
  /** The business's time zone (card 187), for every time on screen; client components get it from here. */
  tz: string;
  health: Record<IntegrationId, boolean>;
  /** The org switch (docs/org-schedule.md): off means nothing starts on its own. */
  org: OrgState;
}

export const RUN_COLS = "id, agent_id, trigger, started_at, ended_at, status, tokens_in, tokens_out, cost_usd, summary, error, memory_json";
const toRun = (r: Record<string, unknown>) => ({ ...r, cost_usd: Number(r.cost_usd ?? 0), tokens_in: Number(r.tokens_in ?? 0), tokens_out: Number(r.tokens_out ?? 0) }) as Run;

/** Midnight UTC: the same day boundary withRun uses for daily budgets. */
export const budgetDayStart = (now = new Date()) => { const d = new Date(now); d.setUTCHours(0, 0, 0, 0); return d; };

export function health(): Record<IntegrationId, boolean> {
  return {
    supabase: !!(env.supabaseUrl && env.supabaseServiceKey),
    // its key is pasted on Connections (the vault): getFloor reads mcp_connections
    shopify: false,
    // the business's own key (the vault), or OPERATOR's hosted Claude on credits: getFloor sets it (card 162)
    claude: false,
    // signed in on Connections: getFloor reads mcp_connections
    mercury: false,
    // signed in on Connections (its key in the vault): getFloor reads mcp_connections
    notion: false,
    // and the business has an owner email (Settings): getFloor checks that
    email: !!(env.resendKey && env.briefFrom),
    // both Gmail sign-ins (read only, drafts) are made on Connections: getFloor reads mcp_connections
    gmail: false,
    gmail_read: false,
    // web search runs through Claude (own key or hosted): getFloor sets it with claude
    web: false,
    // planned for the Conversion Optimizer; nothing uses it yet
    github: false,
    // signed in on Connections, not a setting: getFloor reads mcp_connections
    klaviyo: false,
    // the token vault's own key (core/vault.ts); never made from another secret
    // the gateway's own Mercury sign-in (category and memo); getFloor reads mcp_connections
    mercury_write: false,
    // the gateway's receipt-file key, pasted on Connections into the vault
    mercury_files: false,
    // the gateway's Klaviyo campaign drafts key, pasted on Connections into the vault
    klaviyo_drafts: false,
    vault: vaultReady(),
    // signed in on Connections, and a property picked: getFloor reads mcp_connections
    ga4: false,
    // the business's Stripe read key and the gateway's invoice-drafts key, pasted on Connections into the vault
    stripe: false,
    stripe_drafts: false,
    // the business's Intuit sign-in, made with Connect on Connections
    quickbooks: false,
    // the business's Square sign-in, made with Connect on Connections
    square: false,
    // both Google Calendar sign-ins (reads, the gateway's holds) are made on Connections
    calendar: false,
    calendar_holds: false,
    // both Mailchimp keys (reads, the gateway's drafts) are pasted on Connections
    mailchimp: false,
    mailchimp_drafts: false,
    // both WooCommerce keys (Read for agents, Read/Write for the gateway's notes) are pasted on Connections
    woo: false,
    woo_notes: false,
    hubspot: false,
    hubspot_deals: false,
    // both Meta Ads sign-ins (reads, the gateway's pauses) are made with Connect on Connections
    meta: false,
    meta_pauses: false,
  };
}

/**
 * Which tools are set up, on its own (card 202, docs/speed.md): one query for every connection, the
 * business's settings and its Claude. Setup reads only this; getFloor builds on it.
 */
export const getHealth = cache(async (): Promise<Record<IntegrationId, boolean>> => {
  await requireSession();
  const h = health();
  if (!h.supabase) return h;
  const [mcp, s] = await Promise.all([mcpStatuses().catch(() => ({} as Record<string, McpStatus>)), settings()]);
  if (!s.ownerEmail) h.email = false;
  // Claude (and web search through it): the business's own key, else OPERATOR's hosted Claude on
  // credits (cloud edition), the same order runs use (integrations/anthropic.ts, card 162)
  h.claude = h.web = claudeReady(await claudeState({ status: mcp[CLAUDE_KEY_ID] ?? null }));
  // every server in the registry: set up when signed in and not paused (Notion also needs its parent page, Mercury its accounts)
  const extra: Partial<Record<string, boolean>> = { shopify: !!s.shopifyDomain, notion: !!s.notionBriefParent, mercury: s.mercuryAccountIds.length > 0, ga4: !!mcp.ga4?.settings.propertyId };
  for (const id of MCP_IDS) { const st = mcp[id]; if (st?.connected && !st.paused && extra[id] !== false) h[id] = true; }
  return h;
});

/** The business's time zone, after the sign-in check, read once per request (card 304). */
export const getTz = cache(async (): Promise<string> => {
  await cookies(); // per request only: never read at build time
  if (!health().supabase) { await requireSession(); return DEFAULT_TZ; }
  const [, tz] = await Promise.all([requireSession(), orgTz()]);
  return tz;
});

/** The org switch (docs/org-schedule.md), after the sign-in check, read once per request (card 304). */
export const getOrgSwitch = cache(async (): Promise<OrgState> => {
  await cookies();
  if (!health().supabase) { await requireSession(); return { on: false, at: null, by: null, known: false }; }
  const [, o] = await Promise.all([requireSession(), orgState()]);
  return o;
});

/**
 * The crew (card 304): agents, their live saved setups, the schedule's chains, the org chart, and the
 * last 60 days of runs (newest first, at most 1000), which say what a run costs and what is live.
 * One round, after the sign-in check like every piece.
 */
export const getRoster = cache(async (): Promise<Roster> => {
  await cookies();
  const now = Date.now();
  const empty: Roster = { ok: false, now, agents: {}, runs: [], spentToday: {}, grants: {}, liveVersion: {}, ...buildCrew([]), palette: { ids: [], manualOnly: new Set() }, chains: [], chart: null };
  if (!health().supabase) { await requireSession(); return { ...empty, problem: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set, so there is nothing to show yet." }; }
  const since = new Date(now - 60 * 864e5).toISOString();
  // one round (card 302): the org comes from the signed session cookie, so the reads need not wait for the check;
  // if the check fails it redirects before anything is drawn, and what was read is thrown away
  const [, a, r, defs, flowRow, org] = await Promise.all([
    requireSession(),
    // in_org comes with the org switch migration, role, icon, hue, manual_only and created_at with the roster one; older shapes until then
    db().from("agents").select("id, name, model, enabled, daily_budget_usd, role, icon, hue, manual_only, in_org, created_at")
      .then((x) => (x.error ? db().from("agents").select("id, name, model, enabled, daily_budget_usd, role, icon, hue, manual_only, created_at") : x))
      .then((x) => (x.error ? db().from("agents").select("id, name, model, enabled, daily_budget_usd") : x)),
    db().from("agent_runs").select(RUN_COLS).gte("started_at", since).order("started_at", { ascending: false }).limit(1000),
    db().from("agent_defs").select("agent_id, version, spec").eq("active", true),
    db().from("crew_flow").select("flow").eq("active", true).maybeSingle(),
    loadOrg().catch(() => null),
  ]);
  if (a.error || r.error) return { ...empty, problem: `Supabase: ${(a.error ?? r.error)?.message}` };
  const rows = (a.data ?? []) as (AgentRow & RosterRow)[];
  const agents = Object.fromEntries(rows.map((x) => [x.id, { id: x.id, name: x.name, model: x.model, enabled: x.enabled, daily_budget_usd: Number(x.daily_budget_usd) } as AgentRow]));
  const all = (r.data ?? []).map(toRun);
  // a Preview is not a run of the agent: it stays out of the floor, the run log
  // and Replay, but its cost counts toward today's spend, the same as withRun's budget check
  const runs = all.filter((x) => x.trigger !== "preview");
  const d0 = budgetDayStart(new Date(now)).getTime();
  const spentToday: Record<string, number> = Object.fromEntries(rows.map((b) => [b.id, 0]));
  for (const run of all) if (Date.parse(run.started_at) >= d0) spentToday[run.agent_id] = (spentToday[run.agent_id] ?? 0) + run.cost_usd;
  const grants: Record<string, string[]> = {}, liveVersion: Record<string, number> = {}, specs: Record<string, RosterSpec> = {}, costSpecs: Record<string, CostSpec> = {};
  for (const d of defs.error ? [] : defs.data ?? []) {
    const spec = (d.spec ?? {}) as { tools?: unknown; name?: unknown; mandate?: unknown; model?: unknown; effort?: unknown; limits?: { maxCostUsd?: unknown; maxSteps?: unknown } };
    grants[d.agent_id] = Array.isArray(spec.tools) ? spec.tools.filter((t): t is string => typeof t === "string") : [];
    liveVersion[d.agent_id] = Number(d.version);
    specs[d.agent_id] = { name: typeof spec.name === "string" ? spec.name : undefined, mandate: typeof spec.mandate === "string" ? spec.mandate : "", tools: grants[d.agent_id], maxCostUsd: Number(spec.limits?.maxCostUsd) || undefined, model: typeof spec.model === "string" ? spec.model : undefined };
    costSpecs[d.agent_id] = { model: typeof spec.model === "string" ? spec.model : "", effort: typeof spec.effort === "string" ? spec.effort : undefined, tools: grants[d.agent_id], maxSteps: Number(spec.limits?.maxSteps) || undefined, maxCostUsd: Number(spec.limits?.maxCostUsd) || undefined };
  }
  // the roster (docs/agent-roster.md): every agent with a live version, the same whether it started in code or the app
  const live = rows.filter((x) => specs[x.id]).sort((x, y) => (x.created_at ?? "").localeCompare(y.created_at ?? "") || x.id.localeCompare(y.id));
  const palette: Crew = { ids: live.map((x) => x.id).sort(), manualOnly: new Set(live.filter((x) => x.manual_only !== false).map((x) => x.id)), models: MODEL_LIST.map((m) => m.id) };
  const chains: Chain[] = flowRow.error || !flowRow.data ? [] : readFlow(flowRow.data.flow, palette).flow.chains;
  const tools = Object.fromEntries(Object.values(TOOLS).map((t) => [t.id, { label: t.label, kind: t.kind }]));
  const seatTitle = (id: string) => org?.seats.find((x) => x.holder === "agent" && x.agentId === id)?.title ?? null;
  const roster = buildCrew(live.map((x) => memberOf(x, specs[x.id], { tools, cost: runCostOf(costSpecs[x.id], realCost(runs, x.id)), seatTitle: seatTitle(x.id), chains })));
  return { ok: true, now, agents, runs, spentToday, grants, liveVersion, ...roster, palette, chains, chart: org };
});

/** What waits on the owner (card 304): the counts behind the Company page's list and the Approvals badge. One round. */
export const getCounts = cache(async (): Promise<Counts> => {
  await cookies();
  const none: Counts = { photosWaiting: null, approvalsPending: null, proposalsPending: null, approvalTools: [], proposalKinds: [], approvalOwners: [], chainOks: 0, jobsForYou: [], lessonsWaiting: {} };
  if (!health().supabase) { await requireSession(); return none; }
  const [, ph, ap, pp, jobsForYou, lessonsWaiting, ok] = await Promise.all([
    requireSession(),
    db().from("expense_docs").select("id", { count: "exact", head: true }).eq("status", "needs_photo"),
    // drafts still with their lead (slice 4) aren't waiting on the owner yet; the older shape until that migration is applied
    db().from("approvals").select("id, agent_id, department_id, agent_actions(tool)", { count: "exact" }).eq("status", "pending").or("review_status.is.null,review_status.neq.waiting").limit(500)
      .then((x) => (x.error ? db().from("approvals").select("id, agent_id, department_id, agent_actions(tool)", { count: "exact" }).eq("status", "pending").limit(500) : x)),
    db().from("proposals").select("kind", { count: "exact" }).eq("state", "pending").limit(500),
    openJobsThisWeek().catch(() => []),
    proposedLessons(),
    // chains waiting at a Wait for my OK step; none until that migration is applied
    db().from("chain_oks").select("department_id").eq("status", "pending").gt("due_at", new Date().toISOString()).limit(500),
  ]);
  const oks = ok.error ? [] : (ok.data ?? []).map((x) => ({ agent: "", dept: (x as { department_id: string | null }).department_id ?? null }));
  return { photosWaiting: ph.error ? null : ph.count ?? 0, approvalsPending: ap.error ? (oks.length || null) : (ap.count ?? 0) + oks.length, chainOks: oks.length, proposalsPending: pp.error ? null : pp.count ?? 0,
    approvalTools: ap.error ? [] : (ap.data ?? []).map((x) => toolOfCard(x.agent_actions)), proposalKinds: pp.error ? [] : (pp.data ?? []).map((x) => String(x.kind)),
    approvalOwners: [...(ap.error ? [] : (ap.data ?? []).map((x) => { const o = x as { agent_id?: string; department_id?: string | null }; return { agent: o.agent_id ?? "", dept: o.department_id ?? null }; })), ...oks],
    jobsForYou, lessonsWaiting };
});

/** The picture a Make an image step made in this run (chains slice 4), as a 10-minute signed link; null when none. */
export async function getRunImage(runId: string): Promise<string | null> {
  await requireSession();
  if (!health().supabase || !UUID.test(runId)) return null;
  return imageLink(runId).catch(() => null);
}

/** Chains held at a Wait for my OK step, as cards (chains slice 3); null when that table isn't there yet. */
export const getChainOks = cache(async (): Promise<OkCard[] | null> => {
  await requireSession();
  if (!health().supabase) return null;
  const r = await getRoster();
  return pendingOks((id) => r.byId[id]?.name ?? id).catch(() => null);
});

/** The crew with what is set up and the time zone (card 304): for pages that show agents and tools but nothing waiting on the owner. */
export type CrewFloor = Roster & { health: Record<IntegrationId, boolean>; tz: string };
export const getCrewFloor = cache(async (): Promise<CrewFloor> => {
  const [roster, h, tz] = await Promise.all([getRoster(), getHealth(), getTz()]);
  return { ...roster, health: h, tz };
});

/**
 * Everything at once, for the pages that show all of it (the frame, the Company page, an agent, a run's replay, Crew):
 * the pieces above in one round, each read once per request. A page that shows less asks for its pieces by
 * name instead (card 304, check:speed rule 9).
 */
export const getFloor = cache(async (): Promise<Floor> => {
  const [roster, counts, h, tz, org] = await Promise.all([getRoster(), getCounts(), getHealth(), getTz(), getOrgSwitch()]);
  return { ...roster, ...counts, health: h, tz, org };
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getRun(id: string): Promise<Run | null> {
  await requireSession();
  if (!UUID.test(id) || !health().supabase) return null;
  const { data } = await db().from("agent_runs").select(RUN_COLS).eq("id", id).maybeSingle();
  return data ? toRun(data) : null;
}

export interface Pipeline { stages: Record<string, number>; total: number; domains: string[] }

/** Rowan's pipeline by stage, and the domains it won't repeat. */
export async function getPipeline(): Promise<Pipeline | null> {
  await requireSession();
  if (!health().supabase) return null;
  const { data, error } = await db().from("wholesale_leads").select("stage, domain").order("created_at", { ascending: false }).limit(1000);
  if (error) return null;
  const stages: Record<string, number> = {};
  for (const l of data ?? []) stages[l.stage] = (stages[l.stage] ?? 0) + 1;
  return { stages, total: data?.length ?? 0, domains: (data ?? []).map((l) => l.domain).filter(Boolean) };
}

/** The leads one run found, for Good / Not this on each (docs/company-mode.md). */
export async function leadItemsOfRun(runId: string): Promise<{ id: string; business: string; city: string | null; fit: string | null }[] | null> {
  await requireSession();
  if (!UUID.test(runId) || !health().supabase) return null;
  const { data, error } = await db().from("wholesale_leads").select("id, business, city, fit_reason").eq("run_id", runId).order("created_at", { ascending: true }).limit(25);
  if (error) return null;
  return (data ?? []).map((l) => ({ id: l.id as string, business: String(l.business), city: (l.city as string | null) ?? null, fit: (l.fit_reason as string | null) ?? null }));
}

export interface RuleChoice { id: string; text: string }
/** What a reaction can save to and replace, for one agent: its own rules, its department's, the crew's. */
export interface ReactRules { deptName: string | null; agent: RuleChoice[]; department: RuleChoice[]; crew: RuleChoice[] }

/** The rules a reaction may replace, read fresh. Empty lists when memory isn't set up. */
export async function getReactRules(agentId: string): Promise<ReactRules> {
  await requireSession();
  const empty: ReactRules = { deptName: null, agent: [], department: [], crew: [] };
  if (!health().supabase) return empty;
  try {
    const d = (await agentDepartment(agentId).catch(() => null))?.dept ?? null;
    const { rows } = await memoryView(agentId);
    const kept = rows.filter((r) => r.state === "kept");
    const pick = (keep: (r: MemoryRow) => boolean) => kept.filter(keep).slice(0, 12).map((r) => ({ id: r.id, text: r.text }));
    return {
      deptName: d?.name ?? null,
      agent: pick((r) => r.agent_id === agentId && (r.grp === "standing_order" || r.grp === "note" || r.grp === "lesson")),
      department: pick((r) => r.grp === "department" && !!d && r.department_id === d.id),
      crew: pick((r) => r.grp === "crew" && r.agent_id === null),
    };
  } catch { return empty; }
}

/** The rules each approval card's Not this offers, read once per agent on the cards (a department's tabs, the Company page). */
export async function rulesFor(items: readonly { agent_id: string }[]): Promise<Record<string, ReactRules>> {
  const agents = [...new Set(items.map((i) => i.agent_id))];
  return Object.fromEntries(await Promise.all(agents.map(async (a) => [a, await getReactRules(a)] as const)));
}

/** The owner's reactions on one run, keyed by item id ("" for the run). */
export async function getRunReactions(runId: string): Promise<Record<string, Reaction>> {
  await requireSession();
  if (!UUID.test(runId) || !health().supabase) return {};
  return reactionsOnRun(runId);
}

/** An agent's scorecard from the owner (last 30 days) and its latest reactions, for the Overview. */
export async function getReactionsFor(agentId: string): Promise<{ tally: Tally | undefined; latest: Reaction[] }> {
  await requireSession();
  if (!health().supabase) return { tally: undefined, latest: [] };
  const [t, latest] = await Promise.all([reactionTally([agentId], new Date(Date.now() - 30 * 864e5).toISOString()), reactionsOf(agentId, 8)]);
  return { tally: t[agentId], latest };
}

export interface Books {
  statuses: Record<string, number>;
  total: number;
  proposals: number;
  waiting: { date: string; merchant: string; amount_usd: number }[];
  coverage: number | null;
}

/** Quinn's books: expense_docs by status, proposals waiting, and the photo asks. Null until the table exists. */
export async function getBooks(): Promise<Books | null> {
  await requireSession();
  if (!health().supabase) return null;
  const { data, error } = await db().from("expense_docs").select("status, date, merchant, amount_usd, proposal_status").order("date", { ascending: false }).limit(2000);
  if (error) return null;
  const statuses: Record<string, number> = {};
  for (const d of data ?? []) statuses[d.status] = (statuses[d.status] ?? 0) + 1;
  const counted = (data ?? []).filter((d) => d.status !== "not_needed" && d.status !== "personal");
  const covered = counted.filter((d) => d.status === "matched" || d.status === "bank_record_only").length;
  return {
    statuses,
    total: data?.length ?? 0,
    proposals: (data ?? []).filter((d) => d.proposal_status === "proposed").length,
    waiting: (data ?? []).filter((d) => d.status === "needs_photo").slice(0, 8).map((d) => ({ date: d.date, merchant: d.merchant, amount_usd: Number(d.amount_usd) })),
    coverage: counted.length ? Math.round((covered / counted.length) * 1000) / 10 : null,
  };
}

// ---- Approvals and the gateway log

export interface ApprovalItem {
  id: string;
  action_id: string;
  agent_id: string;
  title: string;
  reasoning: string | null;
  status: string;
  created_at: string;
  decided_at: string | null;
  preview: { date?: string; merchant?: string; amount_usd?: number; receipt_path?: string | null; category?: string | null; note?: string | null; charge?: string; to?: string; subject?: string; body?: string; list?: string; preview_text?: string; title?: string; slot?: string; minutes?: number; record?: string; tags?: string[]; from?: number; available?: number; change?: number; reason?: string; copy?: { field: string; before: string; after: string }[]; items?: number | null; carrier?: string; tracking?: string; notify?: boolean; percent?: number; uses?: number; whole?: boolean; refund_items?: string[] | null; amount?: string; refunded_before?: string; starts?: string; ends?: string; order?: string; deal?: string; stage?: string; ad?: string; result?: string; period?: string; why?: string; customer?: string; location?: string; currency?: string; lines?: { description: string; amount: number }[]; total?: string; days_until_due?: number; memo?: string | null };
  /** The gateway tool: a Mercury change or a Gmail draft. */
  tool: string;
  /** The run that staged it, so a department's chat shows the card under that run (slice 3). */
  run_id: string | null;
  /** A 10-minute signed link to the receipt file, so the owner can check it before approving. */
  receipt_url: string | null;
  action_status: string;
  action_reason: string | null;
  /** The department the agent sat in when it drafted this (slice 4); null off the chart or before the migration. */
  department_id: string | null;
  /** The lead that checks it first, and how that went: waiting, noted, sent_back, or skipped (not checked in time). */
  reviewer_agent_id: string | null;
  review_status: string | null;
  review_note: string | null;
  /** Shared brain, slice 4b: what the agent was shown before it drafted, in code's words. */
  brain_note: string | null;
  review_due: string | null;
}
export interface GatewayAction { id: string; agent_id: string; tool: string; action_type: string; target: string; status: string; reason: string | null; created_at: string; executed_at: string | null; run_id: string | null; exec_run_id: string | null }
export interface ApprovalsView {
  pending: ApprovalItem[];
  /** Pending, still waiting for the lead's check (the owner can decide them anyway). */
  withLead: ApprovalItem[];
  waiting: ApprovalItem[]; decided: ApprovalItem[]; log: GatewayAction[]; staleHours: number;
  /** Names of the agents on these cards that the crew list doesn't know (agents built in the app, leads). */
  names: Record<string, string>;
  /** Departments on the chart, for the tag and the filter. */
  departments: { id: string; name: string }[];
}

/** The approvals queue, approved changes waiting to be applied, recent decisions and the gateway log. Null until the tables exist. */
const AP_COLS = "id, action_id, agent_id, title, reasoning, status, created_at, decided_at, preview, agent_actions(status, reason, tool, run_id)";
const AP_REVIEW = "department_id, reviewer_agent_id, review_status, review_note, review_due";
type ApRow = Pick<ApprovalItem, "id" | "action_id" | "agent_id" | "title" | "reasoning" | "status" | "created_at" | "decided_at"> & { preview: unknown; agent_actions: unknown } & Partial<Pick<ApprovalItem, "department_id" | "reviewer_agent_id" | "review_status" | "review_note" | "review_due" | "brain_note">>;

export async function getApprovals(): Promise<ApprovalsView | null> {
  await requireSession();
  if (!health().supabase) return null;
  const [ap, log, pol] = await Promise.all([
    // the slice 4 and 4b columns, or the older shapes until those migrations are applied
    db().from("approvals").select(`${AP_COLS}, ${AP_REVIEW}, brain_note`).order("created_at", { ascending: false }).limit(200)
      .then((r) => (r.error ? db().from("approvals").select(`${AP_COLS}, ${AP_REVIEW}`).order("created_at", { ascending: false }).limit(200) : r))
      .then((r) => (r.error ? db().from("approvals").select(AP_COLS).order("created_at", { ascending: false }).limit(200) : r)),
    db().from("agent_actions").select("id, agent_id, tool, action_type, target, status, reason, created_at, executed_at, run_id, exec_run_id").order("created_at", { ascending: false }).limit(60),
    db().from("policies").select("value_json").eq("key", "approval_expiry_hours").maybeSingle(),
  ]);
  if (ap.error || log.error) return null;
  const org = await loadOrg().catch(() => null);
  const items: ApprovalItem[] = await Promise.all(((ap.data ?? []) as unknown as ApRow[]).map(async (r) => {
    const act = (Array.isArray(r.agent_actions) ? r.agent_actions[0] : r.agent_actions) as { status: string; reason: string | null; tool: string; run_id?: string | null } | null;
    const preview = (r.preview ?? {}) as ApprovalItem["preview"];
    let receipt_url: string | null = null;
    if (preview.receipt_path && r.status === "pending") {
      const { data } = await db().storage.from("receipts").createSignedUrl(preview.receipt_path, 600);
      receipt_url = data?.signedUrl ?? null;
    }
    return { id: r.id, action_id: r.action_id, agent_id: r.agent_id, title: r.title, reasoning: r.reasoning, status: r.status, created_at: r.created_at, decided_at: r.decided_at, preview, receipt_url, action_status: act?.status ?? "?", action_reason: act?.reason ?? null, tool: act?.tool ?? "", run_id: act?.run_id ?? null,
      department_id: r.department_id ?? null, reviewer_agent_id: r.reviewer_agent_id ?? null, review_status: r.review_status ?? null, review_note: r.review_note ?? null, review_due: r.review_due ?? null, brain_note: r.brain_note ?? null };
  }));
  return {
    pending: items.filter((i) => i.status === "pending" && i.review_status !== "waiting").reverse(), // oldest first
    withLead: items.filter((i) => i.status === "pending" && i.review_status === "waiting").reverse(),
    waiting: items.filter((i) => i.status === "approved" && ["approved", "executing", "failed"].includes(i.action_status)),
    decided: items.filter((i) => i.status !== "pending" && !(i.status === "approved" && ["approved", "executing", "failed"].includes(i.action_status))).slice(0, 30),
    log: (log.data ?? []) as GatewayAction[],
    staleHours: Number(pol.data?.value_json) || 72,
    departments: (org?.departments ?? []).map((d) => ({ id: d.id, name: d.name })),
    names: await agentNames([...new Set(items.flatMap((i) => [i.agent_id, i.reviewer_agent_id ?? ""]).filter(Boolean))]).catch(() => ({})),
  };
}

// ---- Memory (docs/agent-memory.md)

export interface MemoryTab { rows: MemoryRow[]; events: MemoryEvent[]; load: MemoryLoad | null; loads: boolean; /** Linked Notion pages, as a run would read them now. */ pages: PageLoad[]; /** The department the agent sits in, whose rules it loads. */ dept: { id: string; name: string } | null; /** Where it sits, and the other agents' working memory it reads because of that (card 157). */ reach: Reach; shared: SharedLine[] }

/** One agent's memory for the Memory tab, and what its next run would load. Null with a reason until the tables exist. */
export async function getMemory(agentId: string): Promise<{ tab: MemoryTab | null; problem?: string }> {
  await requireSession();
  if (!health().supabase) return { tab: null, problem: "Supabase isn’t set up." };
  try {
    // every agent with a live version loads its memory (docs/agent-roster.md)
    const loads = !!(await getRoster()).byId[agentId];
    const [view, load] = await Promise.all([memoryView(agentId), loads ? loadMemory(agentId) : Promise.resolve(null)]);
    // an agent that doesn't load memory yet still shows whether its linked pages can be read
    const pages = load?.pages ?? await readPages(view.rows.filter((r) => r.agent_id === agentId && r.state === "kept"), DEFAULT_BUDGET);
    return { tab: { ...view, load, loads, pages } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { tab: null, problem: /agent_memory|memory_events|schema cache|does not exist/i.test(msg) ? "The memory tables aren’t in Supabase yet. Apply the agent memory migration (see the PR) and this tab fills in." : msg };
  }
}

// ---- Chains (chains slice 1, card 430): a department's Chains tab and Settings > Schedule

/**
 * The saved chains and what their editor needs: every agent a step can pick (where it runs, its department, what a
 * run costs from real runs), the departments, and, for Settings, the flow's versions. A problem in place of the
 * chains when the crew_flow table isn't there yet.
 */
export async function getChains(r: Roster, tz: string, versions = false): Promise<ChainsData> {
  await requireSession();
  const chart = r.chart;
  const deptOf: Record<string, string | null> = Object.fromEntries(r.palette.ids.map((id) => [id, chart ? seatOf(chart, id)?.departmentId ?? null : null]));
  const where = new Map<string, string>();
  if (health().supabase) {
    const { data } = await db().from("agents").select("id, runs_on");
    for (const a of data ?? []) where.set(a.id as string, (a.runs_on as string | null) ?? "operator");
  }
  const palette: ChainAgent[] = r.palette.ids.map((id) => {
    const a = r.byId[id];
    const model = a?.model ?? r.agents[id]?.model;
    return {
      id, name: a?.name ?? id, role: a?.role ?? "", job: a?.job ?? "", hue: a?.hue ?? "#999",
      enabled: !!r.agents[id]?.enabled, buttonOnly: r.palette.manualOnly.has(id), dept: deptOf[id],
      claude: where.get(id) === "claude", model: MODEL_LIST.find((m) => m.id === model)?.label ?? model ?? null,
      metrics: METRICS[id] ?? [], perRun: a?.perRun ?? null, estimated: a?.costBasis === "estimate",
    };
  });
  // Ask a model steps (chains slice 2): the models and whether each can run here, and who pays for a chain's steps
  const keys = await modelKeysReady().catch(() => NO_MODEL_KEYS);
  const models: ChainModel[] = MODEL_LIST.map((m) => ({ id: m.id, label: m.label, ready: modelReady(m.id, keys), in: m.in, out: m.out }));
  // Make an image steps (slice 4): the image models and whether each can run here (its provider's key is saved)
  const imageModels: ChainImageModel[] = IMAGE_MODELS.map((m) => ({ id: m.id, label: m.label, ready: !!keys[m.provider] }));
  const base = {
    palette, deptOf, depts: (chart?.departments ?? []).map((d) => ({ id: d.id, name: d.name })), models, imageModels, payers: payers(chart),
    approvalTools: APPROVAL_TOOLS.map((t) => ({ id: t, label: APPROVAL_LABELS[t] ?? t })),
    controls: controlsOn(), maxSteps: MAX_STEPS, maxChains: MAX_CHAINS, now: r.now, tz,
  };
  const empty = { version: 0, flow: { chains: [] }, problems: [], versions: [], next: {} };
  if (!health().supabase) return { ...base, ...empty, problem: "Supabase isn’t set up, so there are no chains to show." };
  try {
    const [active, all] = await Promise.all([loadFlow(r.palette), versions ? listFlowVersions(r.palette) : Promise.resolve([])]);
    const next = Object.fromEntries(active.flow.chains.map((c) => [c.key, nextFirings(c, r.now, 3, tz).map((t) => new Date(t).toISOString())]));
    return {
      ...base, version: active.version, flow: active.flow, problems: active.problems, next,
      versions: all.map((v) => ({ version: v.version, active: v.active, note: v.note, createdBy: v.createdBy, createdAt: v.createdAt, chains: v.flow.chains.length, on: v.flow.chains.filter((c) => c.on).map((c) => c.name) })),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, ...empty, problem: /crew_flow/.test(msg) ? "The crew_flow table isn’t in Supabase yet: apply the migration 20261112200000_crew_flow.sql." : `Supabase: ${msg}` };
  }
}

/**
 * The run view of the chain run this run belongs to (chains slice 5): its steps as a timeline, with where each ran,
 * what it cost and what it passed on, plus a short signed link to each picture it made. Null when the run isn't in a
 * chain (or the columns aren't there yet).
 */
export async function getChainRuns(runId: string, tz: string): Promise<{ chainId: string; key: string; name: string; timeline: Timeline; images: Record<string, string> } | null> {
  await requireSession();
  if (!UUID.test(runId) || !health().supabase) return null;
  const { data: me, error } = await db().from("agent_runs").select("chain_id, chain_key").eq("id", runId).maybeSingle();
  if (error || !me?.chain_id) return null;
  const [{ data }, oks, r, where] = await Promise.all([
    db().from("agent_runs").select("id, agent_id, chain_step, status, started_at, ended_at, cost_usd, summary, error").eq("chain_id", me.chain_id).order("chain_step").order("started_at"),
    // the Wait for my OK holds of this chain run; none when that table isn't there yet
    db().from("chain_oks").select("step, status, decided_by, decided_at, created_at, due_at").eq("chain_id", me.chain_id).then((x) => x.data ?? [], () => []),
    getRoster(),
    db().from("agents").select("id, runs_on, model").then((x) => x.data ?? [], () => []),
  ]);
  let name = me.chain_key as string, steps: Step[] = [];
  try {
    const flow = await loadFlow(r.palette);
    const c = flow.flow.chains.find((x) => x.key === me.chain_key);
    if (c) { name = c.name; steps = c.steps; }
  } catch { /* the flow can't be read: show the runs alone */ }
  const runs: TimelineRun[] = (data ?? []).map((x) => ({ id: x.id, step: Number(x.chain_step ?? 0), agentId: x.agent_id, status: x.status as RunStatus, startedAt: x.started_at, endedAt: x.ended_at, costUsd: Number(x.cost_usd ?? 0), summary: (x.summary ?? x.error ?? null) as string | null }));
  const rows = new Map((where as { id: string; runs_on: string | null; model: string | null }[]).map((a) => [a.id, a]));
  const label = (id: string) => MODEL_LIST.find((m) => m.id === id)?.label ?? id;
  const timeline = buildTimeline(steps, runs, (oks as { step: number; status: TimelineOk["status"]; decided_by: string | null; decided_at: string | null; created_at: string; due_at: string }[]).map((o) => ({ step: o.step, status: o.status, decidedBy: o.decided_by, decidedAt: o.decided_at, createdAt: o.created_at, dueAt: o.due_at })), {
    agent: (id) => r.byId[id]?.name ?? id,
    claude: (id) => rows.get(id)?.runs_on === "claude",
    agentModel: (id) => { const m = r.byId[id]?.model ?? rows.get(id)?.model ?? r.agents[id]?.model; return m ? label(m) : null; },
    model: label,
  }, (iso) => when(iso, tz));
  // each picture a Make an image step kept, through a short signed link (slice 4)
  const made = timeline.items.filter((i) => i.kind === "image" && i.runId && i.state === "ok");
  const links = await Promise.all(made.map((i) => imageLink(i.runId!).catch(() => null)));
  const images = Object.fromEntries(made.flatMap((i, k) => (links[k] ? [[i.runId!, links[k]!]] : [])));
  return { chainId: me.chain_id as string, key: me.chain_key as string, name, timeline, images };
}

// ---- Vendors and suppressed addresses (Settings). Null when the caps migration isn't applied yet.

export interface VendorRow { id: string; name: string; kind: string; mercury_recipient_id: string | null; contact_email: string | null; added_by: string; added_at: string }
export interface SuppressionRow { email: string; reason: string | null; source: string; created_at: string }

export async function getVendorsAndSuppressions(): Promise<{ vendors: VendorRow[]; suppressed: SuppressionRow[] } | null> {
  await requireSession();
  if (!health().supabase) return null;
  const [v, s] = await Promise.all([
    db().from("vendors").select("id, name, kind, mercury_recipient_id, contact_email, added_by, added_at").order("name"),
    db().from("email_suppressions").select("email, reason, source, created_at").order("created_at", { ascending: false }).limit(200),
  ]);
  if (v.error || s.error) return null;
  return { vendors: (v.data ?? []) as VendorRow[], suppressed: (s.data ?? []) as SuppressionRow[] };
}
