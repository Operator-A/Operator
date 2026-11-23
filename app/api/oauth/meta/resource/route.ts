import { NextResponse } from "next/server";
import { originOf, resourceMetadata } from "@/core/operator-mcp-rules";

// /.well-known/oauth-protected-resource (RFC 9728), rewritten here by next.config.ts: where Claude signs in
// for OPERATOR's own MCP server (docs/operator-mcp.md).
export function GET(req: Request) {
  return NextResponse.json(resourceMetadata(originOf(req.url, req.headers.get("x-forwarded-host"), req.headers.get("x-forwarded-proto"))), { headers: { "Cache-Control": "public, max-age=3600" } });
}
