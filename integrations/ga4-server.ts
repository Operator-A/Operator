import "server-only";
// Our own Google Analytics MCP server (card 152b, docs/mcp-everywhere.md). Google's own Analytics
// MCP server runs on the founder's machine with their own Google credentials, so it can't be a
// business's connection here; this one runs in the app like Gmail's. It speaks the same JSON-RPC as
// any MCP server and is reached only through integrations/mcp.ts, which opens the sign-in
// (analytics.readonly only). Each tool runs one fixed report (core/ga4-rules.ts) on the property the
// owner picked, which comes from the connection's settings, never from a tool's input.
import { MCP_PROTOCOL, checkedTools, type McpId } from "@/core/mcp-rules";
import { checkGa4Args, readChannels, readOverview, readProperties, readTopPages, reportBodies } from "@/core/ga4-rules";
import { accountSummaries, runReport } from "./ga4-api";

const DESCRIPTIONS: Record<string, string> = {
  ga4_properties: "The Google Analytics properties this sign-in can see.",
  ga4_overview: "Sessions, users, page views and key events for a period, in total and by day.",
  ga4_top_pages: "The most viewed page paths in a period, with views and sessions.",
  ga4_channels: "Sessions and key events by Google's default channel group in a period.",
};

/** The properties a sign-in can see, checked after Connect. */
export const ga4Properties = async (token: string) => readProperties(await accountSummaries(token));

/** A JSON-RPC handler for one call, serving only `profile`'s tools, on the picked property. */
export function ga4Server(profile: McpId, token: string, propertyId: string | null) {
  const offered = checkedTools(profile).filter((t) => t in DESCRIPTIONS);
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-ga4", version: "1" } });
      case "tools/list":
        return reply(id, { tools: offered.map((name) => ({ name, description: DESCRIPTIONS[name], annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!offered.includes(name)) return toolError(id, `${name || "That"} isn't a tool this sign-in serves.`);
        const a = checkGa4Args(name, req.params?.arguments);
        if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
        try {
          let result: unknown;
          if (a.tool === "ga4_properties") result = await ga4Properties(token);
          else {
            if (!propertyId) return toolError(id, "No Google Analytics property is picked yet. Pick one on Connections.");
            const reports = await Promise.all(reportBodies(a).map((b) => runReport(token, propertyId, b)));
            result = a.tool === "ga4_overview" ? readOverview(reports[0], reports[1]) : a.tool === "ga4_top_pages" ? readTopPages(reports[0]) : readChannels(reports[0]);
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
