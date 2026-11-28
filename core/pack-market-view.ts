// What the Packs page's browser side needs (packs slice 4): the card shape, search and filters, and the cost line.
// Kept apart from core/pack-market-rules.ts, which reads the pack files and the tool catalog, so the page's client
// code doesn't pull those in. Pure.
import { usd } from "@/core/cost-rules";

export type PackKind = "department" | "agent";
export interface PackTag { text: string; tone: "" | "ok" | "warn" | "acc" }
export interface PackCost { month: number; perRun: number; atMost: number; byHand: boolean; unknown: boolean }
/** A card on the Packs page. */
export interface MarketCard {
  id: string; kind: PackKind; name: string; about: string; letter: string; hue: string; tags: PackTag[];
  /** The connections it reads, for the Works with filter (tool tile ids). */
  tiles: string[];
  /** Lower-case words search matches: name, about, roles, seats. */
  words: string;
  cost: PackCost;
}
export interface MarketFilter { q: string; kind: "all" | PackKind; tile: string | null }

/** The cards a search and filters leave, in the same order. */
export function matchCards(cards: readonly MarketCard[], f: MarketFilter): MarketCard[] {
  const q = f.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return cards.filter((c) => (f.kind === "all" || c.kind === f.kind) && (!f.tile || c.tiles.includes(f.tile)) && q.every((w) => c.words.includes(w)));
}
/** "Nothing matches" in words: what was searched, among which packs. */
export function noMatchWords(f: MarketFilter, tileName: string | null): string {
  const q = f.q.trim().slice(0, 60);
  if (!q && f.kind === "all" && !tileName) return "No pack matches.";
  const among = f.kind === "department" ? "department packs" : f.kind === "agent" ? "agent packs" : "packs";
  return `No pack matches${q ? ` “${q}”` : ""} among ${among}${tileName ? ` that work with ${tileName}` : ""}.`;
}
/** "About $1.30 a month", or "About $0.40 a run" when nothing in it is scheduled. */
export function costWords(c: PackCost): string {
  if (c.unknown && !c.perRun) return "Cost unknown";
  return c.byHand ? `About ${usd(c.perRun)} a run` : `About ${usd(c.month)} a month`;
}
/** Where a pack's page lives. */
export const packHref = (id: string) => `/packs/${encodeURIComponent(id)}`;
/** The Packs page, maybe filtered to one kind. */
export const packsHref = (kind?: PackKind) => (kind ? `/packs?kind=${kind}` : "/packs");
