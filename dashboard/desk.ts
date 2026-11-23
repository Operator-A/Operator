// The day's greeting and summary line on the Company page (docs/department-pages.md, slice 8; was the Desk), counted in code. Pure, so
// `npm run check:chat` can test it.
import type { GoalStatus } from "@/core/goal-rules";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const word = (n: number, lower = false) => { const w = n <= 10 ? WORDS[n] : String(n); return lower ? w.toLowerCase() : w; };

/** "Good morning" before noon in the business's time zone, "Good afternoon" until 5 PM, then "Good evening". */
export function deskGreeting(now: number, tz: string): string {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date(now)));
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/**
 * "Two goals on track, one behind. Three things need you; two wait for Avery’s summary." Card 158: it
 * counts only the four kinds that interrupt (dashboard/needs-rules.ts), then what waits.
 */
export function deskLine(statuses: GoalStatus[], interrupts: number, later: number, chief = "Avery"): string {
  const n = (s: GoalStatus[]) => statuses.filter((x) => s.includes(x)).length;
  const counts: [number, string][] = ([[n(["on_track", "reached", "done"]), "on track"], [n(["behind", "missed"]), "behind"], [n(["no_measure", "unreadable"]), "can’t be measured yet"], [n(["paused"]), "paused"]] as [number, string][]).filter(([c]) => c > 0);
  const goals = !counts.length ? "No goals set yet." : `${counts.map(([c, t], i) => (i ? `${word(c, true)} ${t}` : `${word(c)} goal${c === 1 ? "" : "s"} ${t}`)).join(", ")}.`;
  const asks = interrupts ? `${word(interrupts)} thing${interrupts === 1 ? " needs" : "s need"} you` : "Nothing needs you";
  const wait = later ? `${asks ? "; " : ""}${word(later, true)} ${later === 1 ? "waits" : "wait"} for ${chief}’s summary` : "";
  return `${goals} ${asks}${wait}.`;
}

/** The first sentence of an agent's words, cut to a length, for a tile or a card. */
export function firstSentence(text: string | null | undefined, max = 160): string {
  const t = String(text ?? "").replace(/^\[[^\]]*\]\s*/, "").replace(/\s+/g, " ").trim();
  const m = t.match(/^(.{20,}?[.!?])(\s|$)/);
  const s = m ? m[1] : t;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}
