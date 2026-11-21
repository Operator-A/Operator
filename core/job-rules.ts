// The job queue's rules (docs/tenancy.md, slice 3), pure so `npm run check:jobs` can test them.
// A job is a row in `jobs`: work that runs on its own (a chain's step), picked up by a worker
// request (/api/jobs/<id>) that runs it as the job's org.

export const JOB_KINDS = ["chain_step"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

/** A claimed job that hasn't finished after this long is marked failed: longer than a worker's 300 s limit. */
export const STALE_MS = 6 * 60_000;
/**
 * A waiting job more than this long past its start time is marked failed, not started: a step meant
 * for the morning shouldn't run in the evening because its kicks were failing. Longer than the
 * scheduler's own lateness (a 15-minute schedule that may run 15 minutes late), with room to spare.
 */
export const MISSED_MS = 2 * 60 * 60_000;
export const MISSED_OUTCOME = "Never started: more than 2 hours past its start time, so it was skipped rather than run late.";
/** How many due jobs one scheduler call starts per org. */
export const DUE_LIMIT = 20;

export interface ChainCtx {
  chainId: string;
  key: string;
  step: number;
  /** The run of the step before, for the hand-off and the replay. */
  parent?: string;
  /** Started with the Run chain button: later steps go on even while the chain or the org is off. */
  manual?: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/** A chain step's payload: names a chain and a step of the saved flow, nothing else. */
export function chainPayload(ctx: ChainCtx): Record<string, unknown> {
  return { chainId: ctx.chainId, key: ctx.key, step: ctx.step, ...(ctx.parent ? { parent: ctx.parent } : {}), ...(ctx.manual ? { manual: true } : {}) };
}

/** A chain step's payload, checked; null when it is malformed. */
export function readChainPayload(p: unknown): ChainCtx | null {
  if (!p || typeof p !== "object" || Array.isArray(p)) return null;
  const { chainId, key, step, parent, manual } = p as Record<string, unknown>;
  if (!isUuid(chainId) || typeof key !== "string" || !/^[a-z0-9_-]{1,40}$/.test(key)) return null;
  if (typeof step !== "number" || !Number.isInteger(step) || step < 0 || step > 9) return null;
  if (parent !== undefined && !isUuid(parent)) return null;
  if (manual !== undefined && typeof manual !== "boolean") return null;
  return { chainId, key, step, ...(parent ? { parent } : {}), ...(manual ? { manual: true } : {}) };
}

/** One job per step of a chain: enqueueing the same step twice does nothing. */
export const chainDedupe = (ctx: Pick<ChainCtx, "chainId" | "step">) => `chain:${ctx.chainId}:${ctx.step}`;

/**
 * The headers of a kick (core/jobs.ts): the CRON_SECRET bearer, and Vercel's protection bypass when
 * the project has one, so Vercel Authentication answers the worker instead of a sign-in redirect.
 */
export function kickHeaders(cronSecret: string, bypass?: string): Record<string, string> {
  return { authorization: `Bearer ${cronSecret}`, ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}) };
}

/** Why a fetch failed, in words: undici's "fetch failed" hides the reason in its cause (e.g. "unexpected redirect"). */
export function fetchFailure(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const c = (e as Error & { cause?: unknown }).cause;
  const why = c instanceof Error ? c.message : typeof c === "string" ? c : "";
  return why && why !== e.message ? `${e.message}: ${why}` : e.message;
}

/** Text for the outcome column, cut to fit. */
export const outcomeText = (s: string) => (s.length > 1000 ? `${s.slice(0, 997)}...` : s);
