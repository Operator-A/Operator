// What reaches an agent and where its result goes (card 400): the agent sheet's hand-off rows and its Can do
// grouped by tool. No database access, so scripts/check-handoff.ts can check it on a small chart.
import { daySet, type Chain, type Days } from "@/core/flow-rules";
import { companySeat, headOf, seatOf, type Org } from "@/core/org-rules";
import { t12 } from "./format";
import { schedWords } from "./schedule";
import type { Schedule } from "./crew";

/** One multi-agent chain an agent is a step of, as the sheet's "When it runs" draws it. */
export interface HandChain {
  key: string; name: string; on: boolean;
  nodes: { id: string; name: string; at: string; me: boolean }[];
  /** The step before this agent's, and whether it hands its summary over; null when the agent starts the chain. */
  prev: { name: string; passAlong: boolean } | null;
  /** The step after, and whether this agent's summary goes to it. */
  next: { name: string; passAlong: boolean } | null;
}

const DAY_SHORT: Record<string, string> = { daily: "daily", weekdays: "weekdays", mondays: "Mondays" };
const daysShort = (d: Days) => DAY_SHORT[d] ?? daySet(d).map((i) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][i]).join(" ");

/** The chains with two or more agents that `id` is a step of, each with its agents in order. */
export function chainsOf(id: string, chains: readonly Chain[], names: Record<string, string>): HandChain[] {
  return chains.filter((c) => c.steps.length > 1 && c.steps.some((s) => s.agent === id)).map((c) => {
    const k = c.steps.findIndex((s) => s.agent === id);
    const startAt = c.start.type === "schedule" ? `${t12(c.start.time)} ${daysShort(c.start.days)}` : c.start.type === "button" ? "Run chain" : c.start.type === "event" ? "a live event" : "an approval";
    const nodes = c.steps.map((s, i) => {
      const at = i === 0 ? startAt : [s.days ? daysShort(s.days) : "", s.notBefore ? `not before ${t12(s.notBefore)}` : ""].filter(Boolean).join(", ");
      return { id: s.agent, name: names[s.agent] ?? s.agent, at, me: s.agent === id };
    });
    const after = c.steps[k + 1];
    return {
      key: c.key, name: c.name, on: c.on, nodes,
      prev: k > 0 ? { name: nodes[k - 1].name, passAlong: !!c.steps[k].passAlong } : null,
      next: after ? { name: names[after.agent] ?? after.agent, passAlong: !!after.passAlong } : null,
    };
  });
}

/** A quarter hour before "HH:MM" (never before midnight). */
export function quarterBefore(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const n = Math.max(0, h * 60 + m - 15);
  return `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
}

export type HeadState = "before" | "after" | "none" | "open" | "you";
export interface HeadRow {
  deptId: string; deptName: string;
  /** The head agent, or null when the seat is open or held by the owner. */
  head: { id: string; name: string } | null;
  /** When the head runs ("Weekdays 7:15 AM"), or null. */
  when: string | null;
  state: HeadState;
  /** The schedule a "Give it a time" fills in: a quarter hour before the reader, on its days. Null when not needed. */
  fill: { time: string; days: number[] } | null;
}

/**
 * Each department's head as the company seat's agent sees them through Department reports: whether the
 * head runs before it (its report is there), after it (yesterday's), not at all, or the seat is open.
 */
export function headRows(o: Org, me: Schedule, schedules: Record<string, Schedule>, names: Record<string, string>): HeadRow[] {
  const mine = me.kind !== "manual" && me.time ? me.time : null;
  return [...o.departments].sort((a, b) => a.sort - b.sort).map((d) => {
    const s = headOf(o, d.id);
    if (!s || s.holder !== "agent" || !s.agentId) return { deptId: d.id, deptName: d.name, head: null, when: null, state: s?.holder === "owner" ? "you" : "open", fill: null };
    const hs = schedules[s.agentId];
    const runs = hs && hs.kind !== "manual" && hs.time ? hs : null;
    const fill = mine ? { time: quarterBefore(mine), days: daySet(me.kind as Days) } : { time: "07:00", days: [1, 2, 3, 4, 5] };
    const state: HeadState = !runs ? "none" : !mine || runs.time! < mine ? "before" : "after";
    return { deptId: d.id, deptName: d.name, head: { id: s.agentId, name: names[s.agentId] ?? s.agentId }, when: runs ? schedWords(runs) : null, state, fill: state === "before" ? null : fill };
  });
}

/** Where a department head's report goes: the company seat's agent, if it reads Department reports. */
export interface UpTo { id: string; name: string; when: string | null; state: "before" | "after" | "none" | "reader_manual"; fill: { time: string; days: number[] } | null }

export function upTo(o: Org, id: string, me: Schedule, schedules: Record<string, Schedule>, names: Record<string, string>, readsReports: (agentId: string) => boolean): UpTo | null {
  const seat = seatOf(o, id);
  if (!seat || !seat.departmentId || seat.parentId != null) return null;
  const c = companySeat(o);
  if (!c || c.holder !== "agent" || !c.agentId || c.agentId === id || !readsReports(c.agentId)) return null;
  const rs = schedules[c.agentId];
  const reader = rs && rs.kind !== "manual" && rs.time ? rs : null;
  const mine = me.kind !== "manual" && me.time ? me.time : null;
  const state = !reader ? "reader_manual" : !mine ? "none" : mine < reader.time! ? "before" : "after";
  return {
    id: c.agentId, name: names[c.agentId] ?? c.agentId, when: reader ? schedWords(reader) : null, state,
    fill: reader && state !== "before" ? { time: quarterBefore(reader.time!), days: daySet(reader.kind as Days) } : null,
  };
}

/** A sheet link with a schedule filled in (not saved): `at` is HH:MM and `days` the weekday digits. */
export const fillQuery = (f: { time: string; days: number[] }) => `&at=${f.time}&days=${f.days.join("")}`;

/** Reads a filled-in schedule from the address, or null when it isn't a quarter-hour time and a day set. */
export function readFill(at: unknown, days: unknown): { time: string; days: number[] } | null {
  if (typeof at !== "string" || !/^([01]\d|2[0-3]):(00|15|30|45)$/.test(at)) return null;
  if (typeof days !== "string" || !/^[0-6]{1,7}$/.test(days)) return null;
  return { time: at, days: [...new Set(days.split("").map(Number))].sort((a, b) => a - b) };
}

// ---- Can do, by tool

export interface CanChoice { id: string; label: string; on: boolean; ready: boolean; why?: string; conn: string }
export interface CanGroup { conn: string; name: string; connected: boolean; items: CanChoice[] }

/**
 * Can do grouped by the tool each action belongs to. Connected tools come first (in the order given), then
 * the tools not connected; a tool with an action already on counts as shown even when it isn't connected.
 */
export function canGroups(can: readonly CanChoice[], connName: (conn: string) => string): { shown: CanGroup[]; later: CanGroup[] } {
  const by = new Map<string, CanChoice[]>();
  for (const c of can) by.set(c.conn, [...(by.get(c.conn) ?? []), c]);
  const groups = [...by.entries()].map(([conn, items]) => ({ conn, name: connName(conn), connected: items.some((i) => i.why !== "Not connected"), items }));
  return { shown: groups.filter((g) => g.connected || g.items.some((i) => i.on)), later: groups.filter((g) => !g.connected && !g.items.some((i) => i.on)) };
}

/** Settings > Schedule with the chains fold open and this chain picked. */
export const chainHref = (key: string) => `/settings/schedule?chain=${encodeURIComponent(key)}#chains`;
