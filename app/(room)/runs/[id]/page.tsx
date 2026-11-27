import { zoneLabel } from "@/core/time";
import { cookies } from "next/headers";
import { needs } from "@/dashboard/needs";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import Link from "next/link";
import { askedIn } from "@/core/avery-chat";
import { notFound } from "next/navigation";
import { costUsd, MODELS } from "@/integrations/anthropic";
import { MODEL_LIST } from "@/integrations/models";
import { dryRun, react } from "@/dashboard/actions";
import { getChainRuns, getFloor, getReactRules, getRun, getRunImage, getRunNumbers, getRunReactions, leadItemsOfRun } from "@/dashboard/data";
import { ReactBar } from "@/dashboard/components/react";
import { dur, m4, num, utcStr, when } from "@/dashboard/format";
import { inClaude, runLook } from "@/dashboard/status";
import { ClaudeLive } from "@/dashboard/components/claudeLive";
import { DryRun, MarkSeen } from "@/dashboard/components/client";
import { Icon } from "@/dashboard/components/Icon";
import { AgentMap } from "@/dashboard/components/AgentMap";
import { mapOf, mapRunOf } from "@/dashboard/agentMap";
import { builderMenu, customMenuFor, mapFor, mapSteps } from "@/dashboard/builder";
import { Avatar, Summary } from "@/dashboard/components/ui";
import { RunView } from "@/dashboard/components/runView";

export default async function Replay({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // the run and the floor together (card 302, docs/speed.md); getRun checks the login too
  const [run, f, jar] = await Promise.all([getRun(id), getFloor(), cookies()]);
  if (!run) notFound();
  const a = f.byId[run.agent_id];
  if (!a) notFound();
  const unseen = needs(f, f.now, parseSeen(jar.get(SEEN_COOKIE)?.value)).some((n) => n.run && n.agentId === a.id);
  const others = f.runs.filter((r) => r.agent_id === a.id && r.status !== "skipped" && r.id !== run.id).slice(0, 6);
  const has = (tool: string) => (f.grants[a.id] ?? []).includes(tool);
  const reactable = run.status === "ok" || run.status === "failed";
  const [items, mf, steps, said, rules, custom, chain, asked, picture, numbers] = await Promise.all([
    has("report_leads") ? leadItemsOfRun(run.id) : null, mapFor(a.id), mapSteps(run.id),
    reactable ? getRunReactions(run.id) : Promise.resolve({} as Awaited<ReturnType<typeof getRunReactions>>), reactable ? getReactRules(a.id) : null,
    customMenuFor(), run.trigger === "chain" ? getChainRuns(run.id, f.tz) : null, run.trigger === "chat" ? askedIn(run.id).catch(() => null) : null,
    // a Make an image step's picture (chains slice 4), through a short signed link
    run.trigger === "chain" ? getRunImage(run.id) : null,
    getRunNumbers(run.id).catch(() => []),
  ]);
  const fromSession = run.summary?.startsWith("[Claude, written by the session]") ?? false;
  const leads = items ? items.length : null;
  const map = mf && mapOf({ agentId: a.id, spec: mf.spec, menu: builderMenu(f.crew, f.health, custom), schedule: null, chain: null, usedBy: mf.usedBy, run: mapRunOf(run, steps, f.tz) });
  // a run in Claude shows as running until its session posts a result (2026-11-27)
  const live = inClaude(run, f.now);
  const look = runLook(run, f.now);

  // Where the money went, split in code with the same prices the agents bill with.
  // a version can pick another model, so use the priced model whose prices give this run's cost, the live version's first
  const usual = Object.values(MODELS).find((m) => f.agents[a.id]?.model?.startsWith(m));
  const fits = (m: string) => Math.abs(costUsd(m, run.tokens_in, run.tokens_out) - run.cost_usd) <= 0.0002;
  const model = usual && (fits(usual) || has("web_search")) ? usual : MODEL_LIST.find((m) => fits(m.id))?.id ?? usual;
  const inUsd = model ? costUsd(model, run.tokens_in, 0) : 0;
  const outUsd = model ? costUsd(model, 0, run.tokens_out) : 0;
  const rest = Math.max(0, Number((run.cost_usd - inUsd - outUsd).toFixed(4)));
  const money = [
    { label: "Input: prompt and pages read", amount: inUsd, sub: `${num(run.tokens_in)} tokens`, color: "var(--acc)" },
    { label: "Output", amount: outUsd, sub: `${num(run.tokens_out)} tokens`, color: "var(--mint)" },
    { label: has("web_search") ? "Web searches" : "Other", amount: rest, sub: has("web_search") ? `about ${Math.round(rest / 0.01)} at $0.01` : "", color: "var(--ink2)" },
  ];

  const title = run.status === "skipped" ? `Skipped · ${when(run.started_at, f.tz)}` : run.status === "failed" ? `Failed · ${when(run.started_at, f.tz)}` : `${run.trigger === "manual" ? "Manual" : run.trigger === "approval" ? "Approval" : run.trigger === "chain" ? "Chain" : run.trigger === "preview" ? "Try" : run.trigger === "chat" ? "Chat" : "Scheduled"} run · ${when(run.started_at, f.tz)}`;
  const stats = [
    ["Started", `${when(run.started_at, f.tz)} ${zoneLabel(f.tz, run.started_at)}`, utcStr(run.started_at)],
    ["Duration", live ? "Still running in Claude" : run.claude_fired_at && run.claude_finished_at ? dur(run.claude_fired_at, run.claude_finished_at) : dur(run.started_at, run.ended_at), run.claude_fired_at ? "From the routine starting to the session’s result" : ""],
    ["Cost", m4(run.cost_usd), ""],
    ["Tokens", `${num(run.tokens_in)} in · ${num(run.tokens_out)} out`, ""],
    ["Trigger", run.trigger === "cron" ? "Vercel Schedule" : run.trigger === "manual" ? "Someone pressed Run" : run.trigger === "approval" ? "An approver approved changes (gateway)" : run.trigger === "chain" ? `Chain${chain ? `: ${chain.name}` : ""}` : run.trigger === "preview" ? "A try from the builder: nothing sent or saved" : run.trigger === "chat" ? `The owner’s message in the chat${asked ? `: “${asked.slice(0, 200)}”` : ""}` : run.trigger, ""],
  ];

  return (
    <>
      {unseen && <MarkSeen agentId={a.id} at={f.now} />}
      <div className="card dark" style={{ borderRadius: 24, padding: 24, gap: 20 }}>
        <div className="row wrap" style={{ gap: 14 }}>
          <Avatar a={a} size={48} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 240 }}>
            <span style={{ fontSize: 12.5, color: "#9A9AA3" }}>Run replay · {a.name}, {a.role}</span>
            <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.02em" }}>{title}</span>
          </div>
          <span className="pill" style={{ background: "#24242A" }}><span className={`dot${look.pulse ? " pulse" : ""}`} style={{ background: look.dot }} />{look.label}</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 16 }}>
          {stats.map(([k, v, t]) => <div key={k} title={t || undefined} style={{ display: "flex", flexDirection: "column", gap: 4 }}><span style={{ fontSize: 12, color: "#8A8A93" }}>{k}</span><span style={{ fontSize: 16, fontWeight: 600 }}>{v}</span></div>)}
        </div>
        <div className="row" style={{ gap: 14 }}>
          <span title="Needs run transcripts" style={{ width: 44, height: 44, borderRadius: 999, background: "#2A2A30", display: "grid", placeItems: "center", flex: "none", opacity: 0.6 }}><Icon name="play" size={17} style={{ color: "#F4F4F6" }} /></span>
          <div style={{ position: "relative", flex: 1, height: 40 }}>
            <div style={{ position: "absolute", left: 0, right: 0, top: 17, height: 6, borderRadius: 999, background: "#2A2A30" }} />
            <div style={{ position: "absolute", left: 0, top: 17, height: 6, width: "100%", borderRadius: 999, background: "linear-gradient(90deg,#F5D35C,#F2884B)", opacity: run.status === "skipped" ? 0.2 : 1 }} />
          </div>
          <span style={{ fontSize: 12.5, color: "#B9B9C2", whiteSpace: "nowrap" }}>Steps need transcripts</span>
        </div>
      </div>

      {reactable && rules && (
        <div id="react" className="card" style={{ gap: 14, scrollMarginTop: 80 }}>
          <div className="card-h"><span className="card-t">Was this right?</span><span className="muted" style={{ fontSize: 12 }}>Your words become a rule for {a.name} straight away</span></div>
          <ReactBar name={a.name} rules={rules} current={said[""] ?? null} save={react.bind(null, a.id, run.id, null)} />
          {items && items.length > 0 && (
            <div className="stack" style={{ gap: 0 }}>
              <span className="muted" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em", paddingBottom: 4 }}>EACH LEAD IT FOUND</span>
              {items.map((l) => (
                <div key={l.id} className="rule" style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "12px 0", alignItems: "flex-start" }}>
                  <div style={{ flex: "1 1 260px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{l.business}</span>
                    <span className="muted" style={{ fontSize: 12.5, lineHeight: 1.4 }}>{[l.city, l.fit].filter(Boolean).join(" · ")}</span>
                  </div>
                  <div style={{ flex: "1 1 280px" }}><ReactBar compact name={a.name} rules={rules} current={said[l.id] ?? null} save={react.bind(null, a.id, run.id, l.id)} /></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {chain && <RunView name={chain.name} timeline={chain.timeline} images={chain.images} current={run.id} tz={f.tz} hue={(id) => f.byId[id]?.hue ?? null} />}

      {others.length > 0 && (
        <div className="row wrap" style={{ gap: 6 }}>
          <span className="sub" style={{ marginRight: 4 }}>Other runs</span>
          {others.map((o) => <Link key={o.id} href={`/runs/${o.id}`} className="btn ghost xs" style={{ height: 32, fontSize: 12.5 }}>{when(o.started_at, f.tz)}{o.status === "failed" ? " · failed" : ""}</Link>)}
        </div>
      )}

      {run.status !== "skipped" && model && (
        <div className="card" style={{ gap: 12 }}>
          <div className="card-h"><span className="card-t">Where the money went</span><span className="muted" style={{ fontSize: 12 }}>Computed in code</span><span style={{ fontSize: 15, fontWeight: 600 }}>{m4(run.cost_usd)}</span></div>
          <div className="bar" style={{ height: 14, borderRadius: 999 }}>{money.filter((m) => m.amount > 0).map((m) => <span key={m.label} style={{ flex: m.amount, background: m.color }} />)}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
            {money.map((m) => <div key={m.label} className="row" style={{ alignItems: "flex-start", gap: 8 }}><span className="dot" style={{ width: 8, height: 8, marginTop: 5, background: m.color }} /><div style={{ display: "flex", flexDirection: "column", gap: 1 }}><span style={{ fontSize: 12.5 }} className="ink2">{m.label}</span><span style={{ fontSize: 14, fontWeight: 600 }}>{m4(m.amount)}</span><span className="muted" style={{ fontSize: 11.5 }}>{m.sub}</span></div></div>)}
          </div>
        </div>
      )}

      {run.status !== "skipped" && map && (
        <div className="card" style={{ padding: 16, gap: 10 }}>
          <span className="card-t" style={{ padding: "0 4px" }}>How this run went{steps.length ? "" : " · runs from before the engine log no steps, so only the brain shows the result"}</span>
          <AgentMap m={map} />
        </div>
      )}

      <div className="grid2">
        <div className="card" style={{ gap: 12 }}>
          <span className="card-t">Summary</span>
          {live && run.claude_fired_at
            ? <ClaudeLive runId={run.id} firedAt={run.claude_fired_at} url={run.claude_url ?? null} />
            : <span style={{ fontSize: 14, lineHeight: 1.5, overflowWrap: "anywhere" }}><Summary text={run.summary ?? (run.status === "running" ? "Working now…" : "No summary.")} /></span>}
          {/* eslint-disable-next-line @next/next/no-img-element -- a short signed link to a private picture, not a static asset */}
          {picture && <a href={picture} target="_blank" rel="noreferrer"><img src={picture} alt="The picture this step made" style={{ width: "100%", maxWidth: 520, borderRadius: 14, border: "1px solid var(--bd)" }} /></a>}
          {run.error && <div style={{ padding: "12px 14px", borderRadius: 14, background: "var(--red-soft)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12.5, color: "var(--red-ink)", overflowWrap: "anywhere" }}>{run.error}</div>}
          {numbers.length > 0 && (
            <div className="stack" style={{ gap: 6 }}>
              <span className="muted" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: ".05em" }}>{fromSession ? "NUMBERS THE CLAUDE SESSION GAVE" : "NUMBERS WORKED OUT IN CODE"}</span>
              <div className="row wrap" style={{ gap: 6 }}>{numbers.map((n) => <span key={n.name} className="pill sm" style={{ background: "var(--soft)", fontWeight: 500 }}>{n.name} <b>{n.value.toLocaleString("en-US")}</b></span>)}</div>
            </div>
          )}
          {leads != null && <div className="row wrap" style={{ gap: 6 }}><span className="pill sm" style={{ background: "var(--soft)", fontWeight: 500 }}>{leads} leads on the leads list</span></div>}
          <div className="row wrap"><DryRun action={dryRun.bind(null, a.id)} /></div>
        </div>
        <div className="card dashed" style={{ padding: "40px 28px", alignItems: "center", textAlign: "center", gap: 8 }}>
          <span style={{ width: 40, height: 40, borderRadius: 999, background: "var(--soft)", display: "grid", placeItems: "center" }}><Icon name="history" /></span>
          <span style={{ fontSize: 15, fontWeight: 600 }}>Steps need run transcripts</span>
          <span style={{ fontSize: 13, maxWidth: 340 }} className="ink2">Coming later. Each tool call and gateway decision will appear here for every run, with a scrubber to play it back.</span>
        </div>
      </div>
    </>
  );
}
