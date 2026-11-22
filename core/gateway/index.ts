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
import { recordCampaign } from "@/core/campaign-results";
import { hasGmail } from "@/integrations/gmail";
import { klaviyoLists } from "@/integrations/klaviyo";
import type { CampaignArgs } from "@/core/klaviyo-draft-rules";
import { invoiceCents, type InvoiceArgs } from "@/core/stripe-rules";
import { QBO_CATEGORIZE_TOOL, UNCATEGORIZED, type CategorizeArgs } from "@/core/quickbooks-rules";
import { productTarget, refuseCopy, refuseStock, refuseTags, shopifyTarget, stockTarget } from "@/core/shopify-actions";
import { afterDecision, demote, levelOf, refreshOffer } from "@/core/trust";
import { executeAfter, isRejectKind, type RejectKind } from "@/core/trust-rules";
import { refuseHold } from "@/core/calendar-rules";
import { audienceIdOk, refuseMailchimpCampaign } from "@/core/mailchimp-rules";
import { orderIdOk, refuseNote } from "@/core/woo-rules";
import { dealIdOk, refuseMove } from "@/core/hubspot-rules";
import { adIdOk, refusePause, RESULT_LABEL, type MetaResult } from "@/core/meta-rules";
import { metaTargets } from "@/core/meta-targets";
import { ANNOTATE, CALENDAR_HOLD, CAMPAIGN_DRAFT, CAP_KEYS, DRAFT_EMAIL, SHOPIFY_COPY, SHOPIFY_STOCK, SHOPIFY_TAGS, INVOICE_DRAFT, MAILCHIMP_DRAFT, WOO_NOTE, HUBSPOT_MOVE, META_PAUSE, QBO_CATEGORIZE, TOOLS, refuseAgent, refuseCampaignTo, type ActionDef, MAX_RECEIPT_BYTES, RECEIPT_TYPES, effectiveCap, planIsEmpty, planWrite, receiptPathOk, refuseDraftTo, refuseProposal, type AnnotateArgs, type CapKey, type DraftArgs, type ToolName } from "./policy";

export { ANNOTATE, CALENDAR_HOLD, CAMPAIGN_DRAFT, DRAFT_EMAIL, INVOICE_DRAFT, SHOPIFY_COPY, SHOPIFY_STOCK, SHOPIFY_TAGS, MAILCHIMP_DRAFT, WOO_NOTE, HUBSPOT_MOVE, META_PAUSE, QBO_CATEGORIZE } from "./policy";

export interface Proposal {
  agentId: string;
  runId?: string | null;
  tool: ToolName;
  target: string;
  args: AnnotateArgs | DraftArgs | CampaignArgs | InvoiceArgs | CategorizeArgs;
  actionType: string;
  title: string;
  reasoning?: string;
  preview?: Record<string, unknown>;
  /** Shared brain, slice 4b: what the agent was shown before it drafted, in code's words (workedNote). */
  brainNote?: string | null;
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
  const grants = isGranted(p.tool) ? await grantsOf(p.agentId) : null;
  const refused = refuseProposal(p.agentId, p.tool, p.target, p.args as Record<string, unknown>, memoMax, grants) ?? (p.tool === DRAFT_EMAIL ? await refuseLead(p.target) : p.tool === CAMPAIGN_DRAFT ? await refuseList(p.target) : null);
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
    const note = p.brainNote ? { brain_note: p.brainNote.slice(0, 600) } : {};
    let { error: e2 } = await db().from("approvals").insert({ ...card, ...note, department_id: departmentId, ...review });
    // before the slice 4b migration there's no brain_note column: the card goes without the line
    if (p.brainNote && (e2?.code === "42703" || e2?.code === "PGRST204")) ({ error: e2 } = await db().from("approvals").insert({ ...card, department_id: departmentId, ...review }));
    // before the slice 4 migration the columns aren't there: the card goes straight to the owner, as before
    if (e2?.code === "42703" || e2?.code === "PGRST204") ({ error: e2 } = await db().from("approvals").insert(card));
    if (e2) { await db().from("agent_actions").delete().eq("id", action.id); throw new Error(`Gateway: could not queue the approval: ${e2.message}`); }
  }
  return { status: "queued", actionId: action.id };
}

// ---- Granted actions (card 250): any agent an approver gave the action's tool on the Tools step

const isGranted = (tool: string) => (TOOLS[tool as ToolName] as ActionDef | undefined)?.agents === "granted";

/** The catalog tools the agent's active spec holds, or null when it has none or it can't be read. */
async function grantsOf(agentId: string): Promise<string[] | null> {
  // imported here, not at the top: agent-spec reads the tool list, which imports the gateway
  try { const { loadSpec } = await import("@/core/agent-spec"); return (await loadSpec(agentId))?.spec.tools ?? null; } catch { return null; }
}

/**
 * Right before anything is applied: an approved or scheduled granted action whose agent no longer holds
 * the tool (an approver took it away, or a new version went live without it) is refused, not applied.
 */
async function refuseUngranted(ids?: string[]) {
  const granted = (Object.keys(TOOLS) as ToolName[]).filter(isGranted);
  if (!granted.length) return 0;
  let q = db().from("agent_actions").select("id, agent_id, tool").eq("status", "approved").in("tool", granted);
  if (ids?.length) q = q.in("id", ids);
  const { data } = await q.limit(500);
  let n = 0;
  const memo = new Map<string, Promise<string[] | null>>();
  for (const a of (data ?? []) as { id: string; agent_id: string; tool: ToolName }[]) {
    if (!memo.has(a.agent_id)) memo.set(a.agent_id, grantsOf(a.agent_id));
    const why = refuseAgent(TOOLS[a.tool] as ActionDef, a.tool, a.agent_id, await memo.get(a.agent_id)!);
    if (!why) continue;
    const { error } = await db().from("agent_actions").update({ status: "refused", reason: `Not applied: ${why}` }).eq("id", a.id).eq("status", "approved");
    if (!error) n++;
  }
  return n;
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
async function ready(id: "mercury_write" | "mercury_files" | "klaviyo_drafts" | "calendar_holds" | "shopify" | "stripe_drafts" | "mailchimp_drafts" | "woo_notes" | "hubspot_deals" | "meta_pauses" | "quickbooks"): Promise<boolean> {
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
  await refuseUngranted(ids);
  const done = (await Promise.all([applyMercury(ids), applyDrafts(ids), applyCampaigns(ids), applyHolds(ids), applyShopifyTags(ids), applyShopifyStock(ids), applyShopifyCopy(ids), applyInvoices(ids), applyMailchimp(ids), applyWooNotes(ids), applyHubSpotMoves(ids), applyMetaPauses(ids), applyCategorize(ids)])).filter((r): r is { ok: boolean; text: string } => !!r);
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
    await recordCampaign(a.id, CAMPAIGN_DRAFT, out.campaignId, args as unknown as Record<string, unknown>);
    return "applied" as const;
  } catch (e) {
    await done({ status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return "failed" as const;
  }
}

/** Approved calendar holds (card 251): private events on the gateway's own Calendar holds sign-in, at most max_calendar_holds_per_run per agent. */
async function applyHolds(ids?: string[]) {
  const rows = await approvedOf(CALENDAR_HOLD, ids);
  if (!rows.length) return null;
  if (!(await ready("calendar_holds"))) return { ok: true, text: "Approved, not on the calendar yet: the Calendar holds sign-in isn't connected (Connections, Google Calendar)." };
  const cap = await numPolicy("max_calendar_holds_per_run", 10);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyHold(a, runId); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway put ${n.applied} approved hold${n.applied === 1 ? "" : "s"} on the calendar${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}. No one was invited or emailed.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved holds are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

async function applyHold(a: ActionRow, runId: string) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as Record<string, unknown>;
    // the fields and the time again, at execution time (a granted action's agent was checked by refuseUngranted);
    // the server checks the time is still free on the calendar right before it writes
    const no = refuseHold(args, Date.now()) ?? (a.target === `${args.start}/${args.end}` ? null : "The target is not the hold's own start and end.");
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const out = (await callWriteTool("calendar_holds", "calendar_create_hold", { title: args.title, start: args.start, end: args.end })) as { eventId?: unknown };
    if (typeof out?.eventId !== "string" || !out.eventId) throw new Error("Google Calendar didn't return an event id");
    await done({ status: "applied", result_json: { calendar_event_id: out.eventId, start: args.start, end: args.end, guests: 0 } });
    return "applied" as const;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // a slot taken since the card is a refusal, not a failure to retry
    if (/isn't free any more/.test(msg)) { await done({ status: "refused", reason: "That time isn't free on the calendar any more." }); return "refused" as const; }
    await done({ status: "failed", reason: msg.slice(0, 300) });
    return "failed" as const;
  }
}

/** Approved Shopify tag changes, at most max_shopify_writes_per_run per agent, through our Shopify server on the business's key. */
async function applyShopifyTags(ids?: string[]) {
  const rows = await approvedOf(SHOPIFY_TAGS, ids);
  if (!rows.length) return null;
  if (!(await ready("shopify"))) return { ok: true, text: "Approved, not in Shopify yet: Shopify isn't connected (Connections, Shopify)." };
  const cap = await numPolicy("max_shopify_writes_per_run", 25);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyShopifyTag(a, runId); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway tagged ${n.applied} approved Shopify record${n.applied === 1 ? "" : "s"}${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved tags are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

async function applyShopifyTag(a: ActionRow, runId: string) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as { tags: string[] };
    // the fields again, at execution time (the grant was re-checked by refuseUngranted before any apply);
    // the server re-checks the app's scopes and the live tags
    const no = shopifyTarget(a.target) ? refuseTags(args as unknown as Record<string, unknown>) : "The target is not a Shopify order or customer id.";
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const out = (await callWriteTool("shopify", "shopify_add_tags", { target: a.target, tags: args.tags })) as { added?: unknown; skipped?: unknown; before?: unknown; label?: unknown };
    const added = Array.isArray(out?.added) ? (out.added as string[]) : [];
    const skipped = Array.isArray(out?.skipped) ? (out.skipped as string[]) : [];
    const before = Array.isArray(out?.before) ? (out.before as string[]) : [];
    await done({
      status: "applied",
      reason: skipped.length ? `Already there, left as is: ${skipped.join(", ")}` : added.length ? null : "Every tag was already there.",
      diff_json: { before: { tags: before }, after: { tags: [...before, ...added] } },
      // what to put back: remove exactly the tags this action added (Shopify's tagsRemove), never one set by hand
      undo_json: added.length ? { tags_remove: added } : null,
      result_json: { added, skipped, record: typeof out?.label === "string" ? out.label : null },
    });
    return "applied" as const;
  } catch (e) {
    await done({ status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return "failed" as const;
  }
}

/** Approved Shopify stock changes, at most max_shopify_writes_per_run per agent, through our Shopify server on the business's key. */
async function applyShopifyStock(ids?: string[]) {
  const rows = await approvedOf(SHOPIFY_STOCK, ids);
  if (!rows.length) return null;
  if (!(await ready("shopify"))) return { ok: true, text: "Approved, not in Shopify yet: Shopify isn't connected (Connections, Shopify)." };
  const cap = await numPolicy("max_shopify_writes_per_run", 25);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyStockChange(a, runId); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway set stock on ${n.applied} approved Shopify item${n.applied === 1 ? "" : "s"}${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved stock changes are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

async function applyStockChange(a: ActionRow, runId: string) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as { from: number; available: number; reason: string };
    // the fields again, at execution time (the grant was re-checked by refuseUngranted before any apply);
    // the server re-checks the app's scopes and the live count, and Shopify compares it again as it writes
    const no = stockTarget(a.target) ? refuseStock(args as unknown as Record<string, unknown>) : "The target is not a Shopify inventory item at a location.";
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const out = (await callWriteTool("shopify", "shopify_set_stock", { target: a.target, from: args.from, available: args.available, reason: args.reason, key: a.id })) as { refused?: unknown; before?: unknown; after?: unknown; label?: unknown; adjustment?: unknown };
    const label = typeof out?.label === "string" ? out.label : null;
    // the count moved since the card: a refusal, not a failure to retry
    if (typeof out?.refused === "string") { await done({ status: "refused", reason: out.refused, result_json: { record: label } }); return "refused" as const; }
    await done({
      status: "applied",
      diff_json: { before: { available: args.from }, after: { available: args.available } },
      // what to put back: the count before, and only while the store still shows the count this action set
      undo_json: { set_available: args.from, only_if_available: args.available },
      result_json: { record: label, reason: args.reason, adjustment: typeof out?.adjustment === "string" ? out.adjustment : null },
    });
    return "applied" as const;
  } catch (e) {
    await done({ status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return "failed" as const;
  }
}

async function applyShopifyCopy(ids?: string[]) {
  const rows = await approvedOf(SHOPIFY_COPY, ids);
  if (!rows.length) return null;
  if (!(await ready("shopify"))) return { ok: true, text: "Approved, not in Shopify yet: Shopify isn't connected (Connections, Shopify)." };
  const cap = await numPolicy("max_shopify_writes_per_run", 25);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyCopyChange(a, runId); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway updated copy on ${n.applied} approved Shopify product${n.applied === 1 ? "" : "s"}${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved copy changes are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

async function applyCopyChange(a: ActionRow, runId: string) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as Record<string, unknown>;
    // the fields again, at execution time (an approver may have edited the text); the server re-checks the
    // app's scopes, that the copy is still what the card was written against, and the facts in the new text
    const no = productTarget(a.target) ? refuseCopy(args) : "The target is not a Shopify product id.";
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const out = (await callWriteTool("shopify", "shopify_update_copy", { target: a.target, ...args })) as { refused?: unknown; before?: unknown; after?: unknown; set?: unknown; label?: unknown };
    const label = typeof out?.label === "string" ? out.label : null;
    // the copy moved since the card, or the text states a fact the product's data doesn't: a refusal, not a failure to retry
    if (typeof out?.refused === "string") { await done({ status: "refused", reason: out.refused, result_json: { record: label } }); return "refused" as const; }
    await done({
      status: "applied",
      diff_json: { before: out?.before ?? null, after: out?.after ?? null },
      // what to put back: the old copy, and only while the store still shows the copy this action set
      undo_json: { set_copy: out?.before ?? null, only_if_print: typeof out?.set === "string" ? out.set : null },
      result_json: { record: label },
    });
    return "applied" as const;
  } catch (e) {
    await done({ status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return "failed" as const;
  }
}

/** Approved Stripe invoices: made as drafts in Stripe on the gateway's own key, at most max_invoice_drafts_per_run per agent. */
async function applyInvoices(ids?: string[]) {
  const rows = await approvedOf(INVOICE_DRAFT, ids);
  if (!rows.length) return null;
  if (!(await ready("stripe_drafts"))) return { ok: true, text: "Approved, not in Stripe yet: the Stripe invoice drafts key isn't connected (Connections, Stripe)." };
  const cap = await numPolicy("max_invoice_drafts_per_run", 5);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyInvoice(a, runId); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway made ${n.applied} approved Stripe draft invoice${n.applied === 1 ? "" : "s"}${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}. The owner finalizes and sends them from Stripe.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved invoices are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

async function applyInvoice(a: ActionRow, runId: string) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as InvoiceArgs;
    // the allow-list again at execution time (the grant was checked by refuseUngranted); the server re-reads the customer
    const no = refuseProposal(a.agent_id, INVOICE_DRAFT, a.target, args as unknown as Record<string, unknown>, 200, [INVOICE_GRANT]);
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const out = (await callWriteTool("stripe_drafts", "stripe_create_invoice_draft", { customerId: a.target, requestKey: a.id, ...args })) as { invoiceId?: unknown; subtotal_cents?: unknown };
    if (typeof out?.invoiceId !== "string" || !out.invoiceId) throw new Error("Stripe didn't return an invoice id");
    const approved = invoiceCents(args.lines);
    // the draft exists either way: a subtotal that doesn't match is shown, never retried (it would make a second draft)
    const matches = out.subtotal_cents === approved;
    await done({ status: matches ? "applied" : "partial", ...(matches ? {} : { reason: `Stripe's draft ${out.invoiceId} has a subtotal of ${String(out.subtotal_cents)} cents, not the ${approved} approved. Check it in Stripe before sending.` }), result_json: { stripe_invoice_id: out.invoiceId, approved_cents: approved, subtotal_cents: out.subtotal_cents ?? null, finalized: false } });
    return "applied" as const;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // a draft was made before the failure: partly done, so a retry can't make it twice
    if (msg.includes("Partly made draft")) { await done({ status: "partial", reason: msg.slice(0, 300) }); return "failed" as const; }
    await done({ status: "failed", reason: msg.slice(0, 300) });
    return "failed" as const;
  }
}
const INVOICE_GRANT = TOOLS[INVOICE_DRAFT].grant;

/** Approved QuickBooks categories: each expense line moved on the business's Intuit sign-in, at most max_qbo_categorize_per_run per agent. */
async function applyCategorize(ids?: string[]) {
  const rows = await approvedOf(QBO_CATEGORIZE, ids);
  if (!rows.length) return null;
  if (!(await ready("quickbooks"))) return { ok: true, text: "Approved, not in QuickBooks yet: QuickBooks Online isn't connected (Connections, QuickBooks)." };
  const cap = await numPolicy("max_qbo_categorize_per_run", 20);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyOneCategory(a, runId); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway categorized ${n.applied} approved QuickBooks expense${n.applied === 1 ? "" : "s"}${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved categories are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

async function applyOneCategory(a: ActionRow, runId: string) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as CategorizeArgs;
    // the allow-list again at execution time (the grant was checked by refuseUngranted); the server re-reads the line and the account
    const no = refuseProposal(a.agent_id, QBO_CATEGORIZE, a.target, args as unknown as Record<string, unknown>, 200, [CATEGORIZE_GRANT]);
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const [purchaseId, lineId] = a.target.split(":");
    let out: { already?: unknown; checked?: unknown; problem?: unknown; amount?: unknown; uncategorizedId?: unknown };
    try {
      out = (await callWriteTool("quickbooks", QBO_CATEGORIZE_TOOL, { purchaseId, lineId, accountId: args.accountId })) as typeof out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // the line was categorized by hand, or the account is gone: refused on the fresh check, nothing written
      if (/isn't in Uncategorized Expense any more|isn't in the business's QuickBooks|inactive|isn't an expense account|isn't on the expense any more/.test(msg)) { await done({ status: "refused", reason: msg.slice(0, 300) }); return "refused" as const; }
      throw e;
    }
    const diff = { before: { account: UNCATEGORIZED }, after: { account: args.account } };
    const result = { amount: typeof out?.amount === "number" ? out.amount : null, account: args.account, already: out?.already === true };
    // the write went through: a check that doesn't match is shown, never retried
    if (out?.checked === false) { await done({ status: "partial", reason: `${String(out.problem ?? "The read-back didn't match")} Check the expense in QuickBooks.`, diff_json: diff, result_json: result }); return "applied" as const; }
    await done({
      status: "applied",
      reason: out?.already === true ? `Already in ${args.account}, left as is.` : null,
      diff_json: diff,
      // what to put back: the same line, back into Uncategorized Expense
      undo_json: out?.already === true || typeof out?.uncategorizedId !== "string" ? null : { accountId: out.uncategorizedId, account: UNCATEGORIZED },
      result_json: result,
    });
    return "applied" as const;
  } catch (e) {
    await done({ status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return "failed" as const;
  }
}
const CATEGORIZE_GRANT = TOOLS[QBO_CATEGORIZE].grant;

/** Approved Mailchimp campaigns (card 252): drafts in Mailchimp on the gateway's own key, at most max_campaign_drafts_per_run per agent. */
async function applyMailchimp(ids?: string[]) {
  const rows = await approvedOf(MAILCHIMP_DRAFT, ids);
  if (!rows.length) return null;
  if (!(await ready("mailchimp_drafts"))) return { ok: true, text: "Approved, not in Mailchimp yet: the Mailchimp campaign drafts key isn't connected (Connections, Mailchimp)." };
  const cap = await numPolicy("max_campaign_drafts_per_run", 3);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyMailchimpOne(a, runId); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway made ${n.applied} approved Mailchimp campaign draft${n.applied === 1 ? "" : "s"}${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}. The owner sends them from Mailchimp.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved campaigns are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

async function applyMailchimpOne(a: ActionRow, runId: string) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as CampaignArgs;
    // the words and the audience id again (a granted action's agent was checked by refuseUngranted);
    // the server checks the audience is still the business's own right before it writes
    const no = audienceIdOk(a.target) ? refuseMailchimpCampaign(args as unknown as Record<string, unknown>) : "The target is not a Mailchimp audience id.";
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const out = (await callWriteTool("mailchimp_drafts", "mailchimp_create_draft", { audienceId: a.target, subject: args.subject, preview: args.preview, body: args.body })) as { campaignId?: unknown; audience?: unknown };
    if (typeof out?.campaignId !== "string" || !out.campaignId) throw new Error("Mailchimp didn't return a campaign id");
    await done({ status: "applied", result_json: { mailchimp_campaign_id: out.campaignId, audience: out.audience ?? null, sent: false } });
    await recordCampaign(a.id, MAILCHIMP_DRAFT, out.campaignId, args as unknown as Record<string, unknown>);
    return "applied" as const;
  } catch (e) {
    await done({ status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return "failed" as const;
  }
}

/** Approved WooCommerce order notes (card 254): private notes on the gateway's own key, at most max_order_notes_per_run per agent. */
async function applyWooNotes(ids?: string[]) {
  const rows = await approvedOf(WOO_NOTE, ids);
  if (!rows.length) return null;
  if (!(await ready("woo_notes"))) return { ok: true, text: "Approved, not in WooCommerce yet: the WooCommerce order notes key isn't connected (Connections, WooCommerce)." };
  const cap = await numPolicy("max_order_notes_per_run", 20);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyWooNote(a, runId); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway added ${n.applied} approved private order note${n.applied === 1 ? "" : "s"} in WooCommerce${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}. Customers don't see them.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved notes are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

async function applyWooNote(a: ActionRow, runId: string) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as Record<string, unknown>;
    // the note and the order id again (a granted action's agent was checked by refuseUngranted);
    // the server checks the order still exists right before it writes
    const no = orderIdOk(a.target) ? refuseNote(args) : "The target is not a WooCommerce order id.";
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const out = (await callWriteTool("woo_notes", "woo_add_order_note", { orderId: a.target, note: args.note })) as { noteId?: unknown; order?: unknown };
    if (!Number.isInteger(out?.noteId)) throw new Error("WooCommerce didn't return a note id");
    await done({ status: "applied", result_json: { woo_note_id: out.noteId, order: out.order ?? a.target, customer_note: false } });
    return "applied" as const;
  } catch (e) {
    await done({ status: "failed", reason: e instanceof Error ? e.message.slice(0, 300) : String(e) });
    return "failed" as const;
  }
}

/** Approved HubSpot deal moves (card 253): a stage change and a note on the gateway's own key, at most max_deal_moves_per_run per agent. */
async function applyHubSpotMoves(ids?: string[]) {
  const rows = await approvedOf(HUBSPOT_MOVE, ids);
  if (!rows.length) return null;
  if (!(await ready("hubspot_deals"))) return { ok: true, text: "Approved, not in HubSpot yet: the HubSpot deal moves key isn't connected (Connections, HubSpot)." };
  const cap = await numPolicy("max_deal_moves_per_run", 20);
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyHubSpotMove(a, runId); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway moved ${n.applied} approved HubSpot deal${n.applied === 1 ? "" : "s"}, each with its note${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} left for the next apply (cap ${cap})` : ""}.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved moves are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

async function applyHubSpotMove(a: ActionRow, runId: string) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as Record<string, unknown>;
    // the stage and note again (a granted action's agent was checked by refuseUngranted); the server
    // checks the stage is in the deal's own pipeline, as HubSpot lists it, right before it writes
    const no = dealIdOk(a.target) ? refuseMove(args) : "The target is not a HubSpot deal id.";
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const out = (await callWriteTool("hubspot_deals", "hubspot_move_deal", { dealId: a.target, stage: args.stage, note: args.note })) as { from?: unknown; fromLabel?: unknown; to?: unknown; toLabel?: unknown; noteId?: unknown };
    if (out?.to !== args.stage) throw new Error("HubSpot didn't confirm the new stage");
    await done({ status: "applied", diff_json: { before: { dealstage: out.from ?? null }, after: { dealstage: out.to } }, result_json: { from: out.fromLabel ?? out.from ?? null, to: out.toLabel ?? out.to, hubspot_note_id: out.noteId ?? null } });
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

/** Approved Meta Ads pauses (card 255): one ad paused on the gateway's own sign-in, at most max_ad_pauses_per_run per agent. */
async function applyMetaPauses(ids?: string[]) {
  const rows = await approvedOf(META_PAUSE, ids);
  if (!rows.length) return null;
  if (!(await ready("meta_pauses"))) return { ok: true, text: "Approved, not paused yet: the Meta Ads pauses sign-in isn't connected (Connections, Meta Ads)." };
  const cap = await numPolicy("max_ad_pauses_per_run", 10);
  const targets = await metaTargets();
  const byAgent = new Map<string, ActionRow[]>();
  for (const r of rows) byAgent.set(r.agent_id, [...(byAgent.get(r.agent_id) ?? []), r]);
  const texts: string[] = [];
  let ok = true;
  for (const [agentId, list] of byAgent) {
    const res = await withRun(agentId, "approval", async (runId) => {
      const n = { applied: 0, refused: 0, failed: 0 };
      for (const a of list.slice(0, cap)) { const r = await applyMetaPause(a, runId, targets); if (r !== "skipped") n[r]++; }
      const left = Math.max(0, list.length - cap);
      return { status: "ok", summary: `Gateway paused ${n.applied} approved Meta ad${n.applied === 1 ? "" : "s"}${n.refused ? `, refused ${n.refused} on a fresh check` : ""}${n.failed ? `, ${n.failed} failed` : ""}${left ? `, ${left} wait for the next run (cap ${cap})` : ""}.` };
    });
    if (res.status === "skipped") ok = false;
    texts.push(res.status === "skipped" ? `${agentId}: not applied (${res.summary}) Approved pauses are kept.` : res.summary);
  }
  return { ok, text: texts.join(" ") };
}

async function applyMetaPause(a: ActionRow, runId: string, targets: Record<MetaResult, number | null>) {
  const { data: claimed } = await db().from("agent_actions").update({ status: "executing", exec_run_id: runId, claimed_at: new Date().toISOString() }).eq("id", a.id).eq("status", "approved").select("id").maybeSingle();
  if (!claimed) return "skipped" as const;
  const done = (patch: Record<string, unknown>) => db().from("agent_actions").update({ executed_at: new Date().toISOString(), ...patch }).eq("id", a.id);
  try {
    const args = a.args_json as unknown as Record<string, unknown>;
    // the fields and the ad id again (a granted action's agent was checked by refuseUngranted); the
    // target is the owner's, read now; the server reads the ad's numbers right before it pauses
    const no = adIdOk(a.target) ? refusePause(args) : "The target is not a Meta ad id.";
    if (no) { await done({ status: "refused", reason: no }); return "refused" as const; }
    const result = args.result as MetaResult;
    const target = targets[result];
    if (target === null) { await done({ status: "refused", reason: `There is no cost per ${RESULT_LABEL[result]} target on Connections (Meta Ads pauses), so nothing is paused on it.` }); return "refused" as const; }
    const out = (await callWriteTool("meta_pauses", "meta_pause_ad", { adId: a.target, result, period: args.period, target })) as { now?: unknown; spend?: unknown; results?: unknown; cost_per_result?: unknown };
    if (out?.now !== "PAUSED") throw new Error("Meta didn't confirm the pause");
    await done({ status: "applied", diff_json: { before: { status: "ACTIVE" }, after: { status: "PAUSED" } }, result_json: { paused: true, spend: out.spend ?? null, results: out.results ?? null, cost_per_result: out.cost_per_result ?? null, target } });
    return "applied" as const;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // no longer over target, or no longer running, is a fresh check refusing it, not a failure
    if (/no longer over its target|isn't running/.test(msg)) { await done({ status: "refused", reason: msg.replace(/^.*?meta_pause_ad: /, "").slice(0, 300) }); return "refused" as const; }
    await done({ status: "failed", reason: msg.slice(0, 300) });
    return "failed" as const;
  }
}
