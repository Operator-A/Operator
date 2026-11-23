import { notFound, redirect } from "next/navigation";
import { getRoster } from "@/dashboard/data";
import { agentHref } from "@/dashboard/dept-rules";

// An agent's own page went in department pages slice 4 (docs/department-pages.md): an old link opens the
// agent's sheet on its department's Agents tab, or on Everyone when it sits in no department.
export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, roster] = await Promise.all([params, getRoster()]);
  if (!/^[a-z0-9_]{1,60}$/.test(id)) notFound();
  redirect(agentHref(roster.chart, id));
}
