import "server-only";
// The setup check (card 281, docs/setup-check.md): one run of a setup agent on a thinking model that
// reads how a just-connected tool is set up and files what is missing for this business. It reads only
// through the catalog (the tool's settings read, its calculate tools, and web search and fetch held to
// the tool's help domains), files findings with a report tool code checks one by one, and changes
// nothing in the tool. Findings are saved in setup_checks only after a run that finishes.
import { db } from "@/core/db";
import { loadSpec, type AgentSpec } from "@/core/agent-spec";
import { runExplore } from "@/core/runner";
import { withRun } from "@/core/runs";
import { TOOLS } from "@/core/tools/catalog";
import type { ToolDef } from "@/core/tools/types";
import { SETUP_AGENT } from "@/core/setup-rules";
import { loadOrg } from "@/core/org";
import { fileSetupFinding } from "@/core/proposals";
import { TILE_BY_ID, type ToolTileId } from "@/core/tools-step-rules";
import {
  CHECKS, EVIDENCE_MAX, FIXES, FIX_LIMITS, HELP_USES, MAX_STEPS, SETUP_CHECK_EFFORT, SETUP_CHECK_LIMITS, SETUP_CHECK_MODEL, SEVERITIES, STEP_MAX, TITLE_MAX, TOPIC_MAX, WHY_MAX,
  checkDirective, countLine, dueReturns, recheckFrom, fixAgents, fixDirective, hasCheck, helpDomains, isStale, keepFindings, readFinding, readFindings, type CheckTile, type Finding, type FixRun, type FixType,
} from "@/core/setup-check-rules";

export interface SetupCheck { tile: CheckTile; status: "running" | "done" | "failed"; findings: Finding[]; summary: string | null; costUsd: number; runId: string | null; updatedAt: string }

const STORES: ToolTileId[] = ["shopify"];

function rowOf(r: Record<string, unknown>): SetupCheck {
  const status = r.status === "done" || r.status === "failed" ? r.status : "running";
  const updatedAt = String(r.updated_at ?? "");
  return { tile: r.tool as CheckTile, status: isStale(status, updatedAt) ? "failed" : status, findings: readFindings(r.findings), summary: (r.summary as string | null) ?? null, costUsd: Number(r.cost_usd) || 0, runId: (r.run_id as string | null) ?? null, updatedAt };
}

/** Every check this business has, one per tool (the latest). Null when the table can't be read. */
export async function setupChecks(): Promise<SetupCheck[] | null> {
  const { data, error } = await db().from("setup_checks").select("tool, status, findings, summary, cost_usd, run_id, updated_at").order("updated_at");
  if (error) return null;
  return (data ?? []).filter((r) => hasCheck(r.tool)).map(rowOf);
}

export async function setupCheck(tile: CheckTile): Promise<SetupCheck | null> {
  return (await setupChecks())?.find((c) => c.tile === tile) ?? null;
}

/**
 * Marks a check as running, or says why it can't start (one is already running). The caller runs it
 * after answering (runCheck), so the founder isn't held up by a minute of thinking.
 */
export async function claimCheck(tile: CheckTile): Promise<{ ok: true } | { problem: string }> {
  const now = await setupCheck(tile);
  if (now?.status === "running") return { problem: "A check of this tool is already running." };
  const { error } = await db().from("setup_checks").upsert({ tool: tile, status: "running", summary: null, updated_at: new Date().toISOString() }, { onConflict: "org_id,tool" });
  if (error) throw new Error(error.message);
  return { ok: true };
}

/** The report tool the agent files with: one finding per call, checked in code, held until the run finishes. */
function findingTool(tile: CheckTile, domains: readonly string[], held: Finding[]): ToolDef {
  const c = CHECKS[tile];
  return {
    id: "report_setup_finding", label: "File a setup finding", detail: `Files one thing about how ${c.name} is set up: a gap that matters for this business, with its steps and the help page they came from, or something already done well. Code checks it; nothing changes in ${c.name}`,
    kind: "report", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [
      { name: "severity", type: "enum", options: [...SEVERITIES], description: "broken: loses data or money now. worth_fixing: would help. good: already done well (no steps)." },
      { name: "topic", type: "text", maxLength: TOPIC_MAX, description: "A short tag for what this is about, lowercase with dots, like ga4.data_retention or ga4.purchase_tracking." },
      { name: "title", type: "text", maxLength: TITLE_MAX, description: "What is wrong or right, in the founder's words." },
      { name: "why", type: "text", maxLength: WHY_MAX, description: "Why it matters for this business, with the numbers the reads gave." },
      { name: "evidence", type: "text", maxLength: EVIDENCE_MAX, description: `The keys from the reads you judged it from, comma separated: ${c.evidence.join(", ")}.` },
      { name: "steps", type: "text", maxLength: (STEP_MAX + 1) * MAX_STEPS, multiline: true, optional: true, description: `For a gap: the Show me how steps, one per line, at most ${MAX_STEPS}, from the help page you fetched. No links in the steps.` },
      { name: "help_url", type: "url", optional: true, description: `For a gap: the help page the steps came from, on ${domains.join(" or ")}. It must be a page you fetched in this run.` },
      ...(c.fixes.length ? [{ name: "fix", type: "enum" as const, options: [...c.fixes], optional: true, description: `For a gap one of these actions could fix for the owner: ${c.fixes.map((f) => `${f} (${FIXES[f].label})`).join(", ")}. It only offers a Fix it for me button.` }] : []),
    ],
    collect: (input, rows) => {
      const r = readFinding(input, { evidence: c.evidence, domains, held: rows.length, fixes: c.fixes });
      if ("problem" in r) return r;
      return { row: { finding: JSON.stringify(r.finding) } };
    },
    deliver: async (o) => { held.push(...o.rows.map((r) => JSON.parse(String(r.finding)) as Finding)); return "kept"; },
  };
}

/** The help tools for this run: Claude's web search and fetch, each held to the help domains and HELP_USES. */
const helpTool = (id: "web_search" | "web_fetch", domains: string[]): ToolDef => ({ ...TOOLS[id], server: { ...TOOLS[id].server!, maxUses: HELP_USES, allowedDomains: domains } });

/**
 * One check, as a logged run of the setup agent (the Chief of Staff's seat). In setup, before the business
 * has departments, it is a setup run (free setup counts it); otherwise a preview, which writes and sends
 * nothing and runs while the agent is off duty. Saves the findings that pass, or marks the check failed.
 */
export async function runCheck(tile: CheckTile, connected: ReadonlySet<string>): Promise<SetupCheck | null> {
  const fail = async (summary: string, runId: string | null = null, costUsd = 0) => {
    await db().from("setup_checks").update({ status: "failed", summary: summary.slice(0, 300), run_id: runId, cost_usd: costUsd, updated_at: new Date().toISOString() }).eq("tool", tile);
    return setupCheck(tile);
  };
  try {
    const loaded = await loadSpec(SETUP_AGENT);
    if (!loaded) return fail("The Chief of Staff has no saved version, so there's no one to run the check.");
    const domains = helpDomains(tile, connected);
    const store = STORES.find((s) => connected.has(s)) ?? null;
    const c = CHECKS[tile];
    const { data: facts } = await db().from("business_facts").select("text, state").order("created_at").limit(40);
    const held: Finding[] = [];
    const local = [findingTool(tile, domains, held), helpTool("web_search", domains), helpTool("web_fetch", domains)];
    const tools = [c.read, ...(store ? c.calcs : []), ...local.map((t) => t.id)];
    const spec: AgentSpec = {
      ...loaded.spec,
      name: "Setup check",
      directive: checkDirective({ tile, facts: (facts ?? []).filter((f) => f.state === "known").map((f) => String(f.text)).slice(0, 30), domains, storeName: store ? TILE_BY_ID[store].name : null }),
      goodResult: "Every gap that matters filed with its evidence, steps and help page, then one or two plain sentences on the overall state.",
      model: SETUP_CHECK_MODEL, effort: SETUP_CHECK_EFFORT, tools, limits: SETUP_CHECK_LIMITS, outputName: "setup check",
    };
    const { count } = await db().from("departments").select("id", { count: "exact", head: true });
    const { inSetup } = await import("@/core/setup");
    const trigger = (await inSetup()) && !count ? "setup" : "preview";
    let fetched: string[] = [], said: string | null = null, finished = false;
    const res = await withRun(SETUP_AGENT, trigger, async (runId) => {
      const r = await runExplore(spec, { agentId: SETUP_AGENT, runId, deliver: true, chat: true, prompt: `Look over this business's ${c.name} now.`, tools: { ...TOOLS, ...Object.fromEntries(local.map((t) => [t.id, t])) } });
      finished = r.finished; said = r.result;
      fetched = r.steps.flatMap((s) => (s.kind === "tool" && s.tool === "web_fetch" && s.input && typeof (s.input as { url?: unknown }).url === "string" ? [String((s.input as { url: string }).url)] : []));
      return { status: r.status, summary: r.summary, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd };
    });
    if (res.status !== "ok" || !finished) return fail(res.status === "skipped" ? `Couldn't run: ${res.summary}` : "The check stopped before it finished, so nothing was saved. Tap Check again.", res.runId, res.costUsd ?? 0);
    const { kept, dropped } = keepFindings(held, fetched);
    const summary = `${String(said ?? "").replace(/\s+/g, " ").trim().slice(0, 240)}${dropped ? ` (${dropped} finding${dropped === 1 ? "" : "s"} left out: their help page wasn't one the check read.)` : ""}`.trim() || countLine(kept);
    const { error } = await db().from("setup_checks").update({ status: "done", findings: kept, summary: summary.slice(0, 300), run_id: res.runId, cost_usd: res.costUsd ?? 0, checked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("tool", tile);
    if (error) throw new Error(error.message);
    return setupCheck(tile);
  } catch (e) {
    return fail(`The check failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`);
  }
}

/** Skip, or open again, one finding (by its place on the card). Only the founder's tap changes it. */
export async function setFindingState(tile: CheckTile, index: number, state: "open" | "skipped"): Promise<void> {
  const now = await setupCheck(tile);
  if (!now || now.status !== "done") throw new Error("That check has no findings yet.");
  if (!Number.isInteger(index) || index < 0 || index >= now.findings.length) throw new Error("Unknown finding.");
  // card 284: a skip starts the clock for its one return as a head's proposal
  const findings = now.findings.map((f, i) => (i === index ? { ...f, state, skipped_at: state === "skipped" ? new Date().toISOString() : f.skipped_at } : f));
  const { error } = await db().from("setup_checks").update({ findings }).eq("tool", tile);
  if (error) throw new Error(error.message);
}

/**
 * Card 284, from the scheduler: skipped findings whose time has come go back to the owner once, as a
 * proposal from the head who owns that tool (recheckFrom). Code files it; no model runs and nothing in the
 * tool changes. The owner's yes opens the finding again on Connections. Marked returned either way the
 * proposal went in, so it never comes back twice; with no agent to file it, it waits on the Desk.
 */
export async function returnSkipped(nowMs: number): Promise<string[]> {
  const checks = await setupChecks();
  const due = dueReturns(checks ?? [], nowMs);
  if (!due.length) return [];
  const org = await loadOrg();
  if (!org) return [];
  const { grants } = await liveGrants();
  const filed: string[] = [];
  for (const d of due) {
    const from = recheckFrom(d.tile, grants, (t) => TOOLS[t]?.needs, org);
    if (!from) continue;
    // marked first, from the row as it is now: a proposal is never filed twice for one finding
    const row = await setupCheck(d.tile);
    const f = row?.findings[d.index];
    if (!row || !f || f.title !== d.finding.title || f.state !== "skipped" || f.returned_at) continue;
    const findings = row.findings.map((x, i) => (i === d.index ? { ...x, returned_at: new Date(nowMs).toISOString() } : x));
    const { error } = await db().from("setup_checks").update({ findings }).eq("tool", d.tile);
    if (error) throw new Error(error.message);
    await fileSetupFinding({ tile: d.tile, index: d.index, title: f.title, why: f.why }, from).then(() => filed.push(`${d.tile}: ${f.title}`), (e: unknown) => console.error("[setup check] re-check", e instanceof Error ? e.message : e));
  }
  return filed;
}

/** A line for Avery's next setup reply: what the finished checks found, counted in code. Null with none. */
export async function checkNote(): Promise<string | null> {
  const done = ((await setupChecks()) ?? []).filter((c) => c.status === "done");
  if (!done.length) return null;
  return `Setup checks so far (the founder sees each on its tool's card): ${done.map((c) => `${CHECKS[c.tile].name}: ${countLine(c.findings)}`).join("; ")}. Mention it briefly once if it fits; don't repeat the findings.`;
}

// ---------- Fix it for me (card 282) ----------

/** Each agent's live tools, from its active saved version. */
async function liveGrants(): Promise<{ grants: Record<string, string[]>; names: Record<string, string> }> {
  const { data, error } = await db().from("agent_defs").select("agent_id, spec").eq("active", true);
  if (error) throw new Error(error.message);
  const grants: Record<string, string[]> = {}, names: Record<string, string> = {};
  for (const d of data ?? []) {
    const spec = (d.spec ?? {}) as { tools?: unknown; name?: unknown };
    grants[d.agent_id] = Array.isArray(spec.tools) ? spec.tools.filter((t): t is string => typeof t === "string") : [];
    names[d.agent_id] = typeof spec.name === "string" ? spec.name : d.agent_id;
  }
  return { grants, names };
}

async function saveFixRun(tile: CheckTile, index: number, run: FixRun): Promise<void> {
  // read again just before writing, so a Skip tapped meanwhile isn't lost
  const now = await setupCheck(tile);
  if (!now || now.status !== "done" || !now.findings[index]) return;
  const findings = now.findings.map((f, i) => (i === index ? { ...f, fix_run: run } : f));
  const { error } = await db().from("setup_checks").update({ findings }).eq("tool", tile);
  if (error) throw new Error(error.message);
}

/**
 * Fix it for me: who would run it. An agent that already holds the fix's action and reads; otherwise
 * where to grant it (the builder's Tools step of an agent that holds one of the reads, else the Crew).
 */
export async function claimFix(tile: CheckTile, index: number): Promise<{ agentId: string; name: string; fix: FixType; finding: Finding } | { problem: string; href?: string }> {
  const now = await setupCheck(tile);
  if (!now || now.status !== "done") return { problem: "That check has no findings yet." };
  const finding = now.findings[index];
  if (!finding) return { problem: "Unknown finding." };
  if (!finding.fix || !(CHECKS[tile].fixes as readonly string[]).includes(finding.fix)) return { problem: "This one has no Fix it for me." };
  if (finding.fix_run?.status === "running" && !isStale("running", finding.fix_run.at)) return { problem: "That fix is already running." };
  const fix = finding.fix;
  const { grants, names } = await liveGrants();
  const [agentId] = fixAgents(grants, fix);
  if (!agentId) {
    const near = Object.keys(grants).sort().find((a) => FIXES[fix].reads.some((t) => grants[a].includes(t)));
    return { problem: `No agent can do this yet. Give one “${FIXES[fix].label}” on its Tools step, then tap Fix it for me again.`, href: near ? `/build/${near}?edit=1&step=connections` : "/crew" };
  }
  await saveFixRun(tile, index, { status: "running", agent: names[agentId], run_id: null, staged: 0, note: "", at: new Date().toISOString() });
  return { agentId, name: names[agentId], fix, finding };
}

/**
 * The fix run: that agent, logged through withRun as a manual run (so it respects its duty switch and
 * budget), held to the fix's action and reads, delivering what it stages to the gateway as approval cards.
 */
export async function runFix(tile: CheckTile, index: number, c: { agentId: string; name: string; fix: FixType; finding: Finding }): Promise<void> {
  const done = (run: Omit<FixRun, "agent" | "at">) => saveFixRun(tile, index, { ...run, agent: c.name, at: new Date().toISOString() });
  try {
    const loaded = await loadSpec(c.agentId);
    if (!loaded) return done({ status: "failed", run_id: null, staged: 0, note: `${c.name} has no saved version.` });
    const f = FIXES[c.fix];
    const spec: AgentSpec = {
      ...loaded.spec,
      directive: fixDirective({ fix: c.fix, tool: CHECKS[tile].name, finding: c.finding, agentName: c.name }),
      goodResult: "The changes that matter most staged as approval cards, then one plain sentence on what was staged.",
      tools: [...f.reads, f.tool], limits: FIX_LIMITS, outputName: "setup fix",
    };
    let staged = 0;
    const res = await withRun(c.agentId, "manual", async (runId, memory) => {
      // its standing orders and lessons still hold on a fix run
      const r = await runExplore(spec, { agentId: c.agentId, runId, memoryBlock: memory?.block ?? "", deliver: true, chat: true, prompt: `Fix it for me: ${c.finding.title}` });
      staged = r.actions.filter((a) => a.status === "queued" || a.status === "scheduled").length;
      return { status: r.status, summary: r.summary, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costUsd: r.costUsd };
    });
    if (res.status !== "ok") return done({ status: "failed", run_id: res.runId, staged, note: res.status === "skipped" ? `${c.name} couldn't run: ${res.summary}` : "The fix stopped before it finished." });
    return done({ status: "done", run_id: res.runId, staged, note: staged ? `${c.name} staged ${staged} change${staged === 1 ? "" : "s"} for you to approve.` : `${c.name} found nothing to change.` });
  } catch (e) {
    return done({ status: "failed", run_id: null, staged: 0, note: `The fix failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}` });
  }
}
