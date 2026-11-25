// How a business's agents think (card 162): with its own Claude key, billed by Anthropic, or on the
// hosted edition's Claude paid from managed credits (card 128 slice 4). Setup step 1 and Connections
// let the founder choose. Pure: no database, no network, so scripts/check-claude-choice.ts tests it.
//
// Which option is offered is only about the edition: the open edition has no hosted Claude, so it
// offers the own key alone. Whether a run may use the hosted key is decided by the paid layer
// (pooledKey); this file only reads that answer as a yes or no.

import type { ClaudeVia } from "@/core/model-key-rules";
import { CREDITS_MARGIN } from "@/core/cost-rules";

export type ClaudeChoice = "hosted" | "own";
export type Edition = "open" | "cloud";

/** What the business has now. hostedReady: the paid layer would hand a run the hosted key (credits, a plan that allows runs). */
export interface ClaudeState {
  edition: Edition; ownKey: boolean; ownKeyPaused: boolean; hostedReady: boolean;
  /** The AI Gateway key is saved and not paused (conductor ticket 1b): Claude runs go through it first. */
  gateway?: boolean;
  /** With both keys saved, which goes first (core/claude-via.ts); read only then. */
  via?: ClaudeVia;
}

/** The options an edition offers, the recommended one first. */
export const claudeOptions = (edition: Edition): readonly ClaudeChoice[] => (edition === "cloud" ? ["hosted", "own"] : ["own"]);

/** Reads the founder's tap from the page's query: only an option this edition offers counts. */
export function readChoice(edition: Edition, raw: unknown): ClaudeChoice | null {
  return typeof raw === "string" && (claudeOptions(edition) as readonly string[]).includes(raw) ? (raw as ClaudeChoice) : null;
}

/** The option shown open: the founder's tap, else the one in use (a key comes first, as in runs), else the first offered. */
export function pickedChoice(s: ClaudeState, raw: unknown): ClaudeChoice {
  const tapped = readChoice(s.edition, raw);
  if (tapped) return tapped;
  if (s.ownKey) return "own";
  return claudeOptions(s.edition)[0];
}

/** What runs use now: the business's own key when it has one (even paused: it is never skipped for credits), else hosted on the cloud. */
export const inUse = (s: ClaudeState): ClaudeChoice | null => (s.ownKey ? "own" : s.edition === "cloud" && s.hostedReady ? "hosted" : null);

/** True when agents can think now: an own key that works, or (with no key) the hosted Claude on the cloud edition. */
export function claudeReady(s: ClaudeState): boolean {
  if (s.gateway) return true;
  if (s.ownKey) return !s.ownKeyPaused;
  return s.edition === "cloud" && s.hostedReady;
}

export const CHOICE_WORDS: Record<ClaudeChoice, { title: string; line: string }> = {
  hosted: { title: "Use OPERATOR’s Claude", line: `Nothing to set up. Pay as you go from prepaid credits: each run costs its model price plus ${Math.round((CREDITS_MARGIN - 1) * 100)}%.` },
  own: { title: "Use your own Claude key", line: "Paste a key from the Claude Console. Anthropic bills you directly for every run." },
};
