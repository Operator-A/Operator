import "server-only";
// The one place the app reaches the paid layer's slots (docs/extensions.md). "operator-extensions"
// is core/extensions/none.ts in the open edition and ee/index.ts in the cloud edition; only this
// file imports it (check:open-core).
import ext from "operator-extensions";
import type { Extensions, PlanAsk, ReturnPlace } from "@/core/extension-types";
import type { Similar, SimilarAsk } from "@/core/brain-rules";
import type { Billing } from "@/core/cost-rules";
import { readHowTo, type CheckTile, type SetupHowTo } from "@/core/setup-check-rules";

export type { PlanAsk, ReturnPlace };
export const extensions: Extensions = ext;
export const edition = () => extensions.edition;

/**
 * Why the plan says no, or null. A plan check that throws says no too, since the ask can't be
 * shown to be allowed; the open edition never throws.
 */
export async function planBlock(ask: PlanAsk): Promise<string | null> {
  try { return await extensions.planBlock(ask); }
  catch (e) { return `Couldn’t check the plan: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}.`; }
}

/** Tells the paid layer People changed (the seat count on the bill). Never stops or fails the change. */
export async function membersChanged(): Promise<void> {
  try { await extensions.afterMembersChange(); } catch { /* the bill catches up on the next change or the next webhook */ }
}

/** The hosted edition's Claude key for a business on credits, or null (the open edition, no credits, a failed check). */
export async function pooledKey(): Promise<string | null> {
  try { return await extensions.pooledKey(); } catch { return null; }
}

/** True when a run with no key of its own would get the hosted key now. The key itself stays here, on the server. */
export async function hostedClaudeReady(): Promise<boolean> {
  return !!(await pooledKey());
}

/** Tells the paid layer a run ended (credits take its charge). Never fails the run. */
export async function runEnded(run: { runId: string; costUsd: number; billing: Billing }): Promise<void> {
  try { await extensions.afterRun(run); } catch { /* a charge that can't be written is retried by nothing: it is logged in agent_runs and usage_ledger either way */ }
}

/** Once per scheduler round, after every business (the cloud edition's weekly shared-brain sync). Never throws. */
export async function afterSchedule(now: number): Promise<string | null> {
  try { return await extensions.afterSchedule(now); }
  catch (e) { return `failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`; }
}

/** Businesses like this one (card 233): null in the open edition, and when the shared brain can't be read. Never throws. */
export async function similarBusinesses(ask: SimilarAsk): Promise<Similar | null> {
  try { return await extensions.similarBusinesses(ask); } catch { return null; }
}

/** Staff-reviewed how-tos for one tool's setup check (card 285), each checked again here; empty when none or unreadable. Never throws. */
export async function setupHowTos(tile: CheckTile): Promise<SetupHowTo[]> {
  try {
    const got = await extensions.setupHowTos(tile);
    return got.flatMap((h) => { const r = readHowTo(h); return "howTo" in r && r.howTo.tile === tile ? [r.howTo] : []; });
  } catch { return []; }
}
