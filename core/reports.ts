import "server-only";
// Writes and reads a department's reports (overview slice 2, docs/department-pages.md). A writing reads the
// department's runs in the window, hands them to one small-model call as numbered facts marked as data, and keeps
// only the lines core/report-rules.ts checked against those runs. Each writing is a quick run through withRun
// (trigger "report"), paid by the head or the company seat, so it is logged, budgeted and skipped when that agent is
// off duty or over budget. A window with no runs is saved with no lines and no model call. Nothing here sends anything.
import { db } from "@/core/db";
import { withRun } from "@/core/runs";
import { agentNames, loadOrg } from "@/core/org";
import { companySeat, deptAgentIds, headOf, type Org } from "@/core/org-rules";
import { orgTz } from "@/core/tz";
import { orgOn } from "@/core/org-switch";
import { enqueue } from "@/core/jobs";
import { firingsBetween } from "@/core/flow-rules";
import type { Chain } from "@/core/flow-rules";
import { costUsd } from "@/integrations/anthropic";
import { modelClient, type ModelClient } from "@/integrations/llm";
import {
  COMPANY_SCOPE, OUT_MAX, REPORT_MODEL, REPORT_PERIODS, REPORT_TRIGGER, checkCompany, checkLines, companyDue, companyMessages, deptFacts,
  factsFor, reportDedupe, reportDue, reportMessages, reportPayer, reportPayload, todayIn, windowOf, type CoLine, type Line, type RepRun, type ReportPeriod,
} from "@/core/report-rules";

export interface Report { period: ReportPeriod; day: string; lines: (Line | CoLine)[]; runCount: number; dropped: number; costUsd: number; writtenAt: string; writerRun: string | null }

/** The newest report of each period for a department, or for the company (COMPANY_SCOPE); null for a period with none. */
export async function latestReports(deptId: string): Promise<Record<ReportPeriod, Report | null>> {
  const read = async (period: ReportPeriod): Promise<Report | null> => {
    const { data, error } = await db().from("reports").select("period, day, lines, run_count, dropped, cost_usd, written_at, writer_run")
      .eq("scope", deptId).eq("period", period).order("day", { ascending: false }).limit(1).maybeSingle();
    if (error || !data) return null;
    return {
      period, day: data.day as string, lines: Array.isArray(data.lines) ? (data.lines as (Line | CoLine)[]) : [], runCount: Number(data.run_count) || 0,
      dropped: Number(data.dropped) || 0, costUsd: Number(data.cost_usd) || 0, writtenAt: data.written_at as string, writerRun: (data.writer_run as string | null) ?? null,
    };
  };
  const [day, week] = await Promise.all([read("day"), read("week")]);
  return { day, week };
}

/** Each department's newest day report (the Company page's department cards), by department id. */
export async function latestDayReports(deptIds: readonly string[]): Promise<Record<string, { day: string; lines: Line[] }>> {
  if (!deptIds.length) return {};
  const { data, error } = await db().from("reports").select("scope, day, lines").eq("period", "day").in("scope", [...deptIds])
    .order("day", { ascending: false }).limit(deptIds.length * 7);
  if (error) return {};
  const out: Record<string, { day: string; lines: Line[] }> = {};
  for (const r of data ?? []) if (!out[r.scope as string]) out[r.scope as string] = { day: r.day as string, lines: Array.isArray(r.lines) ? (r.lines as Line[]) : [] };
  return out;
}

/** Writes today's day and week reports for a department. Returns what happened, in words. */
export async function writeReports(deptId: string, now = Date.now(), client?: ModelClient): Promise<{ ok: boolean; text: string; runId?: string }> {
  const org = await loadOrg();
  const dept = org?.departments.find((d) => d.id === deptId);
  if (!org || !dept) return { ok: false, text: "That department isn’t on the org chart." };
  const ids = deptAgentIds(org, deptId);
  if (!ids.length) return { ok: false, text: `${dept.name} has no agents yet, so there is nothing to report.` };
  const tz = await orgTz();
  const day = todayIn(tz, now);
  const week = windowOf("week", day, tz, now);
  const [names, runRes] = await Promise.all([
    agentNames(ids),
    db().from("agent_runs").select("id, agent_id, trigger, status, started_at, summary, error").in("agent_id", ids)
      .gte("started_at", new Date(week.from).toISOString()).lte("started_at", new Date(now).toISOString()).order("started_at", { ascending: false }).limit(500),
  ]);
  if (runRes.error) return { ok: false, text: `Runs can’t be read: ${runRes.error.message.slice(0, 120)}` };
  const runs = (runRes.data ?? []) as RepRun[];
  const plans = REPORT_PERIODS.map((period) => {
    const w = windowOf(period, day, tz, now);
    return { period, w, facts: factsFor(runs, names, w) };
  });
  const payer = await payerFor(org, deptId);
  const out: string[] = [];
  let runId: string | undefined;
  for (const p of plans) {
    const base = { scope: deptId, period: p.period, day, from_at: new Date(p.w.from).toISOString(), to_at: new Date(p.w.to).toISOString(), run_count: p.facts.length, written_at: new Date(now).toISOString() };
    if (!p.facts.length) {
      await save({ ...base, lines: [], dropped: 0, cost_usd: 0, writer_run: null });
      out.push(`${label(p.period)}: no runs, nothing to write.`);
      continue;
    }
    if (!payer) { out.push(`${label(p.period)}: not written. A report is paid by the department head or the company seat, and neither is an agent on duty.`); continue; }
    let lines: Line[] = [], dropped = 0;
    const res = await withRun(payer, REPORT_TRIGGER, async () => {
      const { system, user } = reportMessages(dept.name, p.period, p.facts, tz);
      const r = await (client ?? modelClient(REPORT_MODEL)).turn({
        model: REPORT_MODEL, maxOut: OUT_MAX, effort: "low", tools: [],
        system: [{ type: "text", text: system }], messages: [{ role: "user", content: [{ type: "text", text: user }] }],
      });
      const raw = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      ({ lines, dropped } = checkLines(raw, p.facts, { agents: new Set(ids), from: p.w.from, to: p.w.to }));
      const cost = costUsd(REPORT_MODEL, r.usage.tokensIn, r.usage.tokensOut, 0, { write: r.usage.cacheWrite, read: r.usage.cacheRead });
      return {
        status: "ok", tokensIn: r.usage.tokensIn, tokensOut: r.usage.tokensOut, costUsd: cost,
        summary: `Wrote ${dept.name}’s ${p.period === "day" ? "daily" : "weekly"} report from ${p.facts.length} run${p.facts.length === 1 ? "" : "s"}: ${lines.length} line${lines.length === 1 ? "" : "s"} kept${dropped ? `, ${dropped} dropped (no run, or a number its runs don’t have)` : ""}.`,
      };
    }, { quick: true }).catch((e: unknown) => ({ status: "failed" as const, summary: e instanceof Error ? e.message : String(e), runId: undefined, costUsd: 0 }));
    runId = res.runId ?? runId;
    if (res.status !== "ok") { out.push(`${label(p.period)}: ${res.status === "skipped" ? "skipped" : "failed"}. ${res.summary}`); continue; }
    await save({ ...base, lines, dropped, cost_usd: res.costUsd ?? 0, writer_run: res.runId ?? null });
    out.push(`${label(p.period)}: ${lines.length} line${lines.length === 1 ? "" : "s"}${dropped ? `, ${dropped} dropped` : ""}.`);
  }
  return { ok: !out.some((x) => / (not written|skipped|failed)\./.test(x)), text: out.join(" "), runId };
}
const label = (p: ReportPeriod) => (p === "day" ? "Today" : "Last 7 days");

async function save(row: Record<string, unknown>) {
  const { error } = await db().from("reports").upsert(row, { onConflict: "org_id,scope,period,day" });
  if (error) throw new Error(`The report can’t be saved: ${error.message.slice(0, 120)}`);
}

async function payerFor(org: Org, deptId: string): Promise<string | null> {
  const held = (x: ReturnType<typeof headOf>) => (x?.holder === "agent" && x.agentId ? x.agentId : null);
  const head = held(headOf(org, deptId)), seat = held(companySeat(org));
  const candidates = [head, seat].filter((a): a is string => !!a);
  if (!candidates.length) return null;
  const { data } = await db().from("agents").select("id, enabled").in("id", candidates);
  return reportPayer(head, seat, new Set((data ?? []).filter((a) => a.enabled).map((a) => a.id as string)));
}

/**
 * For the scheduler, while the org is on: queues today's report job for each department whose reports are due (after
 * its morning firings, or at noon). One job per department per day (its dedupe key), so a report is written once.
 */
export async function queueReports(now: number, chains: readonly Chain[]): Promise<string[]> {
  if (!(await orgOn())) return [];
  const [org, tz] = await Promise.all([loadOrg(), orgTz()]);
  if (!org) return [];
  const day = todayIn(tz, now);
  const from = Date.parse(`${day}T00:00:00Z`) - 864e5, to = from + 3 * 864e5;
  const queued: string[] = [];
  for (const d of org.departments) {
    const ids = new Set(deptAgentIds(org, d.id));
    if (!ids.size) continue;
    const firings = chains.filter((c) => c.on && c.steps.some((s) => !!s.agent && ids.has(s.agent))).flatMap((c) => firingsBetween(c, from, to, tz));
    const { data: going } = await db().from("agent_runs").select("id").in("agent_id", [...ids]).eq("status", "running").gte("started_at", new Date(now - 6 * 6e4).toISOString()).limit(1);
    if (!reportDue(now, tz, firings, !!going?.length)) continue;
    if (await enqueue("report", reportPayload(d.id, day), reportDedupe(d.id, day))) queued.push(d.name);
  }
  // the company report, once every department with agents has today's report, or at 1 PM at the latest
  const staffed = org.departments.filter((d) => deptAgentIds(org, d.id).length > 0).map((d) => d.id);
  const { data: done } = await db().from("reports").select("scope").eq("period", "day").eq("day", day).in("scope", staffed.length ? staffed : ["-"]);
  if (companyDue(now, tz, staffed.length, new Set((done ?? []).map((r) => r.scope as string)).size)
    && await enqueue("report", reportPayload(COMPANY_SCOPE, day), reportDedupe(COMPANY_SCOPE, day))) queued.push("the company");
  return queued;
}

/**
 * Writes today's company reports (overview slice 3) from the departments' reports for the same period and day: one
 * small-model call per period, through withRun, paid by the company seat. A line is kept only when it cites
 * department lines and carries only numbers they give (core/report-rules.ts checkCompany).
 */
export async function writeCompanyReport(now = Date.now(), client?: ModelClient): Promise<{ ok: boolean; text: string; runId?: string }> {
  const org = await loadOrg();
  if (!org) return { ok: false, text: "The org chart can’t be read." };
  const tz = await orgTz();
  const day = todayIn(tz, now);
  const seatHeld = companySeat(org);
  const seat = seatHeld?.holder === "agent" ? seatHeld.agentId : null;
  const { data: on } = seat ? await db().from("agents").select("id, enabled").eq("id", seat).maybeSingle() : { data: null };
  const payer = on?.enabled ? seat : null;
  const depts = new Map(org.departments.map((d) => [d.id, d.name]));
  const { data: rows, error } = await db().from("reports").select("scope, period, lines").eq("day", day).in("scope", [...depts.keys()].length ? [...depts.keys()] : ["-"]);
  if (error) return { ok: false, text: `Department reports can’t be read: ${error.message.slice(0, 120)}` };
  const out: string[] = [];
  let runId: string | undefined;
  for (const period of REPORT_PERIODS) {
    const reports = org.departments.flatMap((d) => {
      const r = (rows ?? []).find((x) => x.scope === d.id && x.period === period);
      return r && Array.isArray(r.lines) ? [{ deptId: d.id, dept: d.name, lines: r.lines as Line[] }] : [];
    });
    const facts = deptFacts(reports);
    const w = windowOf(period, day, tz, now);
    const base = { scope: COMPANY_SCOPE, period, day, from_at: new Date(w.from).toISOString(), to_at: new Date(w.to).toISOString(), run_count: reports.length, written_at: new Date(now).toISOString() };
    if (!facts.length) { await save({ ...base, lines: [], dropped: 0, cost_usd: 0, writer_run: null }); out.push(`${label(period)}: no department lines, nothing to write.`); continue; }
    if (!payer) { out.push(`${label(period)}: not written. The company report is paid by the company seat, and no agent on duty holds it.`); continue; }
    let lines: CoLine[] = [], dropped = 0;
    const res = await withRun(payer, REPORT_TRIGGER, async () => {
      const { system, user } = companyMessages(period, facts);
      const r = await (client ?? modelClient(REPORT_MODEL)).turn({
        model: REPORT_MODEL, maxOut: OUT_MAX, effort: "low", tools: [],
        system: [{ type: "text", text: system }], messages: [{ role: "user", content: [{ type: "text", text: user }] }],
      });
      const raw = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      ({ lines, dropped } = checkCompany(raw, facts, new Set(depts.keys())));
      const cost = costUsd(REPORT_MODEL, r.usage.tokensIn, r.usage.tokensOut, 0, { write: r.usage.cacheWrite, read: r.usage.cacheRead });
      return {
        status: "ok", tokensIn: r.usage.tokensIn, tokensOut: r.usage.tokensOut, costUsd: cost,
        summary: `Wrote the company’s ${period === "day" ? "daily" : "weekly"} report from ${reports.length} department report${reports.length === 1 ? "" : "s"}: ${lines.length} line${lines.length === 1 ? "" : "s"} kept${dropped ? `, ${dropped} dropped` : ""}.`,
      };
    }, { quick: true }).catch((e: unknown) => ({ status: "failed" as const, summary: e instanceof Error ? e.message : String(e), runId: undefined, costUsd: 0 }));
    runId = res.runId ?? runId;
    if (res.status !== "ok") { out.push(`${label(period)}: ${res.status === "skipped" ? "skipped" : "failed"}. ${res.summary}`); continue; }
    await save({ ...base, lines, dropped, cost_usd: res.costUsd ?? 0, writer_run: res.runId ?? null });
    out.push(`${label(period)}: ${lines.length} line${lines.length === 1 ? "" : "s"}${dropped ? `, ${dropped} dropped` : ""}.`);
  }
  return { ok: !out.some((x) => / (not written|skipped|failed)\./.test(x)), text: out.join(" "), runId };
}
