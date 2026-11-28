"use server";
// Installing a pack into a running business (docs/packs.md, packs slice 3): a department pack from the Add a
// department sheet, an agent pack into an open seat. The owner only. Nothing here runs or needs Controls: every
// agent lands off duty with its playbook proposed and its chains off, like a hire card (dashboard/proposalActions.ts
// hireInChat); an action is granted only when the owner turned it on on the confirm sheet, and only one the pack
// suggests.
import { revalidatePath } from "next/cache";
import { audit } from "@/core/audit";
import { installAgentPack, installDepartmentPack } from "@/core/pack-install";
import { PACK_ID } from "@/core/pack-rules";
import type { ActionResult } from "./actions";
import { asRole } from "./data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });

/** A built-in department pack beside the departments already here. Returns where it went. */
export async function installDeptPack(packId: string): Promise<ActionResult & { href?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const id = String(packId ?? "");
  if (!PACK_ID.test(id)) return { ok: false, text: "Unknown pack." };
  try {
    const r = await installDepartmentPack(id, me.email);
    await audit(me, "install_pack", id, { department: r.deptId });
    revalidatePath("/", "layout");
    return { ok: true, text: `${r.name} is on the chart. Everything in it starts off.`, href: `/dept/${r.deptId}?installed=1` };
  } catch (e) { return fail(e); }
}

/** A built-in agent pack into an open seat, with the actions the owner turned on (only ones the pack suggests). */
export async function installSeatPack(packId: string, seatId: string, grants: string[], name: string): Promise<ActionResult & { agentId?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const id = String(packId ?? "");
  if (!PACK_ID.test(id)) return { ok: false, text: "Unknown pack." };
  if (!UUID.test(String(seatId))) return { ok: false, text: "Unknown seat." };
  const asked = (Array.isArray(grants) ? grants : []).map(String).slice(0, 8);
  try {
    const r = await installAgentPack(id, seatId, asked, typeof name === "string" ? name : undefined, me.email);
    await audit(me, "install_pack", id, { seat: seatId, agent: r.agentId, grants: asked });
    revalidatePath("/", "layout");
    return { ok: true, text: `${r.name} sits there now, off duty. Approve its playbook, try it once, then put it on duty.`, agentId: r.agentId };
  } catch (e) { return fail(e); }
}
