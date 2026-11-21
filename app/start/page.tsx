import Link from "next/link";
import { redirect } from "next/navigation";
import { getHealth, requireSession } from "@/dashboard/data";
import { atLeast } from "@/core/roles";
import { chatHistory } from "@/core/avery-chat";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS, initials } from "@/core/business-rules";
import { FACTS_MISSING, inSetup, listFacts, setupState } from "@/core/setup";
import { SETUP_AGENT, STAGES, STAGE_WORDS, nextStage, prevStage, shownStage, stageProgress, wrapScreen, type Stage } from "@/core/setup-rules";
import { AutoSnapshot, SetupChat, Coverage, FactsPanel, StageNav, StoreForm, UnlistedTool, CompanyChart } from "@/dashboard/components/setup";
import { hasSnapshot, snapshotPrefix } from "@/core/snapshot-rules";
import type { Fact } from "@/core/setup-rules";
import { SignOutButton } from "@/dashboard/components/signOut";
import { toolsStep, type TileView } from "@/dashboard/toolsStep";
import { cardCategory, categoryOfTile, categoryState, isCategory, partsShown, planKinds, planNotes, type CategoryPlan, type CategoryState, type ToolCategory } from "@/core/tools-step-rules";
import { KeyForm, ActionButton, LiveRefresher } from "@/dashboard/components/client";
import { FirstJobCard } from "@/dashboard/components/firstJob";
import { firstJobView, jobFloor } from "@/dashboard/firstJob";
import { firstSentence } from "@/dashboard/desk";
import { companyChart, designTools } from "@/dashboard/company";
import { initialPick } from "@/core/company-rules";
import { ga4PickProperty, mcpSaveKey } from "@/dashboard/connectionActions";
import { claudeState } from "@/dashboard/claude";
import { claudeReady, inUse, pickedChoice } from "@/core/claude-choice-rules";
import { extensions } from "@/core/extensions";
import { ClaudeChoice } from "@/dashboard/components/claudeChoice";
import { sendSetup, setupTimeZone, setupGo, setupAddFact, setupAnswerTool, setupConfirmFact, setupEditFact, setupInstall, setupRemoveFact, setupShopifyStore, setupOtherTool, setupPlanClear, setupSkipTool, setupSnapshot, setupStartEmpty, setupToDesk } from "@/dashboard/setupActions";
import { controlsOn } from "@/dashboard/session";
import { billing } from "@/dashboard/cost";
import { settings } from "@/core/settings";

// First-run setup (docs/setup.md): a new business lands here instead of the Desk. One guided flow
// (card 181): one step on screen at a time, the step kept in the setup state. The conversation with
// Avery (card 151), where she asks about tools by part and code draws the card (card 195), the company
// she proposes (card 153), then the first job (card 154).
export const maxDuration = 120;

// where the soft light sits behind each step, so it drifts as the founder moves on
const LIGHT: Record<Stage, [string, string, string]> = {
  business: ["translate(0,0)", "translate(0,0)", "translate(0,0)"],
  company: ["translate(40vw,14vh) scale(1.2)", "translate(-36vw,-18vh) scale(1.15)", "translate(-20vw,-16vh) scale(1.25)"],
  first: ["translate(30vw,28vh)", "translate(-26vw,-30vh)", "translate(-6vw,-4vh) scale(1.2)"],
};

export default async function Setup({ searchParams }: { searchParams: Promise<{ c?: string; q?: string; connected?: string; problem?: string; claude?: string; credits?: string; credits_problem?: string }> }) {
  const sp = await searchParams;
  const me = await requireSession();
  // one round for everything the step shows (card 202, docs/speed.md); setup needs which tools are set up, not the Desk's floor
  const [setup, health, facts, state, history, biz, claude, bill, own] = await Promise.all([inSetup(), getHealth(), listFacts(), setupState(), chatHistory(30).catch(() => null), loadBusiness().catch(() => UNKNOWN_BUSINESS), claudeState(), billing(), settings().catch(() => null)]);
  // card 186: after Start this company, setup counts as done but /start keeps the wrap-up (credits, then the first job)
  if (!setup && !state.wrapUp) redirect("/");
  const owner = atLeast(me.role, "owner");
  // own key or OPERATOR's hosted Claude on credits (card 162): either one opens the conversation
  const keyed = claudeReady(claude);
  // on OPERATOR's Claude: setup is free (the paid layer says how much is left), the crew's work needs credits
  const Hosted = inUse(claude) === "hosted" ? extensions.HostedClaude : null;
  /** The wrap-up (card 186): the first job read from a small floor, and whether a run would wait on credits. */
  const wrapUp = async () => {
    const view = await firstJobView(await jobFloor(health)).catch(() => null);
    const job = view?.phase === "offer" ? view.job : null;
    const needCredits = inUse(claude) === "hosted" && !!(await extensions.planBlock({ kind: "run", agentId: job?.agentId ?? SETUP_AGENT, trigger: "manual", billing: "credits" }).catch(() => null));
    return { view, job, screen: wrapScreen({ firstJob: state.firstJob, needCredits, jobReady: !!job }) };
  };
  const blocked = controlsOn() ? null : "Avery can’t answer here yet: real runs are switched off for this OPERATOR. Whoever runs it turns them on.";
  const { tiles, shopifyDomain, connected } = await toolsStep(state.leaning.map((l) => l.id), health, state.designs.filter((d) => !d.kit).map(designTools));
  const open = tiles.find((t) => t.tile.id === sp.c) ?? null;
  const chart = companyChart(state.leaning, state.designs, connected, bill, planNotes(state.plans), planKinds(state.plans));
  const note = sp.problem ? { ok: false, text: sp.problem.slice(0, 300) } : sp.connected && open ? { ok: true, text: `${open.tile.name} is connected.` } : null;
  // card 195: the part's card in the chat, the one the founder tapped (or came back to from a sign-in), else the one Avery asked about
  const tapped = isCategory(sp.q) ? sp.q : categoryOfTile(sp.c);
  const cat = cardCategory(tapped, state.asked.at(-1) ?? null, connected, state.skipped, state.plans);
  const parts = partsShown(connected, state.skipped, state.plans, state.asked);
  const stage = shownStage(state), at = STAGES.indexOf(stage);
  const talked = (history ?? []).length > 0;
  // the company step goes forward only by Start this company; the wrap-up has no Back (the departments are installed)
  const back = stage === "first" ? null : prevStage(stage), next = stage === "company" || stage === "first" ? null : nextStage(stage);
  const wrap = state.wrapUp ? await wrapUp() : null;
  const nextLabel = stage === "business" ? (talked ? "Show me my company" : "Skip to my company") : "Next: your first job";
  const card = cat && (
    <ToolCard key={`${cat.id}-${open?.tile.id ?? ""}`} c={cat} state={categoryState(cat, connected, state.skipped, state.plans)} plan={state.plans[cat.id] ?? null}
      tiles={tiles} open={open && cat.tiles.includes(open.tile.id) ? open : null} owner={owner} shopifyDomain={shopifyDomain} tapped={!!tapped} note={note} facts={facts ?? []} />
  );

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
        <SignOutButton look="button" />
      </header>
      <div aria-hidden className="wg-line"><i style={{ width: `${stageProgress(stage)}%` }} /></div>

      <main className="wg-main">
        {state.stage === "business" && (
          <div key="business" className="row wrap" style={{ gap: 24, alignItems: "flex-start" }}>
            {keyed ? (
              <SetupChat name="Avery" card={card} send={sendSetup} zone={own && !own.timeZone ? setupTimeZone : undefined} ready={controlsOn()} blocked={blocked} foot={Hosted ? "Setup is free. No card until your crew is ready to work." : null}
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
                {facts && <Coverage facts={facts} />}
                <YourTools parts={parts} tiles={tiles} asking={cat?.id ?? null} />
                {facts ? <FactsPanel facts={facts} add={setupAddFact} edit={setupEditFact} confirm={setupConfirmFact} remove={setupRemoveFact} /> : <div className="wg-glass wg-card sub">{FACTS_MISSING}</div>}
                <div className="wg-glass wg-card" style={{ gap: 10 }}>
                  <h2 className="wg-eyebrow">Avery’s sketch</h2>
                  {state.designs.length ? (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0 }} className="stack">
                      {state.designs.map((d) => <li key={d.key} className="stack" style={{ gap: 2, fontSize: 14 }}><span className="row" style={{ justifyContent: "space-between", gap: 8 }}><b style={{ fontWeight: 600 }}>{d.name}</b><span className="ink2" style={{ fontSize: 12.5 }}>{d.kit ? "From a kit" : "Designed for you"}</span></span><span className="ink2" style={{ fontSize: 13 }}>{d.purpose}</span></li>)}
                    </ul>
                  ) : <span className="sub">Once Avery understands the business, she sketches departments built around it.</span>}
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

        {state.stage === "company" && (
          <section key="company" className="wg-reveal" aria-labelledby="company-h">
            <div className="wg-enter" style={{ textAlign: "center", display: "flex", flexDirection: "column", gap: 10 }}>
              <h1 id="company-h" className="wg-h1" style={{ fontSize: "clamp(30px, 5vw, 44px)" }}>Meet your company.</h1>
              <span className="wg-lead">{state.designs.length ? "Avery designed these from what you told her. Each says why. Nothing goes out without your OK." : "Avery hasn’t sketched your company yet. Go back and tell her more about your business, or add departments below."}</span>
            </div>
            {owner ? (
              <CompanyChart owner={biz.ownerName || "You"} company={chart.company} depts={chart.depts} initial={initialPick(chart.depts)} install={setupInstall} back={setupGo.bind(null, "business")}
                empty={<ActionButton className="btn ghost sm" action={setupStartEmpty} follow>Start empty instead</ActionButton>} />
            ) : <span className="sub" style={{ textAlign: "center" }}>An owner of this business picks the departments.</span>}
          </section>
        )}

        {wrap && (
          <section key="first" className="stack wg-enter" style={{ gap: 18, maxWidth: 680, margin: "0 auto", width: "100%" }} aria-labelledby="job-h">
            <div className="stack" style={{ gap: 8, textAlign: "center" }}>
              <h1 id="job-h" className="wg-h1" style={{ fontSize: "clamp(28px,4.4vw,38px)" }}>
                {wrap.screen === "credits" ? "Setup was on us." : wrap.screen === "job" ? "Your first job." : wrap.screen === "waits" ? "Your company is ready." : "Your company is at work."}
              </h1>
              <span className="wg-lead">
                {wrap.screen === "credits" ? `Your crew’s work runs on credits.${wrap.job ? ` First up: ${wrap.job.name}, your ${wrap.job.role.toLowerCase()}, ${firstSentence(wrap.job.job, 140).replace(/^./, (c) => c.toLowerCase())}` : ""}`
                  : wrap.screen === "job" ? "One tap approves its playbook and starts it. Every other agent stays off duty until you approve its own."
                  : wrap.screen === "waits" ? "No agent can start yet: each department waits on a tool. Connect one and the first job shows on your Desk."
                  : "Your first agent is on the job. Anything it wants to change comes to you as an approval card."}
              </span>
            </div>
            {wrap.screen === "credits" && Hosted && (
              <div className="wg-glass wg-card" style={{ gap: 12 }}>
                <Hosted back="start" owner={owner} query={sp} />
                {sp.claude === "own"
                  ? <ClaudeChoice state={claude} picked="own" owner={owner} back="start" query={sp} />
                  : <Link href="/start?claude=own" scroll={false} className="sub">Use my own Claude key instead</Link>}
              </div>
            )}
            {wrap.view && wrap.screen !== "credits" && <FirstJobCard v={wrap.view} owner={owner} look="card wg-glass" />}
            {wrap.screen === "working" && wrap.view && wrap.view.phase !== "offer" && wrap.view.run && (
              <LiveRefresher runs={[{ id: wrap.view.run.id, name: wrap.view.name, status: wrap.view.run.status, live: wrap.view.run.status === "running" }]} />
            )}
            {(wrap.screen === "working" || wrap.screen === "waits") && (
              <div className="row" style={{ justifyContent: "center" }}>
                <ActionButton className="btn dark" action={setupToDesk} follow>Go to your Desk</ActionButton>
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

const PART_WORD: Record<CategoryState, string> = { connected: "Connected", open: "Not asked yet", skipped: "Later", guide: "Avery sets it up after", export: "On our build list", uses: "On our build list", none: "None yet" };

/** Your tools beside the chat (card 195): every core part, and any other once Avery asked about it. Tap one to open its card. */
function YourTools({ parts, tiles, asking }: { parts: { c: ToolCategory; state: CategoryState }[]; tiles: TileView[]; asking: string | null }) {
  return (
    <div className="wg-glass wg-card" style={{ gap: 10 }} aria-label="Your tools">
      <h2 className="wg-eyebrow">Your tools</h2>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }} className="stack">
        {parts.map(({ c, state }) => {
          const on = state === "connected" ? tiles.find((t) => c.tiles.includes(t.tile.id) && t.state === "connected") : null;
          const now = asking === c.id && state === "open";
          return (
            <li key={c.id}>
              <Link href={`/start?q=${c.id}`} scroll={false} className="row" style={{ justifyContent: "space-between", gap: 8, fontSize: 14, color: "var(--ink)" }}>
                <span>{c.area}</span>
                <span style={{ fontSize: 13, fontWeight: on || now ? 600 : 400, color: on ? "var(--mint-ink)" : now ? "#2A2F86" : "var(--ink2)" }}>{on ? on.tile.name : now ? "Asking now" : PART_WORD[state]}</span>
              </Link>
            </li>
          );
        })}
      </ul>
      <span className="sub" style={{ fontSize: 13 }}>Avery asks about a tool when the conversation gets there. You can also tap one here.</span>
    </div>
  );
}

/**
 * A part's card in the chat (card 195), drawn from code's list: the common tools, Something else,
 * None yet and Skip. A tool with a tile opens its connect steps here; any other is saved as the answer.
 */
function ToolCard({ c, state, plan, tiles, open, owner, shopifyDomain, tapped, note, facts }: { c: ToolCategory; state: CategoryState; plan: CategoryPlan | null; tiles: TileView[]; open: TileView | null; owner: boolean; shopifyDomain: string; tapped: boolean; note: { ok: boolean; text: string } | null; facts: Fact[] }) {
  const on = state === "connected" ? tiles.find((t) => c.tiles.includes(t.tile.id) && t.state === "connected") ?? null : null;
  // card 195 slice B: the numbers code read from it, saved as facts that start "From <tool>: "
  const prefix = on ? snapshotPrefix(on.tile.name) : null;
  const snap = prefix ? facts.filter((f) => f.text.startsWith(prefix)) : [];
  const answer = plan?.kind === "uses" || plan?.kind === "export" ? `${plan.tool}. There’s no direct line to it yet, so it’s on our build list.`
    : plan?.kind === "guide" ? `None yet. Avery sets up ${c.starter?.name} with you after setup.` : plan?.kind === "none" ? "None yet." : null;
  return (
    <section className="wg-pop stack" aria-label={c.area} style={{ gap: 12, background: "var(--card)", border: "1px solid var(--bd)", borderRadius: 18, padding: 18, maxWidth: 640 }}>
      <span className="row" style={{ justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <b style={{ fontSize: 15.5 }}>{on ? <>{on.tile.name} <span style={{ color: "var(--mint-ink)", fontSize: 13 }}>· Connected</span></> : c.area}</b>
        <span className="ink2" style={{ fontSize: 12.5 }}>Avery sees {c.learns}</span>
      </span>
      {note && <span className="soft-box" role="status" style={{ fontSize: 13, ...(note.ok ? {} : { background: "var(--red-soft)", color: "var(--red-ink)" }) }}>{note.text}</span>}
      {on ? (
        <>
          <span style={{ fontSize: 14 }}>{c.ready}{on.who ? <> Signed in as <b>{on.who}</b>.</> : ""}{on.tile.id === "mercury" ? " If that isn’t your business, change it on Connections." : ""}</span>
          {snap.length > 0 ? (
            <div className="stack" style={{ gap: 6 }}>
              <ul className="wg-snap">{snap.map((f) => <li key={f.id}>{f.text.slice(prefix!.length).replace(/^./, (x) => x.toUpperCase())}</li>)}</ul>
              <span className="ink2" style={{ fontSize: 12.5 }}>Counted in code from your {on.tile.name} and saved to what Avery knows. Nothing was changed in {on.tile.name}.</span>
            </div>
          ) : owner && hasSnapshot(on.tile.id) ? <AutoSnapshot take={setupSnapshot.bind(null, on.tile.id)} name={on.tile.name} /> : null}
          {on.tile.also && on.also && !on.also.connected && (
            <div className="stack rule" style={{ gap: 6, paddingTop: 10 }}>
              <b style={{ fontSize: 14 }}>{on.tile.also.label}{on.neededBy.length ? ` (needed for ${on.neededBy.join(", ")})` : ""}</b>
              <span className="sub">{on.tile.also.why} Sign in to the same mailbox.</span>
              {owner && <div><a className="btn outline sm" href={`/connections/${on.tile.also.mcp}/connect?from=start`}>Connect {on.tile.also.label}</a></div>}
            </div>
          )}
          <div><Link className="btn outline sm" href="/start" scroll={false}>Back to the conversation</Link></div>
        </>
      ) : open ? (
        <>
          <ToolPanel t={open} owner={owner} shopifyDomain={shopifyDomain} />
          <div><Link className="btn outline sm" href={`/start?q=${c.id}`} scroll={false}>Back</Link></div>
        </>
      ) : answer && tapped ? (
        <>
          <span style={{ fontSize: 14 }}>Your answer: {answer}</span>
          <div className="row wrap" style={{ gap: 10 }}>
            <Link className="btn outline sm" href="/start" scroll={false}>Back to the conversation</Link>
            {owner && <ActionButton className="btn ghost sm" action={setupPlanClear.bind(null, c.id)} follow>Change my answer</ActionButton>}
          </div>
        </>
      ) : !owner ? (
        <span className="sub">An owner of this business connects tools.</span>
      ) : (
        <>
          <div className="wg-tools">
            {c.tools.map((t) => (
              <ActionButton key={t.name} className="wg-tool" action={setupAnswerTool.bind(null, c.id, t.name)} follow>{t.name}</ActionButton>
            ))}
          </div>
          <div className="row wrap" style={{ gap: 10 }}>
            <details className="wg-else">
              <summary className="btn outline sm">Something else</summary>
              <div className="stack" style={{ gap: 8, paddingTop: 10 }}>
                <span className="sub">Type its name. If it connects, you’ll go straight to it; if not, it goes on our build list.</span>
                <UnlistedTool ask={setupOtherTool.bind(null, c.id)} />
              </div>
            </details>
            <ActionButton className="btn outline sm" action={setupAnswerTool.bind(null, c.id, null)} follow>None yet</ActionButton>
            {state === "open" && <ActionButton className="btn ghost sm" action={setupSkipTool.bind(null, c.id)} follow>Skip for now</ActionButton>}
            {tapped && <Link className="btn ghost sm" href="/start" scroll={false}>Close</Link>}
          </div>
          <span className="ink2" style={{ fontSize: 12.5, lineHeight: 1.45 }}>
            {c.tiles.length ? `${c.tools.filter((t) => t.tile).map((t) => t.name).join(" and ")}: you sign in on its own page, and Avery can read it right away. ` : ""}Anything she wants to change comes to you as an approval first.
          </span>
        </>
      )}
    </section>
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
