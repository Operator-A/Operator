import "server-only";
// Our own Mailchimp MCP server (card 252, docs/mcp-everywhere.md "Mailchimp"). Mailchimp's hosted MCP
// server isn't documented for other apps, and every Mailchimp key reaches the whole account, so our
// server is the limit: this file is the only one that calls Mailchimp's Marketing API, and it has
// exactly these calls. Agents' key (profile "mailchimp"): audiences with counts, and campaign reports,
// asking Mailchimp for fixed fields with no member or email address. The gateway's key (profile
// "mailchimp_drafts"): one draft campaign to one of the business's own audiences. There is no send,
// schedule, test-send, copy or delete call here, and none may be added (check:mcp fails on one):
// the owner sends every campaign from Mailchimp. Only integrations/mcp.ts imports this file (lint).
import { MCP_PROTOCOL, checkedTools, type McpId } from "@/core/mcp-rules";
import { AUDIENCE_FIELDS, DRAFT_TOOL, REPORT_FIELDS, baseOf, checkMailchimpArgs, checkMcDraftArgs, mcCampaignHtml, mcCampaignTitle, readAudiences, readReports, sinceOf } from "@/core/mailchimp-rules";

const TIMEOUT_MS = 25_000;
const DESCRIPTIONS: Record<string, string> = {
  mailchimp_audiences: "Every audience in the business's Mailchimp with its member count, unsubscribes and campaigns sent.",
  mailchimp_campaigns: "Campaigns sent in a period: sent, opens, clicks, unsubscribes, orders and revenue, with rates worked out in code.",
  [DRAFT_TOOL]: "Creates one draft campaign to one of the business's Mailchimp audiences. Never sends or schedules it. Gateway only, after an approval.",
};

async function mc<T>(key: string, path: string, init?: { method: "POST" | "PUT"; body: unknown }, what = path): Promise<T> {
  const res = await fetch(`${baseOf(key)}${path}`, {
    method: init?.method ?? "GET", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Authorization: `Basic ${Buffer.from(`operator:${key.trim()}`).toString("base64")}`, ...(init ? { "Content-Type": "application/json" } : {}) },
    body: init ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) throw new Error(`Mailchimp ${res.status} on ${what}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

/** Before a key is kept: its shape, and whose account it is. */
export async function checkMailchimpKey(key: string): Promise<{ name: string; workspace: string }> {
  const who = await mc<{ account_name?: unknown }>(key, "/?fields=account_name", undefined, "read account");
  const name = String(who.account_name ?? "").slice(0, 100);
  if (!name) throw new Error("Mailchimp didn't say whose account this is");
  return { name, workspace: "Mailchimp" };
}

/** A JSON-RPC handler for one call, serving only `profile`'s tools, with the key the vault opened. */
export function mailchimpServer(profile: McpId, key: string, now: () => number = Date.now) {
  const offered = checkedTools(profile).filter((t) => t in DESCRIPTIONS);
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-mailchimp", version: "1" } });
      case "tools/list":
        return reply(id, { tools: offered.map((name) => ({ name, description: DESCRIPTIONS[name], annotations: { readOnlyHint: name !== DRAFT_TOOL, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!offered.includes(name)) return toolError(id, `${name || "That"} isn't a tool this key serves.`);
        try {
          let result: unknown;
          if (name === DRAFT_TOOL) {
            const a = checkMcDraftArgs(req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            // the audience must still be one of the business's own, read on this key right before the write
            const list = await mc<{ id?: unknown; name?: unknown; campaign_defaults?: { from_name?: unknown; from_email?: unknown } }>(key, `/lists/${a.audienceId}?fields=id,name,campaign_defaults.from_name,campaign_defaults.from_email`, undefined, "read audience");
            if (list.id !== a.audienceId) throw new Error("Mailchimp 404: that audience isn't in the business's Mailchimp any more");
            const camp = await mc<{ id?: unknown }>(key, "/campaigns", {
              method: "POST",
              body: {
                type: "regular",
                recipients: { list_id: a.audienceId },
                settings: { subject_line: a.subject, preview_text: a.preview, title: mcCampaignTitle(a.subject, new Date(now()).toISOString().slice(0, 10)), from_name: String(list.campaign_defaults?.from_name ?? ""), reply_to: String(list.campaign_defaults?.from_email ?? "") },
              },
            }, "create draft campaign");
            if (typeof camp.id !== "string" || !camp.id) throw new Error("Mailchimp didn't return a campaign id");
            await mc(key, `/campaigns/${camp.id}/content`, { method: "PUT", body: { html: mcCampaignHtml(a.body) } }, "set campaign content");
            result = { campaignId: camp.id, audience: String(list.name ?? "").slice(0, 100), sent: false };
          } else {
            const a = checkMailchimpArgs(name, req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            if (a.tool === "mailchimp_audiences") {
              const audiences = readAudiences(await mc(key, `/lists?count=100&fields=${AUDIENCE_FIELDS}`, undefined, "list audiences"));
              result = { audiences, members: audiences.reduce((n, l) => n + l.members, 0) };
            } else {
              const q = new URLSearchParams({ count: "100", since_send_time: sinceOf(a.period, now()), fields: REPORT_FIELDS });
              result = readReports(await mc(key, `/reports?${q}`, undefined, "list reports"));
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
