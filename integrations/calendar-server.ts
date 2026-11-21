import "server-only";
// Our own Google Calendar MCP server (card 251, docs/mcp-everywhere.md). Google's Calendar MCP server
// is a gated Developer Preview, so a business can't connect it; this one runs in the app like Gmail's.
// It speaks the same JSON-RPC as any MCP server and is reached only through integrations/mcp.ts, which
// opens one of two Google sign-ins: "Google Calendar" (calendar.events.readonly) for the read tools,
// and "Calendar holds" (calendar.events), held only by the gateway, for the one write. Each sign-in
// is served only its own profile's tools. Times and free slots are worked out in core/calendar-rules.ts.
import { MCP_PROTOCOL, checkedTools, type McpId } from "@/core/mcp-rules";
import { HOLD_TOOL, LIMITS, checkCalendarArgs, freeSlots, isoMs, overlaps, readEvents, refuseHold, weekOf, type HoldArgs } from "@/core/calendar-rules";
import { insertHold, listEvents } from "./calendar-api";

const DESCRIPTIONS: Record<string, string> = {
  calendar_events: "Events on the primary calendar for the next days: times, a cut title and how many guests, with meetings and hours counted in code.",
  calendar_free: "Free time in working hours on the primary calendar for the next days, each slot 30 minutes or more.",
  [HOLD_TOOL]: "One private hold on the primary calendar, with no guests, emailing no one. Gateway only, after an approval.",
};
const DAY = 86_400_000;

/** The calendar's name and time zone, checked after Connect. */
export async function calendarWho(token: string): Promise<{ calendar: string; timeZone: string | null }> {
  const now = Date.now();
  const r = readEvents(await listEvents(token, now, now + 60_000));
  return { calendar: r.calendar, timeZone: r.timeZone };
}

/** A JSON-RPC handler for one call, serving only `profile`'s tools. */
export function calendarServer(profile: McpId, token: string, now: () => number = Date.now) {
  const offered = checkedTools(profile).filter((t) => t in DESCRIPTIONS);
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-calendar", version: "1" } });
      case "tools/list":
        return reply(id, { tools: offered.map((name) => ({ name, description: DESCRIPTIONS[name], annotations: name === HOLD_TOOL ? { readOnlyHint: false, destructiveHint: false, openWorldHint: false } : { readOnlyHint: true, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!offered.includes(name)) return toolError(id, `${name || "That"} isn't a tool this sign-in serves.`);
        try {
          const t = now();
          let result: unknown;
          if (name === HOLD_TOOL) {
            const args = (req.params?.arguments && typeof req.params.arguments === "object" ? req.params.arguments : {}) as Record<string, unknown>;
            const no = refuseHold(args, t);
            if (no) return toolError(id, `Input refused: ${no}`);
            const a = args as unknown as HoldArgs;
            const s = isoMs(a.start)!, e = isoMs(a.end)!;
            // the time must still be free right now, on the same calendar
            if (overlaps(readEvents(await listEvents(token, s, e)).events, s, e)) return toolError(id, "Input refused: that time isn't free any more.");
            result = { eventId: await insertHold(token, a) };
          } else {
            const a = checkCalendarArgs(name, req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            const r = readEvents(await listEvents(token, t, t + a.days * DAY));
            const tz = r.timeZone ?? "UTC";
            result = a.tool === "calendar_events" ? weekOf(r.events, tz) : { time_zone: tz, slots: freeSlots(r.events, tz, t, a.days, a.fromHour, a.toHour), max_slots: LIMITS.maxSlots };
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
