import "server-only";
// The shared brain, slice 4 (docs/shared-brain.md, card 233): Avery's two tools for it, offered in the
// setup interview and in chat.
//
// - Businesses like yours (read): she names a topic from a fixed list (BRAIN_TOPICS), nothing else.
//   The cloud edition answers through the similarBusinesses slot with counts said by code from the live
//   count and lessons from OPERATOR's playbook. The open edition has no shared brain, so the tool isn't
//   offered. Code, not the model, shows the founder what she was given (similarNote).
// - Kind of business (report, setup only): she picks one from BUSINESS_KINDS; code saves it after a run
//   that finishes, and only when the owner hasn't picked one on Settings > Shared brain.
import { edition, similarBusinesses } from "@/core/extensions";
import { brainSettings, savedSnapshot, saveBrainSettings } from "@/core/brain";
import { BRAIN_TOPICS, BUSINESS_KINDS, KIND_WORDS, isKind, isTopic, whyFor, workedBlock, workedNote, type BrainTopic, type Similar, type SimilarLesson } from "@/core/brain-rules";
import { TOOL_CATEGORIES, partWords } from "@/core/tools-step-rules";
import type { ToolDef } from "@/core/tools/types";

export const SIMILAR_TOOL = "businesses_like_yours";
export const KIND_TOOL = "set_business_kind";

/** Businesses like yours, or null when there is no shared brain (the open edition). `held` keeps what came back, for the note. */
export function similarTool(held: { got: Similar[] }): ToolDef | null {
  if (edition() !== "cloud") return null;
  return {
    id: SIMILAR_TOOL, label: "Businesses like yours",
    detail: "What other businesses on OPERATOR like this one found: counts shared by at least five businesses (never one business), and lessons from OPERATOR's playbook. Use it before you recommend departments, tools or how to run approvals. Quote a count exactly as given, never work out a new number, and say the playbook is OPERATOR's advice. When it returns nothing, say there's nothing to compare with yet",
    kind: "read", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [{
      name: "topic", type: "enum", options: [...BRAIN_TOPICS],
      description: `starting: which departments and tools to begin with. approvals: drafts approved unedited and action types that earn trust. Or one part of the business: ${TOOL_CATEGORIES.map(partWords).join(", ")}.`,
    }],
    run: async (input) => {
      if (!isTopic(input.topic)) return { data: { problem: "pick a topic from the list" } };
      const r = await similarLookup(input.topic);
      if (!r) return { data: { problem: "The shared brain can't be read right now." } };
      held.got.push(r.got);
      return { data: r.data, numbers: r.numbers };
    },
  };
}

/** One businesses-like-yours lookup, the same for the tool and for code that asks up front. Null when it can't be read. */
async function similarLookup(topic: BrainTopic): Promise<{ got: Similar; data: { comparedAs: string; counts: string[] | string; playbook: SimilarLesson[] }; numbers: Record<string, number> } | null> {
  const [s, snap] = await Promise.all([brainSettings(), savedSnapshot()]);
  const got = await similarBusinesses({ topic, kind: s.kind, revenue: snap?.revenue_band ?? "unknown" });
  if (!got) return null;
  const numbers: Record<string, number> = {};
  got.counts.forEach((c, i) => { numbers[`count_${i + 1}_businesses_with_it`] = c.hits; numbers[`count_${i + 1}_businesses_counted`] = c.orgs; });
  return {
    got, numbers,
    data: {
      comparedAs: s.kind ? KIND_WORDS[s.kind] : "every business (the kind of business isn't set yet)",
      counts: got.counts.length ? got.counts.map((c) => c.statement) : "Fewer than five businesses share anything on this topic yet.",
      playbook: got.playbook.map((l) => ({ title: l.title, lesson: l.lesson, for: l.for })),
    },
  };
}

/**
 * Card 200: setup asks the shared brain once, in code, when Avery can sketch, and puts the answer in her
 * prompt, so she doesn't spend a model turn calling the tool. Null on the open edition or when it can't be read.
 */
export async function similarUpFront(topic: BrainTopic): Promise<{ block: string; got: Similar } | null> {
  if (edition() !== "cloud") return null;
  const r = await similarLookup(topic);
  if (!r) return null;
  const counts = Array.isArray(r.data.counts) ? r.data.counts.map((c) => `- ${c}`).join("\n") : r.data.counts;
  const lessons = r.data.playbook.map((l) => `- ${l.title}: ${l.lesson} (${l.for})`).join("\n") || "- none yet";
  return {
    got: r.got,
    block: `Businesses like yours (compared as: ${r.data.comparedAs}), from OPERATOR's shared brain. Quote a count exactly as given and never work out a new number; say the playbook is OPERATOR's advice.\nCounts:\n${counts}\nOPERATOR's playbook:\n${lessons}`,
  };
}

/** Kind of business (setup): one pick from the list, saved after a finished run only if the owner hasn't picked one. */
export function kindTool(held: { said: string | null }): ToolDef | null {
  if (edition() !== "cloud") return null;
  return {
    id: KIND_TOOL, label: "Set the kind of business",
    detail: "Sets which kind of business this is, from a fixed list, so it's compared with businesses like it. Call it once you know. The founder can change it in Settings",
    kind: "report", group: "agents", trusted: true, needs: [], costUsd: 0,
    params: [{ name: "kind", type: "enum", options: [...BUSINESS_KINDS], description: BUSINESS_KINDS.map((k) => `${k}: ${KIND_WORDS[k]}`).join(". ") + "." }],
    collect: (input, rows) => (rows.length ? { problem: "one kind per reply" } : isKind(input.kind) ? { row: { kind: input.kind } } : { problem: "pick a kind from the list" }),
    deliver: async (o) => {
      const kind = o.rows[0]?.kind;
      if (!isKind(kind)) return "nothing to save";
      const s = await brainSettings();
      if (s.kind) return `kept the kind already picked (${KIND_WORDS[s.kind]})`;
      await saveBrainSettings({ ...s, kind });
      held.said = `Kind of business: ${KIND_WORDS[kind]}. Change it any time in Settings, under Shared brain.`;
      return held.said;
    },
  };
}

/**
 * Slice 4b (card 234): what has worked for the action types an agent holds, handed to it by code before
 * it drafts (the cloud edition; null on the open edition or when nothing came back). The block goes in
 * its prompt; the note goes on each approval card it stages, so the owner sees what it was shown.
 */
export async function workedFor(actionTypes: readonly string[]): Promise<{ block: string; note: string } | null> {
  const types = [...new Set(actionTypes)].slice(0, 3);
  if (edition() !== "cloud" || !types.length) return null;
  const [s, snap] = await Promise.all([brainSettings(), savedSnapshot()]);
  const got = await Promise.all(types.map((action) => similarBusinesses({ topic: "approvals", kind: s.kind, revenue: snap?.revenue_band ?? "unknown", action })));
  const merged: Similar = { counts: got.flatMap((g) => g?.counts ?? []), playbook: [] };
  const seen = new Set<string>();
  for (const l of got.flatMap((g) => g?.playbook ?? [])) if (!seen.has(l.title)) { seen.add(l.title); merged.playbook.push(l); }
  merged.playbook = merged.playbook.slice(0, 3);
  const block = workedBlock(merged), note = workedNote(merged);
  return block && note ? { block, note } : null;
}

/** The company reveal's "why" line per department (cloud edition), from counts over the floor only. Empty when there are none. */
export async function revealWhy(depts: readonly { id: string; agents: readonly { tools: readonly string[] }[]; waitsOn: readonly string[] }[]): Promise<Record<string, string>> {
  if (edition() !== "cloud" || !depts.length) return {};
  const [s, snap] = await Promise.all([brainSettings(), savedSnapshot()]);
  const got = await similarBusinesses({ topic: "starting", kind: s.kind, revenue: snap?.revenue_band ?? "unknown", many: true });
  if (!got) return {};
  return whyFor(depts.map((d) => ({ id: d.id, words: [...d.agents.flatMap((a) => a.tools), ...d.waitsOn] })), got.counts);
}
