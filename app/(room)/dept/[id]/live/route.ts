// A department's runs as they happen (docs/department-pages.md, slice 3). The chat polls this while a run
// is going (and now and then otherwise): runs started since `since`, and any still going, each with the
// checklist saved so far. Read-only; the Control Room login guards it like every page.
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/dashboard/session";
import { getRoster, memberFromCookie } from "@/dashboard/data";
import { deptAgentIds } from "@/dashboard/dept-rules";
import { deptRuns } from "@/dashboard/deptFeed";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await memberFromCookie((await cookies()).get(SESSION_COOKIE)?.value))) return Response.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await ctx.params;
  const since = new Date(new URL(req.url).searchParams.get("since") ?? "");
  if (!/^[a-z0-9_-]{1,60}$/.test(id) || Number.isNaN(since.getTime())) return Response.json({ error: "Bad request." }, { status: 400 });
  const roster = await getRoster();
  if (!roster.chart?.departments.some((d) => d.id === id)) return Response.json({ error: "Not found." }, { status: 404 });
  const runs = await deptRuns(deptAgentIds(roster.chart, id).filter((a) => roster.byId[a]), roster.byId, since.toISOString());
  return Response.json({ runs }, { headers: { "cache-control": "no-store" } });
}
