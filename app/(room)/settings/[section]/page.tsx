// A Settings section the paid layer adds (docs/settings.md), such as Billing. Any other slug is not
// found, so the open edition has none. Core sections have their own folders, which win over this one.
import { notFound } from "next/navigation";
import { extensions } from "@/core/extensions";
import { requireSession } from "@/dashboard/data";

export default async function ExtraSection({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ section }, sp] = await Promise.all([params, searchParams, requireSession()]);
  const s = extensions.settingsSections.find((x) => x.slug === section);
  if (!s) notFound();
  const query = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]));
  return <s.Page query={query} />;
}
