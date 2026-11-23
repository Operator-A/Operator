import { NextResponse } from "next/server";
import { RPC, bearerOf, challenge, dispatch, isResponse, originOf, readRpc } from "@/core/operator-mcp-rules";
import { runTool, verifyAccess } from "@/core/operator-mcp";

// OPERATOR's own MCP server (docs/operator-mcp.md): Streamable HTTP with JSON answers, one message per
// POST. Every call carries a token from OPERATOR's sign-in; it names one member in one business, and the
// member is read again on every call. Slice 1 offers read tools only.
export const dynamic = "force-dynamic";

const origin = (req: Request) => originOf(req.url, req.headers.get("x-forwarded-host"), req.headers.get("x-forwarded-proto"));

export async function POST(req: Request) {
  const o = origin(req);
  const v = await verifyAccess(bearerOf(req.headers.get("authorization")));
  if (!v.ok) {
    const h: Record<string, string> = v.status === 401 ? { "WWW-Authenticate": challenge(o, req.headers.get("authorization") ? "invalid_token" : undefined) } : {};
    return NextResponse.json({ error: v.status === 401 ? "invalid_token" : v.status === 429 ? "rate_limited" : "server_error", error_description: v.text }, { status: v.status, headers: h });
  }
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: RPC.parse, message: "The body isn't JSON." } }, { status: 400 }); }
  const msg = readRpc(body);
  if (isResponse(msg)) return msg.error ? NextResponse.json(msg, { status: 400 }) : new NextResponse(null, { status: 202 });
  const out = await dispatch(msg, v.caller.member.role, (tool, args) => runTool(v.caller, o, tool, args));
  return out ? NextResponse.json(out) : new NextResponse(null, { status: 202 });
}

// No server-to-client stream and no sessions: GET and DELETE are not offered (the spec allows 405).
const notOffered = () => new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
export const GET = notOffered;
export const DELETE = notOffered;
