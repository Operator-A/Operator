import "server-only";
// Live events (docs/live-events.md, slice 1): what happens to a signed event, as the business it was
// sent to (the hook route wraps everything here in withOrg). The rules are in core/event-rules.ts; the
// signature is checked in integrations/mcp.ts before anything here runs.
//
// An event only starts chains the owner saved with that event as their start, and only while the org
// and the chain are on; each start is a job like any other (core/chain.ts startStep), so the run goes
// through withRun. A chain starts on events at most EVENT_CAPS times an hour and a day; events past
// that are held, and the scheduler starts one catch-up run for them.
import { loadCrew } from "@/agents/registry";
import { claimFiring, startStep } from "@/core/chain";
import { db } from "@/core/db";
import { loadFlow, type Chain } from "@/core/flow";
import { EVENT_BY_TYPE, KEEP_DAYS, outcomeLine, startTakes, underCap, type EventFacts, type EventSource, type EventStart, type EventType } from "@/core/event-rules";
import { orgOn } from "@/core/org-switch";

const HOUR = 3600_000, DAY = 24 * HOUR;

/** Keeps a signed event. Null when the service already sent it (a retry): it never starts a chain twice. */
export async function keepEvent(source: EventSource, providerId: string, facts: EventFacts): Promise<string | null> {
  const { data, error } = await db().from("inbound_events").insert({ source, event_type: facts.type, provider_id: providerId, facts }).select("id").single();
  if (error) { if (error.code === "23505") return null; throw new Error(error.message); }
  return data.id as string;
}

const isEventChain = (c: Chain): c is Chain & { start: EventStart } => c.start.type === "event";

/** How often a chain started in the last hour and day. Event chains have no schedule, so every chain_fires row of one is an event start. */
async function fireCounts(key: string, now: number): Promise<{ hour: number; day: number }> {
  const count = async (since: number) => {
    const { count: n, error } = await db().from("chain_fires").select("chain_key", { count: "exact", head: true }).eq("chain_key", key).gte("fire_at", new Date(since).toISOString());
    if (error) throw new Error(error.message);
    return n ?? 0;
  };
  const [hour, day] = await Promise.all([count(now - HOUR), count(now - DAY)]);
  return { hour, day };
}

/** Claims an event start in chain_fires (one row per start, so the caps can count them). */
async function claimStart(key: string, at: number, chainId: string): Promise<boolean> {
  // two events in the same millisecond each get their own row
  for (let i = 0; i < 5; i++) if (await claimFiring(key, at + i, chainId)) return true;
  return false;
}

/**
 * Starts the chains a kept event matches, holds it for those at their cap, or (org off) only says what
 * would have started. Writes what happened on the event's row. Runs after the service has its answer.
 */
export async function startForEvent(origin: string, id: string, facts: EventFacts, now = Date.now()): Promise<string> {
  const flow = await loadFlow(await loadCrew());
  const on = await orgOn();
  const started: string[] = [], held: string[] = [], heldKeys: string[] = [], wouldStart: string[] = [];
  for (const c of flow.flow.chains) {
    if (!c.on || !isEventChain(c) || !startTakes(c.start, facts)) continue;
    // while the org is off nothing starts on its own, an event start included
    if (!on) { wouldStart.push(c.name); continue; }
    const n = await fireCounts(c.key, now);
    if (!underCap(n.hour, n.day)) { held.push(c.name); heldKeys.push(c.key); continue; }
    const chainId = crypto.randomUUID();
    if (!(await claimStart(c.key, now, chainId))) continue;
    await startStep(origin, c, { chainId, key: c.key, step: 0, event: id });
    started.push(c.name);
  }
  const outcome = outcomeLine({ started, held, wouldStart });
  const { error } = await db().from("inbound_events").update({ outcome, held: heldKeys }).eq("id", id);
  if (error) console.error("[events] outcome", error.message);
  return outcome;
}

/**
 * The scheduler's part: for each event chain with held events from the last day and room under its cap,
 * one catch-up run handed the newest of them and how many more came in. Returns the chains started.
 */
export async function catchUpHeld(origin: string, now = Date.now()): Promise<string[]> {
  if (!(await orgOn())) return [];
  const flow = await loadFlow(await loadCrew());
  const out: string[] = [];
  for (const c of flow.flow.chains) {
    if (!c.on || !isEventChain(c)) continue;
    const { data, error } = await db().from("inbound_events").select("id, held").contains("held", [c.key]).gte("received_at", new Date(now - DAY).toISOString()).order("received_at", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { id: string; held: string[] }[];
    if (!rows.length) continue;
    const n = await fireCounts(c.key, now);
    if (!underCap(n.hour, n.day)) continue;
    const chainId = crypto.randomUUID();
    if (!(await claimStart(c.key, now, chainId))) continue;
    await startStep(origin, c, { chainId, key: c.key, step: 0, event: rows[0].id, held: rows.length - 1 });
    for (const r of rows) await db().from("inbound_events").update({ held: r.held.filter((k) => k !== c.key) }).eq("id", r.id);
    out.push(`${c.name} (catch-up for ${rows.length} event${rows.length === 1 ? "" : "s"})`);
  }
  return out;
}

/** Drops event rows older than KEEP_DAYS. Returns how many. */
export async function pruneEvents(now = Date.now()): Promise<number> {
  const { data, error } = await db().from("inbound_events").delete().lt("received_at", new Date(now - KEEP_DAYS * DAY).toISOString()).select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export interface EventRow { id: string; label: string; at: string; outcome: string | null; test: boolean; held: number }

/** The newest events, for Status. */
export async function recentEvents(limit = 20): Promise<EventRow[]> {
  const { data, error } = await db().from("inbound_events").select("id, event_type, facts, outcome, held, received_at").order("received_at", { ascending: false }).limit(limit);
  if (error) return [];
  return (data ?? []).map((r) => ({
    id: r.id as string,
    label: EVENT_BY_TYPE[r.event_type as EventType]?.label ?? String(r.event_type),
    at: r.received_at as string,
    outcome: (r.outcome as string | null) ?? null,
    test: (r.facts as EventFacts | null)?.test === true,
    held: ((r.held as string[] | null) ?? []).length,
  }));
}
