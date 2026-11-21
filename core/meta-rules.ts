// Meta Ads (card 255, docs/mcp-everywhere.md "Meta Ads"). Pure, so `npm run check:mcp` and
// `npm run check:policy` can test it.
//
// Meta's hosted Ads MCP server asks for ads_management on every sign-in, which can change campaigns
// and budgets, so our own server (integrations/meta-server.ts) runs in the app over the Marketing API
// with two sign-ins:
// - "Meta Ads" (agents, asks for ads_read only): the ad accounts the sign-in sees, and spend and results
//   per ad over a period, with cost per result worked out here. Our server serves it read tools only.
// - "Meta Ads pauses" (gateway only, ads_management): one write, pause one active ad whose cost per
//   result is over the owner's target for it, after an approver approves. The server re-reads the
//   ad's numbers right before it writes and refuses when the ad is no longer over the target. There is
//   no budget, bid, create, resume or delete call: budget changes wait for a cap the owner sets.
// Both sign in with OPERATOR's Meta app (Facebook Login). Meta grants permissions to a person and an
// app, so the agents' sign-in may list ads_management once pauses are connected: there, as with
// Mailchimp keys, our own server is the limit. The host is fixed (graph.facebook.com, one pinned API
// version) and requests never follow redirects.

export const META_API = "https://graph.facebook.com/v26.0";
export const META_TOOLS = ["meta_ad_accounts", "meta_ad_results"] as const;
export const PAUSE_TOOL = "meta_pause_ad";
/** What a pause carries besides its ad: the result it is judged on, the period, and why. The target is the owner's, never the agent's. */
export const PAUSE_FIELDS = ["result", "period", "why"] as const;
export const WHY_MAX = 300;
/** The most a cost target may be, in the account's currency: a guard against a stray zero, not a cap on spend. */
export const TARGET_MAX = 10_000;
/** At most this many pages of rows are read for one call; more is said, never guessed. */
export const MAX_PAGES = 4;

export const META_PERIODS = ["last_7_days", "last_30_days", "last_90_days"] as const;
export type MetaPeriod = (typeof META_PERIODS)[number];
/** Meta's own date presets for each period. */
export const PRESET: Record<MetaPeriod, string> = { last_7_days: "last_7d", last_30_days: "last_30d", last_90_days: "last_90d" };

/** What counts as one result, and the action types Meta reports it under, first match wins (they overlap). */
export const RESULTS = {
  purchase: ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"],
  lead: ["lead", "onsite_conversion.lead_grouped", "offsite_conversion.fb_pixel_lead"],
  link_click: ["link_click"],
} as const;
export type MetaResult = keyof typeof RESULTS;
export const RESULT_KINDS = Object.keys(RESULTS) as MetaResult[];
export const RESULT_LABEL: Record<MetaResult, string> = { purchase: "purchase", lead: "lead", link_click: "link click" };

/**
 * The owner's cost targets, one per kind of result, kept as policies rows (Connections, Meta Ads
 * pauses). An agent can propose pausing an ad only against one of these, and the gateway reads it
 * again right before the pause. With no target set for a result, nothing is paused on it.
 */
export const TARGET_KEYS: Record<MetaResult, string> = { purchase: "meta_target_cost_per_purchase", lead: "meta_target_cost_per_lead", link_click: "meta_target_cost_per_click" };
/** A target as stored: a positive amount in whole cents, at most TARGET_MAX, or null when unset or bad. */
export function readTarget(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 && n <= TARGET_MAX && Math.abs(Math.round(n * 100) - n * 100) < 1e-6 ? n : null;
}
/** Why a new target can't be saved, or null. A blank clears it. */
export function targetProblem(raw: string): string | null {
  if (!raw.trim()) return null;
  const n = Number(raw.trim().replace(/^\$/, ""));
  if (!Number.isFinite(n) || n <= 0) return "Type an amount above 0, or leave it blank for no target.";
  if (n > TARGET_MAX) return `A target can be at most ${TARGET_MAX}.`;
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) return "Whole cents only.";
  return null;
}

/** The permissions each sign-in may hold. Anything else Meta lists as granted refuses the sign-in. */
export const READ_PERMS = ["ads_read"] as const;
export const PAUSE_PERMS = ["ads_management"] as const;
const HARMLESS = ["public_profile"];

/** Ad account ids are act_ and digits; ad ids are digits. */
export const accountIdOk = (s: unknown): s is string => typeof s === "string" && /^act_\d{1,20}$/.test(s);
export const adIdOk = (s: unknown): s is string => typeof s === "string" && /^\d{1,25}$/.test(s);

/** The insights fields asked for: numbers per ad, no audience, creative or person. */
export const INSIGHT_FIELDS = ["ad_id", "ad_name", "campaign_name", "spend", "impressions", "clicks", "actions"] as const;
export const ACCOUNT_FIELDS = ["account_id", "name", "currency", "account_status", "amount_spent"] as const;

/**
 * Why a sign-in can't be kept, from Meta's own list of what it granted (GET /me/permissions), or null.
 * Meta grants permissions to a person and an app, not to one sign-in, so once the same person connects
 * pauses, the agents' sign-in lists ads_management too: it is allowed there, and our server is the limit
 * (the agents' profile serves read tools only). Anything beyond ads_read and ads_management refuses it.
 */
export function permissionProblem(profile: "meta" | "meta_pauses", raw: unknown): string | null {
  const granted = (((raw ?? {}) as { data?: { permission?: unknown; status?: unknown }[] }).data ?? [])
    .filter((p) => p?.status === "granted" && typeof p.permission === "string")
    .map((p) => p.permission as string);
  const need = profile === "meta" ? READ_PERMS : PAUSE_PERMS;
  const allowed = new Set<string>([...READ_PERMS, ...PAUSE_PERMS, ...HARMLESS]);
  const missing = need.filter((p) => !granted.includes(p));
  if (missing.length) return `this sign-in doesn't hold ${missing.join(", ")}`;
  const extra = granted.filter((p) => !allowed.has(p));
  if (extra.length) return `this sign-in holds more than it needs: ${extra.join(", ")}. Remove OPERATOR in Facebook (Settings, Business integrations) and connect again`;
  return null;
}

/** A read tool's input, checked again on our server. Anything not named here is refused. */
export function checkMetaArgs(tool: string, raw: unknown):
  | { tool: "meta_ad_accounts" }
  | { tool: "meta_ad_results"; account: string; period: MetaPeriod; result: MetaResult }
  | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed: Record<string, string[]> = { meta_ad_accounts: [], meta_ad_results: ["account", "period", "result"] };
  if (!(tool in allowed)) return { problem: `${tool || "that"} isn't a Meta Ads read tool` };
  const extra = Object.keys(a).filter((k) => !allowed[tool].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  if (tool === "meta_ad_accounts") return { tool };
  if (!accountIdOk(a.account)) return { problem: "account must be an ad account id (act_…) from meta_ad_accounts" };
  const period = (a.period ?? "last_30_days") as MetaPeriod;
  if (!META_PERIODS.includes(period)) return { problem: `period is one of ${META_PERIODS.join(", ")}` };
  const result = (a.result ?? "purchase") as MetaResult;
  if (!RESULT_KINDS.includes(result)) return { problem: `result is one of ${RESULT_KINDS.join(", ")}` };
  return { tool: "meta_ad_results", account: a.account, period, result };
}

const num = (v: unknown) => (v !== null && v !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const plain = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
const cents = (n: number) => Math.round(n * 100) / 100;

/** How many results one insights row holds, by the first of the result's action types Meta reported. */
export function resultsOf(actions: unknown, result: MetaResult): number {
  const list = Array.isArray(actions) ? (actions as { action_type?: unknown; value?: unknown }[]) : [];
  for (const t of RESULTS[result]) {
    const hit = list.find((x) => x?.action_type === t);
    if (hit) return num(hit.value);
  }
  return 0;
}

/** Cost per result, in code. No results with spend is "no results yet" (null), never a made-up number. */
export const costPer = (spend: number, results: number): number | null => (results > 0 ? cents(spend / results) : null);

export interface AccountRow { id: string; name: string; currency: string; active: boolean; spent_all_time: number }
/** Ad accounts as Meta lists them. amount_spent is in the account's minor unit (cents). */
export function readAccounts(raw: readonly unknown[]): AccountRow[] {
  const out: AccountRow[] = [];
  for (const r of raw) {
    const a = (r ?? {}) as Record<string, unknown>;
    const id = `act_${String(a.account_id ?? "")}`;
    if (!accountIdOk(id)) continue;
    out.push({ id, name: plain(a.name, 80), currency: plain(a.currency, 3).toUpperCase(), active: Number(a.account_status) === 1, spent_all_time: cents(num(a.amount_spent) / 100) });
  }
  return out;
}

export interface AdRow { id: string; name: string; campaign: string; status: string; spend: number; impressions: number; clicks: number; results: number; cost_per_result: number | null; over_target: boolean | null }
/**
 * Spend and results per ad, with totals, all counted here. Names were typed by people, so they are cut.
 * `statuses` is each ad's effective status, as Meta lists the account's ads.
 */
export function readResults(raw: readonly unknown[], statuses: ReadonlyMap<string, string>, result: MetaResult, truncated: boolean, target: number | null = null) {
  const rows: AdRow[] = [];
  for (const r of raw) {
    const x = (r ?? {}) as Record<string, unknown>;
    if (!adIdOk(x.ad_id)) continue;
    const spend = cents(num(x.spend));
    const results = resultsOf(x.actions, result);
    rows.push({ id: x.ad_id, name: plain(x.ad_name, 80), campaign: plain(x.campaign_name, 80), status: statuses.get(x.ad_id) ?? "UNKNOWN", spend, impressions: num(x.impressions), clicks: num(x.clicks), results, cost_per_result: costPer(spend, results), over_target: target === null ? null : overTarget(spend, results, target) });
  }
  const spend = cents(rows.reduce((n, r) => n + r.spend, 0));
  const results = rows.reduce((n, r) => n + r.results, 0);
  return {
    ads: [...rows].sort((a, b) => b.spend - a.spend).slice(0, 50),
    totals: { ads: rows.length, active_ads: rows.filter((r) => r.status === "ACTIVE").length, spend, results, cost_per_result: costPer(spend, results), active_over_target: rows.filter((r) => r.status === "ACTIVE" && r.over_target).length },
    result,
    target,
    truncated,
  };
}

/**
 * Whether an ad is over its target right now: its cost per result is above the target, or it has spent
 * more than the target with no result at all. Both come from Meta's numbers, compared here.
 */
export function overTarget(spend: number, results: number, target: number): boolean {
  const c = costPer(spend, results);
  return c === null ? spend > target : c > target;
}

/** Why a pause is refused: a result kind, a period and a plain reason, nothing else. */
export function refusePause(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => !(PAUSE_FIELDS as readonly string[]).includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A pause has only its result, period and why.`;
  if (!RESULT_KINDS.includes(args.result as MetaResult)) return `result is one of ${RESULT_KINDS.join(", ")}.`;
  if (!META_PERIODS.includes(args.period as MetaPeriod)) return `period is one of ${META_PERIODS.join(", ")}.`;
  const why = args.why;
  if (typeof why !== "string" || !why.trim()) return "The pause needs a reason.";
  if (why.length > WHY_MAX) return `The reason is longer than ${WHY_MAX} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(why)) return "The reason may not hold control characters.";
  if (/https?:\/\/|www\.|<[a-z/!]/i.test(why)) return "A reason may not hold links or markup.";
  return null;
}

/** What the server accepts for its one write tool, checked again there: the ad, the result, the period and the owner's target, which the gateway reads. */
export function checkPauseArgs(raw: unknown): { adId: string; result: MetaResult; period: MetaPeriod; target: number } | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const extra = Object.keys(a).filter((k) => !["adId", "result", "period", "target"].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  if (!adIdOk(a.adId)) return { problem: "adId must be a Meta ad id" };
  if (!RESULT_KINDS.includes(a.result as MetaResult)) return { problem: `result is one of ${RESULT_KINDS.join(", ")}` };
  if (!META_PERIODS.includes(a.period as MetaPeriod)) return { problem: `period is one of ${META_PERIODS.join(", ")}` };
  const target = readTarget(a.target);
  if (target === null) return { problem: `target is a cost per result above 0 and at most ${TARGET_MAX}, in whole cents` };
  return { adId: a.adId, result: a.result as MetaResult, period: a.period as MetaPeriod, target };
}
