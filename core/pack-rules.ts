// Packs as data (docs/packs.md): each file in packs/ is one department or one agent a business can install.
// A department pack holds its department, head and agents, their specs and playbooks, its seats, its chains
// and its starting goal; an agent pack holds one agent for one seat. Pure, so check:packs and check:install
// can test it. A pack picks only from code (readSpec, the tool list), so it can make an agent smaller, never
// give it a new ability; core/install-rules.ts checks a pack's contents before anything is written.
import type { Chain } from "@/core/flow-rules";

/** A starting crew, as data: one or more department packs merged (mergePacks), installed by core/install.ts. */
export interface Crew {
  /**
   * `overview` is the department's Overview as rows of core's widgets (core/widget-rules.ts); none keeps the default
   * Overview. `pack` is the pack it came from ("store-analytics@1"), set by mergePacks, never by the file.
   */
  departments: { id: string; name: string; sort: number; lead_checks_drafts: boolean; overview?: unknown; pack?: string }[];
  agents: { id: string; name: string; role: string; model: string; icon: string | null; hue: string | null; daily_budget_usd: number; manual_only: boolean }[];
  /** Each agent's spec (core/agent-spec.ts AgentSpec), installed as version 1. */
  specs: Record<string, unknown>;
  /** Each agent's playbook steps, installed as a proposed version 1 for the owner to approve. */
  playbooks: Record<string, { tool: string; input: Record<string, unknown> }[]>;
  /** The org chart. `key` and `parent` are names inside this list; new ids are made at install. */
  seats: { key: string; parent: string | null; department: string | null; title: string; sub: string; holder: "open" | "owner" | "agent"; agent: string | null; sort: number }[];
  /** The chains (core/flow-rules.ts), installed with every chain off. */
  flow: { chains: unknown[] };
  /** Starting goals, installed active with no due date for the owner to set. */
  goals: { department: string; title: string; measure: string | null; target: number | null }[];
}

export const PACK_KINDS = ["department", "agent"] as const;
export type PackKind = (typeof PACK_KINDS)[number];

/** What every pack file starts with. */
export interface PackHead {
  /** Lowercase id, the file's name. */
  id: string;
  kind: PackKind;
  /** A whole number from 1; a higher one is offered to agents and departments installed from a lower one. */
  version: number;
  name: string;
  /** One line for the pack list. */
  about: string;
  /** Who made it: a person's or group's name, never a business's. */
  author: string;
  /** An SPDX license id. */
  license: string;
  /** The oldest OPERATOR version it works with ("0.1.0"): a newer pack is refused, never half-installed. */
  needs_operator: string;
}

/** A department pack: one department with its head, agents, seats, chains and goals. */
export interface DepartmentPack extends PackHead, Omit<Crew, "flow"> {
  kind: "department";
  /** Its chains. A chain with the same key in another picked pack merges into one, in pack order. */
  chains: unknown[];
}

/** An agent pack: one agent for one seat (installed by a later slice, card 503). */
export interface AgentPack extends PackHead {
  kind: "agent";
  /** The seat it fills: its title and line on the org chart, and words that match an open seat's title. */
  seat: { title: string; sub: string; matches: string[] };
  agent: { name: string; role: string; model: string; icon: string | null; hue: string | null; daily_budget_usd: number };
  /** Its spec (core/agent-spec.ts AgentSpec), installed as version 1. */
  spec: unknown;
  /** Its playbook steps, installed as a proposed version 1. */
  playbook: { tool: string; input: Record<string, unknown> }[];
  /** When it runs: null for by hand only, else days and a 24 hour time, installed as a chain that starts off. */
  starts: { days: string; time: string } | null;
  /** Actions an approver may give it, shown as Can do toggles that start off. A pack never grants one. */
  suggests: string[];
}

export type Pack = DepartmentPack | AgentPack;

export const PACK_ID = /^[a-z][a-z0-9-]{1,30}$/;
const SEMVER = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;
const SPDX = /^[A-Za-z0-9.+-]{2,40}$/;
/** The most bytes a pack file may hold, so an upload can't be huge. */
export const PACK_MAX_BYTES = 200_000;

/** Whether `have` is the same version as `need` or newer ("0.2.0" covers "0.1.9"). False when either isn't x.y.z. */
export function versionAtLeast(have: string, need: string): boolean {
  const a = SEMVER.exec(have), b = SEMVER.exec(need);
  if (!a || !b) return false;
  for (let i = 1; i <= 3; i++) if (Number(a[i]) !== Number(b[i])) return Number(a[i]) > Number(b[i]);
  return true;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max: number) => typeof x === "string" && !!x.trim() && x.length <= max;

/**
 * What's wrong with a pack file's shape, read against this OPERATOR's version. A department pack's crew
 * checks (crewProblems) and an agent pack's contents (agentPackProblems) are in core/install-rules.ts.
 */
export function packProblems(p: unknown, appVersion: string): string[] {
  if (!isObj(p)) return ["a pack is an object"];
  const out: string[] = [];
  if (JSON.stringify(p).length > PACK_MAX_BYTES) out.push(`a pack is at most ${PACK_MAX_BYTES / 1000} KB`);
  if (typeof p.id !== "string" || !PACK_ID.test(p.id)) out.push("id: 2 to 31 lowercase letters, digits or dashes");
  if (!PACK_KINDS.includes(p.kind as PackKind)) out.push(`kind: one of ${PACK_KINDS.join(", ")}`);
  if (!Number.isInteger(p.version) || (p.version as number) < 1) out.push("version: a whole number from 1");
  if (!text(p.name, 60)) out.push("name: 1 to 60 characters");
  if (!text(p.about, 200)) out.push("about: 1 to 200 characters");
  if (!text(p.author, 60)) out.push("author: 1 to 60 characters");
  if (typeof p.license !== "string" || !SPDX.test(p.license)) out.push("license: an SPDX license id");
  if (typeof p.needs_operator !== "string" || !SEMVER.test(p.needs_operator)) out.push("needs_operator: a version like 0.1.0");
  else if (!versionAtLeast(appVersion, p.needs_operator)) out.push(`needs OPERATOR ${p.needs_operator} or newer (this is ${appVersion})`);
  if (p.kind === "department") {
    for (const k of ["departments", "agents", "seats", "chains", "goals"]) if (!Array.isArray(p[k])) out.push(`${k}: a list`);
    for (const k of ["specs", "playbooks"]) if (!isObj(p[k])) out.push(`${k}: an object`);
  }
  if (p.kind === "agent") {
    const s = p.seat, a = p.agent;
    if (!isObj(s) || !text(s.title, 60) || typeof s.sub !== "string" || s.sub.length > 120 || !Array.isArray(s.matches) || s.matches.length > 8 || !s.matches.every((m) => text(m, 40)))
      out.push("seat: a title of 1 to 60 characters, a line of at most 120 and up to 8 matching words");
    if (!isObj(a) || !text(a.name, 40) || !text(a.role, 60) || typeof a.model !== "string" || typeof a.daily_budget_usd !== "number" || !("icon" in a) || !("hue" in a))
      out.push("agent: a name, role, model, icon, colour and daily budget");
    if (!isObj(p.spec)) out.push("spec: an object");
    if (!Array.isArray(p.playbook)) out.push("playbook: a list");
    if (p.starts !== null && !isObj(p.starts)) out.push("starts: null or { days, time }");
    if (!Array.isArray(p.suggests) || !p.suggests.every((x) => typeof x === "string")) out.push("suggests: a list of action ids");
  }
  return out;
}

const stepAgent = (s: unknown) => (s && typeof s === "object" ? (s as { agent?: unknown }).agent : undefined);

/**
 * The picked department packs as one crew. Lists are joined in pack order; a chain whose key another pack
 * already used adds its steps to that chain; a step whose agent isn't being installed is dropped, and so is a
 * chain left with no steps. Ids that clash are left for crewProblems to refuse.
 */
export function mergePacks(picked: readonly DepartmentPack[]): Crew {
  const crew: Crew = { departments: [], agents: [], specs: {}, playbooks: {}, seats: [], flow: { chains: [] }, goals: [] };
  const chains = new Map<string, Chain>();
  for (const t of picked) {
    crew.departments.push(...t.departments.map((d) => ({ ...d, pack: `${t.id}@${t.version}` })));
    crew.agents.push(...t.agents);
    Object.assign(crew.specs, t.specs);
    Object.assign(crew.playbooks, t.playbooks);
    crew.seats.push(...t.seats);
    crew.goals.push(...t.goals);
    for (const raw of t.chains) {
      const c = raw as Chain;
      const had = chains.get(c.key);
      if (had) had.steps = [...had.steps, ...c.steps];
      else chains.set(c.key, { ...c, steps: [...c.steps] });
    }
  }
  const ids = new Set(crew.agents.map((a) => a.id));
  crew.flow.chains = [...chains.values()].map((c) => ({ ...c, steps: c.steps.filter((s) => ids.has(String(stepAgent(s)))) })).filter((c) => c.steps.length);
  return crew;
}
