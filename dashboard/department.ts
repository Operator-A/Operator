import "server-only";
// The department draft as the chat panel and the proposal page show it (card 156): the draft, where
// each source stands now, each goal's measure label, each person's cost and the total. Every number
// comes from code (dashboard/cost.ts, card 155).
import { MEASURES } from "@/core/goal-rules";
import { ownMeasureDefs } from "@/core/goals";
import { TOOLS } from "@/core/tools/catalog";
import { loadDraft, sourcesNow, type SourceView } from "@/core/departments";
import { draftGaps, peopleOf, type DeptDraft, type DraftPerson } from "@/core/department-rules";
import type { MonthCost } from "@/core/cost-rules";
import { billing, hireCost } from "./cost";

export interface PersonView extends DraftPerson { head: boolean; toolLabels: string[]; perRun: number | null; daily: MonthCost }
export interface DraftView {
  draft: DeptDraft;
  goals: (DeptDraft["goals"][number] & { measureLabel: string | null })[];
  sources: SourceView[];
  people: PersonView[];
  /** The department's month if every agent ran daily, and what one run of each costs together. */
  totalDaily: number;
  totalPerRun: number;
  gaps: string[];
}

export async function draftView(d: DeptDraft): Promise<DraftView> {
  const [own, sources, bill] = await Promise.all([ownMeasureDefs().catch(() => []), sourcesNow(d).catch(() => []), billing()]);
  const label = (k: string | null) => (k ? [...MEASURES, ...own].find((m) => m.key === k)?.label ?? k : null);
  const people = peopleOf(d).map((p, i): PersonView => {
    const c = hireCost(p, bill);
    return { ...p, head: i === 0 && !!d.head, toolLabels: p.tools.map((t) => TOOLS[t]?.label ?? t), perRun: c.byHand.perRun, daily: c.daily };
  });
  return {
    draft: d,
    goals: d.goals.map((g) => ({ ...g, measureLabel: label(g.measure) })),
    sources, people,
    totalDaily: people.reduce((s, p) => s + p.daily.month, 0),
    totalPerRun: people.reduce((s, p) => s + (p.perRun ?? 0), 0),
    gaps: draftGaps(d),
  };
}

/** The chat panel's card: the business's draft, or null when there is none. */
export async function currentDraftView(): Promise<DraftView | null> {
  const d = await loadDraft().catch(() => null);
  return d ? draftView(d) : null;
}
