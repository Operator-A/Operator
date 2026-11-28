import { Suspense } from "react";
import { SkelPane } from "@/dashboard/components/skeletons";
import Link from "next/link";
import { HARD_RULES } from "@/dashboard/crew";
import { getCrewFloor, requireSession, type CrewFloor } from "@/dashboard/data";
import { BEHIND_THE_SCENES, CONNECTIONS, CONN_BY_ID, isSetUp, toolsOf, usersOf, type ConnId, type Connection } from "@/dashboard/connections";
import type { ToolDef } from "@/core/tools/types";
import { Icon } from "@/dashboard/components/Icon";
import { LockList } from "@/dashboard/components/ui";
import { ActionButton, ChoiceSwitch, KeyForm, TargetForm } from "@/dashboard/components/client";
import { metaTargets } from "@/core/meta-targets";
import { RESULT_KINDS, RESULT_LABEL } from "@/core/meta-rules";
import { claudeRemoveKey, claudeSaveKey, claudeSetVia, hookRemove, hookSaveSecret, modelRemoveKey, modelSaveKey } from "@/dashboard/connectionActions";
import { SOURCES, hookPath } from "@/core/event-rules";
import { gatewayCredits, hookStates } from "@/integrations/mcp";
import { imageSpendNow } from "@/core/image-step";
import { IMAGE_MODELS, imageModel } from "@/core/image-rules";
import { MODEL_LIST } from "@/integrations/models";
import { orgId } from "@/core/tenancy";
import { env } from "@/core/env";
import { headers } from "next/headers";
import { MODEL_PROVIDERS, PROVIDER_BY_ID } from "@/core/model-key-rules";
import { claudeState } from "@/dashboard/claude";
import { claudeReady, inUse, pickedChoice } from "@/core/claude-choice-rules";
import { ClaudeChoice } from "@/dashboard/components/claudeChoice";
import { MCP_SERVERS, type McpId } from "@/core/mcp-rules";
import { MCP_MISSING, getCustomServer, githubView, listCustomServers, mcpLog, mcpStatus, vaultState, type GitHubView, type McpLogRow, type McpStatus, type VaultState } from "@/integrations/mcp";
import { installUrl, slugOk } from "@/core/github-rules";
import { AddServerCard, CustomDetail, CustomTiles, SignInLog } from "@/dashboard/components/CustomServers";
import { GitHubDetail, VaultNote, Who } from "@/dashboard/components/connectionParts";
import { serverOfToolId } from "@/core/custom-mcp-rules";
import { knownServer } from "@/core/connector-rules";
import { controlsOn } from "@/dashboard/session";
import { klaviyoLists } from "@/integrations/klaviyo";
import { mercuryOrgName } from "@/integrations/mercury";
import { ga4PickProperty, klaviyoPickList, metaSetTarget, mcpDisconnect, mcpSaveKey } from "@/dashboard/connectionActions";
import { ga4PropertyList } from "@/integrations/ga4";
import { when } from "@/dashboard/format";
import { emailState } from "@/integrations/email";
import { setupCheck, type SetupCheck } from "@/core/setup-check";
import { CHECKS, CHECK_OF_MCP, type CheckTile } from "@/core/setup-check-rules";
import { SetupCheckCard } from "@/dashboard/components/setupCheck";
import { atLeast, type Role } from "@/core/roles";

// a setup check (card 281) runs after its button answers, inside this request's time
export const maxDuration = 300;

/** An MCP connection's state for its panel: signed in or not, and Klaviyo's lists to pick the counted one from. */
interface McpView { status: McpStatus | null; lists: { id: string; name: string }[] | null; listsProblem: string | null; properties?: { id: string; name: string; account: string }[] | null; targets?: Record<string, number | null> | null; log: McpLogRow[]; vault: VaultState | null; org?: string | null; orgProblem?: string | null; check?: { tile: CheckTile; initial: SetupCheck | null; owner: boolean; approver: boolean } | null; github?: GitHubView | null }


const KEY_HINT: Partial<Record<McpId, string>> = { shopify: "shpat_…", mercury_files: "secret-token:mercury_…", klaviyo_drafts: "pk_…", stripe: "rk_live_…", stripe_drafts: "rk_live_…" };

function McpPanel({ c: base, id, v, tz }: { c: Connection; id: McpId; v: McpView; tz: string }) {
  const s = v.status;
  if (!s) return <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{MCP_MISSING}</span>;
  const srv = MCP_SERVERS[id];
  const c = { ...base, name: srv.name };
  const writes = (srv.writeTools as readonly { tool: string }[]).map((w) => w.tool);
  // a Connect button (hosted servers and Google), or a pasted key; only hosted servers get the tool check
  const oauth = srv.auth !== "token";
  const hosted = srv.auth === "oauth";
  const google = srv.auth === "google";
  const intuit = srv.auth === "intuit";
  const square = srv.auth === "square";
  const meta = srv.auth === "meta";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <VaultNote v={v.vault} />
      {!srv.readTools.length
        ? <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Only the gateway uses this {oauth ? "sign-in" : "key"}, after you approve: {writes.join(", ")}. {oauth ? `Sign-in asks only for: ${srv.scopes.join(", ")}.` : `It should be ${srv.scopes.join(", ")}, and is locked in the vault, never shown again.`}</span>
        : intuit
        ? <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Our own server, run in the app. Agents may read with: {srv.readTools.join(", ")}. Only the gateway, after you approve, may use: {writes.join(", ")}; it moves an expense out of Uncategorized Expense and changes nothing else. Intuit has one accounting permission ({srv.scopes.join(", ")}) and it can read and write, so these limits are in our code.</span>
        : square
        ? <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Our own server, run in the app. Agents may read with: {srv.readTools.join(", ")}. Only the gateway, after you approve, may use: {writes.join(", ")}; it makes a draft invoice and nothing else, and you publish it from Square. Sign-in asks Square only for: {srv.scopes.join(", ")}, and is refused if Square grants anything else. Square’s invoice permission could also publish or cancel; our server has no code to do either.</span>
        : meta
        ? <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Our own server, run in the app. Agents may read with: {srv.readTools.join(", ")}; nothing they use can change {srv.name}. Sign-in asks Meta only for: {srv.scopes.join(", ")}. Meta grants permissions to a person, not to one sign-in, so once you connect pauses this sign-in could manage ads too: our server is the limit, and only reads with it.</span>
        : google
        ? <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Our own server, run in the app. Agents may read with: {srv.readTools.join(", ")}; nothing here can change {srv.name}. Sign-in asks Google only for: {srv.scopes.join(", ")}, and is refused if Google grants anything else.</span>
        : oauth
        ? <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Code may call only these {srv.name} tools: {srv.readTools.join(", ")}. A tool the server adds later does nothing until it is named in code. Sign-in asks only for: {srv.scopes.join(", ")}.</span>
        : <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>Agents may read with: {srv.readTools.join(", ")}.{srv.reportTools.length ? ` Code writes reports with: ${srv.reportTools.join(", ")}; a model never calls those.` : " Nothing here can write."} The key reaches {srv.scopes.join(", ")}, and is locked in the vault, never shown again.</span>}
      {hosted && s.connected && !s.paused && (
        <span className="muted" style={{ fontSize: 12.5 }}>
          {s.toolsCheckedAt ? `Tools checked ${when(s.toolsCheckedAt, tz)}: all ${s.toolsSeen.length} are there with the inputs code expects. If one changes, ${c.name} pauses until you sign in again.` : "Tools not checked yet: the next agent call checks them first."}
        </span>
      )}
      {s.connected ? (
        <>
          {s.paused
            ? <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>Paused: {s.lastError ?? "the sign-in stopped working"}. Agents can’t reach {c.name} until you {oauth ? "sign in again" : "paste a new key"}.</span>
            : <span style={{ fontSize: 13 }}>{oauth ? "Signed in" : "Key locked in the vault"}{s.connectedAt ? ` ${when(s.connectedAt, tz)}` : ""}.{s.lastError ? ` Last problem: ${s.lastError}` : ""}</span>}
          {!oauth && <KeyForm label={`New ${c.name} key`} save={mcpSaveKey.bind(null, id)} placeholder={KEY_HINT[id]} replace />}
          <span className="row wrap" style={{ gap: 8 }}>
            {oauth && <a className="btn outline sm" href={`/connections/${id}/connect`}>Sign in again</a>}
            <ActionButton className="btn outline sm" action={mcpDisconnect.bind(null, id)} confirm={{ title: `Disconnect ${c.name}?`, body: meta ? `It is forgotten here. Meta has no way to cancel one sign-in without the other, so to remove OPERATOR from Facebook entirely open Facebook Settings, Business integrations.` : square ? `Square is asked to cancel the sign-in, and it is forgotten here. Square cancels every sign-in this business gave OPERATOR, so nothing of it stays.` : google ? `Google is asked to cancel the sign-in, and it is forgotten here. Google may cancel the business’s other Google sign-ins too (they use the same app); if one shows Paused, tap Sign in again there.` : oauth ? `${c.name} is asked to cancel the sign-in, and it is forgotten here. Agents that read it get an error until you connect again.` : `The key is forgotten here. Agents and reports that use ${c.name} get an error until you paste a key again.`, confirmLabel: "Disconnect", kind: "danger" }}>Disconnect</ActionButton>
          </span>
          {google && id !== "ga4" && !s.paused && (
            <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              {s.settings.mailbox ? <>Signed in as <b>{s.settings.mailbox}</b>. If that isn’t the business’s mailbox, tap Disconnect, then Connect again with the right Google account.</> : "Couldn’t read which mailbox this is."}
            </span>
          )}
          {intuit && !s.paused && (
            <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              {s.settings.company ? <>Signed in to <b>{s.settings.company}</b>. If that isn’t the business’s QuickBooks company, tap Disconnect, then Connect again and pick the right company on Intuit’s page.</> : "Couldn’t read which company this is."}
            </span>
          )}
          {square && !s.paused && (
            <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              {s.settings.business ? <>Signed in to <b>{s.settings.business}</b>. If that isn’t the business’s Square account, tap Disconnect, then Connect again with the right Square account.</> : "Couldn’t read which business this is."}
            </span>
          )}
          {id === "mercury" && !s.paused && (
            <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
              {v.org ? <>Signed in to <b>{v.org}</b>. If that isn’t the business’s Mercury org, tap Disconnect, then Connect again and pick the business on Mercury’s page.</> : `Couldn’t read which organization this is${v.orgProblem ? `: ${v.orgProblem}` : ""}.`}
            </span>
          )}
          {id === "meta_pauses" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 700 }}>Your cost targets</span><span className="muted" style={{ fontSize: 12.5 }}>In the ad account’s currency. An agent may propose pausing a running ad only when its cost per result is over your target, or it spent more than the target with no result. Leave one blank and nothing is paused on it.</span></span>
              {RESULT_KINDS.map((k) => <TargetForm key={k} label={`Cost per ${RESULT_LABEL[k]}`} current={v.targets?.[k] ?? null} save={metaSetTarget.bind(null, k)} />)}
            </div>
          )}
          {id === "ga4" && !s.paused && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 700 }}>The property agents report on</span><span className="muted" style={{ fontSize: 12.5 }}>Every Analytics tool reads this one property. Agents can’t pick another.</span></span>
              {v.listsProblem && <span className="soft-box" style={{ fontSize: 12.5 }}>Couldn’t read the properties: {v.listsProblem}</span>}
              {(v.properties ?? []).map((p) => (
                <span key={p.id} className="row" style={{ gap: 10, padding: "8px 12px", borderRadius: 12, background: "var(--soft)" }}>
                  <span style={{ flex: 1, display: "flex", flexDirection: "column" }}><span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name || p.id}</span><span className="muted" style={{ fontSize: 12 }}>{p.account} · {p.id}</span></span>
                  {s.settings.propertyId === p.id
                    ? <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Reporting</span>
                    : <ActionButton className="btn outline sm" action={ga4PickProperty.bind(null, p.id)}>Use this one</ActionButton>}
                </span>
              ))}
            </div>
          )}
          {/* card 281/282: is this tool set up well for the business */}
          {v.check && <SetupCheckCard tile={v.check.tile} name={CHECKS[v.check.tile].name} initial={v.check.initial} owner={v.check.owner} approver={v.check.approver} auto={false} />}
          {id === "klaviyo" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 700 }}>The email list a goal counts</span><span className="muted" style={{ fontSize: 12.5 }}>Email list size counts the profiles on this list.</span></span>
              {v.listsProblem && <span className="soft-box" style={{ fontSize: 12.5 }}>Couldn’t read the lists: {v.listsProblem}</span>}
              {(v.lists ?? []).map((l) => (
                <span key={l.id} className="row" style={{ gap: 10, padding: "8px 12px", borderRadius: 12, background: "var(--soft)" }}>
                  <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{l.name || l.id}</span>
                  {s.settings.emailListId === l.id
                    ? <span className="pill sm" style={{ background: "var(--mint-soft)", color: "var(--mint-ink)" }}>Counted</span>
                    : <ActionButton className="btn outline sm" action={klaviyoPickList.bind(null, l.id)}>Count this one</ActionButton>}
                </span>
              ))}
            </div>
          )}
        </>
      ) : oauth ? (
        <span className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <a className="btn dark sm" href={`/connections/${id}/connect`}>Connect {c.name}</a>
          <span className="muted" style={{ fontSize: 12 }}>Opens {google ? "Google" : c.name}’s own sign-in page. {srv.signInHint}</span>
        </span>
      ) : (
        <span style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <KeyForm label={`${c.name} key`} save={mcpSaveKey.bind(null, id)} placeholder={KEY_HINT[id]} />
          <span className="muted" style={{ fontSize: 12 }}>{srv.signInHint} {c.name} is asked whose key it is before it is kept.</span>
        </span>
      )}
      <SignInLog log={v.log} tz={tz} />
    </div>
  );
}

// One page for every integration: is it set up, what can an agent read, do and hand you there,
// and which agents have each of those in their saved setup. Shown here, granted in the builder.

function Status({ c, f }: { c: Connection; f: CrewFloor }) {
  if (c.builtIn && !c.checks.length) return <span className="pill sm" style={{ background: "var(--soft)", color: "var(--ink2)" }}>Built in</span>;
  const ok = isSetUp(c, f.health);
  // not set up yet is setup to do, not a fault (card 189): grey, never red
  return <span className="pill sm" style={{ background: ok ? "var(--mint-soft)" : "var(--soft)", color: ok ? "var(--mint-ink)" : "var(--ink2)" }}><span className="dot" style={{ width: 6, height: 6, background: ok ? "var(--mint)" : "var(--mut)" }} />{ok ? (c.builtIn ? "Built in" : "Set up") : "Not set up"}</span>;
}

function Tile({ c, f, on }: { c: Connection; f: CrewFloor; on: boolean }) {
  const users = usersOf(c.id, f.grants).length;
  return (
    <Link href={on ? "/connections" : `/connections?c=${c.id}`} scroll={false} className="card" style={{ gap: 10, padding: 16, textDecoration: "none", color: "var(--ink)", outline: on ? "2px solid var(--ink)" : undefined }}>
      <span className="row" style={{ gap: 10 }}>
        <span style={{ width: 38, height: 38, borderRadius: 12, background: "var(--soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={c.icon} size={17} /></span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{c.name}</span><span className="muted" style={{ fontSize: 12 }}>{c.sub}</span></span>
      </span>
      <span className="row" style={{ justifyContent: "space-between", gap: 8 }}><Status c={c} f={f} /><span className="muted" style={{ fontSize: 12 }}>{users ? `${users} agent${users === 1 ? "" : "s"}` : "Not used"}</span></span>
    </Link>
  );
}

function ToolRow({ t, f, locked }: { t: ToolDef; f: CrewFloor; locked?: boolean }) {
  const has = Object.keys(f.grants).filter((a) => f.grants[a].includes(t.id));
  const only = Array.isArray(t.agents) && t.agents.length ? t.agents.map((id) => f.byId[id]?.name ?? id) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "12px 14px", borderRadius: 14, background: "var(--soft)", border: locked ? "1px dashed var(--mut2)" : undefined }}>
      <span className="row" style={{ gap: 8, alignItems: "flex-start" }}>
        {locked && <Icon name="lock" size={14} style={{ marginTop: 2, flex: "none", opacity: 0.6 }} />}
        <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{t.label}</span>
        {!t.trusted && <span className="pill sm" style={{ background: "var(--yel-soft)", color: "var(--yel-ink)" }} title="Written by people outside the business. The agent treats it as information, never as instructions.">Untrusted</span>}
      </span>
      <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>{t.detail}</span>
      {only && <span className="muted" style={{ fontSize: 12 }}>Only {only.join(" and ")} may ask for this. That rule is in code.</span>}
      <span className="row wrap" style={{ gap: 6 }}>
        {has.map((a) => <Who key={a} id={a} f={f} />)}
        {!has.length && <span className="muted" style={{ fontSize: 12 }}>No agent has this yet.</span>}
      </span>
    </div>
  );
}

function Detail({ c, f, mcp, more, note, line }: { c: Connection; f: CrewFloor; mcp: McpView | null; more: { id: McpId; v: McpView }[]; note: { ok: boolean; text: string } | null; line?: { ok: boolean; text: string } | null }) {
  if (c.id === "github" && mcp) return <GitHubDetail c={c} f={f} v={mcp} note={note} change={slugOk(env.githubAppSlug) ? installUrl(env.githubAppSlug) : null} />;
  const t = toolsOf(c.id);
  const missing = c.checks.filter((k) => !f.health[k.key]);
  const section = (title: string, sub: string, list: ToolDef[], empty: string, locked?: boolean) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 15, fontWeight: 700 }}>{title}</span><span className="muted" style={{ fontSize: 12.5 }}>{sub}</span></span>
      {list.map((x) => <ToolRow key={x.id} t={x} f={f} locked={locked} />)}
      {!list.length && <span className="muted" style={{ fontSize: 13 }}>{empty}</span>}
    </div>
  );
  return (
    <div className="card" style={{ gap: 18 }}>
      <span className="row" style={{ gap: 12 }}>
        <span style={{ width: 42, height: 42, borderRadius: 13, background: "var(--soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={c.icon} /></span>
        <span style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}><span style={{ fontSize: 19, fontWeight: 700 }}>{c.name}</span><span className="muted" style={{ fontSize: 12.5 }}>{c.sub}</span></span>
        <Status c={c} f={f} />
      </span>
      <span className="ink2" style={{ fontSize: 13.5, lineHeight: 1.55 }}>{c.about}</span>
      {note && <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45, background: note.ok ? "var(--mint-soft)" : "var(--red-soft)", color: note.ok ? "var(--mint-ink)" : "var(--red-ink)" }}>{note.text}</span>}
      {c.mcp && mcp && <McpPanel c={c} id={c.mcp} v={mcp} tz={f.tz} />}
      {more.map((m) => (
        <div key={m.id} style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 6, borderTop: "1px solid var(--bd)" }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{MCP_SERVERS[m.id].name}</span>
          <McpPanel c={c} id={m.id} v={m.v} tz={f.tz} />
        </div>
      ))}
      {c.checks.length > 1 && <span className="row wrap" style={{ gap: 6 }}>{c.checks.map((k) => <span key={k.key} className="pill sm" style={{ background: f.health[k.key] ? "var(--mint-soft)" : "var(--soft)", color: f.health[k.key] ? "var(--mint-ink)" : "var(--ink2)" }}>{k.label}: {f.health[k.key] ? "set up" : "not set up"}</span>)}</span>}
      {line && <span className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45, background: line.ok ? "var(--mint-soft)" : undefined, color: line.ok ? "var(--mint-ink)" : undefined }}>{line.text}</span>}
      {!c.mcp && !line && missing.map((k) => <span key={k.key} className="soft-box" style={{ fontSize: 12.5, lineHeight: 1.45 }}>{c.checks.length > 1 ? `${k.label}: ` : ""}{k.setup}</span>)}
      {section("Can read", "Looks only. Nothing changes.", t.read, `Agents can’t read anything from ${c.name}.`)}
      {section("Can do", "Each one becomes a card on Approvals. Nothing happens until you tap Approve.", t.do, "Nothing yet.", true)}
      {section("Hands you", "Delivered by code after a run finishes. Never during a try.", t.hands, "Nothing.")}
    </div>
  );
}

/** The detail of one built-in connection: its status, log and vault, then what its kind adds (lists, account, properties, setup check). */
async function mcpViewOf(id: NonNullable<Connection["mcp"]>, role: Role): Promise<McpView> {
  const [status, log, vault] = await Promise.all([mcpStatus(id), mcpLog(id), vaultState()]);
  const live = !!status?.connected && !status.paused;
  const problem = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);
  // card 281/282: the setup check of this tool (Analytics once a property is picked)
  const tile = CHECK_OF_MCP[id] ?? null;
  const checks = !!tile && live && (id !== "ga4" || !!status?.settings.propertyId);
  // what this kind of connection adds, all at once (card 302)
  const [lists, org, properties, initial, github] = await Promise.all([
    live && id === "klaviyo" ? klaviyoLists().then((v) => ({ v, p: null }), (e) => ({ v: null, p: problem(e) })) : { v: null, p: null },
    live && id === "mercury" ? mercuryOrgName().then((v) => ({ v, p: null }), (e) => ({ v: null, p: problem(e) })) : { v: null, p: null },
    live && id === "ga4" ? ga4PropertyList().then((v) => ({ v, p: null }), (e) => ({ v: null, p: problem(e) })) : { v: null, p: null },
    checks ? setupCheck(tile!).catch(() => null) : null,
    status?.connected && id === "github" ? githubView().catch(() => null) : null,
  ]);
  const check = checks ? { tile: tile!, initial, owner: atLeast(role, "owner"), approver: atLeast(role, "approver") } : null;
  return { status, lists: lists.v, listsProblem: lists.p ?? properties.p, properties: properties.v, log, vault, org: org.v, orgProblem: org.p, check, github };
}

export default async function Connections({ searchParams }: { searchParams: Promise<{ c?: string; s?: string; known?: string; problem?: string; connected?: string; claude?: string; credits?: string; credits_problem?: string }> }) {
  const sp = await searchParams;
  const pick = sp.c;
  // two rounds (card 302, docs/speed.md): the floor, the member and the servers together, then every status and log together.
  // A custom server (s=<id>) or the add form (s=new) takes the detail pane instead of a built-in connection.
  const [f, me, customs, custom] = await Promise.all([getCrewFloor(), requireSession(), listCustomServers(), sp.s && sp.s !== "new" ? getCustomServer(sp.s).catch(() => null) : null]);
  const adding = sp.s === "new";
  const sel = !custom && !adding && pick && pick in CONN_BY_ID ? CONN_BY_ID[pick as ConnId] : null;
  // the picked connection's detail calls its service (lists, account name, properties, setup check), so it
  // streams in behind its own skeleton while the grid draws at once (card 303, docs/speed.md)
  const detailP = sel ? Promise.all([
    sel.mcp ? mcpViewOf(sel.mcp, me.role) : null,
    Promise.all((sel.mcpMore ?? []).map(async (id) => {
      const [status, log, targets] = await Promise.all([mcpStatus(id), mcpLog(id), id === "meta_pauses" ? metaTargets().catch(() => null) : null]);
      // the owner's cost targets sit with the sign-in that pauses, read here and by the gateway
      return { id, v: { status, lists: null, listsProblem: null, log, vault: null, targets } as McpView };
    })),
    sel.id === "email" ? emailState() : null,
  ] as const) : null;
  const [statusPairs, customLog] = await Promise.all([
    Promise.all(customs.map(async (c) => [c.id, await mcpStatus(c.id)] as const)),
    custom ? mcpLog(custom.id, 10) : [],
  ]);
  const customStatuses = Object.fromEntries(statusPairs);
  const note = sp.problem ? { ok: false, text: sp.problem.slice(0, 300) } : sp.connected ? { ok: true, text: custom ? "Connected. Its tools are listed below, all off." : `Connected. Give an agent its read tools under Reads in its sheet${sel?.mcp === "klaviyo" ? ", and pick the list Email list size counts below" : ""}.` } : null;
  const outside = CONNECTIONS.filter((c) => !c.builtIn);
  const ok = outside.filter((c) => isSetUp(c, f.health)).length;
  const grid = (list: Connection[]) => <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>{list.map((c) => <Tile key={c.id} c={c} f={f} on={sel?.id === c.id} />)}</div>;
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 className="h1">Connections</h1>
        <span style={{ fontSize: 13.5 }} className="muted">{ok} of {outside.length} set up. Tap one to see what agents can read, do and hand you there, and who has it. This is shown here and given to an agent in its builder. Secrets are never shown. Looking for something else? <Link href="/connections/find">Find a tool</Link>.</span>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: sel || custom || adding ? "minmax(0,0.9fr) minmax(0,1.3fr)" : "minmax(0,1fr)" }}>
        <div className="stack">
          {grid(outside)}
          <span className="side-label" style={{ padding: "4px 2px 0" }}>Built in</span>
          {grid(CONNECTIONS.filter((c) => c.builtIn))}
          <span className="side-label" style={{ padding: "4px 2px 0" }}>Your servers</span>
          <CustomTiles servers={customs} statuses={customStatuses} sel={custom?.id ?? (adding ? "new" : null)} />
        </div>
        {sel && detailP && <div className="conn-detail"><Suspense fallback={<SkelPane />}><SelDetail c={sel} f={f} detailP={detailP} note={note} /></Suspense></div>}
        {custom && <div className="conn-detail"><CustomDetail tz={f.tz} c={custom} status={customStatuses[custom.id] ?? null} log={customLog} controls={controlsOn()} note={note} usedBy={Object.keys(f.grants).filter((a) => f.grants[a].some((t) => serverOfToolId(t) === custom.id)).map((a) => f.agents[a]?.name ?? a)} /></div>}
        {adding && <div className="conn-detail"><AddServerCard controls={controlsOn()} known={knownServer(sp.known)} /></div>}
      </div>
      <div className="card dark" style={{ gap: 10 }}>
        <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 600 }}><Icon name="lock" size={15} />Always on, for every agent</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", columnGap: 24 }}><LockList rules={HARD_RULES} dark /></div>
      </div>
      <Suspense fallback={<SkelPane />}><GatewayCard owner={me.role === "owner"} /></Suspense>
      <Suspense fallback={<SkelPane />}><ClaudeCard owner={me.role === "owner"} query={sp} /></Suspense>
      <Suspense fallback={<SkelPane />}><ModelKeysCard owner={me.role === "owner"} /></Suspense>
      <Suspense fallback={<SkelPane />}><LiveEventsCard owner={me.role === "owner"} /></Suspense>
      <div className="card" style={{ gap: 10 }}>
        <span className="card-t">Behind the scenes</span>
        {BEHIND_THE_SCENES.map((b) => (
          <div key={b.key} className="row rule" style={{ gap: 12, padding: "10px 0", alignItems: "flex-start" }}>
            <Icon name={b.icon} size={16} style={{ marginTop: 2, flex: "none" }} />
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{b.name}</span><span className="ink2" style={{ fontSize: 12.5 }}>{f.health[b.key] ? b.about : b.setup}</span></span>
            <span className="pill sm" style={{ background: f.health[b.key] ? "var(--mint-soft)" : "var(--red-soft)", color: f.health[b.key] ? "var(--mint-ink)" : "var(--red-ink)" }}>{f.health[b.key] ? "Set up" : "Not set up"}</span>
          </div>
        ))}
      </div>
    </>
  );
}

/** The picked connection's detail, once its service has answered (card 303). */
async function SelDetail({ c, f, detailP, note }: { c: Connection; f: CrewFloor; detailP: Promise<readonly [McpView | null, Parameters<typeof Detail>[0]["more"], Parameters<typeof Detail>[0]["line"]]>; note: Parameters<typeof Detail>[0]["note"] }) {
  const [mcp, more, line] = await detailP;
  return <Detail c={c} f={f} mcp={mcp} more={more} note={note} line={line} />;
}

/** The two keys Claude can run on when both are saved (decided 2026-11-25, to the approved mockup). */
const CLAUDE_VIA_OPTIONS = [
  { id: "gateway", title: "AI Gateway", sub: "Billed by Vercel" },
  { id: "own", title: "My own Claude key", sub: "Billed by Anthropic" },
] as const;

/** How agents think (card 162): the business's own Claude key (docs/tenancy.md, slice 8.1c), or on the cloud edition OPERATOR's hosted Claude on credits; with an AI Gateway key, which of the two keys Claude runs on first. */
async function ClaudeCard({ owner, query }: { owner: boolean; query: Readonly<Record<string, string | undefined>> }) {
  const state = await claudeState();
  const ok = claudeReady(state);
  const using = inUse(state);
  // with a gateway key, the card is about which key Claude runs on; without one, it is the usual choice
  const both = !!state.gateway && state.ownKey && !state.ownKeyPaused;
  const via = both ? state.via ?? "gateway" : "gateway";
  const pill = !ok ? "Not set up" : state.gateway ? (via === "own" ? "Your own key" : "Through the gateway") : using === "hosted" ? "On OPERATOR’s Claude" : "Your own key";
  const forget = { title: "Forget the Claude key?", body: state.gateway ? "The key is forgotten here, and Claude runs on your AI Gateway key alone. Delete it in the Claude Console too if it shouldn’t work anywhere." : state.edition === "cloud" ? "The key is forgotten here, and runs move to OPERATOR’s Claude on your credits. Delete it in the Claude Console too if it shouldn’t work anywhere." : "The key is forgotten here. Delete it in the Claude Console too if it shouldn’t work anywhere.", confirmLabel: "Forget it", kind: "danger" as const };
  return (
    <div className="card" id="claude" style={{ gap: state.gateway ? 12 : 10 }}>
      <span className="row" style={{ gap: 8, justifyContent: "space-between" }}>
        <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 600 }}><Icon name="cpu" size={15} />Claude</span>
        <span className="pill sm" style={{ background: ok ? "var(--mint-soft)" : "var(--red-soft)", color: ok ? "var(--mint-ink)" : "var(--red-ink)" }}>{pill}</span>
      </span>
      {state.gateway ? <>
        {both && <ChoiceSwitch label="Claude runs on" value={via} options={CLAUDE_VIA_OPTIONS} act={claudeSetVia} disabled={!owner} />}
        <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {!both ? (state.ownKeyPaused
            ? "Claude agents and steps run on your AI Gateway key. Anthropic stopped accepting your saved Claude key: paste a new one to choose between the two."
            : "Claude agents and steps run on your AI Gateway key. Save your own Claude key below to choose between the two.")
            : via === "own" ? "Claude agents and steps run on your own Claude key, billed by Anthropic. If that key can’t answer, the run tries your AI Gateway key once. Pictures and other makers’ models still come through the gateway."
            : "Claude agents and steps run on your AI Gateway key. If the gateway can’t answer, the run tries your own Claude key once. Runs never fall back to credits."}
        </span>
        {!both && (owner
          ? <><KeyForm label="Claude API key" save={claudeSaveKey} placeholder="sk-ant-…" replace={state.ownKey} /><span className="sub">From the Claude Console, Settings › API keys.</span></>
          : <span className="sub">Ask an owner of this business to paste their Claude key.</span>)}
        {both && (
          <span className="row" style={{ gap: 8, justifyContent: "space-between", fontSize: 12.5, borderTop: "1px solid var(--bd)", paddingTop: 12 }}>
            <span className="ink2">Your own Claude key is saved.</span>
            {owner && <ActionButton className="btn outline sm" action={claudeRemoveKey} confirm={forget}>Forget the key</ActionButton>}
          </span>
        )}
      </> : <>
        <span className="ink2" style={{ fontSize: 12.5 }}>
          {ok ? "Every agent thinks with Claude. A key of your own always comes first; without one, runs use OPERATOR’s Claude and are paid from credits."
            : state.edition === "cloud" ? "Agents can’t think yet, so runs stop with a note. Buy credits for OPERATOR’s Claude, or paste your own key." : "Paste a Claude API key from the Claude Console (Settings > API keys). Until then agents can’t think, so runs stop with a note."}
        </span>
        <ClaudeChoice state={state} picked={pickedChoice(state, query.claude)} owner={owner} back="connections" query={query} />
        {owner && state.ownKey && <ActionButton className="btn outline sm" action={claudeRemoveKey} confirm={forget}>Forget the key</ActionButton>}
      </>}
    </div>
  );
}

/** The steps to make a gateway key, click by click (conductor ticket 1 mockup). */
const GATEWAY_STEPS = [
  <>Open <b>vercel.com</b> and sign in.</>,
  <>Pick your team, then <b>AI Gateway</b> in the left menu.</>,
  <>Open <b>API Keys</b> and press <b>Create key</b>.</>,
  <>Name it <b>OPERATOR</b>, and set a <b>monthly budget</b> (start with $50).</>,
  <>Press <b>Create</b>, copy the key, and paste it below.</>,
];

/**
 * The Vercel AI Gateway (conductor ticket 1, to the approved mockup): one key that reaches every maker's models, billed
 * by Vercel at each maker's own price. Picture models come through it now; text models, Claude included, next.
 */
async function GatewayCard({ owner }: { owner: boolean }) {
  const p = PROVIDER_BY_ID.gateway;
  const st = await mcpStatus(p.vaultId);
  const on = !!st?.connected, paused = on && !!st?.paused;
  const [credits, { month, week }] = on && !paused
    ? await Promise.all([gatewayCredits(), imageSpendNow().catch(() => ({ month: [], week: [] }))])
    : [null, { month: [], week: [] }];
  const gw = (rows: { model: string; usd: number; pictures: number }[]) => rows.filter((r) => imageModel(r.model)?.provider === "gateway");
  const spent = gw(month).reduce((t, r) => t + r.usd, 0);
  const makers = new Map<string, { usd: number; pictures: number }>();
  for (const r of gw(week)) { const k = imageModel(r.model)!.maker, t = makers.get(k) ?? { usd: 0, pictures: 0 }; t.usd += r.usd; t.pictures += r.pictures; makers.set(k, t); }
  const pictures = IMAGE_MODELS.filter((m) => m.provider === "gateway").length;
  // Claude's models go through the gateway too, so they count as its text models
  const texts = MODEL_LIST.filter((m) => m.provider === "gateway" || m.provider === "anthropic").length;
  const usd = (v: number) => `$${v.toFixed(2)}`;
  const tile = (n: string, label: string, live: boolean) => (
    <div style={{ background: live ? "var(--mint-soft)" : "var(--soft)", borderRadius: 14, padding: "10px 12px", display: "flex", flexDirection: "column" }}>
      <b style={{ fontSize: 18 }}>{n}</b><span style={{ fontSize: 12, color: live ? "var(--mint-ink)" : "var(--ink2)" }}>{label}</span>
    </div>
  );
  return (
    <div className="card" id="gateway" style={{ gap: 12 }}>
      <span className="row" style={{ gap: 8, justifyContent: "space-between" }}>
        <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 600 }}><Icon name="cpu" size={15} />AI Gateway</span>
        <span className="pill sm" style={{ background: paused ? "var(--yel-soft)" : on ? "var(--mint-soft)" : "var(--soft)", color: paused ? "var(--yel-ink)" : on ? "var(--mint-ink)" : "var(--ink2)" }}>{paused ? "Paused" : on ? "Connected" : "No key"}</span>
      </span>
      <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
        {on
          ? "Claude, other makers’ text models and picture models all come through your Vercel AI Gateway key. Vercel bills you at each maker’s own price, with no markup on top."
          : "One key reaches every model OPERATOR offers through Vercel: Claude, other makers’ text models, and picture models. Vercel bills you at each maker’s own price, with no markup on top. Until a key is saved, gateway models can’t run, and Claude runs on your own key or credits as before."}
      </span>
      {paused && st?.lastError && <span className="ink2" style={{ fontSize: 12.5 }}>{st.lastError}</span>}
      {on && !paused && <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 8 }}>
          {tile(String(pictures), "Pictures", true)}
          {tile(String(texts), "Text, Claude too", true)}
          {tile("Later", "Video, voice, transcribe", false)}
        </div>
        <div style={{ borderTop: "1px solid var(--bd)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span className="ink2">Pictures this month</span><b>{usd(spent)}</b></span>
          <span className="ink2" style={{ fontSize: 12 }}>Each agent run’s cost is on Activity, as before.</span>
          <span className="row" style={{ justifyContent: "space-between", fontSize: 13 }}><span className="ink2">Credits left in Vercel</span><b>{credits ? usd(credits.balance) : "Couldn’t read"}</b></span>
          <span className="ink2" style={{ fontSize: 12 }}>You set the budget on the key in Vercel. When it runs out, steps stop and say so, and your agents’ daily budgets still apply on top.</span>
        </div>
        {makers.size > 0 && (
          <div style={{ borderTop: "1px solid var(--bd)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 600 }}>Last 7 days by maker</span>
            {[...makers].sort((a, b) => b[1].usd - a[1].usd).map(([k, t]) => (
              <span key={k} className="row" style={{ justifyContent: "space-between", fontSize: 12.5 }}><span>{k}</span><span className="ink2">{usd(t.usd)} · {t.pictures} picture{t.pictures === 1 ? "" : "s"}</span></span>
            ))}
          </div>
        )}
      </>}
      {owner
        ? <>
            {!on && <>
              <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7 }}>{GATEWAY_STEPS.map((t, i) => <li key={i}>{t}</li>)}</ol>
              <span style={{ background: "var(--yel-soft)", color: "var(--yel-ink)", borderRadius: 14, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.5 }}>Vercel asks for credits before the key works. Add some under <b>AI Gateway › Credits</b>.</span>
            </>}
            <KeyForm label="AI Gateway API key" save={modelSaveKey.bind(null, p.id)} placeholder={p.placeholder} replace={on} />
            {!on && <span className="sub">OPERATOR checks the key with one read-only call, then locks it in this business’s vault. It’s never shown again.</span>}
            {on && <ActionButton className="btn outline sm" action={modelRemoveKey.bind(null, p.id)} confirm={{ title: "Forget the AI Gateway key?", body: "The key is forgotten here, and Make an image steps on gateway models stop until a key is saved again. Delete it in Vercel too if it shouldn’t work anywhere.", confirmLabel: "Forget it", kind: "danger" }}>Forget the key</ActionButton>}
          </>
        : !on && <span className="sub">Ask an owner of this business to paste it.</span>}
    </div>
  );
}

/** The business's own keys for other model providers (docs/agent-setup.md, "Models across providers"). */
async function ModelKeysCard({ owner }: { owner: boolean }) {
  const list = MODEL_PROVIDERS.filter((p) => !p.ownCard);
  const states = await Promise.all(list.map((p) => mcpStatus(p.vaultId)));
  return (
    <div className="card" id="models" style={{ gap: 10 }}>
      <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 600 }}><Icon name="cpu" size={15} />Other models</span>
      <span className="ink2" style={{ fontSize: 12.5 }}>Your own key for another AI provider, billed by that provider. With a key saved, its models show under Runs on in an agent’s sheet. Picking another model sends that agent’s job, facts and memory to the provider, and web search stays Claude-only.</span>
      {list.map((p, i) => {
        const st = states[i], on = !!st?.connected, paused = on && !!st?.paused;
        return (
          <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid var(--bd)" }}>
            <span className="row" style={{ gap: 8, justifyContent: "space-between" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{p.name}</span>
              <span className="pill sm" style={{ background: paused ? "var(--yel-soft)" : on ? "var(--mint-soft)" : "var(--soft)", color: paused ? "var(--yel-ink)" : on ? "var(--mint-ink)" : "var(--ink2)" }}>{paused ? "Paused" : on ? "Key saved" : "No key"}</span>
            </span>
            {paused && st?.lastError && <span className="ink2" style={{ fontSize: 12.5 }}>{st.lastError}</span>}
            {owner
              ? <>
                  {!on && <span className="ink2" style={{ fontSize: 12.5 }}>Make a key at {p.where}, then paste it here.</span>}
                  <KeyForm label={`${p.name} API key`} save={modelSaveKey.bind(null, p.id)} placeholder={p.placeholder} replace={on} />
                  {on && <ActionButton className="btn outline sm" action={modelRemoveKey.bind(null, p.id)} confirm={{ title: `Forget the ${p.name} key?`, body: `The key is forgotten here. Delete it at ${p.name} too if it shouldn’t work anywhere.`, confirmLabel: "Forget it", kind: "danger" }}>Forget the key</ActionButton>}
                </>
              : !on && <span className="sub">Ask an owner of this business to paste it.</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Live events (docs/live-events.md, slice 1): each service's hook address and its signing secret. */
async function LiveEventsCard({ owner }: { owner: boolean }) {
  const [states, org, h] = await Promise.all([hookStates().catch(() => []), orgId(), headers()]);
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const base = env.dashboardUrl ?? (host ? `https://${host}` : "");
  return (
    <div className="card" id="live-events" style={{ gap: 10 }}>
      <span className="row" style={{ gap: 8, fontSize: 15, fontWeight: 600 }}><Icon name="inbox" size={15} />Live events</span>
      <span className="ink2" style={{ fontSize: 12.5 }}>A service tells OPERATOR the moment something happens, so a chain on the Crew canvas can start within seconds instead of at its next scheduled time. OPERATOR checks every event’s signature with the secret you paste here, keeps only its named fields for 30 days, and starts only chains you saved with that event as their start, while the org and the chain are on. A chain starts on events at most 10 times an hour and 50 a day; past that, one catch-up run follows.</span>
      {SOURCES.map((s) => {
        const st = states.find((x) => x.source === s.id), on = !!st?.connected;
        const addr = st?.hook ? `${base}${hookPath(s.id, org, st.hook)}` : null;
        return (
          <div key={s.id} style={{ display: "flex", flexDirection: "column", gap: 6, paddingTop: 8, borderTop: "1px solid var(--bd)" }}>
            <span className="row" style={{ gap: 8, justifyContent: "space-between" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</span>
              <span className="pill sm" style={{ background: on ? "var(--mint-soft)" : "var(--soft)", color: on ? "var(--mint-ink)" : "var(--ink2)" }}>{on ? "Listening" : "Off"}</span>
            </span>
            {addr && <span style={{ fontSize: 12.5 }}>Hook address: <code style={{ wordBreak: "break-all" }}>{addr}</code></span>}
            {owner
              ? <>
                  {!on && <span className="ink2" style={{ fontSize: 12.5 }}>Paste the signing secret first and OPERATOR makes this business’s hook address. Then:</span>}
                  <ol className="ink2" style={{ fontSize: 12.5, margin: 0, paddingLeft: 18 }}>{s.steps.map((t) => <li key={t}>{t}</li>)}</ol>
                  <KeyForm label={`${s.name} signing secret`} save={hookSaveSecret.bind(null, s.id)} placeholder={s.placeholder} replace={on} />
                  {on && <ActionButton className="btn outline sm" action={hookRemove.bind(null, s.id)} confirm={{ title: `Stop ${s.name} live events?`, body: `The signing secret and the hook address are forgotten here, and events sent there are refused. Delete the webhook in ${s.name} too.`, confirmLabel: "Stop", kind: "danger" }}>Stop live events</ActionButton>}
                </>
              : !on && <span className="sub">Ask an owner of this business to set it up.</span>}
          </div>
        );
      })}
    </div>
  );
}
