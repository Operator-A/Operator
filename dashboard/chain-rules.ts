// Chains where they live (chains slice 1, card 430): which chains a department page's Chains tab, an agent's sheet
// and Settings > Schedule list, the words between steps, and a new chain. Pure: no database, no network, so
// `npm run check:chains` tests it. The chains themselves, their checks and how they run are core/flow-rules.ts.
import { ASK, chainOwner, dayWords, MAX_STEPS, type Ask, type OkStep, type Chain, type Days, type Flow, type Owner, type Start, type Step } from "@/core/flow-rules";
import { eventStartWords } from "@/core/event-rules";
import { t12 } from "./format";

/** Where a chain belongs: the company, or a department (its own, or one of its agents'). */
export type Place = { kind: "company" } | { kind: "dept"; dept: string; via: "dept" | "agent"; agent?: string };

/** A chain's place, from its owner and which department each agent sits in (`deptOf`). */
export function placeOf(c: Chain, deptOf: Readonly<Record<string, string | null>>): Place {
  const o = chainOwner(c);
  if (!o) return { kind: "company" };
  if ("dept" in o) return { kind: "dept", dept: o.dept, via: "dept" };
  const d = deptOf[o.agent];
  return d ? { kind: "dept", dept: d, via: "agent", agent: o.agent } : { kind: "company" };
}

export interface ChainGroup { id: string; title: string; chains: Chain[] }

/**
 * The lists a Chains board shows. On a department: its own chains, then its agents' chains. Everywhere (Settings):
 * the company's chains, then each department's (its own and its agents'), in the chart's order. Empty groups
 * are left out, except a department's own list, which always shows so "+ New chain" has a home.
 */
export function boardGroups(flow: Flow, scope: { dept: string } | "all", deptOf: Readonly<Record<string, string | null>>, depts: readonly { id: string; name: string }[]): ChainGroup[] {
  const at = flow.chains.map((c) => ({ c, p: placeOf(c, deptOf) }));
  if (scope !== "all") {
    const mine = at.filter((x) => x.p.kind === "dept" && x.p.dept === scope.dept);
    return [
      { id: "dept", title: "This department’s chains", chains: mine.filter((x) => x.p.kind === "dept" && x.p.via === "dept").map((x) => x.c) },
      { id: "agents", title: "Its agents’ chains", chains: mine.filter((x) => x.p.kind === "dept" && x.p.via === "agent").map((x) => x.c) },
    ].filter((g) => g.id === "dept" || g.chains.length);
  }
  const known = new Set(depts.map((d) => d.id));
  const company = at.filter((x) => x.p.kind === "company" || !known.has(x.p.dept)).map((x) => x.c);
  return [
    { id: "company", title: "Company chains", chains: company },
    ...depts.map((d) => ({ id: d.id, title: d.name, chains: at.filter((x) => x.p.kind === "dept" && x.p.dept === d.id).map((x) => x.c) })),
  ].filter((g) => g.id === "company" || g.chains.length);
}

const DAY_SHORT: Partial<Record<string, string>> = { daily: "Every day", weekdays: "Weekdays", mondays: "Mondays" };
const daysLabel = (d: Days) => DAY_SHORT[d] ?? dayWords(d).replace(/^on /, "").replace(/^./, (m) => m.toUpperCase());

/** How a start reads on its card and in the list: "Mondays at 7:00 AM", "When a new order comes in", "After Weekly post finishes". */
export function startWords(s: Start, names: { chain: (key: string) => string; tool: (id: string) => string }): string {
  if (s.type === "schedule") return `${daysLabel(s.days)} at ${t12(s.time)}`;
  if (s.type === "button") return "When you press Run chain";
  if (s.type === "event") return eventStartWords(s);
  if (s.type === "after") return `After ${names.chain(s.chain)} finishes${s.when === "any" ? ", either way" : ""}`;
  return `When you ${s.decision === "any" ? "decide" : s.decision} ${names.tool(s.tool)}`;
}

/** The line between two steps, as the lane shows it: "passes its result if it worked", "then, if it failed". */
export function linkWords(next: Step): string {
  const w = next.when ?? "ok";
  const how = w === "ok" ? " if it worked" : w === "failed" ? " if it failed" : "";
  const extra = [next.check ? `${next.check.metric} ${next.check.op} ${next.check.value}` : "", next.days ? dayWords(next.days) : "", next.notBefore ? `not before ${t12(next.notBefore)}` : ""].filter(Boolean);
  return `${next.passAlong ? "passes its result" : "then"}${how}${extra.length ? ` · ${extra.join(" · ")}` : ""}`;
}

/** A fresh key for a new chain: from its name, never one the flow already has. */
export function newKey(flow: Flow, name: string): string {
  const base = (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "chain").slice(0, 34);
  let key = base;
  for (let i = 2; flow.chains.some((c) => c.key === key); i++) key = `${base}-${i}`;
  return key;
}

/** A new chain: off, started with Run chain, its first agent picked; owned by `owner` (null: the company). */
export function newChain(flow: Flow, owner: Owner | null, first: string, name: string): Chain {
  const n = name.trim().slice(0, 60) || "New chain";
  return { key: newKey(flow, n), name: n, on: false, start: { type: "button" }, steps: [{ agent: first }], ...(owner ? { owner } : {}) };
}

/** Whether one more step fits. */
export const roomFor = (c: Chain) => c.steps.length < MAX_STEPS;

/** A new Ask a model step (chains slice 2) on `model`, with no instruction yet and the default cap. */
export const newAsk = (model: string): Ask => ({ model, prompt: "", maxUsd: ASK.defaultUsd });

/** The model a new Ask a model step starts on: the cheapest that can run here, by its price for answers. */
export function askModel(models: readonly { id: string; ready: boolean; out: number }[]): string | null {
  return [...models].filter((m) => m.ready).sort((a, b) => a.out - b.out)[0]?.id ?? null;
}

/**
 * Whether a Wait for my OK step (chains slice 3) can go in at `at`: it needs a step before it to approve, and one OK
 * next to another would ask twice.
 */
export const okFits = (c: Chain, at: number) => at > 0 && !c.steps[at - 1]?.ok && !c.steps[at]?.ok;

/**
 * A step added at `at` (after step at-1): an agent (its id), an Ask a model step, or a Wait for my OK step. A step
 * after another waits for it to work and gets its result; an OK always shows the step before's result.
 */
export function withStep(c: Chain, at: number, what: string | Ask | { ok: OkStep }): Chain {
  const steps = [...c.steps];
  const body: Step = typeof what === "string" ? { agent: what } : "ok" in what ? { ok: what.ok } : { ask: what };
  steps.splice(at, 0, at === 0 ? body : body.ok ? { ...body, when: "ok" } : { ...body, when: "ok", passAlong: true });
  // a new first step: the one it pushed down waits for it
  if (at === 0 && steps[1]) steps[1] = { when: "ok", passAlong: true, ...steps[1] };
  return { ...c, steps };
}

/** Takes step `k` out; the step that becomes first drops what only applies after a step (when, check, wait). */
export function withoutStep(c: Chain, k: number): Chain {
  const steps = c.steps.filter((_, i) => i !== k);
  if (k === 0 && steps[0]) { const { when: _w, check: _c, notBefore: _n, ...rest } = steps[0]; void _w; void _c; void _n; steps[0] = rest; }
  return { ...c, steps };
}

/** Step `k` moved one place up (-1) or down (+1); whichever step ends up first drops what only applies after a step. */
export function moveStep(c: Chain, k: number, dir: -1 | 1): Chain {
  const j = k + dir;
  if (j < 0 || j >= c.steps.length) return c;
  const steps = [...c.steps];
  [steps[k], steps[j]] = [steps[j], steps[k]];
  const { when: _w, check: _c, notBefore: _n, ...first } = steps[0]; void _w; void _c; void _n;
  steps[0] = first;
  return { ...c, steps };
}

/** The chains the "After another chain finishes" start can pick: every other chain, but not one that already starts after this one. */
export function afterChoices(flow: Flow, key: string): Chain[] {
  const leadsHere = (c: Chain, seen = new Set<string>()): boolean => {
    if (c.key === key) return true;
    if (c.start.type !== "after" || seen.has(c.key)) return false;
    seen.add(c.key);
    const up = flow.chains.find((x) => x.key === (c.start as { chain: string }).chain);
    return !!up && leadsHere(up, seen);
  };
  return flow.chains.filter((c) => c.key !== key && !leadsHere(c));
}

/** The department page's Chains tab with a chain open; Settings > Schedule for a company chain. */
export function chainHref(c: Chain, deptOf: Readonly<Record<string, string | null>>): string {
  const p = placeOf(c, deptOf);
  return p.kind === "dept" ? `/dept/${encodeURIComponent(p.dept)}?tab=chains&chain=${encodeURIComponent(c.key)}` : `/settings/schedule?chain=${encodeURIComponent(c.key)}#chains`;
}

/** "+ New chain starting with" an agent: its department's Chains tab (Settings for an agent in no department). */
export function newChainHref(agent: string, dept: string | null): string {
  return dept ? `/dept/${encodeURIComponent(dept)}?tab=chains&new=${encodeURIComponent(agent)}` : `/settings/schedule?new=${encodeURIComponent(agent)}#chains`;
}
