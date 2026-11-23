import { notFound, redirect } from "next/navigation";
import { getRoster } from "@/dashboard/data";
import { agentHref } from "@/dashboard/dept-rules";

// An agent's own page went in department pages slice 4 (docs/department-pages.md): an old link opens the
// agent's sheet on its department's Agents tab, or on Everyone when it sits in no department; ?edit opens
// its Edit tab (slice 6).
export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const [{ id }, sp, roster] = await Promise.all([params, searchParams, getRoster()]);
  if (!/^[a-z0-9_]{1,60}$/.test(id)) notFound();
  redirect(agentHref(roster.chart, id, sp.edit != null));
}
