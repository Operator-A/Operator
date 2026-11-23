import { NextResponse } from "next/server";
import { clientIdOf, readRegistration } from "@/core/operator-mcp-rules";
import { clientSecret } from "@/core/operator-mcp";

// Dynamic client registration (RFC 7591) for OPERATOR's own MCP server (docs/operator-mcp.md). Nothing is
// stored: the client id is the registration itself, signed. Registering grants nothing; a person still
// signs in and taps Allow.
export async function POST(req: Request) {
  if (clientSecret().length < 32) return NextResponse.json({ error: "temporarily_unavailable", error_description: "This OPERATOR has no sign-in set up yet." }, { status: 503 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid_client_metadata", error_description: "The body isn't JSON." }, { status: 400 }); }
  const r = readRegistration(body);
  if ("problem" in r) return NextResponse.json({ error: /redirect/.test(r.problem) ? "invalid_redirect_uri" : "invalid_client_metadata", error_description: r.problem }, { status: 400 });
  return NextResponse.json({
    client_id: clientIdOf(r.client, clientSecret()),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: r.client.name,
    redirect_uris: r.client.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }, { status: 201 });
}
