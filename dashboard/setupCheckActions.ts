"use server";
// The setup check (card 281, docs/setup-check.md): Check my setup on a connected tool, the card polling
// while it runs, and Skip / Open again on a finding. Each checks the login and role first. A check makes
// real model calls, so it also needs DASHBOARD_CONTROLS=on.
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { audit } from "@/core/audit";
import { orgId, withOrg } from "@/core/tenancy";
import { claimCheck, claimFix, runCheck, runFix, setFindingState, setupCheck, type SetupCheck } from "@/core/setup-check";
import { hasCheck } from "@/core/setup-check-rules";
import { asRole, getHealth } from "./data";
import { connectedTiles } from "./toolsStep";
import { controlsOn } from "./session";
import type { ActionResult } from "./actions";

const CONTROLS_OFF = "I can’t check here yet: real runs are switched off for this OPERATOR. Whoever runs it turns them on.";
const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });

/** Starts a check in the background and answers at once; the card polls setupCheckState until it's done. */
export async function startSetupCheck(tile: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  if (!hasCheck(tile)) return { ok: false, text: "That tool has no setup check yet." };
  try {
    const connected = await connectedTiles(await getHealth());
    if (!connected.has(tile)) return { ok: false, text: "Connect it first." };
    const claim = await claimCheck(tile);
    if ("problem" in claim) return { ok: false, text: claim.problem };
    // the run outlives this request, so it carries the org itself rather than reading the cookie later
    const org = await orgId();
    after(() => withOrg(org, () => runCheck(tile, connected)).catch((e: unknown) => { console.error(`[setup-check] ${tile} failed`, e); }));
    await audit(me, "setup_check", tile);
    return { ok: true, text: "Checking. This takes a minute or two; keep going, the card fills in when it’s done." };
  } catch (e) { return fail(e); }
}

/**
 * Fix it for me (card 282): runs, in the background, an agent that already holds the finding's action and
 * reads; what it stages lands on Approvals as ordinary cards. With none, says where to grant it (href).
 */
export async function fixFinding(tile: string, index: number): Promise<ActionResult & { href?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return { ok: false, text: CONTROLS_OFF };
  if (!hasCheck(tile) || !Number.isInteger(index)) return { ok: false, text: "Unknown finding." };
  try {
    const claim = await claimFix(tile, index);
    if ("problem" in claim) return { ok: false, text: claim.problem, href: claim.href };
    const org = await orgId();
    after(() => withOrg(org, () => runFix(tile, index, claim)).catch((e: unknown) => { console.error(`[setup-check] fix ${tile} failed`, e); }));
    await audit(me, "setup_finding_fix", tile, { index, agent: claim.agentId, fix: claim.fix });
    return { ok: true, text: `${claim.name} is on it. What it stages shows up on Approvals for you to check.` };
  } catch (e) { return fail(e); }
}

/** The card's poll while a check runs. Read only. */
export async function setupCheckState(tile: string): Promise<SetupCheck | null> {
  const { no } = await asRole("approver"); if (no) return null;
  if (!hasCheck(tile)) return null;
  return setupCheck(tile);
}

async function setState(tile: string, index: number, state: "open" | "skipped"): Promise<ActionResult> {
  if (!hasCheck(tile)) return { ok: false, text: "Unknown tool." };
  try {
    await setFindingState(tile, index, state);
    revalidatePath("/"); revalidatePath("/connections"); revalidatePath("/start");
    return { ok: true, text: state === "skipped" ? "Skipped. It stays on your Company page if you want it later." : "Opened again." };
  } catch (e) { return fail(e); }
}

/** Skip on a finding: it leaves the tool's card and waits on the Company page. */
export async function skipFinding(tile: string, index: number): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  const r = await setState(tile, index, "skipped");
  if (r.ok) await audit(me, "setup_finding_skip", tile, { index });
  return r;
}

/** Open again, from the Company page or the card. */
export async function reopenFinding(tile: string, index: number): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  const r = await setState(tile, index, "open");
  if (r.ok) await audit(me, "setup_finding_open", tile, { index });
  return r;
}
