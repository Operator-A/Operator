"use server";
// Installing a pack into a running business (docs/packs.md, packs slice 3): a department pack from the Add a
// department sheet, an agent pack into an open seat. The owner only. Nothing here runs or needs Controls: every
// agent lands off duty with its playbook proposed and its chains off, like a hire card (dashboard/proposalActions.ts
// hireInChat); an action is granted only when the owner turned it on on the confirm sheet, and only one the pack
// suggests.
import { revalidatePath } from "next/cache";
import { audit } from "@/core/audit";
import { installAgentPack, installDepartmentPack, savePackUpdate } from "@/core/pack-install";
import { PACK_ID } from "@/core/pack-rules";
import type { ActionResult } from "./actions";
import { asRole } from "./data";
import { db } from "@/core/db";
import { loadOrg } from "@/core/org";
import { toSave } from "@/core/layout-edit-rules";
import { MAX_WIDGETS, type Widget } from "@/core/widget-rules";

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

/** A newer version of a department's pack, saved as drafts: changed specs wait for a clean try and Go live. */
export async function savePackDrafts(deptId: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const id = String(deptId ?? "");
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(id)) return { ok: false, text: "Unknown department." };
  try {
    const r = await savePackUpdate(id);
    await audit(me, "update_pack", id, { to: r.to, drafts: r.drafts });
    revalidatePath("/", "layout");
    return { ok: true, text: r.drafts ? `Saved ${r.drafts} draft${r.drafts === 1 ? "" : "s"} from version ${r.to}. Each needs a clean try and your Go live.` : `${r.name} is on version ${r.to}.` };
  } catch (e) { return fail(e); }
}

/**
 * A department's Overview as the layout editor left it (packs slice 5): the owner or an approver. Checked like a
 * pack's layout (core's widgets only, agent numbers only from this department's agents); null or an empty page saves
 * the usual Overview. Nothing runs and nothing is read from a tool: a widget only shows what OPERATOR saved.
 */
export async function saveLayout(deptId: string, items: Widget[] | null): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  const id = String(deptId ?? "");
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(id)) return { ok: false, text: "Unknown department." };
  if (items != null && (!Array.isArray(items) || items.length > MAX_WIDGETS)) return { ok: false, text: `At most ${MAX_WIDGETS} widgets.` };
  try {
    const org = await loadOrg();
    if (!org?.departments.some((d) => d.id === id)) return { ok: false, text: "Unknown department." };
    const agents = org.seats.filter((s) => s.departmentId === id && s.agentId).map((s) => s.agentId!);
    const { layout, problems } = toSave(items, agents);
    if (problems.length) return { ok: false, text: `Not saved: ${problems.slice(0, 3).join("; ")}` };
    const up = await db().from("departments").update({ overview: layout }).eq("id", id).select("id");
    if (up.error) throw new Error(up.error.message);
    if (!up.data?.length) return { ok: false, text: "Unknown department." };
    await audit(me, "edit_layout", id, { widgets: layout ? layout.flat().length : 0, usual: layout == null });
    revalidatePath(`/dept/${id}`);
    return { ok: true, text: layout ? "Layout saved." : "Back to the usual Overview." };
  } catch (e) { return fail(e); }
}
