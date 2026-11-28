// The packs built into OPERATOR (docs/packs.md): data files in packs/, listed here. Department packs are in
// install order (a chain shared by two packs runs in this order: the numbers before the brief). Adding one is
// a pull request with a JSON file and a line below; check:packs checks every file. Nothing else in the app
// reads packs/.
import { packProblems, type AgentPack, type DepartmentPack, type Pack } from "@/core/pack-rules";
import { OPERATOR_VERSION } from "@/core/version";
import finance from "@/packs/finance.json";
import chiefOfStaff from "@/packs/chief-of-staff.json";
import prospecting from "@/packs/prospecting.json";
import emailMarketing from "@/packs/email-marketing.json";
import storeAnalytics from "@/packs/store-analytics.json";
import conversionAnalyst from "@/packs/conversion-analyst.json";

const FILES: unknown[] = [finance, chiefOfStaff, prospecting, emailMarketing, storeAnalytics, conversionAnalyst];

for (const f of FILES) {
  const p = packProblems(f, OPERATOR_VERSION);
  if (p.length) throw new Error(`A pack in packs/ is malformed: ${p.join("; ")}`);
}

/** Every built-in pack. */
export const PACKS: readonly Pack[] = FILES as Pack[];
/** The built-in department packs, in install order. */
export const DEPT_PACKS: readonly DepartmentPack[] = PACKS.filter((p): p is DepartmentPack => p.kind === "department");

/** The built-in agent packs: one agent for an open seat. */
export const AGENT_PACKS: readonly AgentPack[] = PACKS.filter((p): p is AgentPack => p.kind === "agent");

/** A built-in pack by id and kind, or null. */
export const packById = <K extends Pack["kind"]>(id: string, kind: K): Extract<Pack, { kind: K }> | null =>
  (PACKS.find((p) => p.id === id && p.kind === kind) as Extract<Pack, { kind: K }> | undefined) ?? null;

/** The department packs for the Company page's picker. */
export const packList = () => DEPT_PACKS.map((t) => ({ id: t.id, name: t.name, about: t.about }));

/** The picked department packs, in install order; unknown ids are refused. */
export function pickPacks(ids: readonly string[]): DepartmentPack[] {
  const want = new Set(ids);
  for (const id of want) if (!DEPT_PACKS.some((t) => t.id === id)) throw new Error(`There's no department pack ${id}.`);
  if (!want.size) throw new Error("Pick at least one department.");
  return DEPT_PACKS.filter((t) => want.has(t.id));
}
