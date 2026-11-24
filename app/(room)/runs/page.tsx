import { redirect } from "next/navigation";
import { ACTIVITY_HREF } from "@/dashboard/activity-rules";

// Runs and Status are one page now, Activity (docs/department-pages.md, slice 12). Old links keep their filters;
// an agent filter becomes that agent's department there. Each run's replay stays at /runs/<id>.
export default async function Runs({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const p = new URLSearchParams();
  for (const k of ["status", "trigger", "q"]) if (sp[k]) p.set(k, sp[k]!);
  const s = p.toString();
  redirect(s ? `${ACTIVITY_HREF}?${s}` : ACTIVITY_HREF);
}
