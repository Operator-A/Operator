import Link from "next/link";
import { redirect } from "next/navigation";
import { getFloor, requireSession } from "@/dashboard/data";
import { atLeast } from "@/core/roles";
import { chatHistory } from "@/core/avery-chat";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS, initials } from "@/core/business-rules";
import { FACTS_MISSING, departmentTemplates, inSetup, listFacts, setupState } from "@/core/setup";
import { TEMPLATE_FIT } from "@/dashboard/setup";
import { SetupChat, FactsPanel, StoreForm, UnlistedTool, CompanyChart } from "@/dashboard/components/setup";
import { Icon } from "@/dashboard/components/Icon";
import { toolsStep, type TileView } from "@/dashboard/toolsStep";
import { KeyForm, ActionButton } from "@/dashboard/components/client";
import { companyChart } from "@/dashboard/company";
import { initialPick } from "@/core/company-rules";
import { claudeSaveKey, ga4PickProperty, mcpSaveKey } from "@/dashboard/connectionActions";
import { sendSetup, setupAddFact, setupConfirmFact, setupEditFact, setupInstall, setupRemoveFact, setupShopifyStore, setupStartEmpty, setupToolAsk } from "@/dashboard/setupActions";
import { controlsOn } from "@/dashboard/session";

// First-run setup (card 151, docs/setup.md): a new business lands here instead of the Desk. Step 1 is
// the conversation with Avery; step 2 connects the tools (card 152); step 3 is the company Avery
// proposes (card 153); step 4 explains the first job, which the Desk offers (card 154).
export const maxDuration = 120;

export default async function Setup({ searchParams }: { searchParams: Promise<{ c?: string; connected?: string; problem?: string }> }) {
  const sp = await searchParams;
  const me = await requireSession();
  if (!(await inSetup())) redirect("/");
  const [floor, facts, state, history, biz] = await Promise.all([getFloor(), listFacts(), setupState(), chatHistory(30).catch(() => null), loadBusiness().catch(() => UNKNOWN_BUSINESS)]);
  const owner = atLeast(me.role, "owner");
  const keyed = !!floor.health?.claude;
  const templates = departmentTemplates();
  const leaning = state.leaning.map((l) => ({ ...l, name: templates.find((t) => t.id === l.id)?.name ?? l.id }));
  const blocked = controlsOn() ? null : "Controls are off, so Avery can’t answer yet: each message is a real model call. Set DASHBOARD_CONTROLS=on.";
  const steps = ["Your business", "Tools", "Your company", "First job"];
  const { tiles, shopifyDomain, connected } = await toolsStep(state.leaning.map((l) => l.id), floor.health);
  const open = tiles.find((t) => t.tile.id === sp.c) ?? null;
  const chart = companyChart(state.leaning, connected);
  const note = sp.problem ? { ok: false, text: sp.problem.slice(0, 300) } : sp.connected && open ? { ok: true, text: `${open.tile.name} is connected.` } : null;

  return (
    <div className="page">
      <div className="ws">
        <header className="topbar" style={{ flexWrap: "wrap", gap: 16 }}>
          <span className="brand">
            <span className="brand-mark">{initials(biz.name)}</span>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}><span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.02em" }}>{biz.name}</span><span style={{ fontSize: 12 }} className="muted">Setting up</span></span>
          </span>
          <nav aria-label="Setup steps" className="row wrap" style={{ gap: 18, marginLeft: "auto" }}>
            {steps.map((s, i) => (
              <a key={s} href={`#step-${i + 1}`} className="row" style={{ gap: 8, fontSize: 13, fontWeight: i === 0 ? 600 : 400, color: "inherit", textDecoration: "none" }}>
                <span style={{ width: 24, height: 24, borderRadius: 999, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 700, background: i === 0 ? "var(--acc)" : "var(--soft)", color: i === 0 ? "#fff" : "inherit" }}>{i + 1}</span>{s}
              </a>
            ))}
          </nav>
        </header>
        <main className="stack" style={{ gap: 28, padding: "8px clamp(16px, 3vw, 28px) 32px" }}>
          <div id="step-1" className="row wrap" style={{ gap: 24, alignItems: "flex-start" }}>
            {keyed ? (
              <SetupChat name="Avery" send={sendSetup} ready={controlsOn()} blocked={blocked}
                initial={(history ?? []).map((h) => ({ id: h.id, role: h.role, text: h.text, runId: h.run_id, notes: h.notes }))} />
            ) : (
              <section className="card stack" style={{ gap: 12, flex: "999 1 520px", minWidth: 0 }} aria-labelledby="key-h">
                <h1 id="key-h" style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em" }}>First, Avery needs a Claude key</h1>
                <span className="ink2" style={{ fontSize: 14.5 }}>Every agent thinks with your business’s own Claude key, so Anthropic bills you directly. Make one in the Claude Console (Settings, then API keys) and paste it here. It is locked in the vault and never shown again.</span>
                {owner ? <KeyForm label="Claude API key" save={claudeSaveKey} placeholder="sk-ant-…" /> : <span className="sub">Ask an owner of this business to paste it.</span>}
              </section>
            )}
            <aside className="stack" style={{ gap: 16, flex: "1 1 300px" }} aria-label="What Avery has learned">
              {facts ? <FactsPanel facts={facts} add={setupAddFact} edit={setupEditFact} confirm={setupConfirmFact} remove={setupRemoveFact} /> : <div className="card sub">{FACTS_MISSING}</div>}
              <div className="card stack" style={{ gap: 10 }}>
                <h2 className="card-t" style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: ".04em" }}>Departments I’m thinking of</h2>
                {leaning.length ? (
                  <ul style={{ listStyle: "none", margin: 0, padding: 0 }} className="stack">
                    {leaning.map((l) => <li key={l.id} className="row" style={{ justifyContent: "space-between", gap: 8, fontSize: 14 }}><span>{l.name}</span><span style={{ color: l.fit === "strong" ? "var(--mint-ink)" : "var(--mut)" }}>{TEMPLATE_FIT[l.fit]}</span></li>)}
                  </ul>
                ) : <span className="sub">Once Avery knows a little about the business, she lists the departments she thinks fit.</span>}
                <span className="sub">You’ll see the full company once your tools are connected.</span>
              </div>
            </aside>
          </div>

          <section id="step-2" className="card stack" style={{ gap: 14 }} aria-labelledby="tools-h">
            <span id="tools" />
            <h2 id="tools-h" className="card-t">2. Connect your tools</h2>
            <span className="sub">Connect the tools you already use, so your agents can see the business for themselves. Each one asks only for what its agents read, and you can skip any of them for now.</span>
            {note && <span className="soft-box" role="status" style={{ fontSize: 13, background: note.ok ? "var(--mint-soft)" : "var(--red-soft)", color: note.ok ? "var(--mint-ink)" : "var(--red-ink)" }}>{note.text}</span>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 12 }}>
              {tiles.map((t) => <ToolTileCard key={t.tile.id} t={t} on={open?.tile.id === t.tile.id} />)}
            </div>
            {open && <ToolPanel t={open} owner={owner} shopifyDomain={shopifyDomain} />}
            <div className="stack rule" style={{ gap: 8, paddingTop: 12 }}>
              <b style={{ fontSize: 14 }}>A tool that isn’t listed?</b>
              <span className="sub">Tell Avery its name. If it has its own server you can add it by address; if not, it goes on the list of connections to build.</span>
              {owner ? <UnlistedTool ask={setupToolAsk} /> : <span className="sub">An owner of this business connects tools.</span>}
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}><a href="#step-3" className="btn outline sm">{connected.size ? "Next: your company" : "Skip for now"}</a></div>
          </section>

          <section id="step-3" className="card stack" style={{ gap: 12 }} aria-labelledby="company-h">
            <h2 id="company-h" className="card-t">3. Your company</h2>
            <span className="sub">{state.leaning.length ? "Avery’s proposal, from what you told her and the tools you connected. Each agent shows its job, the tools it uses and what it adds to the month." : "Avery hasn’t proposed departments yet. Tell her about your business in step 1, or add departments below."}</span>
            {owner ? (
              <>
                <CompanyChart owner={biz.ownerName || "You"} company={chart.company} depts={chart.depts} initial={initialPick(chart.depts)} install={setupInstall} back="#step-1" />
                <div className="row wrap rule" style={{ gap: 12, justifyContent: "space-between", paddingTop: 12 }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><b style={{ fontSize: 14 }}>Start empty</b><span className="sub">Keep Avery alone, add departments on Crew &gt; Org chart and build each agent yourself.</span></span>
                  <ActionButton className="btn outline sm" action={setupStartEmpty} follow>Start empty</ActionButton>
                </div>
              </>
            ) : <span className="sub">An owner of this business picks the departments.</span>}
          </section>

          <section id="step-4" className="card stack" style={{ gap: 8 }} aria-labelledby="job-h">
            <h2 id="job-h" className="card-t">4. First job</h2>
            <span className="sub">After Start this company, the Desk picks the first job in code: the agent whose tools are connected and whose work ends in something you approve (the Bookkeeper when your bank is connected). One tap approves its playbook and starts it; every other agent waits for your approval.</span>
          </section>
        </main>
      </div>
    </div>
  );
}

const STATE_WORD: Record<TileView["state"], { text: string; bg: string; fg: string }> = {
  connected: { text: "Connected", bg: "var(--mint-soft)", fg: "var(--mint-ink)" },
  paused: { text: "Paused", bg: "var(--red-soft)", fg: "var(--red-ink)" },
  not: { text: "Not connected", bg: "var(--soft)", fg: "var(--ink2)" },
  coming: { text: "Coming next", bg: "var(--soft)", fg: "var(--mut)" },
};

function ToolTileCard({ t, on }: { t: TileView; on: boolean }) {
  const w = STATE_WORD[t.state];
  return (
    <Link href={on ? "/start#step-2" : `/start?c=${t.tile.id}#step-2`} scroll={false} className="card" aria-current={on ? "true" : undefined} style={{ gap: 10, padding: 14, textDecoration: "none", color: "var(--ink)", outline: on ? "2px solid var(--ink)" : undefined }}>
      <span className="row" style={{ gap: 10 }}>
        <span style={{ width: 36, height: 36, borderRadius: 11, background: "var(--soft)", display: "grid", placeItems: "center", flex: "none" }}><Icon name={t.tile.icon} size={16} /></span>
        <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1 }}><span style={{ fontSize: 15, fontWeight: 600 }}>{t.tile.name}</span><span className="muted" style={{ fontSize: 12 }}>{t.tile.gives}</span></span>
      </span>
      <span className="row wrap" style={{ gap: 6 }}>
        <span className="pill sm" style={{ background: w.bg, color: w.fg }}>{w.text}</span>
        {t.neededBy.length > 0 && t.state !== "connected" && <span className="pill sm" style={{ background: "var(--yel-soft)", color: "var(--yel-ink)" }}>Needed for {t.neededBy.join(", ")}</span>}
      </span>
    </Link>
  );
}

function ToolPanel({ t, owner, shopifyDomain }: { t: TileView; owner: boolean; shopifyDomain: string }) {
  const { tile } = t;
  if (t.state === "coming") {
    return <div className="card stack" style={{ gap: 8, background: "var(--soft)" }}><b style={{ fontSize: 15 }}>{tile.name}</b><span className="sub">Coming soon. Skip it for now; it shows up here when it’s ready.</span></div>;
  }
  if (t.pick) {
    return (
      <div className="card stack" style={{ gap: 10, background: "var(--soft)" }} aria-label="Pick the Analytics property">
        <b style={{ fontSize: 16 }}>Which site should agents report on?</b>
        <span className="sub">Google signed in. Every Analytics tool reads the one property you pick; agents can’t pick another.</span>
        {!t.pick.length && <span className="soft-box" style={{ fontSize: 13 }}>Couldn’t read the properties. Try again on <Link href="/connections?c=analytics">Connections</Link>.</span>}
        {t.pick.map((p) => (
          <span key={p.id} className="row" style={{ gap: 10, padding: "8px 12px", borderRadius: 12, background: "var(--card)" }}>
            <span style={{ flex: 1, display: "flex", flexDirection: "column" }}><span style={{ fontSize: 14, fontWeight: 600 }}>{p.name || p.id}</span><span className="muted" style={{ fontSize: 12 }}>{p.account}</span></span>
            {owner && <ActionButton className="btn outline sm" action={ga4PickProperty.bind(null, p.id)}>Use this one</ActionButton>}
          </span>
        ))}
      </div>
    );
  }
  const token = tile.id === "shopify";
  return (
    <div className="card stack" style={{ gap: 12, background: "var(--soft)" }} aria-label={`Connect ${tile.name}, step by step`}>
      <span className="row" style={{ gap: 8, justifyContent: "space-between" }}><b style={{ fontSize: 16 }}>Connect {tile.name}</b><span className="pill sm" style={{ background: STATE_WORD[t.state].bg, color: STATE_WORD[t.state].fg }}>{STATE_WORD[t.state].text}</span></span>
      {t.state === "connected" && <span style={{ fontSize: 13.5 }}>Connected{t.who ? <> as <b>{t.who}</b></> : ""}. {tile.id === "mercury" ? "If that isn’t your business, disconnect it on Connections and connect again. " : ""}You can change it any time on <Link href={`/connections?c=${tile.id}`}>Connections</Link>.</span>}
      {t.state === "paused" && <span className="soft-box" style={{ fontSize: 13 }}>Paused: {t.problem ?? "the sign-in stopped working"}. Follow the steps again to reconnect.</span>}
      {t.state !== "connected" && (
        <ol className="stack" style={{ margin: 0, paddingLeft: 20, gap: 6, fontSize: 14, lineHeight: 1.5 }}>
          {tile.steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
      )}
      {t.permissions.length > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>What it asks for, and why</span>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.5 }} className="ink2">
            {t.permissions.map((p) => <li key={p.scope}>{p.words}.</li>)}
          </ul>
        </div>
      )}
      {t.state === "connected" && tile.also && t.also && !t.also.connected && (
        <div className="stack rule" style={{ gap: 6, paddingTop: 10 }}>
          <b style={{ fontSize: 14 }}>{tile.also.label}{t.neededBy.length ? ` (needed for ${t.neededBy.join(", ")})` : ""}</b>
          <span className="sub">{tile.also.why} Sign in to the same mailbox.</span>
          {owner && <div><a className="btn outline sm" href={`/connections/${tile.also.mcp}/connect?from=start`}>Connect {tile.also.label}</a></div>}
        </div>
      )}
      {t.state !== "connected" && (owner ? (token ? (
        <div className="stack" style={{ gap: 8 }}>
          <StoreForm initial={shopifyDomain} save={setupShopifyStore} />
          {shopifyDomain ? <KeyForm label="Shopify key" save={mcpSaveKey.bind(null, "shopify")} placeholder="shpat_…" /> : <span className="sub">Save the store’s address first; the key is checked against it.</span>}
        </div>
      ) : (
        <div><a className="btn dark sm" href={`/connections/${tile.mcp}/connect?from=start`}>Connect {tile.name}</a></div>
      )) : <span className="sub">An owner of this business connects tools.</span>)}
    </div>
  );
}
