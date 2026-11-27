// Which runs are live now (slice 1 of the click-speed fix, docs/speed.md rule 10). The frame's LiveRefresher asks
// this every few seconds while a run is live and renders the page again only when the answer changes. One small
// query, the ids only; the Control Room login guards it like every page.
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/dashboard/session";
import { memberFromCookie, type Run } from "@/dashboard/data";
import { db } from "@/core/db";
import { isLive } from "@/dashboard/status";

export async function GET() {
  if (!(await memberFromCookie((await cookies()).get(SESSION_COOKIE)?.value))) return Response.json({ error: "Sign in again." }, { status: 401 });
  const now = Date.now();
  const { data, error } = await db().from("agent_runs").select("id, status, started_at").eq("status", "running").gte("started_at", new Date(now - 6 * 6e4).toISOString()).limit(50);
  if (error) return Response.json({ error: "Couldn’t read the runs." }, { status: 500 });
  const live = ((data ?? []) as Run[]).filter((r) => isLive(r, now)).map((r) => r.id);
  return Response.json({ live }, { headers: { "cache-control": "no-store" } });
}
