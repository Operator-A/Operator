import "server-only";
// Our own Square MCP server (card 242, docs/mcp-everywhere.md "Square"). Square's hosted MCP server
// reaches everything Square's APIs offer and lets only allow-listed clients sign in, so it can't be held
// to a profile; this one runs in the app and is reached only through integrations/mcp.ts, which opens the
// sign-in from the vault. One profile, "square":
// - read tools for agents (callMcpTool): each runs fixed requests (core/square-rules.ts) and every total
//   is made there.
// - one write tool for core/gateway only (callWriteTool, after an approver approves): a draft invoice,
//   which is one order of ad hoc lines and one invoice Square keeps as a DRAFT. No publish, cancel,
//   delete, refund, payment or order update is here, and none may be added (check:square fails on one):
//   the owner publishes from Square.
import { MCP_PROTOCOL, MCP_SERVERS } from "@/core/mcp-rules";
import {
  MAX_LOCATIONS, MAX_PAGES, SQ_ID, SQUARE_DRAFT_TOOL, checkSquareArgs, checkSquareDraftArgs, invoiceCents, listPage, readCustomers, readInvoice, readLocations, readMerchant, readOpenInvoices,
  readOrder, readPayments, readTokenScopes, refuseLocation, sinceIso, squareDraftBodies, squareRequest, type SquareArgs,
} from "@/core/square-rules";
import { errorText, squareFetch, squareJson, squareTokenStatus, type SquareConn } from "./square-api";

/** Starts an error raised after the order was made, so the gateway records it as partly done, never retried. */
const PARTIAL = "Partly made draft";

const DESCRIPTIONS: Record<string, string> = {
  square_payments: "Completed payments over a period: gross, refunds, fees and net, in total, by day and by location, and the average sale.",
  square_locations: "The business's Square locations, active ones first, with their currency.",
  square_open_invoices: "Open invoices across the business's locations, most overdue first, with the amount still owed and days late.",
  square_customers: "The most recent customers, to pick one for an invoice.",
  [SQUARE_DRAFT_TOOL]: "Creates one draft invoice for one customer at one location. Never publishes, sends or charges it.",
};

/** Who signed in and what the sign-in carries, read right after Connect. */
export async function squareWho(host: string, token: string): Promise<{ merchantId: string; name: string; scopes: string[] | null }> {
  const c: SquareConn = { host, token };
  const res = await squareFetch(c, squareRequest.merchant());
  if (res.status === 401) throw new Error("Square 401: the sign-in wasn't accepted");
  if (!res.ok) throw new Error(`Square ${res.status}: ${await errorText(res)}`);
  const m = readMerchant(await res.json());
  if (!m) throw new Error("Square didn't say which business this is");
  return { merchantId: m.id, name: m.name, scopes: readTokenScopes(await squareTokenStatus(c)) };
}

const locationNames = async (c: SquareConn) => {
  const locations = readLocations(await squareJson(c, squareRequest.locations()));
  return { locations, names: new Map(locations.map((l) => [l.id, l.name])) };
};

async function read(c: SquareConn, a: SquareArgs): Promise<unknown> {
  const now = Date.now();
  switch (a.tool) {
    case "square_locations": return { locations: (await locationNames(c)).locations };
    case "square_payments": {
      const { names } = await locationNames(c);
      const since = sinceIso(a.days, now);
      const rows: Record<string, unknown>[] = [];
      let cursor: string | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = listPage(await squareJson(c, squareRequest.payments(since, cursor)), "payments");
        rows.push(...page.rows);
        if (!page.next) return readPayments(rows, names, false);
        cursor = page.next;
      }
      return readPayments(rows, names, true);
    }
    case "square_open_invoices": {
      const { locations, names } = await locationNames(c);
      const searched = locations.filter((l) => l.active).slice(0, MAX_LOCATIONS);
      const rows: Record<string, unknown>[] = [];
      for (const l of searched) rows.push(...listPage(await squareJson(c, squareRequest.invoices(l.id)), "invoices").rows);
      return { ...readOpenInvoices(rows, names, new Date(now).toISOString().slice(0, 10), a.limit), locations_searched: searched.length };
    }
    case "square_customers": return { customers: readCustomers(await squareJson(c, squareRequest.customers(a.limit))) };
  }
}

/** The draft: the customer and the location re-read, then the order, then the invoice on it, then read back. */
async function draft(c: SquareConn, raw: unknown): Promise<unknown> {
  const a = checkSquareDraftArgs(raw);
  if ("problem" in a) throw new Error(`Input refused: ${a.problem}`);
  const cres = await squareFetch(c, squareRequest.customer(a.customerId));
  if (cres.status === 404) throw new Error("Square 404: that customer isn't in the business's Square any more");
  if (!cres.ok) throw new Error(`Square ${cres.status} on read customer: ${await errorText(cres)}`);
  const lres = await squareFetch(c, squareRequest.location(a.locationId));
  if (lres.status === 404) throw new Error("Square 404: that location isn't in the business's Square any more");
  if (!lres.ok) throw new Error(`Square ${lres.status} on read location: ${await errorText(lres)}`);
  const no = refuseLocation(await lres.json(), a.currency);
  if (no) throw new Error(no);
  const approved = invoiceCents(a.lines);
  const bodies = squareDraftBodies(a, Date.now());
  const ores = await squareFetch(c, squareRequest.createOrder(bodies.order));
  if (!ores.ok) throw new Error(`Square ${ores.status} on create order: ${await errorText(ores)}`);
  const order = readOrder(await ores.json());
  if (!order) throw new Error("Square didn't return the order");
  // From here an order exists: a failure says which one, so it is looked at in Square and never made twice.
  if (order.total !== approved) throw new Error(`${PARTIAL}: Square's order ${order.id} totals ${order.total} cents, not the ${approved} approved, so no invoice was made on it`);
  const ires = await squareFetch(c, squareRequest.createInvoice(bodies.invoice(order.id)));
  if (!ires.ok) throw new Error(`${PARTIAL}: order ${order.id} was made but Square ${ires.status} on create invoice: ${await errorText(ires)}`);
  const inv = readInvoice(await ires.json());
  if (!inv || inv.status !== "DRAFT") throw new Error(`${PARTIAL}: order ${order.id} was made but Square didn't return a draft invoice`);
  const back = await squareFetch(c, squareRequest.invoice(inv.id));
  const check = back.ok ? readInvoice(await back.json()) : null;
  return { invoiceId: inv.id, orderId: order.id, currency: a.currency, approved_cents: approved, total_cents: check?.total ?? inv.total, status: check?.status ?? inv.status, lines: a.lines.length };
}

/**
 * A JSON-RPC handler for one call, with the token the vault opened. `write` (only callWriteTool passes it):
 * the profile's write tool; otherwise its read tools only.
 */
export function squareServer(o: { host: string; token: string; write: boolean }) {
  const p = MCP_SERVERS.square;
  const offered: string[] = o.write ? p.writeTools.map((w) => w.tool) : [...p.readTools];
  const reply = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
  const toolError = (id: unknown, text: string) => reply(id, { isError: true, content: [{ type: "text", text }] });
  return async function handle(raw: unknown): Promise<unknown> {
    const req = (raw && typeof raw === "object" ? raw : {}) as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown } };
    const id = req.id ?? null;
    if (req.jsonrpc !== "2.0" || typeof req.method !== "string") return { jsonrpc: "2.0", id, error: { code: -32600, message: "not a JSON-RPC 2.0 request" } };
    switch (req.method) {
      case "initialize":
        return reply(id, { protocolVersion: MCP_PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "operator-square", version: "1" } });
      case "tools/list":
        return reply(id, { tools: offered.map((name) => ({ name, description: DESCRIPTIONS[name], annotations: { readOnlyHint: name !== SQUARE_DRAFT_TOOL, destructiveHint: false, openWorldHint: false } })) });
      case "tools/call": {
        const name = typeof req.params?.name === "string" ? req.params.name : "";
        if (!offered.includes(name)) return toolError(id, `${name || "That"} isn't a tool served here.`);
        const c: SquareConn = { host: o.host, token: o.token };
        try {
          let result: unknown;
          if (name === SQUARE_DRAFT_TOOL) result = await draft(c, req.params?.arguments);
          else {
            const a = checkSquareArgs(name, req.params?.arguments);
            if ("problem" in a) return toolError(id, `Input refused: ${a.problem}`);
            result = await read(c, a);
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

export { SQ_ID };
