import Link from "next/link";
import { redirect } from "next/navigation";
import { getFloor, requireSession } from "@/dashboard/data";
import { atLeast } from "@/core/roles";
import { chatHistory } from "@/core/avery-chat";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS, initials } from "@/core/business-rules";
import { FACTS_MISSING, departmentTemplates, inSetup, listFacts, setupState } from "@/core/setup";
import { TEMPLATE_FIT } from "@/dashboard/setup";
import { STAGES, STAGE_WORDS, nextStage, prevStage, stageProgress, type Stage } from "@/core/setup-rules";
import { SetupChat, FactsPanel, StageNav, StoreForm, UnlistedTool, CompanyChart } from "@/dashboard/components/setup";
import { Icon } from "@/dashboard/components/Icon";
import { toolsStep, type TileView } from "@/dashboard/toolsStep";
import { KeyForm, ActionButton } from "@/dashboard/components/client";
import { companyChart } from "@/dashboard/company";
import { initialPick } from "@/core/company-rules";
import { ga4PickProperty, mcpSaveKey } from "@/dashboard/connectionActions";
import { claudeState } from "@/dashboard/claude";
import { claudeReady, inUse, pickedChoice } from "@/core/claude-choice-rules";
import { extensions } from "@/core/extensions";
import { ClaudeChoice } from "@/dashboard/components/claudeChoice";
import { sendSetup, setupGo, setupAddFact, setupConfirmFact, setupEditFact, setupInstall, setupRemoveFact, setupShopifyStore, setupStartEmpty, setupToolAsk } from "@/dashboard/setupActions";
import { controlsOn } from "@/dashboard/session";
import { billing } from "@/dashboard/cost";

// First-run setup (docs/setup.md): a new business lands here instead of the Desk. One guided flow
// (card 181): one step on screen at a time, the step kept in the setup state. The conversation with
// Avery (card 151), the tools (card 152), the company she proposes (card 153), then the first job,
// which the Desk offers (card 154).
export const maxDuration = 120;

// where the soft light sits behind each step, so it drifts as the founder moves on
const LIGHT: Record<Stage, [string, string, string]> = {
  business: ["translate(0,0)", "translate(0,0)", "translate(0,0)"],
  tools: ["translate(22vw,6vh)", "translate(-18vw,-8vh)", "translate(-14vw,10vh)"],
  company: ["translate(40vw,14vh) scale(1.2)", "translate(-36vw,-18vh) scale(1.15)", "translate(-20vw,-16vh) scale(1.25)"],
  first: ["translate(30vw,28vh)", "translate(-26vw,-30vh)", "translate(-6vw,-4vh) scale(1.2)"],
};

export default async function Setup({ searchParams }: { searchParams: Promise<{ c?: string; connected?: string; problem?: string; claude?: string; credits?: string; credits_problem?: string }> }) {
  const sp = await searchParams;
  const me = await requireSession();
  if (!(await inSetup())) redirect("/");
  const [floor, facts, state, history, biz, claude] = await Promise.all([getFloor(), listFacts(), setupState(), chatHistory(30).catch(() => null), loadBusiness().catch(() => UNKNOWN_BUSINESS), claudeState()]);
  const owner = atLeast(me.role, "owner");
  // own key or OPERATOR's hosted Claude on credits (card 162): either one opens the conversation
  const keyed = claudeReady(claude);
  // on OPERATOR's Claude: setup is free (the paid layer says how much is left), the crew's work needs credits
  const Hosted = inUse(claude) === "hosted" ? extensions.HostedClaude : null;
  const templates = departmentTemplates();
  const leaning = state.leaning.map((l) => ({ ...l, name: templates.find((t) => t.id === l.id)?.name ?? l.id }));
  const blocked = controlsOn() ? null : "Avery can’t answer here yet: real runs are switched off for this OPERATOR. Whoever runs it turns them on.";
  const { tiles, shopifyDomain, connected } = await toolsStep(state.leaning.map((l) => l.id), floor.health);
  const open = tiles.find((t) => t.tile.id === sp.c) ?? null;
  const chart = companyChart(state.leaning, connected, await billing());
  const note = sp.problem ? { ok: false, text: sp.problem.slice(0, 300) } : sp.connected && open ? { ok: true, text: `${open.tile.name} is connected.` } : null;
  const stage = state.stage, at = STAGES.indexOf(stage);
  const talked = (history ?? []).length > 0;
  const back = prevStage(stage), next = nextStage(stage);
  const nextLabel = stage === "business" ? (talked ? "Next: your tools" : "Skip to tools") : stage === "tools" ? (connected.size ? "Next: your company" : "Skip for now") : "Next: your first job";

  return (
    <div className="wg">
      {LIGHT[stage].map((t, i) => <div key={i} aria-hidden className={`wg-blob b${i}`} style={{ transform: t }} />)}
      <header className="wg-top">
        <span className="brand" style={{ width: "auto" }}>
          <span className="brand-mark">{initials(biz.name)}</span>
          <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}><span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.02em" }}>{biz.name}</span><span style={{ fontSize: 12 }} className="ink2">Setting up</span></span>
        </span>
        <ol aria-label="Setup progress" className="wg-steps">
          {STAGES.map((s, i) => <li key={s} aria-current={i === at ? "step" : undefined} className={i < at ? "done" : i === at ? "now" : ""}><i aria-hidden />{STAGE_WORDS[s]}</li>)}
        </ol>
      </header>
      <div aria-hidden className="wg-line"><i style={{ width: `${stageProgress(stage)}%` }} /></div>

      <main className="wg-main">
        {state.stage === "business" && (
          <div key="business" className="row wrap" style={{ gap: 24, alignItems: "flex-start" }}>
            {keyed ? (
              <SetupChat name="Avery" send={sendSetup} ready={controlsOn()} blocked={blocked} foot={Hosted ? "Setup is free. No card until your crew is ready to work." : null}
                initial={(history ?? []).map((h) => ({ id: h.id, role: h.role, text: h.text, runId: h.run_id, notes: h.notes }))} />
            ) : (
              <section className="wg-glass wg-card wg-enter" style={{ flex: "999 1 520px", minWidth: 0 }} aria-labelledby="key-h">
                <h1 id="key-h" className="wg-h1" style={{ fontSize: 30 }}>First, choose how Avery thinks</h1>
                <span className="ink2" style={{ fontSize: 14.5 }}>{claude.edition === "cloud" ? "Every agent thinks with Claude. Use OPERATOR’s, paid from credits with nothing to set up, or bring your own key and Anthropic bills you. You can switch later on Connections." : "Every agent thinks with your business’s own Claude key, so Anthropic bills you directly."}</span>
                <ClaudeChoice state={claude} picked={pickedChoice(claude, sp.claude)} owner={owner} back="start" query={sp} />
              </section>
            )}
            {keyed && talked && (
              <aside className="stack wg-enter" style={{ gap: 16, flex: "1 1 300px" }} aria-label="What Avery has learned">
                {facts ? <FactsPanel facts={facts} add={setupAddFact} edit={setupEditFact} confirm={setupConfirmFact} remove={setupRemoveFact} /> : <div className="wg-glass wg-card sub">{FACTS_MISSING}</div>}
                <div className="wg-glass wg-card" style={{ gap: 10 }}>
                  <h2 className="wg-eyebrow">Departments I’m thinking of</h2>
                  {leaning.length ? (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }} className="stack">
                      {leaning.map((l) => <li key={l.id} className="row" style={{ justifyContent: "space-between", gap: 8, fontSize: 14 }}><span>{l.name}</span><span style={{ color: l.fit === "strong" ? "var(--mint-ink)" : "var(--ink2)" }}>{TEMPLATE_FIT[l.fit]}</span></li>)}
                    </ul>
                  ) : <span className="sub">Once Avery knows a little about the business, she lists the departments she thinks fit.</span>}
                </div>
                {Hosted && (
                  <div className="wg-glass wg-card" style={{ gap: 6 }} aria-label="How Avery thinks">
                    <h2 className="wg-eyebrow">On OPERATOR’s Claude</h2>
                    <Hosted back="start" owner={owner} query={sp} compact />
                    <Link href="/connections?claude=own#claude" className="sub">Use your own Claude key instead</Link>
                  </div>
                )}
              </aside>
            )}
          </div>
        )}

        {state.stage === "tools" && (
          <section key="tools" className="wg-glass wg-card wg-enter" aria-labelledby="tools-h">
            <h1 id="tools-h" className="wg-h1" style={{ fontSize: 30 }}>Connect your tools</h1>
            <span className="wg-lead">Your agents see the business for themselves. Each tool asks only for what its agents read, and you can skip any of them for now.</span>
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
          </section>
        )}

        {state.stage === "company" && (
          <section key="company" className="wg-glass wg-card wg-enter" aria-labelledby="company-h">
            <h1 id="company-h" className="wg-h1" style={{ fontSize: 30 }}>Your company</h1>
            <span className="wg-lead">{state.leaning.length ? "Avery’s proposal, from what you told her and the tools you connected. Each agent shows its job, the tools it uses and what it adds to the month." : "Avery hasn’t proposed departments yet. Go back and tell her about your business, or add departments below."}</span>
            {owner ? (
              <>
                <CompanyChart owner={biz.ownerName || "You"} company={chart.company} depts={chart.depts} initial={initialPick(chart.depts)} install={setupInstall} back={setupGo.bind(null, "business")} />
                <div className="row wrap rule" style={{ gap: 12, justifyContent: "space-between", paddingTop: 12 }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><b style={{ fontSize: 14 }}>Start empty</b><span className="sub">Keep Avery alone, add departments on Crew &gt; Org chart and build each agent yourself.</span></span>
                  <ActionButton className="btn outline sm" action={setupStartEmpty} follow>Start empty</ActionButton>
                </div>
              </>
            ) : <span className="sub">An owner of this business picks the departments.</span>}
          </section>
        )}

        {state.stage === "first" && (
          <section key="first" className="wg-glass wg-card wg-enter" style={{ maxWidth: 680, margin: "0 auto", width: "100%" }} aria-labelledby="job-h">
            <h1 id="job-h" className="wg-h1" style={{ fontSize: 30 }}>Your first job</h1>
            <span className="wg-lead">After Start this company, the Desk picks the first job: the agent whose tools are connected and whose work ends in something you approve (the Bookkeeper when your bank is connected). One tap approves its playbook and starts it; every other agent waits for your approval.</span>
            {Hosted && (
              <div className="stack rule" style={{ gap: 8, paddingTop: 12 }}>
                <b style={{ fontSize: 14 }}>Credits for your crew’s work</b>
                <span className="sub">Setup is free. Your crew’s jobs run on credits, so buy a pack before the first job (or paste your own key on Connections).</span>
                <Hosted back="start" owner={owner} query={sp} />
              </div>
            )}
          </section>
        )}

        <StageNav go={setupGo}
          back={back ? { stage: back, label: "Back" } : null}
          next={next ? { stage: next, label: nextLabel, quiet: stage === "business" && !talked } : null} />
      </main>
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
    <Link href={on ? "/start" : `/start?c=${t.tile.id}`} scroll={false} className="card" aria-current={on ? "true" : undefined} style={{ gap: 10, padding: 14, textDecoration: "none", color: "var(--ink)", outline: on ? "2px solid var(--ink)" : undefined }}>
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
