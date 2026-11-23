// Settings > Connected apps (docs/operator-mcp.md): apps that reach OPERATOR through its own MCP server,
// such as Claude. Each connection is one person in this business; Disconnect ends it at once.
import { getTz, requireSession } from "@/dashboard/data";
import { listApps } from "@/core/operator-mcp";
import { ConnectedApps } from "@/dashboard/components/connectedApps";
import { SectionHead } from "@/dashboard/components/settingsHead";
import { disconnectApp } from "@/dashboard/mcpActions";
import { MCP_PATH } from "@/core/operator-mcp-rules";
import { headers } from "next/headers";

export default async function AppsPage() {
  const [tz, me, h] = await Promise.all([getTz(), requireSession(), headers()]);
  const apps = await listApps(me).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-operator";
  return (
    <>
      <SectionHead title="Connected apps" sub="Apps that read OPERATOR for you, such as Claude. They see what you can see, and change nothing." />
      <div className="card set-card pad">
        <span className="sub">To connect Claude: in Claude, open Settings, then Connectors, then Add custom connector. Name it OPERATOR and paste this address, then sign in here and tap Allow.</span>
        <code className="pill" style={{ alignSelf: "flex-start", userSelect: "all" }}>{`https://${host}${MCP_PATH}`}</code>
        {typeof apps === "string" ? <span className="sub">{apps}</span> : (
          <ConnectedApps
            apps={apps.map((a) => ({ id: a.id, client: a.client, email: a.email, you: a.memberId === me.id, connectedAt: a.connectedAt, lastUsedAt: a.lastUsedAt }))}
            tz={tz} owner={me.role === "owner"} disconnect={disconnectApp}
          />
        )}
      </div>
    </>
  );
}
