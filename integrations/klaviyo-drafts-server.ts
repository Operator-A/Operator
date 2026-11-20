import "server-only";
// Klaviyo campaign drafts (card 159b, docs/mcp-everywhere.md "Klaviyo campaign drafts"). Klaviyo's
// hosted MCP server is used read-only for agents, so the one write it can't do safely runs on our own
// small server in the app. Its key (a Klaviyo private key with campaigns:write, templates:write and
// lists:read, refused when it can also read profiles, flows or metrics) is pasted on Connections into
// the token vault, and only core/gateway reaches it, through callWriteTool, after an approver
// approves. One tool: make a template and a draft campaign to one of the business's own lists. No
// send job, schedule, cancel or delete call is here, and none may be added (check:mcp fails on one):
// the owner sends every campaign from Klaviyo. Only integrations/mcp.ts imports this file (lint).
import { MCP_PROTOCOL, checkedTools } from "@/core/mcp-rules";
import { campaignHtml, campaignName, campaignText, checkDraftArgs, looksLikeKlaviyoKey } from "@/core/klaviyo-draft-rules";

const BASE = "https://a.klaviyo.com/api";
/** Pinned so a change on Klaviyo's side can't change what a call does. */
const REVISION = "2024-10-15";
const TIMEOUT_MS = 25_000;
const OFFERED = checkedTools("klaviyo_drafts");
/** Reads this key must NOT be able to do: a key that can is more than the profile needs, and is refused. */
const TOO_MUCH = [["profiles", "profiles:read"], ["flows", "flows:read"], ["metrics", "metrics:read"]] as const;

function headers(key: string): Record<string, string> {
  return { Authorization: `Klaviyo-API-Key ${key}`, revision: REVISION, Accept: "application/vnd.api+json", "Content-Type": "application/vnd.api+json" };
}

async function get(key: string, path: string) {
  return fetch(`${BASE}/${path}`, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS), headers: headers(key) });
}

async function post(key: string, path: string, body: unknown, what: string): Promise<{ data?: { id?: string; relationships?: Record<string, { data?: { id?: string }[] }> } }> {
  const res = await fetch(`${BASE}/${path}`, { method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS), headers: headers(key), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Klaviyo ${res.status} on ${what}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.status === 204 ? {} : res.json().catch(() => ({}));
}

/** Before the key is kept: its shape, that Klaviyo accepts it for lists, and that it reaches no more than the profile. */
export async function checkKlaviyoDraftsKey(key: string): Promise<{ name: string; workspace: string }> {
  if (!looksLikeKlaviyoKey(key)) throw new Error("not a Klaviyo private API key (pk_…)");
  const res = await get(key, "lists?page[size]=1");
  if (res.status === 401) throw new Error("Klaviyo 401: the key wasn't accepted");
  if (!res.ok) throw new Error(`Klaviyo ${res.status}: the key needs lists:read`);
  for (const [path, scope] of TOO_MUCH) {
    const r = await get(key, `${path}?page[size]=1`);
    if (r.ok) throw new Error(`the key can also use ${scope}. Make a key with only campaigns:write, templates:write and lists:read`);
  }
  return { name: "Klaviyo campaign drafts key", workspace: "drafts only" };
}

/** A JSON-RPC handler for one call, with the key the vault opened. */
export function klaviyoDraftsServer(key: string) {
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-klaviyo-drafts", version: "1" } });
      case "tools/list":
        return reply(id, { tools: OFFERED.map((name) => ({ name, description: "Creates one draft email campaign to one Klaviyo list. Never sends or schedules it.", annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!OFFERED.includes(name)) return toolError(id, `${name || "That"} isn't a tool this server serves.`);
        const a = checkDraftArgs(req.params?.arguments);
        if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
        try {
          // the list must still be one of the business's own lists, read on this key right before the write
          const list = await get(key, `lists/${a.listId}`);
          if (list.status === 404) throw new Error("Klaviyo 404: that list isn't in the business's Klaviyo any more");
          if (!list.ok) throw new Error(`Klaviyo ${list.status} on read list`);
          const listName = String(((await list.json().catch(() => ({}))) as { data?: { attributes?: { name?: unknown } } }).data?.attributes?.name ?? "");
          const label = campaignName(a.subject, new Date().toISOString().slice(0, 10));
          const tpl = await post(key, "templates", { data: { type: "template", attributes: { name: label, editor_type: "CODE", html: campaignHtml(a.body), text: campaignText(a.body) } } }, "create template");
          const templateId = tpl.data?.id;
          if (!templateId) throw new Error("Klaviyo didn't return a template id");
          const camp = await post(key, "campaigns", {
            data: {
              type: "campaign",
              attributes: {
                name: label,
                audiences: { included: [a.listId], excluded: [] },
                "campaign-messages": { data: [{ type: "campaign-message", attributes: { channel: "email", label, content: { subject: a.subject, preview_text: a.preview } } }] },
              },
            },
          }, "create draft campaign");
          const campaignId = camp.data?.id;
          const messageId = camp.data?.relationships?.["campaign-messages"]?.data?.[0]?.id;
          if (!campaignId || !messageId) throw new Error("Klaviyo didn't return the draft campaign's ids");
          await post(key, "campaign-message-assign-template", { data: { type: "campaign-message", id: messageId, relationships: { template: { data: { type: "template", id: templateId } } } } }, "attach template");
          return reply(id, { structuredContent: { result: { campaignId, templateId, listName } }, content: [{ type: "text", text: "ok" }] });
        } catch (e) {
          return toolError(id, e instanceof Error ? e.message : String(e));
        }
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `no method ${req.method}` } };
    }
  };
}
