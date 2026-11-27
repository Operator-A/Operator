// Whether a run's Claude session is still going (2026-11-27): the run page's live line asks this every 10-30 s
// and reloads once the session's result is in. Read-only; the Control Room login guards it like every page.
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/dashboard/session";
import { getRun, memberFromCookie } from "@/dashboard/data";
import { inClaude } from "@/dashboard/status";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await memberFromCookie((await cookies()).get(SESSION_COOKIE)?.value))) return Response.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await ctx.params;
  const run = await getRun(id);
  if (!run) return Response.json({ error: "Not found." }, { status: 404 });
  return Response.json({ running: inClaude(run) }, { headers: { "cache-control": "no-store" } });
}
