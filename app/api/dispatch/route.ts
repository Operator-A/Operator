import { NextResponse } from "next/server";
import { expireOks } from "@/core/chain-ok";
import { pruneImages } from "@/core/image-step";
import { pruneChainDrafts } from "@/core/chain-drafts";
import { orgTz } from "@/core/tz";
import { loadCrew } from "@/agents/registry";
import { claimFiring, resumeChain, startStep } from "@/core/chain";
import { expireWaits } from "@/core/claude-agents";
import { allOrgIds } from "@/core/db";
import { firingsBetween, loadFlow } from "@/core/flow";
import { dueJobs, failMissed, failStale, kick } from "@/core/jobs";
import { orgOn } from "@/core/org-switch";
import { cronAuthorized } from "@/core/runs";
import { withOrg } from "@/core/tenancy";
import { sendStatusAlerts } from "@/core/status";
import { applyTrusted } from "@/core/gateway";
import { controlsOn } from "@/dashboard/session";
import { afterSchedule, edition } from "@/core/extensions";
import { takeSnapshot } from "@/core/brain";
import { returnSkipped } from "@/core/setup-check";
import { catchUpHeld, pruneEvents } from "@/core/events";

export const maxDuration = 60;

// The scheduler: the one Vercel Schedule (vercel.json "dispatch", every 15 minutes; this plan's schedules run up to 15 minutes late, so it can't be more often). For each org in
// turn, as that org (docs/tenancy.md, slice 3): it starts the chains whose schedule came due in the
// last hour (each firing once: chain_fires), marks failed the jobs that never finished (and the waiting ones more than 2 hours past their start), and kicks
// the jobs that are due (a step whose "not before" time has come, or one whose kick was lost). The
// work itself runs in workers (/api/jobs/<id>), each its own request through withRun. While an org
// is off (core/org-switch.ts, docs/org-schedule.md) no chain of it starts on its own; the worker
// lets only steps of a chain the owner started with Run chain go on. Last, it emails the owner any new
// alert from the Status page (core/status.ts). In between, with DASHBOARD_CONTROLS on, it applies
// what earned trust let through (core/gateway applyTrusted, card 7): actions whose undo window has
// passed, and actions at Act, each re-checked and run as its agent. On the cloud edition it also takes the
// business's shared-brain snapshot once a day (core/brain.ts, docs/shared-brain.md): counts from the
// business's own rows, kept in its own row; sharing off deletes it. While the org is on, a setup check finding
// the founder skipped 3 weeks ago comes back once as its tool's head's proposal (core/setup-check.ts, card 284). After every business, the afterSchedule
// slot runs the cloud edition's weekly sync of the counted patterns into Hindsight (card 232).
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const origin = new URL(req.url).origin;
  const now = Date.now();
  const orgs: Record<string, unknown>[] = [];
  let ids: string[];
  try { ids = await allOrgIds(); }
  catch (e) { return NextResponse.json({ error: `Orgs can't be read: ${e instanceof Error ? e.message : e}` }, { status: 500 }); }
  for (const org of ids) {
    try { orgs.push({ org, ...(await withOrg(org, () => schedule(origin, now))) }); }
    catch (e) { console.error(`[dispatch] ${org}`, e); orgs.push({ org, error: e instanceof Error ? e.message : String(e) }); }
  }
  // once per round, after every business: the cloud edition's weekly shared-brain sync (ee/brain.ts)
  const brain = await afterSchedule(now);
  // the weekly sync's result goes to the logs too, so it can be checked there (not when it is off or not due)
  if (brain && brain !== "not due" && brain !== "off") console.log("[dispatch] shared brain:", brain);
  return NextResponse.json({ orgs, brain });
}

async function schedule(origin: string, now: number) {
  const started: string[] = [];
  const flow = await loadFlow(await loadCrew());
  const [on, tz] = await Promise.all([orgOn(), orgTz()]);
  for (const c of flow.flow.chains) {
    if (!on || !c.on) continue;
    // an hour back, so a late or missed call still catches the firing
    for (const at of firingsBetween(c, now - 60 * 6e4, now, tz)) {
      const chainId = crypto.randomUUID();
      if (!(await claimFiring(c.key, at, chainId))) continue;
      started.push(`${c.name} (${new Date(at).toISOString()})`);
      await startStep(origin, c, { chainId, key: c.key, step: 0 });
    }
  }
  // live events (docs/live-events.md): one catch-up run per event chain that held events at its cap; never stops the scheduler
  const caughtUp = on ? await catchUpHeld(origin, now).catch((e) => { console.error("[dispatch] events", e instanceof Error ? e.message : e); return []; }) : [];
  await pruneEvents(now).catch((e) => console.error("[dispatch] prune events", e instanceof Error ? e.message : e));
  // chain steps in Claude with no result after 24 hours count as failed, and their chains go on; never stops the scheduler
  const expired = await expireWaits(now).then((xs) => Promise.all(xs.map((x) => resumeChain(origin, x.chain, x.runId, "failed")))).catch((e) => { console.error("[dispatch] claude waits", e instanceof Error ? e.message : e); return []; });
  // Wait for my OK cards nobody answered in 3 days stop their chains (chains slice 3); never stops the scheduler
  const okExpired = await expireOks(now).catch((e) => { console.error("[dispatch] chain OKs", e instanceof Error ? e.message : e); return 0; });
  // Make an image pictures past their 90 days are deleted (chains slice 4); never stops the scheduler
  const imagesGone = await pruneImages(now).catch((e) => { console.error("[dispatch] chain images", e instanceof Error ? e.message : e); return 0; });
  // chain drafts from Claude nobody used in 14 days are deleted (card 435); never stops the scheduler
  const draftsGone = await pruneChainDrafts(now).catch((e) => { console.error("[dispatch] chain drafts", e instanceof Error ? e.message : e); return 0; });
  const stale = await failStale(now);
  // a step whose kicks kept failing is skipped once it is hours late, not run at the wrong time of day
  const missed = await failMissed(now);
  const due = await dueJobs(now);
  await Promise.all(due.map((id) => kick(origin, id)));
  // trusted actions never stop the scheduler; with controls off they wait, as approved ones do
  const trusted = controlsOn() ? await applyTrusted(new Date(now)).catch((e) => { console.error("[dispatch] trusted", e instanceof Error ? e.message : e); return null; }) : null;
  // alerts read the state after this round's work, and never stop the scheduler
  // the shared-brain snapshot never stops the scheduler either; at most one a day
  const brain = edition() === "cloud" ? await takeSnapshot().catch((e) => { console.error("[dispatch] brain", e instanceof Error ? e.message : e); return "failed"; }) : null;
  // card 284: setup check findings skipped 3 weeks ago come back once as a head's proposal (code, no model), only while the org is on
  const rechecks = on ? await returnSkipped(now).catch((e) => { console.error("[dispatch] setup re-checks", e instanceof Error ? e.message : e); return []; }) : [];
  const alerted = await sendStatusAlerts(origin, now).catch((e) => { console.error("[dispatch] alerts", e instanceof Error ? e.message : e); return []; });
  return { on, started, caughtUp, kicked: due.length, expired: expired.length, okExpired, imagesGone, draftsGone, stale, missed, trusted, brain, rechecks, alerted, problems: flow.problems };
}
