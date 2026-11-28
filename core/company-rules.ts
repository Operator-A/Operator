// Setup step 3, "Your company" (card 153, docs/setup.md): the org chart Avery proposes, drawn in code
// from her sketch (core/design-rules.ts), the department templates, the connected tools
// and what each agent costs (core/cost-rules.ts). The model never writes the chart, a job, a tool or a
// number: it only named template ids, which code checked. Pure, so check:setup can test it.
import { dayRuns, type Chain } from "@/core/flow-rules";
import type { DepartmentPack } from "@/core/pack-rules";
import { totalCost, type MonthCost } from "@/core/cost-rules";
import type { Fit, Leaning } from "@/core/setup-rules";
import { pickId, type Design } from "@/core/design-rules";
import { peopleOf, type DraftPerson } from "@/core/department-rules";

export interface CompanyAgent {
  id: string;
  name: string;
  role: string;
  /** The template's mandate: the specific job it does. */
  job: string;
  /** Labels of the tools it uses, from the tool list in code. */
  tools: string[];
  /** Heads the department: its seat has no parent. */
  head: boolean;
  /** Runs a month on the template's schedule (DAY_RUNS), 0 by hand. */
  runsPerMonth: number;
  cost: MonthCost;
}

export interface CompanyDept {
  id: string;
  name: string;
  about: string;
  /** How Avery leaned: strong, likely, or null when she didn't. */
  fit: Fit | null;
  agents: CompanyAgent[];
  /** Seats with no agent yet, by title. */
  openSeats: string[];
  /** Tools it still waits on (names), from the tiles’ needs. */
  waitsOn: string[];
  /** What the founder planned for a tool it waits on (card 183), by tool name: a full sentence. */
  waitNotes: Record<string, string>;
  /** Which of those tools the founder planned for (card 184), by tool name. */
  waitKinds: Record<string, "guide" | "export">;
  /** Card 193: the founder's words Avery designed it for, or null for a template she didn't sketch. */
  reason: string | null;
  /** template: on the list, not sketched; kit: sketched from a template under its own name; bespoke: designed from scratch. */
  kind: "template" | "kit" | "bespoke";
}

/** A department's status on the reveal (card 184), worked out in code: a plain wait outranks an export, an export outranks a guide. */
export type DeptStatus = "ready" | "after" | "export" | "waiting";
export const DEPT_STATUS_WORDS: Record<DeptStatus, string> = { ready: "Ready", after: "After setup", export: "From an export", waiting: "Waiting on a tool" };
export function deptStatus(d: Pick<CompanyDept, "waitsOn" | "waitKinds">): DeptStatus {
  if (!d.waitsOn.length) return "ready";
  if (d.waitsOn.some((n) => !d.waitKinds[n])) return "waiting";
  return d.waitsOn.some((n) => d.waitKinds[n] === "export") ? "export" : "after";
}

/** What a department adds to the month, summed in code over its agents; agents with no estimate are named, not counted as zero. */
export const deptMonth = (d: Pick<CompanyDept, "agents">) => totalCost(d.agents.map((a) => ({ name: a.name, cost: a.cost })));

/** The line under a department that waits on tools: plain ones wait for a connection, planned ones say the plan. */
export function waitLine(waitsOn: readonly string[], notes: Readonly<Record<string, string>>): string {
  const plain = waitsOn.filter((n) => !notes[n]);
  return [plain.length ? `Waits on ${plain.join(" and ")}: it starts working once that’s connected.` : null, ...waitsOn.filter((n) => notes[n]).map((n) => notes[n])].filter(Boolean).join(" ");
}

/** Runs a month for one agent on a template's routines: its first scheduled chain, the step's own days first. By hand only is 0. */
export function runsFor(id: string, chains: readonly unknown[], manualOnly: boolean): number {
  if (manualOnly) return 0;
  for (const raw of chains) {
    const c = raw as Chain;
    if (c.start?.type !== "schedule") continue;
    const step = c.steps.find((s) => s.agent === id);
    if (step) return dayRuns(step.days ?? c.start.days);
  }
  return 0;
}

/**
 * Every department template as a branch of the chart, in template order, with how Avery leaned. The
 * setup template (the Chief of Staff) is the company seat above them, so it isn't a branch.
 */
export function companyDepts(templates: readonly DepartmentPack[], o: {
  leaning: readonly Leaning[];
  /** Avery's sketch (card 193): a kit's name and reason replace the template's; bespoke ones come from bespokeDept. */
  designs?: readonly Pick<Design, "kit" | "name" | "purpose" | "reason">[];
  setupTemplate: string;
  toolLabel: (id: string) => string;
  costOf: (template: DepartmentPack, agentId: string, runsPerMonth: number) => MonthCost;
  waitsOn: Readonly<Record<string, readonly string[]>>;
  waitNotes?: Readonly<Record<string, string>>;
  waitKinds?: Readonly<Record<string, "guide" | "export">>;
}): CompanyDept[] {
  return templates.filter((t) => t.id !== o.setupTemplate).map((t) => {
    const d = o.designs?.find((x) => x.kit === t.id);
    return {
    id: t.id, name: d?.name ?? t.name, about: d?.purpose || t.about, reason: d?.reason ?? null, kind: d ? "kit" as const : "template" as const,
    fit: o.leaning.find((l) => l.id === t.id)?.fit ?? null,
    agents: agentsOf(t, o),
    openSeats: t.seats.filter((s) => s.holder === "open").map((s) => s.title),
    waitsOn: [...(o.waitsOn[t.id] ?? [])],
    waitNotes: Object.fromEntries((o.waitsOn[t.id] ?? []).filter((n) => o.waitNotes?.[n]).map((n) => [n, o.waitNotes![n]])),
    waitKinds: Object.fromEntries((o.waitsOn[t.id] ?? []).filter((n) => o.waitKinds?.[n]).map((n) => [n, o.waitKinds![n]])),
    };
  });
}

/**
 * A department Avery designed from scratch (card 193), as a branch of the chart: its people from the
 * draft (head first), each by hand until its playbook is approved, so its cost is per run, not a month.
 */
export function bespokeDept(d: Design, o: {
  toolLabel: (id: string) => string;
  costOf: (p: DraftPerson) => MonthCost;
  waitsOn: readonly string[];
  waitNotes?: Readonly<Record<string, string>>;
  waitKinds?: Readonly<Record<string, "guide" | "export">>;
}): CompanyDept {
  const people = d.draft ? peopleOf(d.draft) : [];
  return {
    id: pickId(d), name: d.name, about: d.purpose, fit: "strong", reason: d.reason, kind: "bespoke",
    agents: people.map((p, i) => ({ id: `${d.key}:${p.name.toLowerCase()}`, name: p.name, role: p.seat, job: p.job, tools: [...new Set(p.tools.map(o.toolLabel))], head: i === 0 && !!d.draft?.head, runsPerMonth: 0, cost: o.costOf(p) })),
    openSeats: d.draft?.head ? [] : ["Head"],
    waitsOn: [...o.waitsOn],
    waitNotes: Object.fromEntries(o.waitsOn.filter((n) => o.waitNotes?.[n]).map((n) => [n, o.waitNotes![n]])),
    waitKinds: Object.fromEntries(o.waitsOn.filter((n) => o.waitKinds?.[n]).map((n) => [n, o.waitKinds![n]])),
  };
}

/** One template's agents, heads first, in seat order. */
export function agentsOf(t: DepartmentPack, o: { toolLabel: (id: string) => string; costOf: (template: DepartmentPack, agentId: string, runsPerMonth: number) => MonthCost }): CompanyAgent[] {
  const specs = t.specs as Record<string, { mandate?: string; tools?: string[] }>;
  return t.seats.filter((s) => s.holder === "agent" && s.agent).map((s) => {
    const a = t.agents.find((x) => x.id === s.agent)!;
    const runs = runsFor(a.id, t.chains, a.manual_only);
    return {
      id: a.id, name: a.name, role: a.role || s.title,
      job: specs[a.id]?.mandate?.trim() || s.sub || s.title,
      tools: [...new Set((specs[a.id]?.tools ?? []).map(o.toolLabel))],
      head: s.parent == null, runsPerMonth: runs,
      cost: o.costOf(t, a.id, runs),
    };
  }).sort((x, y) => Number(y.head) - Number(x.head));
}

/** What the chart starts with: the departments Avery sketched (kits and bespoke), strong or likely. */
export const initialPick = (depts: readonly CompanyDept[]): string[] => depts.filter((d) => d.fit).map((d) => d.id);

/** The picked departments, checked against the chart: known ids only, each once, in chart order. */
export function readPick(picked: readonly unknown[], depts: readonly CompanyDept[]): { ids: string[] } | { problem: string } {
  const want = new Set<string>();
  for (const p of picked) {
    const id = String(p ?? "");
    if (!depts.some((d) => d.id === id)) return { problem: `${id || "(blank)"} isn't a department on the chart` };
    want.add(id);
  }
  if (!want.size) return { problem: "Pick at least one department, or Start empty." };
  return { ids: depts.filter((d) => want.has(d.id)).map((d) => d.id) };
}

/** The chart's totals: the company seat plus every agent in the picked departments. */
export function companyTotals(depts: readonly CompanyDept[], picked: readonly string[], company: readonly CompanyAgent[]) {
  const agents = [...company, ...depts.filter((d) => picked.includes(d.id)).flatMap((d) => d.agents)];
  return { agents: agents.length, ...totalCost(agents.map((a) => ({ name: a.name, cost: a.cost }))) };
}
