"use server";
// Proposal actions (docs/company-mode.md, slice 3). Each checks the login again. None of them runs,
// sends or spends: a yes creates an agent off duty, saves a draft version, or opens Find a tool,
// through the same code paths as the builder and the org chart.
import { audit } from "@/core/audit";
import { revalidatePath } from "next/cache";
import { withActor } from "@/core/actor";
import { acceptProposal, declineProposal, getProposal, type Proposal } from "@/core/proposals";
import { setAgentTime, setBuiltBudget, type ActionResult } from "./actions";
import { asRole } from "./data";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/", "layout"); return { ok: true, text }; };

export async function proposalAccept(id: string): Promise<ActionResult & { href?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown proposal." };
  try {
    const pr = await getProposal(id);
    const r = await acceptProposal(id);
    await audit(me, "accept_proposal", id);
    return { ...done(`${r.text}${pr ? await applyChange(pr) : ""}`), href: r.href ?? undefined };
  } catch (e) { return fail(e); }
}

/**
 * The schedule and budget part of an approved agent change (slice 6), after acceptProposal saved any version:
 * through the sheet's own actions, so their checks (and the Controls rule for a raise) hold. Returns words to add.
 */
async function applyChange(pr: Proposal): Promise<string> {
  const p = pr.payload;
  if (p.kind !== "change_agent" || !p.agentId) return "";
  const out: string[] = [];
  if (p.when) {
    const t = await setAgentTime(p.agentId, p.when.days && p.when.time ? { days: p.when.days, time: p.when.time } : null, true);
    out.push(t.ok ? t.text : `Its schedule wasn’t set: ${t.text}`);
  }
  if (p.budget != null) {
    const b = await setBuiltBudget(p.agentId, p.budget);
    out.push(b.ok ? b.text : `Its budget wasn’t set: ${b.text}`);
  }
  return out.length ? ` ${out.join(" ")}` : "";
}

/**
 * Approve on a change card in the department chat (docs/department-pages.md, slice 6), owner only. A goal
 * change goes through the goal code; an agent change saves any new version (it runs only after a clean try
 * and Go live, both separate taps) and sets the schedule and budget through the sheet's own actions. Nothing
 * here runs a model.
 */
export async function changeInChat(id: string): Promise<ActionResult & { agentId?: string; draft?: boolean }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown change." };
  const pr = await getProposal(id);
  if (!pr || pr.state !== "pending" || (pr.kind !== "change_agent" && pr.kind !== "goal")) return { ok: false, text: "That change isn’t waiting any more." };
  try {
    const r = await acceptProposal(id);
    await audit(me, "accept_proposal", id, { via: "dept_chat" });
    const more = await applyChange(pr);
    return { ...done(`${r.text}${more}`), agentId: r.agentId, draft: /^Saved as draft/.test(r.text) };
  } catch (e) { return fail(e); }
}

/**
 * Hire from the department chat (docs/department-pages.md, slice 5): the owner's yes to a hire card, with
 * the actions they turned on. Only actions the hire suggested and an approver may give get through
 * (hireDraft checks again); the agent starts off duty, then gets the hire's schedule. The first try is a
 * separate tap of the existing tryBuilt, so nothing here runs a model.
 */
export async function hireInChat(id: string, grants: string[]): Promise<ActionResult & { agentId?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown hire." };
  const pr = await getProposal(id);
  if (!pr || pr.state !== "pending" || pr.payload.kind !== "hire") return { ok: false, text: "That hire isn’t waiting any more." };
  const p = pr.payload;
  const asked = (Array.isArray(grants) ? grants : []).map(String).filter((g) => (p.can ?? []).includes(g));
  try {
    const r = await acceptProposal(id, { grants: asked });
    await audit(me, "accept_proposal", id, { via: "dept_chat", grants: asked });
    let when = "";
    if (r.agentId && p.days && p.time) {
      // off duty, so the schedule only takes effect once it is put on duty
      const t = await setAgentTime(r.agentId, { days: p.days, time: p.time }, true);
      when = t.ok ? "" : ` Its schedule wasn’t set: ${t.text}`;
    }
    return { ...done(`${r.text}${when}`), agentId: r.agentId };
  } catch (e) { return fail(e); }
}

/**
 * Hire from the department chat (docs/department-pages.md, slice 5): the owner's yes to a hire card, with
 * the actions they turned on. Only actions the hire suggested and an approver may give get through
 * (hireDraft checks again); the agent starts off duty, then gets the hire's schedule. The first try is a
 * separate tap of the existing tryBuilt, so nothing here runs a model.
 */
export async function hireInChat(id: string, grants: string[]): Promise<ActionResult & { agentId?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown hire." };
  const pr = await getProposal(id);
  if (!pr || pr.state !== "pending" || pr.payload.kind !== "hire") return { ok: false, text: "That hire isn’t waiting any more." };
  const p = pr.payload;
  const asked = (Array.isArray(grants) ? grants : []).map(String).filter((g) => (p.can ?? []).includes(g));
  try {
    const r = await acceptProposal(id, { grants: asked });
    await audit(me, "accept_proposal", id, { via: "dept_chat", grants: asked });
    let when = "";
    if (r.agentId && p.days && p.time) {
      // off duty, so the schedule only takes effect once it is put on duty
      const t = await setAgentTime(r.agentId, { days: p.days, time: p.time }, true);
      when = t.ok ? "" : ` Its schedule wasn’t set: ${t.text}`;
    }
    return { ...done(`${r.text}${when}`), agentId: r.agentId };
  } catch (e) { return fail(e); }
}

/** Not now, with the reason the owner typed (optional). */
export async function proposalDecline(id: string, reason: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown proposal." };
  try { const t = await withActor(me.email, () => declineProposal(id, String(reason ?? ""))); await audit(me, "decline_proposal", id); return done(t); } catch (e) { return fail(e); }
}


/** Card 156: the owner proposes the department Avery drafted with them. It lands in Needs you. */
export async function proposeDepartment(): Promise<ActionResult & { href?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const { proposeDraft } = await import("@/core/departments");
    const r = await proposeDraft();
    await audit(me, "propose_department", r.id);
    return { ...done(`${r.title} waits in Needs you. Open it to approve.`), href: `/proposals/${r.id}` };
  } catch (e) { return fail(e); }
}

/** Card 156: throws away the department draft. */
export async function discardDepartmentDraft(): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const { discardDraft } = await import("@/core/departments");
    await discardDraft();
    await audit(me, "discard_department_draft", null);
    return done("The department draft is gone.");
  } catch (e) { return fail(e); }
}
