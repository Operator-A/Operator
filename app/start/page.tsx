import Link from "next/link";
import { redirect } from "next/navigation";
import { getFloor, requireSession } from "@/dashboard/data";
import { atLeast } from "@/core/roles";
import { chatHistory } from "@/core/avery-chat";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS, initials } from "@/core/business-rules";
import { FACTS_MISSING, departmentTemplates, inSetup, listFacts, setupState } from "@/core/setup";
import { TEMPLATE_FIT } from "@/dashboard/setup";
import { SetupChat, FactsPanel } from "@/dashboard/components/setup";
import { KeyForm, TemplatePicker, ActionButton } from "@/dashboard/components/client";
import { claudeSaveKey } from "@/dashboard/connectionActions";
import { sendSetup, setupAddFact, setupConfirmFact, setupEditFact, setupInstall, setupRemoveFact, setupStartEmpty } from "@/dashboard/setupActions";
import { controlsOn } from "@/dashboard/session";

// First-run setup (card 151, docs/setup.md): a new business lands here instead of the Desk. Step 1 is
// the conversation with Avery; steps 2 to 4 are cards 152 to 154 (until then, Connections and the
// department picker).
export const maxDuration = 120;

export default async function Setup() {
  const me = await requireSession();
  if (!(await inSetup())) redirect("/");
  const [floor, facts, state, history, biz] = await Promise.all([getFloor(), listFacts(), setupState(), chatHistory(30).catch(() => null), loadBusiness().catch(() => UNKNOWN_BUSINESS)]);
  const owner = atLeast(me.role, "owner");
  const keyed = !!floor.health?.claude;
  const templates = departmentTemplates();
  const leaning = state.leaning.map((l) => ({ ...l, name: templates.find((t) => t.id === l.id)?.name ?? l.id }));
  const blocked = controlsOn() ? null : "Controls are off, so Avery can’t answer yet: each message is a real model call. Set DASHBOARD_CONTROLS=on.";
  const steps = ["Your business", "Tools", "Your company", "First job"];

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

          <section id="step-2" className="card stack" style={{ gap: 10 }} aria-labelledby="tools-h">
            <span id="tools" />
            <h2 id="tools-h" className="card-t">2. Connect your tools</h2>
            <span className="sub">Connect the tools you already use, so Avery can see the business for herself. Every connection asks only for what its agents read.</span>
            <div><Link href="/connections" className="btn outline sm">Open Connections</Link></div>
          </section>

          <section id="step-3" className="card stack" style={{ gap: 12 }} aria-labelledby="company-h">
            <h2 id="company-h" className="card-t">3. Your company</h2>
            <span className="sub">Pick the departments to start from: each brings its seats on the org chart, agents, routines and a goal, every agent off duty until you approve its playbook. Avery stays in the company seat above them.</span>
            {owner ? (
              <>
                <TemplatePicker templates={templates} install={setupInstall} initial={leaning.length ? leaning.map((l) => l.id) : undefined} />
                <div className="row wrap rule" style={{ gap: 12, justifyContent: "space-between", paddingTop: 12 }}>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}><b style={{ fontSize: 14 }}>Start empty</b><span className="sub">Keep Avery alone, add departments on Crew &gt; Org chart and build each agent yourself.</span></span>
                  <ActionButton className="btn outline sm" action={setupStartEmpty} follow>Start empty</ActionButton>
                </div>
              </>
            ) : <span className="sub">An owner of this business picks the departments.</span>}
          </section>

          <section id="step-4" className="card stack" style={{ gap: 8 }} aria-labelledby="job-h">
            <h2 id="job-h" className="card-t">4. First job</h2>
            <span className="sub">Once your company is in place, the Desk shows what each department can do first. Nothing runs until you approve it.</span>
          </section>
        </main>
      </div>
    </div>
  );
}
