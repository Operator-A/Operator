import "server-only";
// What a department's widget grid reads beyond the default Overview (packs slice 2, docs/packs.md): the department's
// saved layout, the saved daily numbers, a goal's saved daily readings and an agent's numbers from its runs. Only
// saved rows, through db(), never a live call to Shopify or Google; each read happens once per request however many
// widgets share it (React cache), and each widget streams in its own frame. Numbers are worked out in
// core/widget-rules.ts.
import { cache } from "react";
import { db } from "@/core/db";
import { readingsFor } from "@/core/goal-readings";
import { packFrom, readLayout, type Layout, type SnapRow } from "@/core/widget-rules";
import { snapshotsSince } from "./overview";
import { metricKeys } from "@/core/layout-edit-rules";

/** The department's layout and the pack it came from. Both null before the migration or when none is saved. */
export async function deptLayout(id: string): Promise<{ layout: Layout | null; pack: { id: string; version: number } | null }> {
  const { data, error } = await db().from("departments").select("overview, pack").eq("id", id).maybeSingle();
  if (error || !data) return { layout: null, pack: null };
  return { layout: readLayout(data.overview), pack: packFrom(data.pack) };
}

/** The saved daily numbers from `fromDay` on, read once per request. */
export const snapsFrom = cache(async (fromDay: string): Promise<SnapRow[] | null> => snapshotsSince(fromDay).catch(() => null));

/** The saved daily readings of the first active goal that uses `measure`, from `fromDay` on. Null when no goal uses it. */
export const measureReadings = cache(async (measure: string, fromDay: string): Promise<{ day: string; value: number }[] | null> => {
  const { data, error } = await db().from("goals").select("id").eq("measure", measure).eq("state", "active").order("created_at", { ascending: true }).limit(1);
  const id = !error && data?.[0] ? String(data[0].id) : null;
  if (!id) return null;
  return (await readingsFor([id], fromDay).catch(() => ({} as Record<string, { day: string; value: number }[]>)))[id] ?? [];
});

/** An agent's newest finished runs that saved numbers, newest first (at most 20), read once per request. */
export const metricRuns = cache(async (agentId: string): Promise<{ metrics: unknown; started_at: string }[]> => {
  const { data, error } = await db().from("agent_runs").select("metrics, started_at").eq("agent_id", agentId).eq("status", "ok")
    .not("metrics", "is", null).order("started_at", { ascending: false }).limit(20);
  return error ? [] : (data ?? []) as { metrics: unknown; started_at: string }[];
});

/** Who last saved this department's layout and when (packs slice 5), from the audit log; null when no one has. */
export async function lastLayoutSave(deptId: string): Promise<{ by: string; at: string } | null> {
  const { data, error } = await db().from("audit_log").select("actor, at").eq("action", "edit_layout").eq("target", deptId).order("at", { ascending: false }).limit(1);
  return error || !data?.[0] ? null : { by: String(data[0].actor), at: String(data[0].at) };
}

/**
 * What the layout editor needs beyond the layout (packs slice 5): each of the department's agents with the numbers
 * its last runs saved, and the saved daily numbers, so a widget's settings preview real saved numbers. Saved rows
 * only; nothing is read from a tool.
 */
export async function layoutEditData(agents: readonly { id: string; name: string }[], fromDay: string): Promise<{ agents: { id: string; name: string; keys: string[]; runs: { metrics: unknown }[] }[]; snaps: SnapRow[] }> {
  const [runs, snaps] = await Promise.all([Promise.all(agents.map((a) => metricRuns(a.id).catch(() => []))), snapsFrom(fromDay)]);
  return {
    agents: agents.map((a, i) => ({ id: a.id, name: a.name, keys: metricKeys(runs[i]), runs: runs[i].map((r) => ({ metrics: r.metrics })) })),
    snaps: snaps ?? [],
  };
}
