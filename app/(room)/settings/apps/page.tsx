// Settings > Connected apps (docs/operator-mcp.md): apps that reach OPERATOR through its own MCP server,
// such as Claude. Each connection is one person in this business; Disconnect ends it at once.
import { getTz, requireSession } from "@/dashboard/data";
import { listApps } from "@/core/operator-mcp";
import { ConnectedApps } from "@/dashboard/components/connectedApps";
import { SectionHead } from "@/dashboard/components/settingsHead";
import { disconnectApp } from "@/dashboard/mcpActions";
import { MCP_PATH, MOVE_PROMPT } from "@/core/operator-mcp-rules";
import { headers } from "next/headers";

export default async function AppsPage() {
  const [tz, me, h] = await Promise.all([getTz(), requireSession(), headers()]);
  const apps = await listApps(me).catch((e: unknown) => (e instanceof Error ? e.message : String(e)));
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-operator";
  return (
    <>
      <SectionHead title="Connected apps" sub="Apps that reach OPERATOR for you, such as Claude. They see what you can see. An owner's app can also draft agents, try them and file proposals; going live, duty, actions and budgets stay here." />
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
      {me.role === "owner" && (
        <div className="card set-card pad">
          <span className="sub" style={{ fontWeight: 600 }}>Move an agent from a Claude project</span>
          <span className="sub">Connect Claude first. Then open the Claude project that runs the agent, and paste this into a new chat there. Claude drafts the agent here, off duty, tries it once and stops; you put it on duty.</span>
          <pre className="pill" style={{ whiteSpace: "pre-wrap", userSelect: "all", margin: 0, fontSize: 12.5, lineHeight: 1.5 }}>{MOVE_PROMPT}</pre>
        </div>
      )}
    </>
  );
}
