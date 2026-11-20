import "server-only";
// What setup left to finish (card 183, docs/setup.md): parts of the company the founder had no tool for
// (Avery's click-by-click steps into a starter tool) or uses a tool with no connection (an export).
import { setupState } from "@/core/setup";
import { listExports } from "@/core/exports";
import { followUps, type FollowUp } from "@/core/tools-step-rules";
import { connectedTiles } from "./toolsStep";
import type { Floor } from "./data";

export async function followUpsView(f: Floor): Promise<FollowUp[]> {
  const st = await setupState();
  if (!st.done || !Object.keys(st.plans).length) return [];
  const [connected, exports] = await Promise.all([connectedTiles(f.health), listExports()]);
  return followUps(st.plans, connected, new Set((exports ?? []).map((e) => e.service_key)));
}
