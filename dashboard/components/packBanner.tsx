import "server-only";
// After a pack is installed (packs slice 3, to the approved mockup): a banner on its department's Overview listing only
// what's left to turn it on, each step a link to the screen that already does it. Worked out from the rows on every
// visit (core/pack-install.ts packSetup), never stored, so it goes away once every step is done.
import Link from "next/link";
import { packSetup } from "@/core/pack-install";
import { sheetHref, tabHref } from "@/dashboard/dept-rules";

export async function PackBanner({ deptId, name, installed, names }: { deptId: string; name: string; installed: boolean; names: Record<string, string> }) {
  const s = await packSetup(deptId).catch(() => null);
  if (!s?.steps.length) return null;
  const link = (key: string) =>
    key === "playbook" && s.waiting ? <Link href={sheetHref(deptId, "overview", s.waiting)} scroll={false} className="dp-btn dark">Review</Link>
      : key === "duty" && s.off ? <Link href={sheetHref(deptId, "overview", s.off)} scroll={false} className="dp-btn">Open {names[s.off] ?? "the agent"}</Link>
        : key === "chain" ? <Link href={tabHref(deptId, "chains")} className="dp-btn">Chains</Link> : null;
  return (
    <div className="pk-banner" role="status">
      <b>{installed ? `${name} is added, and switched off.` : `What’s left to turn ${name} on`}</b>
      <div className="pk-steps">
        {s.steps.map((x, i) => <div key={x.key} className="pk-step"><span className="n">{i + 1}</span><span className="t">{x.text}</span>{link(x.key)}</div>)}
      </div>
    </div>
  );
}
