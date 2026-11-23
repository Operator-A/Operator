import "server-only";
// What setup left to finish (card 183, docs/setup.md): parts of the company the founder had no tool for
// (Avery's click-by-click steps into a starter tool) or uses a tool with no connection (an export).
import { setupState } from "@/core/setup";
import { listExports } from "@/core/exports";
import { followUps, type FollowUp } from "@/core/tools-step-rules";
import { connectedTiles } from "./toolsStep";
import type { Floor } from "./data";
import { setupChecks } from "@/core/setup-check";
import { CHECKS, type CheckTile, type Finding } from "@/core/setup-check-rules";

export async function followUpsView(f: Floor): Promise<FollowUp[]> {
  const st = await setupState();
  if (!st.done || !Object.keys(st.plans).length) return [];
  const [connected, exports] = await Promise.all([connectedTiles(f.health), listExports()]);
  return followUps(st.plans, connected, new Set((exports ?? []).map((e) => e.service_key)));
}

/** Setup check findings the founder skipped (card 281): they wait on the Company page with their steps until opened again. */
export interface SkippedFinding { tile: CheckTile; name: string; index: number; finding: Finding }
export async function skippedFindings(): Promise<SkippedFinding[]> {
  const checks = (await setupChecks()) ?? [];
  return checks.filter((c) => c.status === "done").flatMap((c) => c.findings.flatMap((f, index) => (f.state === "skipped" ? [{ tile: c.tile, name: CHECKS[c.tile].name, index, finding: f }] : [])));
}
