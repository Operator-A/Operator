import "server-only";
// The tool gateway. Agents never call a write integration themselves: they propose an
// action here, the gateway checks it against the allow-list (policy.ts) and either
// refuses it or queues it for the owner. Approved actions are executed here and nowhere else,
// after a fresh check against Mercury's live state (or, for a Gmail draft, the lead's row),
// inside withRun so every apply is in agent_runs and respects agents.enabled. Every action,
// refused or applied, is a row in agent_actions.
import { db } from "@/core/db";
import { withRun } from "@/core/runs";
import { LEAD_REVIEW_HOURS, draftChecker, draftDepartment } from "@/core/org";
import { hasMercury, mercuryCategories, mercuryTransaction } from "@/integrations/mercury";
import { callWriteTool, mcpStatus } from "@/integrations/mcp";
import { startOf } from "@/core/time";
import { orgTz } from "@/core/tz";
import { hasGmail } from "@/integrations/gmail";
import { klaviyoLists } from "@/integrations/klaviyo";
import type { CampaignArgs } from "@/core/klaviyo-draft-rules";
import { afterDecision, demote, levelOf, refreshOffer } from "@/core/trust";
import { executeAfter, isRejectKind, type RejectKind } from "@/core/trust-rules";
import { ANNOTATE, CAMPAIGN_DRAFT, CAP_KEYS, DRAFT_EMAIL, refuseCampaignTo, MAX_RECEIPT_BYTES, RECEIPT_TYPES, effectiveCap, planIsEmpty, planWrite, receiptPathOk, refuseDraftTo, refuseProposal, type AnnotateArgs, type CapKey, type DraftArgs, type ToolName } from "./policy";

export { ANNOTATE, CAMPAIGN_DRAFT, DRAFT_EMAIL } from "./policy";

export interface Proposal {
  agentId: string;
  runId?: string | null;
  tool: ToolName;
  target: string;
  args: AnnotateArgs | DraftArgs | CampaignArgs;
  actionType: string;
  title: string;
  reasoning?: string;
  preview?: Record<string, unknown>;
}

async function numPolicy(key: string, d: number) {
  const { data } = await db().from("policies").select("value_json").eq("key", key).maybeSingle();
  const n = Number(data?.value_json);
  return Number.isFinite(n) && n > 0 ? n : d;
}

/**
 * Queue an action at its agent's trust level for that tool (core/trust.ts, card 7), or record it as
 * refused. Draft: an approval card. Act with undo: scheduled, applied by the scheduler after the undo
 * window unless an approver cancels it. Act: approved, applied by the scheduler's next round. Every
 * refusal and cap holds at every level, and every apply re-checks live state first.
 */
export async function propose(p: Proposal): Promise<{ status: "queued" | "scheduled" | "refused" | "duplicate"; reason?: string; actionId?: string }> {
  const memoMax = await numPolicy("mercury_memo_max_chars", 200);
  const refused = refuseProposal(p.agentId, p.tool, p.target, p.args as Record<string, unknown>, memoMax) ?? (p.tool === DRAFT_EMAIL ? await refuseLead(p.target) : p.tool === CAMPAIGN_DRAFT ? await refuseList(p.target) : null);
  const base = { agent_id: p.agentId, run_id: p.runId ?? null, tool: p.tool, action_type: p.actionType, target: p.target, args_json: p.args };
  if (refused) {
    await db().from("agent_actions").insert({ ...base, status: "refused", reason: refused });
    return { status: "refused", reason: refused };
  }
  const { data: action, error } = await db().from("agent_actions").insert({ ...base, status: "proposed" }).select("id").single();
  if (error?.code === "23505") return { status: "duplicate" };
  if (error || !action) throw new Error(`Gateway: could not record the action: ${error?.message}`);
  const level = await levelOf(p.agentId, p.tool);
  if (level !== "draft") {
    const undo = (await loadCaps()).undo_window_minutes.value;
    const now = Date.now();
    const patch = level === "act_undo"
      ? { status: "scheduled", level, execute_after: executeAfter(now, undo) }
      : { status: "approved", level, decided_at: new Date(now).toISOString() };
    const { error: e3 } = await db().from("agent_actions").update(patch).eq("id", action.id).eq("status", "proposed");
    if (!e3) return { status: "scheduled", actionId: action.id };
    // before the trust migration the columns aren't there: fall back to an approval card
  }
  // Draft: always an approval. Tagged with the agent's department; when that department has
  // "Lead checks drafts first" on, it waits for the agent above it for up to LEAD_REVIEW_HOURS.
  {
    const [departmentId, checker] = await Promise.all([draftDepartment(p.agentId), draftChecker(p.agentId)]);
    const review = checker ? { reviewer_agent_id: checker.reviewer, review_status: "waiting", review_due: new Date(Date.now() + LEAD_REVIEW_HOURS * 36e5).toISOString() } : {};
    const card = { action_id: action.id, agent_id: p.agentId, title: p.title, reasoning: p.reasoning ?? null, preview: p.preview ?? {} };
    let { error: e2 } = await db().from("approvals").insert({ ...card, department_id: departmentId, ...review });
    // before the slice 4 migration the columns aren't there: the card goes straight to the owner, as before
    if (e2?.code === "42703" || e2?.code === "PGRST204") ({ error: e2 } = await db().from("approvals").insert(card));
    if (e2) { await db().from("agent_actions").delete().eq("id", action.id); throw new Error(`Gateway: could not queue the approval: ${e2.message}`); }
  }
  return { status: "queued", actionId: action.id };
}

// ---- Gmail drafts: the recipient always comes from the leads list

interface LeadRow { id: string; business: string; email: string | null; stage: string }

async function leadAndSuppressed(leadId: string) {
  const { data: lead } = await db().from("wholesale_leads").select("id, business, email, stage").eq("id", leadId).maybeSingle();
  const to = ((lead as LeadRow | null)?.email ?? "").trim().toLowerCase();
  const { data: sup } = to ? await db().from("email_suppressions").select("email").eq("email", to) : { data: [] };
  return { lead: lead as LeadRow | null, suppressed: new Set((sup ?? []).map((r) => r.email as string)) };
}

/** Why a draft to this lead can't be proposed right now, read fresh from the leads list and suppressions. */
async function refuseLead(leadId: string) {
  const { lead, suppressed } = await leadAndSuppressed(leadId);
  return refuseDraftTo(lead, suppressed);
}

// ---- Klaviyo campaign drafts: the list is always one of the business's own, read by code

/** Why a campaign to this list can't be proposed: it isn't on the business's Klaviyo lists right now. */
async function refuseList(listId: string) {
  try { return refuseCampaignTo(listId, await klaviyoLists()); } catch (e) { return `Klaviyo's lists couldn't be read to check the list: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`; }
}

// ---- The Bookkeeper's proposals (expense_docs.proposal_*) become actions

interface ProposalRow {
  id: string; mercury_txn_id: string; date: string; merchant: string; amount_usd: number; status: string;
  receipt_path: string | null; source: string | null; receipt_json: { merchant?: string | null; total_usd?: number | null; date?: string | null } | null;
  proposal_attach: boolean; proposal_category_id: string | null; proposal_category: string | null; proposal_memo: string | null;
}

/** Turns every expense_docs proposal that has no open action into one approval per charge. Idempotent. */
export async function queueBookkeeperProposals(runId?: string | null) {
  await expireStale();
  const { data, error } = await db().from("expense_docs")
    .select("id, mercury_txn_id, date, merchant, amount_usd, status, receipt_path, source, receipt_json, proposal_attach, proposal_category_id, proposal_category, proposal_memo")
    .eq("proposal_status", "proposed").not("mercury_txn_id", "is", null).order("date", { ascending: false }).limit(200);
  if (error) throw new Error(`Gateway: could not read proposals: ${error.message}`);
  const rows = (data ?? []) as ProposalRow[];
  if (!rows.length) return { queued: 0, refused: 0 };
  const { data: acts } = await db().from("agent_actions").select("target, status, result_json").eq("tool", ANNOTATE).in("target", rows.map((r) => r.mercury_txn_id));
  const open = new Set((acts ?? []).filter((a) => ["proposed", "approved", "executing"].includes(a.status)).map((a) => a.target));
  const attached = new Set((acts ?? []).filter((a) => (a.result_json as { attached?: boolean } | null)?.attached).map((a) => a.target));
  let queued = 0, refused = 0;
  for (const r of rows) {
    if (open.has(r.mercury_txn_id) || r.status === "personal" || r.status === "not_needed") continue;
    const args: AnnotateArgs = {};
    if (r.proposal_attach && r.receipt_path && !attached.has(r.mercury_txn_id)) { args.attach = true; args.receipt_path = r.receipt_path; }
    if (r.proposal_category_id) { args.category_id = r.proposal_category_id; args.category = r.proposal_category ?? undefined; }
    if (r.proposal_memo) args.note = r.proposal_memo;
    if (!args.attach && !args.category_id && !args.note) continue;
    const parts = [args.attach && "receipt", args.category_id && "category", args.note && "memo"].filter(Boolean) as string[];
    const read = r.receipt_json;
    const res = await propose({
      agentId: "bookkeeper", runId, tool: ANNOTATE, target: r.mercury_txn_id, args,
      actionType: parts.join("+"),
      title: `${r.merchant} · $${Number(r.amount_usd).toFixed(2)} · ${r.date}`,
      reasoning: args.attach && read
        ? `Receipt found in Gmail: ${read.merchant ?? "?"}, $${read.total_usd ?? "?"} on ${read.date ?? "?"}. Matched in code on exact amount, date within the window and merchant name.`
        : args.category_id ? "No category in Mercury yet. Suggested from Mercury's own category list." : undefined,
      preview: { date: r.date, merchant: r.merchant, amount_usd: Number(r.amount_usd), receipt_path: args.attach ? r.receipt_path : null, category: args.category ?? null, note: args.note ?? null },
    });
    if (res.status === "queued" || res.status === "scheduled") {
      queued++;
      await db().from("expense_docs").update({ proposal_action_id: res.actionId }).eq("id", r.id);
    } else if (res.status === "refused") refused++;
  }
  return { queued, refused };
}

// ---- Decisions

/** Drafts a lead didn't check in time go to the owner, saying so. */
export async function releaseOverdueChecks(now = new Date()) {
  const { data } = await db().from("approvals").select("id, reviewer_agent_id").eq("status", "pending").eq("review_status", "waiting").lt("review_due", now.toISOString());
  for (const r of data ?? []) {
    await db().from("approvals").update({ review_status: "skipped", review_at: now.toISOString(), review_note: `Not checked within ${LEAD_REVIEW_HOURS} hours.` })
      .eq("id", r.id).eq("review_status", "waiting");
  }
  return (data ?? []).length;
}

/** Drafts waiting for this agent's check, oldest first, with whether each may still be sent back. */
export async function draftsToCheck(reviewer: string) {
  await releaseOverdueChecks();
  const { data, error } = await db().from("approvals").select("id, agent_id, title, reasoning, preview, created_at, review_due, agent_actions(tool, target)")
    .eq("status", "pending").eq("reviewer_agent_id", reviewer).eq("review_status", "waiting").order("created_at", { ascending: true }).limit(20);
  if (error) throw new Error(error.message);
  const rows = (data ?? []).map((r) => {
    const act = (Array.isArray(r.agent_actions) ? r.agent_actions[0] : r.agent_actions) as { tool: string; target: string } | null;
    return { id: r.id as string, agentId: r.agent_id as string, title: r.title as string, reasoning: r.reasoning as string | null, preview: r.preview as Record<string, unknown>, createdAt: r.created_at as string, due: r.review_due as string, tool: act?.tool ?? "", target: act?.target ?? "" };
  });
  const sentBack = await sentBackBefore(rows.map((r) => ({ tool: r.tool, target: r.target })));
  return rows.map((r) => ({ ...r, canSendBack: !sentBack.has(`${r.tool}|${r.target}`) }));
}

/** Tool and target pairs a lead already sent back once: the next draft for them can only get a note. */
async function sentBackBefore(pairs: { tool: string; target: string }[]) {
  if (!pairs.length) return new Set<string>();
  const { data } = await db().from("agent_actions").select("tool, target").eq("status", "sent_back").in("target", [...new Set(pairs.map((p) => p.target))]);
  return new Set((data ?? []).map((r) => `${r.tool}|${r.target}`));
}

/**
 * A lead's check on one draft (docs/org-chart.md, slice 4), saved after the lead's run finishes. A note
 * stays on the card for the owner. A send-back closes the draft without counting as the owner's decision, and
 * the caller proposes a lesson for the agent that wrote it (the owner keeps or discards it). A lead never approves,
 * rejects or edits: the draft's words and target stay exactly as they were.
 */
export async function leadReview(approvalId: string, reviewer: string, verdict: "note" | "send_back", note: string): Promise<{ result: "noted" | "gone" } | { result: "sent_back"; agentId: string; title: string }> {
  const now = new Date().toISOString();
  const { data: ap } = await db().from("approvals").select("id, action_id, agent_id, title, agent_actions(tool, target)")
    .eq("id", approvalId).eq("status", "pending").eq("reviewer_agent_id", reviewer).eq("review_status", "waiting").maybeSingle();
  if (!ap) return { result: "gone" };
  const act = (Array.isArray(ap.agent_actions) ? ap.agent_actions[0] : ap.agent_actions) as { tool: string; target: string } | null;
  const once = act ? (await sentBackBefore([act])).has(`${act.tool}|${act.target}`) : true;
  if (verdict === "note" || once) {
    const { data } = await db().from("approvals").update({ review_status: "noted", review_note: note, review_at: now }).eq("id", approvalId).eq("review_status", "waiting").select("id").maybeSingle();
    return { result: data ? "noted" : "gone" };
  }
  const { data } = await db().from("approvals").update({ status: "sent_back", review_status: "sent_back", review_note: note, review_at: now, decided_at: now, decided_by: `${reviewer} (lead)`, reject_reason: note })
    .eq("id", approvalId).eq("status", "pending").eq("review_status", "waiting").select("id").maybeSingle();
  if (!data) return { result: "gone" };
  await db().from("agent_actions").update({ status: "sent_back", decided_at: now, reason: `Sent back by its lead: ${note}` }).eq("id", ap.action_id).eq("status", "proposed");
  return { result: "sent_back", agentId: ap.agent_id as string, title: ap.title as string };
}

/** Pending items older than approval_expiry_hours expire, so nothing is applied from an old view of the world. */
export async function expireStale() {
  await releaseOverdueChecks();
  const hours = await numPolicy("approval_expiry_hours", 72);
  const cutoff = new Date(Date.now() - hours * 36e5).toISOString();
  const { data } = await db().from("approvals").update({ status: "expired", decided_at: new Date().toISOString(), reject_reason: "stale" })
    .eq("status", "pending").lt("created_at", cutoff).select("action_id");
  const ids = (data ?? []).map((a) => a.action_id);
  if (!ids.length) return 0;
  await db().from("agent_actions").update({ status: "expired", reason: "stale", decided_at: new Date().toISOString() }).in("id", ids).eq("status", "proposed");
  await db().from("expense_docs").update({ proposal_status: "rejected" }).in("proposal_action_id", ids);
  return ids.length;
}

/**
 * Records an approver's decision on a pending approval. Approving does not write anything by itself.
 * A rejection says why (core/trust-rules.ts REJECT_KINDS): "wrong" or "against the rules" drops that
 * agent's tool back to Draft; any other decision may open a promotion card (core/trust.ts).
 */
export async function decide(approvalId: string, decision: "approve" | "reject", by: string, reason?: string, kind?: RejectKind | null): Promise<string | null> {
  return (await decideWithTrust(approvalId, decision, by, reason, kind))?.actionId ?? null;
}

/** decide, with what the decision did to the trust level ("" when nothing changed). */
export async function decideWithTrust(approvalId: string, decision: "approve" | "reject", by: string, reason?: string, kind?: RejectKind | null): Promise<{ actionId: string; trust: string } | null> {
  const now = new Date().toISOString();
  const status = decision === "approve" ? "approved" : "rejected";
  const rk = decision === "reject" && isRejectKind(kind) ? kind : null;
  const patch = { status, decided_at: now, decided_by: by, reject_reason: decision === "reject" ? (reason ?? "rejected by the owner") : null };
  let { data: ap, error } = await db().from("approvals").update({ ...patch, ...(rk ? { reject_kind: rk } : {}) })
    .eq("id", approvalId).eq("status", "pending").select("action_id, agent_id").maybeSingle();
  // before the trust migration the column isn't there: the decision is recorded without its kind
  if (rk && (error?.code === "42703" || error?.code === "PGRST204")) ({ data: ap, error } = await db().from("approvals").update(patch).eq("id", approvalId).eq("status", "pending").select("action_id, agent_id").maybeSingle());
  if (error) throw new Error(error.message);
  if (!ap) return null; // already decided or expired
  await db().from("agent_actions").update({ status, decided_at: now, ...(decision === "reject" ? { reason: reason ?? "rejected by the owner" } : {}) }).eq("id", ap.action_id).eq("status", "proposed");
  await db().from("expense_docs").update({ proposal_status: status }).eq("proposal_action_id", ap.action_id);
  const { data: act } = await db().from("agent_actions").select("tool").eq("id", ap.action_id).maybeSingle();
  const trust = act?.tool ? await afterDecision(ap.agent_id as string, act.tool as string, decision === "reject" ? (rk ?? "other") : null, by) : "";
  return { actionId: ap.action_id as string, trust };
}

/**
 * An approver cancels an action waiting in its undo window. Nothing was written. "Wrong" or "against
 * the rules" drops that agent's tool back to Draft. Returns what happened, or null when it already went.
 */
export async function cancelScheduled(actionId: string, kind: RejectKind, by: string): Promise<string | null> {
  const { data, error } = await db().from("agent_actions").update({ status: "cancelled", cancel_kind: kind, decided_at: new Date().toISOString(), reason: `Cancelled by ${by.slice(0, 120)} in the undo window.` })
    .eq("id", actionId).eq("status", "scheduled").select("agent_id, tool").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return `Cancelled: nothing was written.${await afterDecision(data.agent_id as string, data.tool as string, kind, by)}`;
}

/**
 * The scheduler's round (app/api/dispatch), as one org: actions whose undo window has passed become
 * approved, then everything a trust level approved (Act with undo, Act) is applied with the same fresh
 * checks as an approver's tap, inside withRun (so only while its agent is on duty). Afterwards each
 * agent's tool may earn its next promotion card.
 */
export async function applyTrusted(now = new Date()): Promise<{ released: number; applied: string | null }> {
  const iso = now.toISOString();
  const { data: rel, error } = await db().from("agent_actions").update({ status: "approved", decided_at: iso }).eq("status", "scheduled").lte("execute_after", iso).select("id");
  if (error) return { released: 0, applied: null }; // before the trust migration: nothing is ever scheduled
  const { data: auto } = await db().from("agent_actions").select("id, agent_id, tool").eq("status", "approved").in("level", ["act_undo", "act"]).limit(200);
  const rows = (auto ?? []) as { id: string; agent_id: string; tool: string }[];
  if (!rows.length) return { released: (rel ?? []).length, applied: null };
  const res = await applyApproved(rows.map((r) => r.id));
  for (const k of new Set(rows.map((r) => `${r.agent_id}|${r.tool}`))) {
    const [agentId, tool] = k.split("|");
    await refreshOffer(agentId, tool).catch(() => false);
  }
  return { released: (rel ?? []).length, applied: res.text };
}

/** A failed action goes back to approved so the next apply tries it again (with a fresh live check). */
export async function retry(actionId: string) {
  const { data } = await db().from("agent_actions").update({ status: "approved", reason: null }).eq("id", actionId).eq("status", "failed").select("id").maybeSingle();
  return !!data;
}

// ---- Execution

/** Why approved actions can't be written to Mercury right now, or null. (agents.enabled is checked by withRun.) */
export async function writeBlocker(): Promise<string | null> {
  if (!(await hasMercury())) return "Mercury isn't connected on Connections, so the gateway can't re-check transactions.";
  if (!(await editsReady()) && !(await filesReady())) return "Neither Mercury writes nor Mercury receipt files is connected (Connections → Mercury), so approved changes wait here.";
  return null;
}

/** A gateway sign-in is connected and not paused. */
async function ready(id: "mercury_write" | "mercury_files" | "klaviyo_drafts"): Promise<boolean> {
  const s = await mcpStatus(id);
  return !!s?.connected && !s.paused;
}
/** The gateway's own Mercury sign-in (category and memo only). */
const editsReady = () => ready("mercury_write");
/** The gateway's receipt key, in the vault (attach a file only). */
const filesReady = () => ready("mercury_files");

/** One receipt file onto the charge an approver approved, through our receipt server on the gateway's key. Returns Mercury's attachment id. */
async function attachReceipt(transactionId: string, file: { name: string; type: string; bytes: Uint8Array }): Promise<string | null> {
  const out = (await callWriteTool("mercury_files", "mercury_attach_receipt", { transactionId, name: file.name, type: file.type, base64: Buffer.from(file.bytes).toString("base64") })) as { attachmentId?: unknown };
  return typeof out?.attachmentId === "string" ? out.attachmentId : null;
}

/** A charge's memo and/or category, through Mercury's MCP server on the gateway's sign-in. A field left undefined is not sent, so Mercury keeps it. */
async function updateCharge(transactionId: string, patch: { note?: string; categoryId?: string }) {
  const args: Record<string, unknown> = { transactionId };
  if (patch.note !== undefined) args.note = patch.note;
  if (patch.categoryId !== undefined) args.categoryId = patch.categoryId;
  if (Object.keys(args).length === 1) return;
  await callWriteTool("mercury_write", "updateTransaction", args);
}

interface ActionRow { id: string; agent_id: string; target: string; args_json: AnnotateArgs; status: string }

async function applyOne(a: ActionRow, runId: string, cats: () => Promise<Set<string>>) {
  const now = new Date().toISOString();
  // claim it, so two clicks can't apply it twice
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    // re-check the allow-list at execution time, in case a row was edited by hand
    const refused = refuseProposal(a.agent_id, ANNOTATE, a.target, a.args_json as Record<string, unknown>, Number.MAX_SAFE_INTEGER);
    if (refused) { await done({ status: "refused", reason: refused }); return "refused" as const; }
    const { data: doc } = await db().from("expense_docs").select("id, amount_usd, status").eq("mercury_txn_id", a.target).maybeSingle();
    if (!doc) { await done({ status: "refused", reason: "No expense_docs row for this transaction." }); return "refused" as const; }
    const live = await mercuryTransaction(a.target);
    const plan = planWrite(a.args_json, live, { amountUsd: Number(doc.amount_usd), status: doc.status }, a.args_json.category_id ? await cats() : new Set());
    if (typeof plan === "string") {
      await done({ status: "refused", reason: plan });
      await db().from("expense_docs").update({ proposal_status: "rejected" }).eq("id", doc.id);
      return "refused" as const;
    }
    const before = { note: live!.note ?? null, category_id: live!.categoryData?.id ?? null, attachments: live!.attachments?.length ?? 0 };
    if (planIsEmpty(plan)) {
      await done({ status: "applied", reason: `Nothing left to change: ${plan.skipped.join("; ")}`, result_json: { attached: false, skipped: plan.skipped }, diff_json: { before, after: before } });
      await db().from("expense_docs").update({ proposal_status: "applied", updated_at: now }).eq("id", doc.id);
      return "applied" as const;
    }
    // both ways in are checked before anything is written, so a change never lands half done
    if (plan.attach && !(await filesReady())) throw new Error("Mercury receipt files isn't connected (Connections → Mercury), so the receipt can't be attached.");
    if ((plan.categoryId || plan.note) && !(await editsReady())) throw new Error("Mercury writes isn't connected (Connections → Mercury), so the category and memo can't be set.");
    let attachmentId: string | null = null;
    if (plan.attach) {
      const path = a.args_json.receipt_path!;
      if (!receiptPathOk(a.target, path)) throw new Error("Receipt path is not this transaction's file.");
      const { data: blob, error } = await db().storage.from("receipts").download(path);
      if (error || !blob) throw new Error(`Could not read the receipt file: ${error?.message ?? "missing"}`);
      if (blob.size > MAX_RECEIPT_BYTES) throw new Error("Receipt file is over 10 MB.");
      const ext = path.split(".").pop()!;
      attachmentId = await attachReceipt(a.target, { name: `receipt.${ext}`, type: RECEIPT_TYPES[ext], bytes: new Uint8Array(await blob.arrayBuffer()) });
    }
    if (plan.categoryId || plan.note) await updateCharge(a.target, { categoryId: plan.categoryId, note: plan.note });
    const after = { note: plan.note ?? before.note, category_id: plan.categoryId ?? before.category_id, attachments: before.attachments + (plan.attach ? 1 : 0) };
    await done({
      status: plan.skipped.length ? "partial" : "applied",
      reason: plan.skipped.length ? plan.skipped.join("; ") : null,
      diff_json: { before, after },
      // what to put back: the memo and category it replaced (both were empty), and the attachment it added
      undo_json: { note: plan.note ? before.note : undefined, category_id: plan.categoryId ? before.category_id : undefined, attachment_id: attachmentId },
      result_json: { attached: plan.attach, attachment_id: attachmentId, category_id: plan.categoryId ?? null, note: plan.note ?? null, skipped: plan.skipped },
    });
    await db().from("expense_docs").update({
      proposal_status: "applied", updated_at: now,
      ...(plan.categoryId ? { category_id: plan.categoryId, category: a.args_json.category ?? null } : {}),
    }).eq("id", doc.id);
    return "applied" as const;
  } catch (e) {
    await done({ status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return "failed" as const;
  }
}

/**
 * Applies approved actions (all of them, or the ids given): Mercury changes and Gmail drafts, each
 * kind only when its integration is set up, each inside a withRun for its agent (trigger
 * "approval", $0). A disabled agent's run is skipped and its actions stay approved.
 */
export async function applyApproved(ids?: string[]) {
  await expireStale();
  // an apply that died mid-way: mark it failed; a retry checks again first, so nothing is written twice
  await db().from("agent_actions").update({ status: "failed", reason: "Interrupted while applying. Retry checks again first." })
    .eq("status", "executing").lt("claimed_at", new Date(Date.now() - 10 * 6e4).toISOString());
  const done = (await Promise.all([applyMercury(ids), applyDrafts(ids), applyCampaigns(ids)])).filter((r): r is { ok: boolean; text: string } => !!r);
  if (!done.length) return { ok: true, text: "Nothing approved is waiting." };
  return { ok: done.every((r) => r.ok), text: done.map((r) => r.text).join(" ") };
}

async function approvedOf(tool: string, ids?: string[]) {
  let q = db().from("agent_actions").select("id, agent_id, target, args_json, status").eq("status", "approved").eq("tool", tool).order("decided_at", { ascending: true });
  if (ids?.length) q = q.in("id", ids);
  const { data, error } = await q.limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as ActionRow[];
}

/** Approved Gmail drafts: made in Gmail, to the address on the lead's row, at most max_gmail_drafts_per_run per agent. */
async function applyDrafts(ids?: string[]) {
  const rows = await approvedOf(DRAFT_EMAIL, ids);
  if (!rows.length) return null;
  if (!(await hasGmail())) return { ok: true, text: "Approved, not in Gmail yet: the Gmail drafts sign-in isn't connected (Connections, Gmail)." };
  const cap = await numPolicy("max_gmail_drafts_per_run", 10);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyDraft(a, runId); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway made ${n.applied} approved Gmail draft${n.applied === 1 ? "" : "s"}${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}. The owner sends them from Gmail.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved drafts are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

/** A plain-text draft through our Gmail server, on the gateway's own gmail.compose sign-in. Returns its draft id. */
async function createDraft(to: string, subject: string, body: string): Promise<string> {
  const out = (await callWriteTool("gmail", "gmail_create_draft", { to, subject, body })) as { draftId?: unknown };
  if (typeof out?.draftId !== "string" || !out.draftId) throw new Error("Gmail didn't return a draft id");
  return out.draftId;
}

async function applyDraft(a: ActionRow, runId: string) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as DraftArgs;
    // the allow-list and the lead again, at execution time: the row may have changed since the card
    const refused = refuseProposal(a.agent_id, DRAFT_EMAIL, a.target, args as unknown as Record<string, unknown>);
    const { lead, suppressed } = await leadAndSuppressed(a.target);
    const no = refused ?? refuseDraftTo(lead, suppressed);
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const to = lead!.email!.trim();
    const draftId = await createDraft(to, args.subject, args.body);
    await done({ status: "applied", result_json: { gmail_draft_id: draftId, to }, diff_json: { before: { stage: lead!.stage }, after: { stage: lead!.stage === "new" ? "drafted" : lead!.stage } } });
    await db().from("wholesale_leads").update({ gmail_draft_id: draftId, draft_subject: args.subject, draft_body: args.body, ...(lead!.stage === "new" ? { stage: "drafted" } : {}) }).eq("id", lead!.id);
    return "applied" as const;
  } catch (e) {
    await done({ status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return "failed" as const;
  }
}

/** Approved Klaviyo campaigns: made as drafts in Klaviyo on the gateway's own key, at most max_campaign_drafts_per_run per agent. */
async function applyCampaigns(ids?: string[]) {
  const rows = await approvedOf(CAMPAIGN_DRAFT, ids);
  if (!rows.length) return null;
  if (!(await ready("klaviyo_drafts"))) return { ok: true, text: "Approved, not in Klaviyo yet: the Klaviyo campaign drafts key isn't connected (Connections, Klaviyo)." };
  const cap = await numPolicy("max_campaign_drafts_per_run", 3);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyCampaign(a, runId); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway made ${n.applied} approved Klaviyo campaign draft${n.applied === 1 ? "" : "s"}${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}. The owner sends them from Klaviyo.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved campaigns are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

async function applyCampaign(a: ActionRow, runId: string) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as CampaignArgs;
    // the allow-list and the list again, at execution time: a row may have been edited, a list deleted
    const no = refuseProposal(a.agent_id, CAMPAIGN_DRAFT, a.target, args as unknown as Record<string, unknown>) ?? (await refuseList(a.target));
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const out = (await callWriteTool("klaviyo_drafts", "klaviyo_create_draft", { listId: a.target, subject: args.subject, preview: args.preview, body: args.body })) as { campaignId?: unknown; templateId?: unknown; listName?: unknown };
    if (typeof out?.campaignId !== "string" || !out.campaignId) throw new Error("Klaviyo didn't return a campaign id");
    await done({ status: "applied", result_json: { klaviyo_campaign_id: out.campaignId, klaviyo_template_id: out.templateId ?? null, list: out.listName ?? null, sent: false } });
    return "applied" as const;
  } catch (e) {
    await done({ status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return "failed" as const;
  }
}

/** Approved Mercury changes, at most max_mercury_writes_per_run per agent. */
async function applyMercury(ids?: string[]) {
  const rows = await approvedOf(ANNOTATE, ids);
  if (!rows.length) return null;
  const blocked = await writeBlocker();
  if (blocked) return { ok: true, text: `Approved, not in Mercury yet: ${blocked}` };
  const cap = await numPolicy("max_mercury_writes_per_run", 20);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    let catSet: Set<string> | null = null;
    const cats = async () => (catSet ??= new Set((await mercuryCategories()).map((c) => c.id)));
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) {
        const r = await applyOne(a, runId, cats);
        if (r !== "skipped") n[r]++;
      }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway applied ${n.applied} approved Mercury change${n.applied === 1 ? "" : "s"}${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved changes are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

// ---- Caps: what checkPurchase and checkEmail need (policy.ts), loaded here.

/** Names the payment and email action types will have. Neither is in TOOLS yet, so nothing can propose one. */
export const PAY_TOOL = "mercury.send_money";
export const EMAIL_TOOL = "email.send";

/** Every cap as code enforces it (the policy row held inside the code limit), plus the raw row. */
export async function loadCaps(): Promise<Record<CapKey, { value: number; raw: unknown }>> {
  const { data, error } = await db().from("policies").select("key, value_json").in("key", CAP_KEYS);
  if (error) throw new Error(`Gateway: could not read caps: ${error.message}`);
  const raw = new Map((data ?? []).map((r) => [r.key as string, r.value_json as unknown]));
  return Object.fromEntries(CAP_KEYS.map((k) => [k, { value: effectiveCap(k, raw.get(k)), raw: raw.has(k) ? raw.get(k) : null }])) as Record<CapKey, { value: number; raw: unknown }>;
}

/** Money sent this calendar month in the business's time zone, from applied payment actions (computed in code). */
export async function monthSpentUsd(now = new Date()): Promise<number> {
  const { data, error } = await db().from("agent_actions").select("args_json").eq("tool", PAY_TOOL).in("status", ["applied", "executing"]).gte("executed_at", startOf("month", await orgTz(), now));
  if (error) throw new Error(error.message);
  const cents = (data ?? []).reduce((s, r) => s + Math.round(Number((r.args_json as { amount_usd?: number } | null)?.amount_usd ?? 0) * 100), 0);
  return cents / 100;
}

/** Outbound emails sent today (in the business's time zone), from applied email actions. Briefs to the owner are reports, not actions, so they don't count. */
export async function emailsSentToday(now = new Date()): Promise<number> {
  const { count, error } = await db().from("agent_actions").select("id", { count: "exact", head: true }).eq("tool", EMAIL_TOOL).in("status", ["applied", "executing"]).gte("executed_at", startOf("day", await orgTz(), now));
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/** Vendors that have been paid before, so a first payment always waits for the owner. */
export async function paidVendorIds(): Promise<Set<string>> {
  const { data } = await db().from("agent_actions").select("target").eq("tool", PAY_TOOL).eq("status", "applied");
  return new Set((data ?? []).map((r) => r.target as string));
}

/**
 * A cap was breached (a payment or email refused by checkPurchase or checkEmail). CLAUDE.md:
 * a cap breach drops that action type back to Draft (core/trust.ts demote), and the refusal shows in
 * the gateway log.
 */
export async function onBreach(b: { agentId: string; tool: string; target: string; reason: string; runId?: string | null }) {
  await db().from("agent_actions").insert({ agent_id: b.agentId, run_id: b.runId ?? null, tool: b.tool, action_type: "cap breach", target: b.target, args_json: {}, status: "refused", reason: b.reason });
  await demote(b.agentId, b.tool, `A cap was hit: ${b.reason}`.slice(0, 300)).catch(() => false);
}
