import { headers } from "next/headers";
import { SignInCard } from "@/app/login/card";
import { requireSession } from "@/dashboard/data";
import { allowApp } from "@/dashboard/mcpActions";
import { db } from "@/core/db";
import { CONSENT_LINES, CONSENT_NEVER, CONSENT_OWNER_LINES, originOf, readAuthorize, withQuery } from "@/core/operator-mcp-rules";
import { clientSecret } from "@/core/operator-mcp";
import { ROLE_LABELS } from "@/core/roles";

export const metadata = { title: "Connect an app · OPERATOR" };

// The consent page of OPERATOR's own MCP server (docs/operator-mcp.md): Claude sends the person here to
// sign in and say yes. Signed out, the proxy sends them to sign in first and back here after. A request
// from an app that isn't registered, or that asks to return somewhere it didn't register, is shown as an
// error and never sent anywhere.
export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [sp, me, h] = await Promise.all([searchParams, requireSession(), headers()]);
  const origin = originOf(`https://${h.get("host") ?? "localhost"}/`, h.get("x-forwarded-host"), h.get("x-forwarded-proto"));
  const r = readAuthorize(sp, clientSecret(), origin);
  if ("problem" in r) {
    return (
      <SignInCard>
        <span style={{ fontWeight: 600 }}>This connection can’t be made</span>
        <span className="ink2" style={{ fontSize: 13.5 }}>{r.problem}</span>
        {r.redirect && <a className="btn ghost" href={r.redirect}>Back to the app</a>}
      </SignInCard>
    );
  }
  const { data: org } = await db().from("orgs").select("name").maybeSingle();
  const keep = { client_id: sp.client_id, redirect_uri: sp.redirect_uri, state: sp.state, code_challenge: sp.code_challenge, code_challenge_method: sp.code_challenge_method, response_type: sp.response_type, resource: sp.resource };
  return (
    <SignInCard>
      <div className="stack" style={{ gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 16 }}>Connect {r.ask.client.name} to {org?.name ?? "your business"}</span>
        <span className="muted" style={{ fontSize: 12.5 }}>Signed in as {me.email} ({ROLE_LABELS[me.role]})</span>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <span className="ink2" style={{ fontSize: 13.5 }}>{r.ask.client.name} will be able to:</span>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.6 }}>{[...CONSENT_LINES, ...(me.role === "owner" ? CONSENT_OWNER_LINES : [])].map((l) => <li key={l}>{l}</li>)}</ul>
        <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{CONSENT_NEVER} What it reads is sent to {r.ask.client.name} under your own account there. You can disconnect it any time in Settings, Connected apps.</span>
      </div>
      <form action={allowApp} className="row" style={{ gap: 8 }}>
        {Object.entries(keep).map(([k, v]) => (v == null ? null : <input key={k} type="hidden" name={k} value={v} />))}
        <button className="btn primary">Allow</button>
        <a className="btn ghost" href={withQuery(r.ask.redirectUri, { error: "access_denied", state: r.ask.state })}>Cancel</a>
      </form>
    </SignInCard>
  );
}
