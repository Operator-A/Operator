import "server-only";
// Our own Meta Ads MCP server (card 255, docs/mcp-everywhere.md "Meta Ads"). Meta's hosted Ads MCP
// server asks for ads_management on every sign-in, so this one runs in the app over the Marketing API.
// It is the only file that calls Meta, and only integrations/mcp.ts reaches it (lint). Agents' sign-in
// (profile "meta", ads_read): ad accounts, and spend and results per ad. The gateway's sign-in (profile
// "meta_pauses", ads_management): pause one active ad that is over its target right now. There is no
// budget, bid, create, resume or delete call, and none may be added (check:mcp fails on one).
import { MCP_PROTOCOL, checkedTools, type McpId } from "@/core/mcp-rules";
import { ACCOUNT_FIELDS, INSIGHT_FIELDS, MAX_PAGES, META_API, PAUSE_TOOL, PRESET, checkMetaArgs, checkPauseArgs, costPer, overTarget, permissionProblem, readAccounts, readResults, resultsOf } from "@/core/meta-rules";

const TIMEOUT_MS = 25_000;
const DESCRIPTIONS: Record<string, string> = {
  meta_ad_accounts: "The ad accounts this sign-in sees, with currency and whether each is active.",
  meta_ad_results: "Spend and results per ad over a period, with cost per result worked out in code. Each ad carries an id for a pause. No audiences or people.",
  [PAUSE_TOOL]: "Pauses one active ad whose cost per result is over the target right now. Gateway only, after an approval.",
};

async function fb(token: string, path: string, form?: Record<string, string>): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${META_API}${path}`, {
    method: form ? "POST" : "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${token.trim()}`, Accept: "application/json", ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const must = (r: { status: number; json: unknown }, what: string) => {
  if (r.status < 200 || r.status >= 300) {
    const err = (r.json as { error?: { message?: unknown; code?: unknown } } | null)?.error;
    // Meta says an expired or cancelled sign-in with code 190; it pauses the sign-in like a 401
    const status = err?.code === 190 ? 401 : r.status;
    throw new Error(`Meta ${status} on ${what}: ${JSON.stringify(err?.message ?? "").slice(0, 200)}`);
  }
  return r.json;
};
/** Every page of a list, up to MAX_PAGES, following only Meta's own cursor on our fixed path. */
async function pages(token: string, path: string, what: string): Promise<{ rows: unknown[]; more: boolean }> {
  const rows: unknown[] = [];
  let after = "";
  for (let p = 0; p < MAX_PAGES; p++) {
    const j = must(await fb(token, `${path}${after ? `&after=${encodeURIComponent(after)}` : ""}`), what) as { data?: unknown[]; paging?: { cursors?: { after?: unknown }; next?: unknown } };
    rows.push(...(j.data ?? []));
    after = j.paging?.next ? String(j.paging?.cursors?.after ?? "") : "";
    if (!after) return { rows, more: false };
  }
  return { rows, more: true };
}

/** Before a sign-in is kept: Meta's own list of what it granted must match the profile exactly. */
export async function checkMetaSignIn(profile: McpId, token: string): Promise<{ name: string; workspace: string }> {
  if (profile !== "meta" && profile !== "meta_pauses") throw new Error("not a Meta Ads sign-in");
  const problem = permissionProblem(profile, must(await fb(token, "/me/permissions"), "read permissions"));
  if (problem) throw new Error(problem);
  const me = (await fb(token, "/me?fields=name").catch(() => null))?.json as { name?: unknown } | null;
  const accounts = readAccounts((await pages(token, `/me/adaccounts?fields=${ACCOUNT_FIELDS.join(",")}&limit=50`, "list ad accounts")).rows);
  if (!accounts.length) throw new Error("this sign-in can't see any ad account");
  const who = typeof me?.name === "string" ? me.name.slice(0, 80) : "Meta";
  return { name: `${who}, ${accounts.length} ad account${accounts.length === 1 ? "" : "s"}`, workspace: profile === "meta" ? "read only" : "pauses only" };
}

/** A JSON-RPC handler for one call, serving only `profile`'s tools, with the token the vault opened. */
export function metaServer(profile: McpId, token: string) {
  const offered = checkedTools(profile).filter((t) => t in DESCRIPTIONS);
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-meta-ads", version: "1" } });
      case "tools/list":
        return reply(id, { tools: offered.map((name) => ({ name, description: DESCRIPTIONS[name], annotations: { readOnlyHint: name !== PAUSE_TOOL, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!offered.includes(name)) return toolError(id, `${name || "That"} isn't a tool this sign-in serves.`);
        try {
          let result: unknown;
          if (name === PAUSE_TOOL) {
            const a = checkPauseArgs(req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            // the ad and its numbers as Meta reports them now, on this sign-in, right before the write
            const ad = must(await fb(token, `/${a.adId}?fields=id,name,effective_status`), "read ad") as { id?: unknown; name?: unknown; effective_status?: unknown };
            if (String(ad?.id) !== a.adId) throw new Error("Meta 404: that ad isn't there any more");
            if (ad.effective_status !== "ACTIVE") throw new Error(`The ad isn't running (it is ${String(ad.effective_status ?? "unknown").toLowerCase()}), so there is nothing to pause.`);
            const ins = must(await fb(token, `/${a.adId}/insights?date_preset=${PRESET[a.period]}&fields=spend,actions`), "read the ad's results") as { data?: { spend?: unknown; actions?: unknown }[] };
            const row = ins.data?.[0] ?? {};
            const spend = Math.round(Number(row.spend ?? 0) * 100) / 100 || 0;
            const results = resultsOf(row.actions, a.result);
            if (!overTarget(spend, results, a.target)) throw new Error(`The ad is no longer over its target: ${results} result${results === 1 ? "" : "s"} for ${spend} (cost per result ${costPer(spend, results) ?? "none yet"}, target ${a.target}).`);
            const out = must(await fb(token, `/${a.adId}`, { status: "PAUSED" }), "pause ad") as { success?: unknown };
            if (out?.success !== true) throw new Error("Meta didn't confirm the pause");
            result = { adId: a.adId, name: String(ad.name ?? "").slice(0, 80), was: "ACTIVE", now: "PAUSED", spend, results, cost_per_result: costPer(spend, results), target: a.target };
          } else {
            const a = checkMetaArgs(name, req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            const accounts = readAccounts((await pages(token, `/me/adaccounts?fields=${ACCOUNT_FIELDS.join(",")}&limit=50`, "list ad accounts")).rows);
            if (a.tool === "meta_ad_accounts") {
              result = { accounts };
            } else {
              // only an account this sign-in lists, so an id from anywhere else reads nothing
              const acct = accounts.find((x) => x.id === a.account);
              if (!acct) throw new Error("That ad account isn't one this sign-in sees.");
              const ads = await pages(token, `/${a.account}/ads?fields=id,effective_status&limit=200`, "list ads");
              const statuses = new Map<string, string>();
              for (const x of ads.rows as { id?: unknown; effective_status?: unknown }[]) if (typeof x?.id === "string") statuses.set(x.id, String(x.effective_status ?? "UNKNOWN"));
              const ins = await pages(token, `/${a.account}/insights?level=ad&date_preset=${PRESET[a.period]}&fields=${INSIGHT_FIELDS.join(",")}&limit=200`, "read results");
              result = { account: acct.id, currency: acct.currency, period: a.period, ...readResults(ins.rows, statuses, a.result, ins.more || ads.more) };
            }
          }
          return reply(id, { structuredContent: { result }, content: [{ type: "text", text: "ok" }] });
        } catch (e) {
          return toolError(id, e instanceof Error ? e.message : String(e));
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `no method ${req.method}` } };
    }
  };
}
