// Pieces of the Connections page (app/(room)/connections/page.tsx): an agent chip, the vault note, and
// GitHub's detail (engineering isolation slice 1, to the approved mockup), kept here so the page stays
// readable. Server components: their buttons are the shared client ActionButton.
import Link from "next/link";
import type { CrewFloor } from "@/dashboard/data";
import { usersOf, type Connection } from "@/dashboard/connections";
import { Icon } from "@/dashboard/components/Icon";
import { Avatar } from "@/dashboard/components/ui";
import { ActionButton } from "@/dashboard/components/client";
import { SignInLog } from "@/dashboard/components/CustomServers";
import { githubSetRepo, mcpDisconnect, vaultReseal } from "@/dashboard/connectionActions";
import { MCP_SERVERS } from "@/core/mcp-rules";
import { MAX_REPOS } from "@/core/github-rules";
import { MCP_MISSING, VAULT_MISSING, type GitHubView, type McpLogRow, type McpStatus, type VaultState } from "@/integrations/mcp";
import { when } from "@/dashboard/format";

/** What GitHub's detail reads: the connection's status, the vault, its log, and GitHub's own answer. */
export interface GitHubDetailView { status: McpStatus | null; vault: VaultState | null; log: McpLogRow[]; github?: GitHubView | null }

export /** The vault's state: is MCP_SECRET_KEY set, and is every sign-in locked with it. */
function VaultNote({ v }: { v: VaultState | null }) {
  if (!v) return null;
  if (!v.keySet) return <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{v.tooShort ? `MCP_SECRET_KEY is too short. ${VAULT_MISSING}` : VAULT_MISSING}</span>;
  if (!v.onOtherKey.length && !v.unreadable.length) return null;
  return (
    <span className="soft-box row wrap" style={{ fontSize: 12.5, lineHeight: 1.45, gap: 8 }}>
      <span style={{ flex: 1, minWidth: 200 }}>
        {v.onOtherKey.length ? `${v.onOtherKey.length} sign-in${v.onOtherKey.length === 1 ? " is" : "s are"} still locked with an older key. ` : ""}
        {v.unreadable.length ? `${v.unreadable.join(", ")} can’t be unlocked with either key: sign in again.` : ""}
      </span>
      {v.onOtherKey.length > 0 && <ActionButton className="btn outline sm" action={vaultReseal}>Re-lock now</ActionButton>}
    </span>
  );
}

/** An agent's chip, linking to its sheet. */
export function Who({ id, f }: { id: string; f: CrewFloor }) {
  const a = f.byId[id];
  const name = a?.name ?? id;
  return (
    <Link href={`/agents/${id}`} className="row" title={name} style={{ gap: 6, fontSize: 12, fontWeight: 600, color: "var(--ink)", textDecoration: "none", padding: "3px 10px 3px 3px", borderRadius: 999, background: "var(--soft)" }}>
      {a ? <Avatar a={a} size={22} /> : <span className="av" style={{ width: 22, height: 22, fontSize: 11 }}>{name.slice(0, 1)}</span>}
      {name}
    </Link>
  );
}

const GITHUB_PROTECT = "https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/managing-a-branch-protection-rule";
const CHECKS_WORD = { passing: "checks passing", failing: "checks failing", pending: "checks running", none: "no checks" } as const;

/**
 * GitHub's detail (engineering isolation slice 1, to the approved mockup): the install, the repos agents may
 * read (turned on here, at most five), the agents with GitHub reads, and the branch protection note.
 */
export function GitHubDetail({ c, f, v, note, change }: { c: Connection; f: CrewFloor; v: GitHubDetailView; note: { ok: boolean; text: string } | null; change: string | null }) {
  const s = v.status;
  const srv = MCP_SERVERS.github;
  const live = !!s?.connected && !s.paused;
  const g = v.github ?? null;
  const reading = g?.reading ?? [];
  const on = new Set(reading.map((r) => r.repo.toLowerCase()));
  const offered = (g?.reachable ?? []).filter((r) => !on.has(r.name.toLowerCase()));
  const full = reading.length >= MAX_REPOS;
  const users = usersOf(c.id, f.grants);
  const pill = live ? { t: "Connected", bg: "var(--mint-soft)", ink: "var(--mint-ink)", dot: "var(--mint)" } : s?.paused ? { t: "Paused", bg: "var(--soft)", ink: "var(--ink2)", dot: "var(--mut)" } : { t: "Not set up", bg: "var(--soft)", ink: "var(--ink2)", dot: "var(--mut)" };
  const code = (t: string) => <code key={t} className="gh-code">{t}</code>;
  const row = { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, background: "var(--soft)", flexWrap: "wrap" } as const;
  return (
    <div className="card gh-card" style={{ gap: 18, padding: 28 }}>
      <span className="row" style={{ gap: 12 }}>
        <span style={{ width: 44, height: 44, borderRadius: 12, background: "var(--soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={c.icon} size={22} /></span>
        <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}><span style={{ fontSize: 19, fontWeight: 700 }}>{c.name}</span><span className="muted" style={{ fontSize: 12.5 }}>Pull requests, checks and issues, read only</span></span>
        <span className="pill sm" style={{ background: pill.bg, color: pill.ink }}><span className="dot" style={{ width: 6, height: 6, background: pill.dot }} />{pill.t}</span>
      </span>
      <span className="ink2" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{c.about}</span>
      {note && <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45, background: note.ok ? "var(--mint-soft)" : "var(--red-soft)", color: note.ok ? "var(--mint-ink)" : "var(--red-ink)" }}>{note.text}</span>}
      {!s && <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{MCP_MISSING}</span>}
      <VaultNote v={v.vault} />
      <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Our own server, run in the app. Agents may read with: {srv.readTools.flatMap((t, i) => (i ? [" ", code(t)] : [code(t)]))}; nothing here can change GitHub. The OPERATOR app asks GitHub only for read access to pull requests, checks, issues and metadata, and a sign-in that carries more is refused.</span>
      {s?.connected ? (
        <>
          {s.paused && <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>Paused: {s.lastError ?? "GitHub stopped taking the app"}. Agents can’t read GitHub until you tap Connect again.</span>}
          <span className="row wrap" style={{ gap: 8 }}>
            <span className="muted" style={{ fontSize: 12.5, flex: 1, minWidth: 200 }}>Installed on <b style={{ color: "var(--ink)", fontWeight: 600 }}>{g?.accounts.join(", ") || s.settings.accounts || "GitHub"}</b>{s.connectedAt ? ` · connected ${when(s.connectedAt, f.tz)}` : ""}</span>
            {s.paused && <a className="btn dark sm" href="/connections/github/connect">Connect again</a>}
            {change && <a className="btn outline sm" href={change} target="_blank" rel="noreferrer">Change repos on GitHub</a>}
            <ActionButton className="btn outline sm" action={mcpDisconnect.bind(null, "github")} confirm={{ title: "Disconnect GitHub?", body: "The OPERATOR app’s install is forgotten here and agents can’t read GitHub until you connect again. OPERATOR keeps no GitHub sign-in, so to remove the app from GitHub too, uninstall it in GitHub’s settings.", confirmLabel: "Disconnect", kind: "danger" }}>Disconnect</ActionButton>
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 700 }}>Repos agents may read</span><span className="muted" style={{ fontSize: 12.5 }}>Every GitHub tool reads only the repos turned on here. An agent never names a repo itself.</span></span>
            {g?.problem && <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>Couldn’t read GitHub just now: {g.problem}</span>}
            {!g && <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>Couldn’t read GitHub just now.</span>}
            {reading.map((r) => (
              <div key={r.repo} style={row}>
                <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.repo}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{r.problem ? `Couldn’t read it: ${r.problem}` : r.branch ? `Default branch ${r.branch} · ${r.openPrs === 100 ? "100 or more" : r.openPrs} open pull request${r.openPrs === 1 ? "" : "s"}${r.checks ? ` · ${CHECKS_WORD[r.checks]}` : ""}` : "Reading"}</span>
                </span>
                <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Reading</span>
                <ActionButton className="btn outline sm gh-small" action={githubSetRepo.bind(null, r.repo, false)}>Turn off</ActionButton>
              </div>
            ))}
            {offered.map((r) => (
              <div key={r.name} style={row}>
                <span style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column" }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>{r.name}</span><span className="muted" style={{ fontSize: 12 }}>Shared with the app, not read</span></span>
                <ActionButton className="btn outline sm" action={githubSetRepo.bind(null, r.name, true)} disabled={full} title={full ? `At most ${MAX_REPOS} repos can be read. Turn one off first.` : undefined}>Read this repo</ActionButton>
              </div>
            ))}
            <span className="muted" style={{ fontSize: 12 }}>Don’t see a repo? Add it to the OPERATOR app on GitHub with Change repos, then turn it on here.</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <span style={{ fontSize: 15, fontWeight: 700 }}>Agents that read GitHub</span>
            <span className="row wrap" style={{ gap: 6 }}>
              {users.map((a) => <Who key={a} id={a} f={f} />)}
              {!users.length && <span className="muted" style={{ fontSize: 12 }}>No agent has a GitHub read yet. Give one under Reads in its sheet.</span>}
            </span>
          </div>
          <span className="soft-box row wrap" style={{ gap: 10, fontSize: 12.5, lineHeight: 1.45, alignItems: "center" }}>
            <Icon name="lock" size={18} style={{ flex: "none" }} />
            <span style={{ flex: 1, minWidth: 200 }}>Agents that run in Claude push and open pull requests from their own session, outside OPERATOR. Turn on branch protection for each repo’s default branch so nothing merges without your review.</span>
            <a className="btn outline sm" href={GITHUB_PROTECT} target="_blank" rel="noreferrer">How to</a>
          </span>
        </>
      ) : s ? (
        <span className="row wrap" style={{ gap: 10, alignItems: "center" }}>
          <a className="btn dark sm" href="/connections/github/connect">Connect GitHub</a>
          <span className="muted" style={{ fontSize: 12, flex: 1, minWidth: 240 }}>{srv.signInHint}</span>
        </span>
      ) : null}
      <SignInLog log={v.log} tz={f.tz} />
    </div>
  );
}
