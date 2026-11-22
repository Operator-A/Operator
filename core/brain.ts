import "server-only";
// The shared brain, slice 2 (docs/shared-brain.md, card 231): the business's own snapshot and its
// choice on Settings > Shared brain. Everything here is the current business's rows, through db().
// Nothing leaves the business in this slice: the cloud edition's ee/brain.ts (slice 3) is what will
// read the totals across businesses, through core/db.ts, never these rows.
import { db } from "@/core/db";
import { orgDate } from "@/core/tz";
import { TEMPLATES } from "@/core/templates";
import { TOOLS } from "@/core/gateway/policy";
import { readPlans } from "@/core/tools-step-rules";
import { checkCampaignResults, recentCampaigns } from "@/core/campaign-results";
import { BRAIN_KEY, NO_BRAIN, buildSnapshot, readBrainSettings, snapshotProblem, type BrainSettings, type Snapshot } from "@/core/brain-rules";

export const BRAIN_MISSING = "The shared brain table isn’t in Supabase yet: apply the migration 20261226090000_shared_brain.sql.";

/** The business's choice: share (on by default) and the kind of business. */
export async function brainSettings(): Promise<BrainSettings> {
  const { data, error } = await db().from("policies").select("value_json").eq("key", BRAIN_KEY).maybeSingle();
  if (error) return NO_BRAIN;
  return readBrainSettings((data as { value_json?: unknown } | null)?.value_json);
}

/** Saves the choice. The caller has checked the member is an owner. Turning sharing off deletes the snapshot at once. */
export async function saveBrainSettings(s: BrainSettings): Promise<void> {
  const clean = readBrainSettings(s);
  const { error } = await db().from("policies").upsert({ key: BRAIN_KEY, value_json: clean, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  if (!clean.share) await forgetSnapshot();
}

/** Deletes the business's snapshot, so it is in no count from now on. */
export async function forgetSnapshot(): Promise<void> {
  const { error } = await db().from("brain_snapshots").delete().not("org_id", "is", null);
  if (error && !/brain_snapshots/.test(error.message)) throw new Error(error.message);
}

/** The business's snapshot as it is saved, for Settings. Null when there is none. */
export async function savedSnapshot(): Promise<Snapshot | null> {
  const { data, error } = await db().from("brain_snapshots").select("taken_on, kind, revenue_band, age_band, tools, departments, bespoke, on_duty, actions, levels, results").maybeSingle();
  if (error || !data) return null;
  return data as Snapshot;
}

/** What the business's snapshot would be today, from its own rows. */
export async function computeSnapshot(kind: BrainSettings["kind"]): Promise<Snapshot> {
  const today = await orgDate();
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const [org, setup, conns, depts, agents, approvals, levels, kpis, campaigns] = await Promise.all([
    db().from("orgs").select("created_at").maybeSingle(),
    db().from("policies").select("value_json").eq("key", "setup").maybeSingle(),
    db().from("mcp_connections").select("id").not("connected_at", "is", null),
    db().from("departments").select("id"),
    db().from("agents").select("id", { count: "exact", head: true }).eq("enabled", true),
    db().from("approvals").select("status, agent_actions(tool)").gte("decided_at", since),
    db().from("trust_levels").select("tool, level").neq("level", "draft"),
    db().from("kpi_snapshots").select("revenue").gte("date", await orgDate(30)),
    recentCampaigns(),
  ]);
  for (const r of [org, conns, depts, agents, approvals]) if (r.error) throw new Error(r.error.message);
  const plans = readPlans(((setup.data as { value_json?: { plans?: unknown } } | null)?.value_json ?? {}).plans);
  const kpiRows = kpis.error ? [] : ((kpis.data ?? []) as { revenue: number | string }[]);
  return buildSnapshot({
    today,
    kind,
    revenue30: kpiRows.length ? kpiRows.reduce((s, r) => s + Number(r.revenue), 0) : null,
    orgCreatedAt: String((org.data as { created_at?: string } | null)?.created_at ?? new Date().toISOString()),
    plans,
    connected: new Set(((conns.data ?? []) as { id: string }[]).map((c) => c.id)),
    departmentIds: ((depts.data ?? []) as { id: string }[]).map((d) => d.id),
    kitDepartmentIds: TEMPLATES.flatMap((t) => t.departments.map((d) => d.id)),
    onDuty: agents.count ?? 0,
    approvals: ((approvals.data ?? []) as { status: string; agent_actions: { tool: string } | { tool: string }[] | null }[]).map((a) => ({
      status: a.status, tool: (Array.isArray(a.agent_actions) ? a.agent_actions[0]?.tool : a.agent_actions?.tool) ?? "",
    })),
    levels: levels.error ? [] : ((levels.data ?? []) as { tool: string; level: string }[]),
    actionTypes: Object.keys(TOOLS),
    campaigns,
  });
}

/**
 * Takes the business's snapshot once a day (the scheduler, cloud edition only). Sharing off: deletes
 * any snapshot and takes none. A snapshot that fails snapshotProblem is never saved.
 */
export async function takeSnapshot(): Promise<"off" | "already" | "taken"> {
  const s = await brainSettings();
  if (!s.share) { await forgetSnapshot(); return "off"; }
  const today = await orgDate();
  const { data: had, error } = await db().from("brain_snapshots").select("taken_on").maybeSingle();
  if (error) throw new Error(/brain_snapshots/.test(error.message) ? BRAIN_MISSING : error.message);
  if ((had as { taken_on?: string } | null)?.taken_on === today) return "already";
  // slice 4b: how sent campaigns turned out, read once a day before the snapshot; never stops it
  await checkCampaignResults().catch((e) => console.error("[brain] campaign results", e instanceof Error ? e.message : e));
  const snap = await computeSnapshot(s.kind);
  const problem = snapshotProblem(snap);
  if (problem) throw new Error(`Snapshot not saved: ${problem}`);
  const { error: e2 } = await db().from("brain_snapshots").upsert({ ...snap, updated_at: new Date().toISOString() }, { onConflict: "org_id" });
  if (e2) throw new Error(e2.message);
  return "taken";
}
