import "server-only";
// Trust levels on the Approvals page (card 7, docs/trust.md): open promotion cards, actions waiting in
// their undo window, and where each agent's kind of action stands. Every number comes from code
// (core/trust.ts, core/trust-rules.ts).
import { db } from "@/core/db";
import { agentNames } from "@/core/org";
import { loadCaps } from "@/core/gateway";
import { ANNOTATE, CALENDAR_HOLD, CAMPAIGN_DRAFT, MAILCHIMP_DRAFT, WOO_NOTE, HUBSPOT_MOVE, META_PAUSE, DRAFT_EMAIL, INVOICE_DRAFT, SHOPIFY_TAGS, TOOLS, type ActionDef } from "@/core/gateway/policy";
import { listTrust, standingOf, TRUST_MISSING } from "@/core/trust";
import { loadSpec } from "@/core/agent-spec";
import { LEVEL_WORDS, offerWords, standingWords, type Level } from "@/core/trust-rules";

/** What each write tool is called on a promotion card ("Quinn's receipt and category changes"). */
export const WHAT: Record<string, string> = {
  [ANNOTATE]: "receipt and category changes",
  [DRAFT_EMAIL]: "first-email drafts",
  [CAMPAIGN_DRAFT]: "campaign drafts",
  [SHOPIFY_TAGS]: "Shopify order and customer tags",
  [CALENDAR_HOLD]: "calendar holds",
  [MAILCHIMP_DRAFT]: "Mailchimp campaign drafts",
  [WOO_NOTE]: "order notes",
  [HUBSPOT_MOVE]: "deal moves",
  [META_PAUSE]: "Meta ad pauses",
  [INVOICE_DRAFT]: "Stripe invoice drafts",
};

export interface TrustLine { agentId: string; tool: string; name: string; what: string; level: Level; levelWords: string; words: string; reason: string | null; changedAt: string | null; clean: number }
export interface TrustOffer { agentId: string; tool: string; text: string }
export interface Scheduled { id: string; agentId: string; name: string; what: string; label: string; executeAfter: string }
export interface TrustView { offers: TrustOffer[]; scheduled: Scheduled[]; lines: TrustLine[]; undoMinutes: number; problem: string | null }

export async function trustView(): Promise<TrustView> {
  const undoMinutes = (await loadCaps()).undo_window_minutes.value;
  const { data: agents } = await db().from("agents").select("id");
  const have = new Set((agents ?? []).map((a) => a.id as string));
  // a granted action type (card 250): the agents whose active spec holds its tool; else the agents it names
  const specTools = new Map(await Promise.all([...have].map(async (id) => [id, (await loadSpec(id).catch(() => null))?.spec.tools ?? []] as const)));
  const holders = (t: ActionDef) => (t.agents === "granted" ? [...have].filter((a) => !!t.grant && specTools.get(a)?.includes(t.grant)) : t.agents.filter((a) => have.has(a)));
  const pairs = Object.entries(TOOLS).flatMap(([tool, t]) => holders(t as ActionDef).map((agentId) => ({ agentId, tool })));
  const names = await agentNames([...new Set(pairs.map((p) => p.agentId))]);
  const rows = await listTrust();
  const rowOf = (a: string, t: string) => rows.find((r) => r.agent_id === a && r.tool === t) ?? null;
  let problem: string | null = null;
  const lines: TrustLine[] = [];
  for (const p of pairs) {
    const r = rowOf(p.agentId, p.tool);
    try {
      const s = await standingOf(p.agentId, p.tool, r);
      lines.push({ ...p, name: names[p.agentId] ?? p.agentId, what: WHAT[p.tool] ?? p.tool, level: s.level, levelWords: LEVEL_WORDS[s.level], words: standingWords(s.level, s.standing), reason: r?.reason ?? null, changedAt: r?.changed_at ?? null, clean: s.standing.kind === "offer" || s.standing.kind === "progress" ? s.standing.clean : 0 });
    } catch (e) { problem = e instanceof Error ? e.message : String(e); }
  }
  const offers = rows.filter((r) => r.offer_level && (TOOLS as Record<string, { promotable: boolean }>)[r.tool]?.promotable).map((r) => {
    const line = lines.find((l) => l.agentId === r.agent_id && l.tool === r.tool);
    const clean = line?.clean ?? 0;
    return { agentId: r.agent_id, tool: r.tool, text: offerWords({ agent: names[r.agent_id] ?? r.agent_id, what: WHAT[r.tool] ?? r.tool, clean, to: r.offer_level as Level, undoMinutes }) };
  });
  const { data: sched, error } = await db().from("agent_actions").select("id, agent_id, tool, target, args_json, execute_after").eq("status", "scheduled").order("execute_after", { ascending: true }).limit(50);
  if (error && !problem && /execute_after|schema cache|column/.test(error.message)) problem = TRUST_MISSING;
  const scheduled = ((sched ?? []) as { id: string; agent_id: string; tool: string; target: string; args_json: Record<string, unknown>; execute_after: string }[]).map((a) => ({
    id: a.id, agentId: a.agent_id, name: names[a.agent_id] ?? a.agent_id, what: WHAT[a.tool] ?? a.tool, executeAfter: a.execute_after,
    label: String(a.args_json?.subject ?? a.args_json?.title ?? a.args_json?.note ?? a.args_json?.category ?? a.target).slice(0, 120),
  }));
  return { offers, scheduled, lines, undoMinutes, problem };
}
