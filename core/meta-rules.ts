// Meta Ads (card 255, docs/mcp-everywhere.md "Meta Ads"). Pure, so `npm run check:mcp` and
// `npm run check:policy` can test it.
//
// Meta's hosted Ads MCP server asks for ads_management on every sign-in, which can change campaigns
// and budgets, so our own server (integrations/meta-server.ts) runs in the app over the Marketing API
// with two sign-ins:
// - "Meta Ads" (agents, ads_read only): the ad accounts the sign-in sees, and spend and results per
//   ad over a period, with cost per result worked out here. A sign-in that can manage ads is refused.
// - "Meta Ads pauses" (gateway only, ads_management): one write, pause one active ad whose cost per
//   result is over the target on the approval card, after an approver approves. The server re-reads the
//   ad's numbers right before it writes and refuses when the ad is no longer over the target. There is
//   no budget, bid, create, resume or delete call: budget changes wait for a cap the owner sets.
// The host is fixed (graph.facebook.com, one pinned API version) and requests never follow redirects.

export const META_API = "https://graph.facebook.com/v26.0";
export const META_TOOLS = ["meta_ad_accounts", "meta_ad_results"] as const;
export const PAUSE_TOOL = "meta_pause_ad";
/** What a pause carries besides its ad: the result it is judged on, the period, the target, and why. */
export const PAUSE_FIELDS = ["result", "period", "target", "why"] as const;
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
const RESULT_KINDS = Object.keys(RESULTS) as MetaResult[];

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
 * The agents' sign-in must hold ads_read and must not hold ads_management or anything else; the
 * gateway's must hold ads_management, and may hold ads_read, nothing more.
 */
export function permissionProblem(profile: "meta" | "meta_pauses", raw: unknown): string | null {
  const granted = (((raw ?? {}) as { data?: { permission?: unknown; status?: unknown }[] }).data ?? [])
    .filter((p) => p?.status === "granted" && typeof p.permission === "string")
    .map((p) => p.permission as string);
  const need = profile === "meta" ? READ_PERMS : PAUSE_PERMS;
  const allowed = new Set<string>([...need, ...HARMLESS, ...(profile === "meta_pauses" ? READ_PERMS : [])]);
  const missing = need.filter((p) => !granted.includes(p));
  if (missing.length) return `this sign-in doesn't hold ${missing.join(", ")}`;
  const extra = granted.filter((p) => !allowed.has(p));
  if (extra.length) return profile === "meta" && extra.includes("ads_management")
    ? "this sign-in can manage ads. Agents get one with ads_read only"
    : `this sign-in holds more than it needs: ${extra.join(", ")}`;
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

export interface AdRow { id: string; name: string; campaign: string; status: string; spend: number; impressions: number; clicks: number; results: number; cost_per_result: number | null }
/**
 * Spend and results per ad, with totals, all counted here. Names were typed by people, so they are cut.
 * `statuses` is each ad's effective status, as Meta lists the account's ads.
 */
export function readResults(raw: readonly unknown[], statuses: ReadonlyMap<string, string>, result: MetaResult, truncated: boolean) {
  const rows: AdRow[] = [];
  for (const r of raw) {
    const x = (r ?? {}) as Record<string, unknown>;
    if (!adIdOk(x.ad_id)) continue;
    const spend = cents(num(x.spend));
    const results = resultsOf(x.actions, result);
    rows.push({ id: x.ad_id, name: plain(x.ad_name, 80), campaign: plain(x.campaign_name, 80), status: statuses.get(x.ad_id) ?? "UNKNOWN", spend, impressions: num(x.impressions), clicks: num(x.clicks), results, cost_per_result: costPer(spend, results) });
  }
  const spend = cents(rows.reduce((n, r) => n + r.spend, 0));
  const results = rows.reduce((n, r) => n + r.results, 0);
  return {
    ads: [...rows].sort((a, b) => b.spend - a.spend).slice(0, 50),
    totals: { ads: rows.length, active_ads: rows.filter((r) => r.status === "ACTIVE").length, spend, results, cost_per_result: costPer(spend, results) },
    result,
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

/** Why a pause is refused: a result kind, a period, a target and a plain reason, nothing else. */
export function refusePause(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => !(PAUSE_FIELDS as readonly string[]).includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A pause has only its result, period, target and why.`;
  if (!RESULT_KINDS.includes(args.result as MetaResult)) return `result is one of ${RESULT_KINDS.join(", ")}.`;
  if (!META_PERIODS.includes(args.period as MetaPeriod)) return `period is one of ${META_PERIODS.join(", ")}.`;
  const t = args.target;
  if (typeof t !== "number" || !Number.isFinite(t) || t <= 0 || t > TARGET_MAX) return `target is a cost per result above 0 and at most ${TARGET_MAX}.`;
  if (Math.abs(Math.round(t * 100) - t * 100) > 1e-6) return "target is in whole cents.";
  const why = args.why;
  if (typeof why !== "string" || !why.trim()) return "The pause needs a reason.";
  if (why.length > WHY_MAX) return `The reason is longer than ${WHY_MAX} characters.`;
  if (/[\u0000-\u001f\u007f]/.test(why)) return "The reason may not hold control characters.";
  if (/https?:\/\/|www\.|<[a-z/!]/i.test(why)) return "A reason may not hold links or markup.";
  return null;
}

/** What the server accepts for its one write tool, checked again there. The reason stays in OPERATOR. */
export function checkPauseArgs(raw: unknown): { adId: string; result: MetaResult; period: MetaPeriod; target: number } | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!adIdOk(a.adId)) return { problem: "adId must be a Meta ad id" };
  const { adId, ...rest } = a;
  const no = refusePause({ why: "checked by the gateway", ...rest });
  return no ? { problem: no } : { adId: adId as string, result: a.result as MetaResult, period: a.period as MetaPeriod, target: a.target as number };
}
