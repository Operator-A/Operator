import { notFound, redirect } from "next/navigation";
import { getRoster } from "@/dashboard/data";
import { agentHref } from "@/dashboard/dept-rules";

// The builder's step editor went in department pages slice 6 (docs/department-pages.md): an old link opens
// the agent's sheet, on its Edit tab when the link was to the editor (?edit).
export default async function BuildAgent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const [{ id }, sp, roster] = await Promise.all([params, searchParams, getRoster()]);
  if (!/^[a-z0-9_]{1,60}$/.test(id)) notFound();
  redirect(agentHref(roster.chart, id, sp.edit != null));
}
