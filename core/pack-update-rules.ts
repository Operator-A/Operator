// A newer version of a pack, offered to a department installed from an older one (docs/packs.md, packs slice 3b,
// mockup screen 5). Worked out here with no database, so `npm run check:pack-install` can test it. What changed is
// worked out in code; saving it writes each changed agent's spec as a draft version beside what runs (never live by
// itself), and keeps what belongs to this business: the agent's name, its granted actions and custom tools, its
// Notion pages, report page and whose results it reads. Chains, goals and seats are never changed by an update.
import { readSpec, type AgentSpec } from "@/core/agent-spec";
import type { DepartmentPack } from "@/core/pack-rules";
import { TOOLS } from "@/core/tools/catalog";
import { layoutProblems } from "@/core/widget-rules";

/** A pack tag as saved on a department or agent: "store-analytics@1". */
export function readTag(tag: unknown): { id: string; version: number } | null {
  const m = typeof tag === "string" ? /^([a-z][a-z0-9-]{1,30})@(\d{1,4})$/.exec(tag) : null;
  return m ? { id: m[1], version: Number(m[2]) } : null;
}

/** One of the department's agents that came from the pack: its spec now, its first spec's name, and whether the owner changed it. */
export interface LiveAgent { id: string; name: string; firstName: string; spec: unknown; edited: string | null }
export interface DiffLine { mark: "+" | "~" | "="; text: string }
export interface PackUpdate {
  from: number; to: number; name: string;
  lines: DiffLine[];
  /** Agents whose spec changes, with the draft each gets. */
  drafts: { agentId: string; name: string; spec: AgentSpec }[];
  /** The department's new Overview layout, or null when it doesn't change. */
  overview: unknown;
  /** "You changed Iris's spec on Nov 20": a draft is saved beside it, nothing is replaced. */
  warns: string[];
}

const isOwn = (t: string) => !TOOLS[t] || TOOLS[t].agents === "granted";
const list = (xs: readonly string[]) => (xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
const label = (t: string) => TOOLS[t]?.label ?? t;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * What a newer pack would change in a department installed from version `from`, or null when the pack on file
 * isn't newer. `overview` is the department's layout now; `agents` its agents that came from this pack.
 */
export function packUpdate(pack: DepartmentPack, from: number, overview: unknown, agents: readonly LiveAgent[]): PackUpdate | null {
  if (!(pack.version > from)) return null;
  const lines: DiffLine[] = [], drafts: PackUpdate["drafts"] = [], warns: string[] = [];
  const specs = pack.specs as Record<string, unknown>;
  const matched = new Set<string>(), ids = new Map<string, string>();
  for (const live of agents) {
    // the pack agent this one came from: by its first spec's name, as installed
    const pa = pack.agents.find((a) => a.name === live.firstName) ?? null;
    if (!pa) { lines.push({ mark: "=", text: `${live.name}: not in this version, left as it is` }); continue; }
    matched.add(pa.id); ids.set(pa.id, live.id);
    const now = readSpec(live.spec, live.id).spec;
    const next = readSpec(specs[pa.id], pa.id).spec;
    const keep = now.tools.filter(isOwn);
    const spec: AgentSpec = {
      ...next, name: now.name, tools: [...new Set([...next.tools.filter((t) => !isOwn(t)), ...keep])],
      notionPages: now.notionPages, reportPage: now.reportPage, readsFrom: now.readsFrom,
    };
    const what: string[] = [];
    const added = spec.tools.filter((t) => !now.tools.includes(t)), gone = now.tools.filter((t) => !spec.tools.includes(t));
    if (added.length) what.push(`also reads ${list(added.map(label))}`);
    if (gone.length) what.push(`no longer reads ${list(gone.map(label))}`);
    if (spec.directive !== now.directive || spec.mandate !== now.mandate || spec.goodResult !== now.goodResult) what.push("new instructions");
    if (spec.model !== now.model || spec.effort !== now.effort) what.push(`runs on ${spec.model}, ${spec.effort} effort`);
    if (!same(spec.limits, now.limits)) what.push(`at most ${spec.limits.maxSteps} steps and $${spec.limits.maxCostUsd.toFixed(2)} a run`);
    if (!what.length) { lines.push({ mark: "=", text: `${live.name}’s spec unchanged` }); continue; }
    const { problems } = readSpec(spec, live.id);
    if (problems.length) { lines.push({ mark: "=", text: `${live.name}: this version can’t be saved (${problems.join("; ")})` }); continue; }
    lines.push({ mark: "~", text: `${live.name}’s spec: ${what.join("; ")}` });
    drafts.push({ agentId: live.id, name: live.name, spec });
    if (live.edited) warns.push(`You changed ${live.name}’s spec on ${live.edited}. This version is saved as a draft beside yours: nothing you made is replaced.`);
  }
  for (const a of pack.agents) if (!matched.has(a.id) && agents.length) lines.push({ mark: "+", text: `${a.name}, ${a.role}: new in this version, not added (install the pack again or hire for it)` });
  // the pack's agent numbers name its own agents: they follow to this business's ids
  const raw = pack.departments[0]?.overview ?? null;
  const nextLayout = Array.isArray(raw) ? raw.map((row) => (Array.isArray(row) ? row.map((w) => (w && typeof w === "object" && typeof (w as { agent?: unknown }).agent === "string" ? { ...w, agent: ids.get((w as { agent: string }).agent) ?? (w as { agent: string }).agent } : w)) : row)) : raw;
  const layoutOk = nextLayout === null || !layoutProblems(nextLayout, agents.map((a) => a.id)).length;
  const layoutChanged = layoutOk && !same(nextLayout ?? null, overview ?? null);
  if (layoutChanged) lines.push({ mark: "~", text: "Overview: a new layout from the pack" });
  lines.push({ mark: "=", text: "Chains, goals and seats unchanged" });
  return { from, to: pack.version, name: pack.name, lines, drafts, overview: layoutChanged ? nextLayout : null, warns };
}
