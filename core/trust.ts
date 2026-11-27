import "server-only";
// Trust levels (card 7, docs/trust.md): reading and changing the level each agent has earned for each
// write tool, through db() (scoped to the org). The rules are in core/trust-rules.ts. Only the gateway
// and the Control Room's server actions call this. A level goes up only through acceptOffer, which only
// an owner's tap on a promotion card calls; it goes down through demote.
import { db } from "@/core/db";
import { TOOLS, type ToolName } from "@/core/gateway/policy";
import { demotes, effectiveLevel, isLevel, isRejectKind, standing, type Level, type Outcome, type RejectKind, type Standing } from "@/core/trust-rules";

export interface TrustRow {
  agent_id: string; tool: string; level: Level; changed_at: string; changed_by: string; reason: string | null;
  offer_level: Level | null; offer_at: string | null; declined_at: string | null;
}
const COLS = "agent_id, tool, level, changed_at, changed_by, reason, offer_level, offer_at, declined_at";
export const TRUST_MISSING = "The trust levels table isn’t in Supabase yet: apply the migration 20261225090000_trust_levels.sql.";
const missing = (m: string) => (/trust_levels|reject_kind|execute_after|cancel_kind|schema cache/.test(m) ? TRUST_MISSING : m);
const promotable = (tool: string) => !!(TOOLS as Record<string, { promotable: boolean }>)[tool]?.promotable;

/** Every stored level. Empty before the migration, so every action stays at Draft. */
export async function listTrust(): Promise<TrustRow[]> {
  const { data, error } = await db().from("trust_levels").select(COLS).limit(500);
  if (error) return [];
  return (data ?? []) as TrustRow[];
}

async function rowOf(agentId: string, tool: string): Promise<TrustRow | null> {
  const { data, error } = await db().from("trust_levels").select(COLS).eq("agent_id", agentId).eq("tool", tool).maybeSingle();
  if (error) return null;
  return (data as TrustRow | null) ?? null;
}

/** The level an action of this agent and tool runs at now: Draft without a row, and always Draft for a tool never promoted. */
export async function levelOf(agentId: string, tool: ToolName): Promise<Level> {
  return effectiveLevel((await rowOf(agentId, tool))?.level, promotable(tool));
}

interface Dated extends Outcome { at: string }

/** Decided outcomes at this level since it last changed, newest first (core/trust-rules.ts Outcome). */
async function outcomes(agentId: string, tool: string, level: Level, since: string | null): Promise<Dated[]> {
  if (level === "draft") {
    let q = db().from("approvals").select("action_id, status, reject_kind, decided_at").eq("agent_id", agentId).in("status", ["approved", "edited", "rejected"]).order("decided_at", { ascending: false }).limit(120);
    if (since) q = q.gt("decided_at", since);
    const { data, error } = await q;
    if (error) throw new Error(missing(error.message));
    const rows = (data ?? []) as { action_id: string; status: string; reject_kind: string | null; decided_at: string }[];
    if (!rows.length) return [];
    const { data: acts, error: e2 } = await db().from("agent_actions").select("id").eq("tool", tool).in("id", rows.map((r) => r.action_id));
    if (e2) throw new Error(e2.message);
    const mine = new Set((acts ?? []).map((a) => a.id as string));
    return rows.filter((r) => mine.has(r.action_id)).map((r) => ({ clean: r.status === "approved", kind: r.status === "rejected" ? (isRejectKind(r.reject_kind) ? r.reject_kind : "other") : null, at: r.decided_at }));
  }
  let q = db().from("agent_actions").select("status, cancel_kind, decided_at, created_at").eq("agent_id", agentId).eq("tool", tool).eq("level", level).in("status", ["applied", "cancelled"]).order("created_at", { ascending: false }).limit(120);
  if (since) q = q.gt("created_at", since);
  const { data, error } = await q;
  if (error) throw new Error(missing(error.message));
  return ((data ?? []) as { status: string; cancel_kind: string | null; decided_at: string | null; created_at: string }[])
    .map((r) => ({ clean: r.status === "applied", kind: r.status === "cancelled" ? (isRejectKind(r.cancel_kind) ? r.cancel_kind : "other") : null, at: r.decided_at ?? r.created_at }));
}

/** Where this agent's tool stands on the way up, worked out in code from its record. */
export async function standingOf(agentId: string, tool: string, row?: TrustRow | null): Promise<{ level: Level; standing: Standing; row: TrustRow | null }> {
  const r = row === undefined ? await rowOf(agentId, tool) : row;
  const level = effectiveLevel(r?.level, promotable(tool));
  const list = await outcomes(agentId, tool, level, r?.changed_at ?? null);
  const sinceDecline = r?.declined_at ? list.filter((o) => o.at > r.declined_at!).length : null;
  return { level, row: r, standing: standing({ level, promotable: promotable(tool), outcomes: list, sinceDecline }) };
}

/**
 * Where many agent and tool pairs stand at once (click-speed slice 3): the same answer as standingOf for each pair, in
 * one round. Pairs at Draft read their agent's decided approvals once per agent, with each action's tool alongside,
 * instead of two queries per pair one after another. Each approvals read takes the oldest `since` among that agent's
 * pairs, so every pair's newest 120 are in it (newer rows come first). A pair that fails carries its error.
 */
export async function standingsOf(pairs: { agentId: string; tool: string }[], rows: TrustRow[]): Promise<{ agentId: string; tool: string; level: Level; standing: Standing; row: TrustRow | null; error?: string }[]> {
  const rowFor = (a: string, t: string) => rows.find((r) => r.agent_id === a && r.tool === t) ?? null;
  const items = pairs.map((p) => { const row = rowFor(p.agentId, p.tool); return { ...p, row, level: effectiveLevel(row?.level, promotable(p.tool)) }; });
  type Decided = { action_id: string; status: string; reject_kind: string | null; decided_at: string; agent_actions: { tool: string } | { tool: string }[] | null };
  const draftAgents = [...new Set(items.filter((i) => i.level === "draft").map((i) => i.agentId))];
  const byAgent = new Map<string, Decided[] | Error>(await Promise.all(draftAgents.map(async (a) => {
    const sinces = items.filter((i) => i.agentId === a && i.level === "draft").map((i) => i.row?.changed_at ?? null);
    const since = sinces.includes(null) ? null : (sinces as string[]).sort()[0];
    let q = db().from("approvals").select("action_id, status, reject_kind, decided_at, agent_actions(tool)").eq("agent_id", a).in("status", ["approved", "edited", "rejected"]).order("decided_at", { ascending: false }).limit(120);
    if (since) q = q.gt("decided_at", since);
    const { data, error } = await q;
    return [a, error ? new Error(missing(error.message)) : ((data ?? []) as Decided[])] as const;
  })));
  const toolOf = (d: Decided) => (Array.isArray(d.agent_actions) ? d.agent_actions[0]?.tool : d.agent_actions?.tool) ?? null;
  return Promise.all(items.map(async (i) => {
    try {
      let list: Dated[];
      if (i.level === "draft") {
        const got = byAgent.get(i.agentId);
        if (got instanceof Error) throw got;
        const since = i.row?.changed_at ?? null;
        list = (got ?? []).filter((d) => (!since || d.decided_at > since) && toolOf(d) === i.tool)
          .map((d) => ({ clean: d.status === "approved", kind: d.status === "rejected" ? (isRejectKind(d.reject_kind) ? d.reject_kind : "other") : null, at: d.decided_at }));
      } else list = await outcomes(i.agentId, i.tool, i.level, i.row?.changed_at ?? null);
      const sinceDecline = i.row?.declined_at ? list.filter((o) => o.at > i.row!.declined_at!).length : null;
      return { agentId: i.agentId, tool: i.tool, level: i.level, row: i.row, standing: standing({ level: i.level, promotable: promotable(i.tool), outcomes: list, sinceDecline }) };
    } catch (e) {
      return { agentId: i.agentId, tool: i.tool, level: i.level, row: i.row, standing: standing({ level: i.level, promotable: promotable(i.tool), outcomes: [], sinceDecline: null }), error: e instanceof Error ? e.message : String(e) };
    }
  }));
}

/** After a decision: opens a promotion card when the record earns one. Never moves a level by itself. */
export async function refreshOffer(agentId: string, tool: string): Promise<boolean> {
  const { level, standing: s, row } = await standingOf(agentId, tool);
  if (s.kind !== "offer" || row?.offer_level) return false;
  const now = new Date().toISOString();
  const { error } = await db().from("trust_levels").upsert({ agent_id: agentId, tool, level, changed_at: row?.changed_at ?? now, changed_by: row?.changed_by ?? "system", reason: row?.reason ?? null, offer_level: s.to, offer_at: now, declined_at: row?.declined_at ?? null }, { onConflict: "org_id,agent_id,tool" });
  if (error) throw new Error(missing(error.message));
  return true;
}

/** Open promotion cards. */
export async function openOffers(): Promise<TrustRow[]> {
  return (await listTrust()).filter((r) => r.offer_level && promotable(r.tool));
}

/**
 * The owner accepted a promotion card: the level moves up one, only if the record still earns exactly
 * that step (checked again here, in code). The count starts again from the new level.
 */
export async function acceptOffer(agentId: string, tool: string, by: string): Promise<Level> {
  const { level, standing: s, row } = await standingOf(agentId, tool);
  if (!row?.offer_level) throw new Error("That promotion isn’t open any more.");
  if (s.kind !== "offer" || s.to !== row.offer_level) {
    await db().from("trust_levels").update({ offer_level: null, offer_at: null }).eq("agent_id", agentId).eq("tool", tool);
    throw new Error("Its record changed since the card was made, so the promotion was withdrawn.");
  }
  const { data, error } = await db().from("trust_levels").update({ level: s.to, changed_at: new Date().toISOString(), changed_by: by.slice(0, 120), reason: `Promoted from ${level} after ${s.clean} of the last 30 clean.`, offer_level: null, offer_at: null, declined_at: null })
    .eq("agent_id", agentId).eq("tool", tool).eq("level", level).eq("offer_level", s.to).select("level");
  if (error) throw new Error(missing(error.message));
  if (!data?.length) throw new Error("That promotion was already decided.");
  return s.to;
}

/** "Not yet": the card closes, and is offered again after TRUST.cooldown more decisions. */
export async function declineOffer(agentId: string, tool: string): Promise<void> {
  const { error } = await db().from("trust_levels").update({ offer_level: null, offer_at: null, declined_at: new Date().toISOString() }).eq("agent_id", agentId).eq("tool", tool);
  if (error) throw new Error(missing(error.message));
}

/**
 * Back to Draft, at once: a wrong or policy rejection or cancel, a cap breach, a breaker, or the owner's
 * own tap. Any open promotion card closes, and whatever was still waiting in the undo window for this
 * agent and tool is cancelled, so nothing goes out at the old level; the agent proposes it again.
 */
export async function demote(agentId: string, tool: string, why: string, by = "system"): Promise<boolean> {
  const row = await rowOf(agentId, tool);
  if (!row) return false; // no row: already Draft, with no card open
  if (row.level === "draft" && !row.offer_level) return false;
  const { error } = await db().from("trust_levels").update({
    level: "draft", offer_level: null, offer_at: null,
    ...(row.level !== "draft" ? { changed_at: new Date().toISOString(), changed_by: by.slice(0, 120), reason: why.slice(0, 300) } : {}),
  }).eq("agent_id", agentId).eq("tool", tool);
  if (error) throw new Error(missing(error.message));
  await db().from("agent_actions").update({ status: "cancelled", decided_at: new Date().toISOString(), reason: "Back to Draft before its undo window ended." })
    .eq("agent_id", agentId).eq("tool", tool).eq("status", "scheduled");
  return row.level !== "draft";
}

/** After an approval decision or a cancel: a wrong or policy one drops the type back to Draft, any other may open a card. Never throws. */
export async function afterDecision(agentId: string, tool: string, kind: RejectKind | null, by: string): Promise<string> {
  try {
    if (demotes(kind)) return (await demote(agentId, tool, `Marked “${kind === "wrong" ? "it got this wrong" : "against the rules"}” by ${by}.`, by)) ? " Back to Draft: every one waits for you again." : "";
    return (await refreshOffer(agentId, tool)) ? " It has earned a promotion: see Approvals." : "";
  } catch { return ""; }
}

export { isLevel };
