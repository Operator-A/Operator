import { NextResponse } from "next/server";
import { clientOf, pkceOk, redirectAllowed, redirectOk } from "@/core/operator-mcp-rules";
import { clientSecret, redeemCode, refresh } from "@/core/operator-mcp";

// The token endpoint (OAuth 2.1) for OPERATOR's own MCP server (docs/operator-mcp.md): a sign-in code (with
// its PKCE verifier) or a refresh token becomes a one-hour access token and a new refresh token.
const no = (error: string, text: string, status = 400) => NextResponse.json({ error, error_description: text }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(req: Request) {
  let f: URLSearchParams;
  try { f = new URLSearchParams(await req.text()); } catch { return no("invalid_request", "Send the form as application/x-www-form-urlencoded."); }
  const client = clientOf(f.get("client_id"), clientSecret());
  if (!client) return no("invalid_client", "This app isn't registered with this OPERATOR.", 401);
  try {
    const grant = f.get("grant_type");
    let r;
    if (grant === "authorization_code") {
      const redirectUri = redirectOk(f.get("redirect_uri")) ?? "";
      if (!redirectAllowed(client, redirectUri)) return no("invalid_grant", "redirect_uri isn't one this app registered.");
      r = await redeemCode(f.get("code") ?? "", redirectUri, (c) => pkceOk(f.get("code_verifier"), c));
    } else if (grant === "refresh_token") {
      r = await refresh(f.get("refresh_token") ?? "");
    } else return no("unsupported_grant_type", "grant_type must be authorization_code or refresh_token.");
    return r.ok ? NextResponse.json(r.body, { headers: { "Cache-Control": "no-store" } }) : no(r.error, r.text);
  } catch {
    return no("server_error", "The sign-in couldn't be finished. Try again.", 500);
  }
}
