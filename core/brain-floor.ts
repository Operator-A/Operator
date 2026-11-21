// The shared brain's floor (docs/shared-brain.md, card 231), kept apart so core/db.ts can use it
// without the rest of core/brain-rules.ts. Pure.

/** A pattern crosses between businesses only when at least this many share it. Also written in brain_patterns() (SQL). */
export const BRAIN_FLOOR = 5;

/** A row from brain_patterns(), as code reads it. */
export interface PatternRow { cohort: string; pattern: string; orgs: number; hits: number; num: number | null; den: number | null }

/** The floor again in code, for anything that reads brain_patterns(): a row under it is dropped, whatever the database said. */
export const overFloor = (rows: readonly PatternRow[]): PatternRow[] => rows.filter((r) => r.orgs >= BRAIN_FLOOR && r.hits >= BRAIN_FLOOR);
