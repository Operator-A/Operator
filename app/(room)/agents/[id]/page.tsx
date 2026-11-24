import { notFound, redirect } from "next/navigation";
import { getRoster } from "@/dashboard/data";
import { agentHref } from "@/dashboard/dept-rules";

// An agent's lasting address (docs/department-pages.md, slices 4 and 13). Its own page went in slice 4; the link
// opens the agent's sheet on its department's Agents tab, or on Company › Departments when it sits in none, worked
// out when it is opened so it follows the agent when it moves. ?edit opens its Edit tab (slice 6). Approval
// results, lessons and the agent map link here, so it stays when the other old pages went (slice 13).
export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const [{ id }, sp, roster] = await Promise.all([params, searchParams, getRoster()]);
  if (!/^[a-z0-9_]{1,60}$/.test(id)) notFound();
  redirect(agentHref(roster.chart, id, sp.edit != null));
}
