// Avery designs the company in setup (card 193, docs/setup.md "Avery designs the company"). After the
// interview she sketches up to MAX_DESIGNS departments for this business. Each one is either a kit (a
// department template she starts from, under the name she gives it) or bespoke: a department draft
// built part by part with the same checks as a department drafted in the chat (core/department-rules.ts,
// card 156), so a bespoke department only ever has read and calculate tools, at most a head and two
// narrow agents, and goals measured in code or kept in words. Every design carries the founder's own
// words as its reason. Pure: no database, no network, so check:setup tests every case.
import { applyPart, draftGaps, peopleOf, readDraft, EMPTY_DRAFT, type DeptDraft, type DraftCtx } from "@/core/department-rules";

export const MAX_DESIGNS = 4;
/** Design updates one setup message may make: a full bespoke department is about six parts. */
export const MAX_DESIGN_PARTS = 24;
export const REASON_MAX = 200;

export interface Design {
  /** Stable key for the chart and the pick: a slug of the first name it had. */
  key: string;
  name: string;
  purpose: string;
  /** The founder's words this department answers: a short quote or close paraphrase from the conversation. */
  reason: string;
  /** The template it starts from, or null when bespoke. */
  kit: string | null;
  /** The bespoke department's draft (its name and purpose kept in step); null for a kit. */
  draft: DeptDraft | null;
}

/** A kit's id, name and the agent names it brings (a bespoke person can't take one of them). */
export interface Kit { id: string; name: string; agentNames: readonly string[] }

const one = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
/** A reason as said: outer quote marks dropped, so the card's own pair is the only one (card 196). */
export function unquote(s: string): string {
  let t = s.trim();
  while (t.length > 2 && /^["“”'‘’]/.test(t) && /["“”'‘’]$/.test(t) && !/["“”]/.test(t.slice(1, -1).trim().slice(1, -1))) t = t.slice(1, -1).trim();
  return t;
}
/** How a reason shows after "You said:": in one pair of quote marks, or as it is when it quotes inside. */
export const saidLine = (s: string) => { const r = unquote(s); return /["“”]/.test(r) ? r : `“${r}”`; };
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const LINK = /https?:\/\/|www\.|@|\.[a-z]{2,6}\/|[a-z0-9-]+\.(com|io|net|org|dev|app|ai|co|shop|store)\b/i;
const DEPT = /^[A-Za-z][A-Za-z0-9 &'-]{1,39}$/;
export const designKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "dept";

export const DESIGN_PARTS = ["about", "goal", "head", "agent", "remove", "drop"] as const;

/**
 * One update from Avery's Design a department tool. `dept` names the department every call is about.
 * about: creates it (purpose, reason, kit or none) or changes its purpose, reason or name. goal, head,
 * agent, remove: a bespoke department's parts, checked by applyPart. drop: takes the department off.
 */
export function applyDesign(designs: readonly Design[], input: Record<string, unknown>, o: { ctx: DraftCtx; kits: readonly Kit[]; now: string }): { designs: Design[]; note: string } | { problem: string } {
  const part = String(input.part ?? "");
  if (!(DESIGN_PARTS as readonly string[]).includes(part)) return { problem: `part must be one of ${DESIGN_PARTS.join(", ")}` };
  const dept = one(input.dept, 40);
  if (!DEPT.test(dept)) return { problem: "dept is the department's name: 2 to 40 letters, digits or spaces" };
  const list = designs.map((d) => ({ ...d }));
  const at = list.findIndex((d) => same(d.name, dept));
  const others = list.filter((_, i) => i !== at);
  // a person's name must be free across the whole sketch: the kits' agents and every other bespoke department's people
  const taken = [...o.ctx.agentNames, ...others.flatMap((d) => (d.kit ? o.kits.find((k) => k.id === d.kit)?.agentNames ?? [] : d.draft ? peopleOf(d.draft).map((p) => p.name) : []))];
  const ctx: DraftCtx = { ...o.ctx, agentNames: taken, departments: [...o.ctx.departments, ...others.map((d) => d.name)] };

  if (part === "drop") {
    if (at < 0) return { problem: `there is no ${dept} in the sketch` };
    list.splice(at, 1);
    return { designs: list, note: `took ${dept} off` };
  }
  if (part === "about") {
    const reason = unquote(one(input.reason, REASON_MAX + 1));
    if (reason && reason.length > REASON_MAX) return { problem: `keep the reason under ${REASON_MAX} characters` };
    if (reason && LINK.test(reason)) return { problem: "a reason can't hold a link or an address" };
    const purpose = one(input.purpose, 200);
    if (purpose && LINK.test(purpose)) return { problem: "the purpose can't hold a link" };
    const rename = one(input.name, 40);
    if (rename && !DEPT.test(rename)) return { problem: "the new name is 2 to 40 letters, digits or spaces" };
    const name = rename || dept;
    if (ctx.departments.some((x) => same(x, name))) return { problem: `there is already a ${name} department in the sketch` };
    const kitRaw = one(input.kit, 40);
    const kit = !kitRaw || /^(none|no|null|-|bespoke)$/i.test(kitRaw) ? null : kitRaw;
    if (kit && !o.kits.some((k) => k.id === kit)) return { problem: `${kit} isn't a starting kit: use one of ${o.kits.map((k) => k.id).join(", ")}, or none` };
    if (kit && list.some((d, i) => i !== at && d.kit === kit)) return { problem: `the ${kit} kit is already in the sketch` };
    if (at < 0) {
      if (list.length >= MAX_DESIGNS) return { problem: `at most ${MAX_DESIGNS} departments: drop one first` };
      if (!purpose) return { problem: "a new department needs its purpose, in one sentence" };
      if (reason.length < 10) return { problem: "a new department needs its reason: the founder's own words it answers" };
      const draft = kit ? null : applyPart(EMPTY_DRAFT, { part: "about", name, purpose }, ctx, o.now);
      if (draft && "problem" in draft) return draft;
      const key = uniqueKey(designKey(name), list);
      list.push({ key, name, purpose, reason, kit, draft: draft ? draft.draft : null });
      return { designs: list, note: `${name}${kit ? ` (from the ${o.kits.find((k) => k.id === kit)!.name} kit)` : " (designed for you)"}` };
    }
    const d = list[at];
    if (input.kit != null && String(input.kit).trim() && kit !== d.kit) return { problem: "a department keeps its kit: drop it and design it again to change that" };
    if (!purpose && !reason && !rename) return { problem: "about needs a purpose, a reason or a new name" };
    if (purpose) d.purpose = purpose;
    if (reason) d.reason = reason;
    d.name = name;
    if (d.draft) {
      const r = applyPart(d.draft, { part: "about", name, purpose: d.purpose }, { ...ctx, departments: ctx.departments }, o.now);
      if ("problem" in r) return r;
      d.draft = r.draft;
    }
    return { designs: list, note: `${name}: ${[rename && "name", purpose && "purpose", reason && "reason"].filter(Boolean).join(", ")}` };
  }
  // goal, head, agent, remove: a bespoke department's parts
  if (at < 0) return { problem: `design ${dept} with about first` };
  const d = list[at];
  if (!d.draft) return { problem: `${d.name} starts from a kit, which brings its own people and goals` };
  const r = applyPart(d.draft, { ...input, part }, ctx, o.now);
  if ("problem" in r) return r;
  d.draft = r.draft;
  return { designs: list, note: `${d.name}: ${r.note}` };
}

function uniqueKey(base: string, list: readonly Design[]): string {
  let key = base;
  for (let i = 2; list.some((d) => d.key === key); i++) key = `${base.slice(0, 36)}-${i}`;
  return key;
}

/** What a design still needs before it can be started: nothing for a kit; a bespoke one needs a head and a goal. */
export function designGaps(d: Design): string[] {
  if (d.kit) return [];
  return d.draft ? draftGaps(d.draft) : ["a head", "at least one goal"];
}

/** Reads the stored sketch back: well-shaped designs only, kits still on the list, names and keys unique. */
export function readDesigns(raw: unknown, kitIds: readonly string[]): Design[] {
  if (!Array.isArray(raw)) return [];
  const out: Design[] = [];
  for (const x of raw.slice(0, MAX_DESIGNS)) {
    if (!x || typeof x !== "object") continue;
    const r = x as Partial<Design>;
    const name = one(r.name, 40), purpose = one(r.purpose, 200), reason = one(r.reason, REASON_MAX), key = one(r.key, 40);
    if (!DEPT.test(name) || !key || !reason) continue;
    const kit = typeof r.kit === "string" && kitIds.includes(r.kit) ? r.kit : null;
    if (r.kit && !kit) continue;
    const draft = kit ? null : readDraft(r.draft);
    if (!kit && !draft) continue;
    if (out.some((d) => d.key === key || same(d.name, name) || (kit && d.kit === kit))) continue;
    out.push({ key, name, purpose, reason, kit, draft });
  }
  return out;
}

/** The pick id of a bespoke department on the chart (a kit's pick id is its template id). */
export const BESPOKE_PREFIX = "design:";
export const pickId = (d: Pick<Design, "key" | "kit">) => d.kit ?? `${BESPOKE_PREFIX}${d.key}`;
