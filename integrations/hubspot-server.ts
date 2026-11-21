import "server-only";
// Our own HubSpot MCP server (card 253, docs/mcp-everywhere.md "HubSpot"). HubSpot's hosted MCP server
// takes its scopes from its tool list, writes included, so this one runs in the app over HubSpot's CRM
// API. It is the only file that calls HubSpot, and only integrations/mcp.ts reaches it (lint). Agents'
// service key (profile "hubspot"): open deals by stage and counts of contacts and companies, asking for
// no contact list, email or phone. The gateway's key (profile "hubspot_deals"): move one deal to another
// stage of its own pipeline and log a note on it. There is no create, delete, merge, contact, company,
// email or sequence call, and none may be added (check:mcp fails on one).
import { MCP_PROTOCOL, checkedTools, type McpId } from "@/core/mcp-rules";
import { DEAL_PROPS, HUBSPOT_API, MAX_PAGES, MOVE_TOOL, NOTE_TO_DEAL, checkHubSpotArgs, checkMoveArgs, noteBody, readDeals, readPipelines, sinceMs } from "@/core/hubspot-rules";

const TIMEOUT_MS = 25_000;
const DESCRIPTIONS: Record<string, string> = {
  hubspot_deals: "Open deals by stage with amounts, and the ones gone quiet, counted in code. Each deal and stage carries an id for a move. No contacts or emails.",
  hubspot_contacts: "How many contacts and companies the business has, and how many were added in a period. Counts only.",
  [MOVE_TOOL]: "Moves one deal to another stage of its own pipeline and logs a note on it. Gateway only, after an approval.",
};

async function hs(key: string, path: string, init?: { method: "POST" | "PATCH"; body: unknown }): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${HUBSPOT_API}${path}`, {
    method: init?.method ?? "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Bearer ${key.trim()}`, Accept: "application/json", ...(init ? { "Content-Type": "application/json" } : {}) },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text().catch(() => "");
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const must = (r: { status: number; json: unknown }, what: string) => {
  if (r.status < 200 || r.status >= 300) throw new Error(`HubSpot ${r.status} on ${what}: ${JSON.stringify((r.json as { message?: unknown } | null)?.message ?? r.json ?? "").slice(0, 200)}`);
  return r.json;
};
const total = (j: unknown) => Number((j as { total?: unknown } | null)?.total ?? 0) || 0;
const countSearch = (object: "contacts" | "companies", since?: number) => ({
  method: "POST" as const,
  body: { limit: 1, properties: ["createdate"], filterGroups: since === undefined ? [] : [{ filters: [{ propertyName: "createdate", operator: "GTE", value: String(since) }] }] },
});

/**
 * Before a key is kept: HubSpot answers with it, and whether it can write deals is the one the profile
 * needs. The probe asks to change no property on deal 0, which doesn't exist: a key without deal write
 * is refused for the scope (403), a key with it gets "no such deal" (400 or 404). Nothing is written.
 */
export async function checkHubSpotKey(profile: McpId, key: string): Promise<{ name: string; workspace: string }> {
  must(await hs(key, "/crm/v3/objects/deals?limit=1&properties=dealstage"), "read deals");
  const probe = await hs(key, "/crm/v3/objects/deals/0", { method: "PATCH", body: { properties: {} } });
  const canWrite = probe.status === 400 || probe.status === 404;
  if (probe.status !== 403 && !canWrite) throw new Error(`HubSpot ${probe.status}: couldn't tell whether this key can change deals`);
  if (profile === "hubspot" && canWrite) throw new Error("this key can change deals. Agents get a key with read scopes only: remove crm.objects.deals.write");
  if (profile === "hubspot_deals" && !canWrite) throw new Error("this key can't change deals. The gateway's key needs crm.objects.deals.write");
  const acct = await hs(key, "/account-info/v3/details").catch(() => null);
  const portal = (acct?.json as { portalId?: unknown } | null)?.portalId;
  return { name: Number.isInteger(portal) ? `HubSpot account ${portal}` : "HubSpot", workspace: profile === "hubspot" ? "read only" : "deal moves only" };
}

/** A JSON-RPC handler for one call, serving only `profile`'s tools, with the key the vault opened. */
export function hubspotServer(profile: McpId, key: string, now: () => number = Date.now) {
  const offered = checkedTools(profile).filter((t) => t in DESCRIPTIONS);
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-hubspot", version: "1" } });
      case "tools/list":
        return reply(id, { tools: offered.map((name) => ({ name, description: DESCRIPTIONS[name], annotations: { readOnlyHint: name !== MOVE_TOOL, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!offered.includes(name)) return toolError(id, `${name || "That"} isn't a tool this key serves.`);
        try {
          let result: unknown;
          if (name === MOVE_TOOL) {
            const a = checkMoveArgs(req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            // the deal and its pipeline's stages as HubSpot lists them now, on this key, right before the write
            const deal = must(await hs(key, `/crm/v3/objects/deals/${a.dealId}?properties=dealstage,pipeline,dealname`), "read deal") as { id?: unknown; properties?: Record<string, unknown> };
            if (String(deal?.id) !== a.dealId) throw new Error("HubSpot 404: that deal isn't in HubSpot any more");
            const pipeline = String(deal.properties?.pipeline ?? "");
            const from = String(deal.properties?.dealstage ?? "");
            const stages = readPipelines(must(await hs(key, "/crm/v3/pipelines/deals"), "read pipelines")).filter((s) => s.pipeline === pipeline);
            const to = stages.find((s) => s.id === a.stage);
            if (!to) throw new Error("That stage isn't in this deal's pipeline any more.");
            if (from === a.stage) throw new Error("The deal is already in that stage.");
            must(await hs(key, `/crm/v3/objects/deals/${a.dealId}`, { method: "PATCH", body: { properties: { dealstage: a.stage } } }), "move deal");
            const note = await hs(key, "/crm/v3/objects/notes", {
              method: "POST",
              body: { properties: { hs_timestamp: new Date(now()).toISOString(), hs_note_body: noteBody(a.note) }, associations: [{ to: { id: a.dealId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO_DEAL }] }] },
            });
            if (note.status < 200 || note.status >= 300) throw new Error(`The deal moved to ${to.label}, but HubSpot ${note.status} refused the note: ${JSON.stringify((note.json as { message?: unknown } | null)?.message ?? "").slice(0, 200)}`);
            const fromLabel = stages.find((s) => s.id === from)?.label ?? from;
            result = { dealId: a.dealId, from, fromLabel, to: a.stage, toLabel: to.label, noteId: String((note.json as { id?: unknown } | null)?.id ?? "") };
          } else {
            const a = checkHubSpotArgs(name, req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            if (a.tool === "hubspot_deals") {
              const stages = readPipelines(must(await hs(key, "/crm/v3/pipelines/deals"), "read pipelines"));
              const all: unknown[] = [];
              let after = "";
              let more = false;
              for (let p = 0; p < MAX_PAGES; p++) {
                const j = must(await hs(key, `/crm/v3/objects/deals?limit=100&archived=false&properties=${DEAL_PROPS.join(",")}${after ? `&after=${encodeURIComponent(after)}` : ""}`), "list deals") as { results?: unknown[]; paging?: { next?: { after?: unknown } } };
                all.push(...(j.results ?? []));
                after = String(j.paging?.next?.after ?? "");
                more = !!after;
                if (!more) break;
              }
              result = { ...readDeals(all, stages, now(), more), stage_ids: stages.filter((s) => !s.closed).map((s) => ({ id: s.id, stage: s.label, pipeline: s.pipelineLabel })) };
            } else {
              const since = sinceMs(a.period, now());
              const [c, cNew, co, coNew] = await Promise.all([
                hs(key, "/crm/v3/objects/contacts/search", countSearch("contacts")),
                hs(key, "/crm/v3/objects/contacts/search", countSearch("contacts", since)),
                hs(key, "/crm/v3/objects/companies/search", countSearch("companies")),
                hs(key, "/crm/v3/objects/companies/search", countSearch("companies", since)),
              ]);
              result = { contacts: total(must(c, "count contacts")), new_contacts: total(must(cNew, "count contacts")), companies: total(must(co, "count companies")), new_companies: total(must(coNew, "count companies")), period: a.period };
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
