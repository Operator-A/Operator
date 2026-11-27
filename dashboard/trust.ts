import "server-only";
// Trust levels on the Approvals page (card 7, docs/trust.md): open promotion cards, actions waiting in
// their undo window, and where each agent's kind of action stands. Every number comes from code
// (core/trust.ts, core/trust-rules.ts).
import { db } from "@/core/db";
import { agentNames } from "@/core/org";
import { loadCaps } from "@/core/gateway";
import { ANNOTATE, CALENDAR_HOLD, CAMPAIGN_DRAFT, MAILCHIMP_DRAFT, WOO_NOTE, HUBSPOT_MOVE, META_PAUSE, DRAFT_EMAIL, INVOICE_DRAFT, QBO_CATEGORIZE, SQUARE_INVOICE, SHOPIFY_COPY, SHOPIFY_DISCOUNT, SHOPIFY_REFUND, SHOPIFY_SHIP, SHOPIFY_STOCK, SHOPIFY_TAGS, TOOLS, type ActionDef } from "@/core/gateway/policy";
import { listTrust, standingsOf, TRUST_MISSING } from "@/core/trust";
import { readSpec } from "@/core/agent-spec";
import { LEVEL_WORDS, offerWords, standingWords, type Level } from "@/core/trust-rules";

/** What each write tool is called on a promotion card ("Quinn's receipt and category changes"). */
export const WHAT: Record<string, string> = {
  [ANNOTATE]: "receipt and category changes",
  [DRAFT_EMAIL]: "first-email drafts",
  [CAMPAIGN_DRAFT]: "campaign drafts",
  [SHOPIFY_TAGS]: "Shopify order and customer tags",
  [SHOPIFY_STOCK]: "Shopify stock counts",
  [SHOPIFY_COPY]: "Shopify product copy",
  [SHOPIFY_SHIP]: "Shopify shipped",
  [SHOPIFY_REFUND]: "Shopify refund",
  [SHOPIFY_DISCOUNT]: "Shopify discount code",
  [CALENDAR_HOLD]: "calendar holds",
  [MAILCHIMP_DRAFT]: "Mailchimp campaign drafts",
  [WOO_NOTE]: "order notes",
  [HUBSPOT_MOVE]: "deal moves",
  [META_PAUSE]: "Meta ad pauses",
  [INVOICE_DRAFT]: "Stripe invoice drafts",
  [QBO_CATEGORIZE]: "QuickBooks expense categories",
  [SQUARE_INVOICE]: "Square invoice drafts",
};

export interface TrustLine { agentId: string; tool: string; name: string; what: string; level: Level; levelWords: string; words: string; reason: string | null; changedAt: string | null; clean: number }
export interface TrustOffer { agentId: string; tool: string; text: string }
export interface Scheduled { id: string; agentId: string; name: string; what: string; label: string; executeAfter: string }
export interface TrustView { offers: TrustOffer[]; scheduled: Scheduled[]; lines: TrustLine[]; undoMinutes: number; problem: string | null }

/**
 * Click-speed slice 3: two rounds, whatever the number of agents. Round one reads the caps, agents, their live specs
 * (one query, not one per agent), trust rows and scheduled actions together; round two reads names and every pair's
 * standing at once (core/trust.ts standingsOf). Before, specs were one query per agent and standings two queries per
 * agent and tool, one after another. `only` limits the lines to some agents (a department page).
 */
export async function trustView(only?: readonly string[]): Promise<TrustView> {
  const [caps, agentsRes, defsRes, rows, schedRes] = await Promise.all([
    loadCaps(),
    db().from("agents").select("id"),
    db().from("agent_defs").select("agent_id, spec").eq("active", true),
    listTrust(),
    db().from("agent_actions").select("id, agent_id, tool, target, args_json, execute_after").eq("status", "scheduled").order("execute_after", { ascending: true }).limit(50),
  ]);
  const undoMinutes = caps.undo_window_minutes.value;
  const have = new Set(((agentsRes.data ?? []) as { id: string }[]).map((a) => a.id).filter((a) => !only || only.includes(a)));
  // a granted action type (card 250): the agents whose active spec holds its tool; else the agents it names
  const specTools = new Map<string, string[]>();
  for (const d of (defsRes.data ?? []) as { agent_id: string; spec: unknown }[]) {
    if (!have.has(d.agent_id)) continue;
    try { specTools.set(d.agent_id, readSpec(d.spec, d.agent_id).spec.tools); } catch { specTools.set(d.agent_id, []); }
  }
  const holders = (t: ActionDef) => (t.agents === "granted" ? [...have].filter((a) => !!t.grant && specTools.get(a)?.includes(t.grant)) : t.agents.filter((a) => have.has(a)));
  const pairs = Object.entries(TOOLS).flatMap(([tool, t]) => holders(t as ActionDef).map((agentId) => ({ agentId, tool })));
  const sched = ((schedRes.data ?? []) as { id: string; agent_id: string; tool: string; target: string; args_json: Record<string, unknown>; execute_after: string }[]).filter((a) => !only || only.includes(a.agent_id));
  const [names, standings] = await Promise.all([
    agentNames([...new Set([...pairs.map((p) => p.agentId), ...rows.map((r) => r.agent_id), ...sched.map((a) => a.agent_id)])]),
    standingsOf(pairs, rows),
  ]);
  let problem: string | null = null;
  const lines: TrustLine[] = [];
  for (const s of standings) {
    if (s.error) { problem = s.error; continue; }
    const r = s.row;
    lines.push({ agentId: s.agentId, tool: s.tool, name: names[s.agentId] ?? s.agentId, what: WHAT[s.tool] ?? s.tool, level: s.level, levelWords: LEVEL_WORDS[s.level], words: standingWords(s.level, s.standing), reason: r?.reason ?? null, changedAt: r?.changed_at ?? null, clean: s.standing.kind === "offer" || s.standing.kind === "progress" ? s.standing.clean : 0 });
  }
  const offers = rows.filter((r) => (!only || only.includes(r.agent_id)) && r.offer_level && (TOOLS as Record<string, { promotable: boolean }>)[r.tool]?.promotable).map((r) => {
    const line = lines.find((l) => l.agentId === r.agent_id && l.tool === r.tool);
    const clean = line?.clean ?? 0;
    return { agentId: r.agent_id, tool: r.tool, text: offerWords({ agent: names[r.agent_id] ?? r.agent_id, what: WHAT[r.tool] ?? r.tool, clean, to: r.offer_level as Level, undoMinutes }) };
  });
  const error = schedRes.error;
  if (error && !problem && /execute_after|schema cache|column/.test(error.message)) problem = TRUST_MISSING;
  const scheduled = sched.map((a) => ({
    id: a.id, agentId: a.agent_id, name: names[a.agent_id] ?? a.agent_id, what: WHAT[a.tool] ?? a.tool, executeAfter: a.execute_after,
    label: String(a.args_json?.subject ?? a.args_json?.title ?? a.args_json?.note ?? a.args_json?.category ?? a.target).slice(0, 120),
  }));
  return { offers, scheduled, lines, undoMinutes, problem };
}
