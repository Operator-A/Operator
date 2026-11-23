import { NextResponse } from "next/server";
import { authServerMetadata, originOf } from "@/core/operator-mcp-rules";

// /.well-known/oauth-authorization-server (RFC 8414), rewritten here by next.config.ts: OPERATOR's own
// sign-in for its MCP server (docs/operator-mcp.md).
export function GET(req: Request) {
  return NextResponse.json(authServerMetadata(originOf(req.url, req.headers.get("x-forwarded-host"), req.headers.get("x-forwarded-proto"))), { headers: { "Cache-Control": "public, max-age=3600" } });
}
