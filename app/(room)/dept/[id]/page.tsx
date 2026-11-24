import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteChain, discardChainDraft, goLive, previewChain, realRun, runChainNow, saveChain, setEnabled, tryBuilt } from "@/dashboard/actions";
import { changeInChat, hireInChat, proposalDecline } from "@/dashboard/proposalActions";
import { deptHires } from "@/dashboard/hireCards";
import { deptChanges } from "@/dashboard/changeCards";
import { getApprovals, getChainOks, getChains, getCounts, getOrgSwitch, getRoster, getTz, requireSession, rulesFor, type ApprovalItem, type ApprovalsView } from "@/dashboard/data";
import { ChainsBoard } from "@/dashboard/components/chains";
import { DEPT_TABS, TAB_LABEL, deptAgentIds, deptHue, deptTab, goalHref, headAgentId, hireHref, madeAgentHref, needsByDept, newAgentHref, settingsHref, sheetHref, tabHref, type DeptTab } from "@/dashboard/dept-rules";
import { deptRuns } from "@/dashboard/deptFeed";
import { HEAD_CHAT_MISSING, headHistory } from "@/core/head-chat";
import { sendToHead } from "@/dashboard/chatActions";
import { HeadChat } from "@/dashboard/components/headChat";
import { DeptTabs } from "@/dashboard/components/deptTabs";
import { goalsByDept, type GoalView } from "@/dashboard/goals";
import { GOALS_MISSING } from "@/core/goals";
import { headOf, below, deptSpent, latestOutputs, monthSpendByAgent } from "@/core/org";
import { usd } from "@/core/cost-rules";
import { firstSentence } from "@/dashboard/desk";
import { nextRuns, schedWords } from "@/dashboard/schedule";
import { stateLook, stateOf } from "@/dashboard/status";
import { when } from "@/dashboard/format";
import { controlsOn } from "@/dashboard/session";
import { MODEL_LIST } from "@/integrations/models";
import { ActionButton } from "@/dashboard/components/client";
import { ApprovalCard, ChainOkCard } from "@/dashboard/components/approvalBits";
import { okChainHref } from "@/core/chain-ok-rules";
import { AgentSheetFor } from "@/dashboard/components/agentSheetFor";
import { readFill } from "@/dashboard/handoff-rules";
import { DeptSettingsFor } from "@/dashboard/components/deptSettingsFor";
import { GoalTiles } from "@/dashboard/components/goalTiles";
import { approvalsHistoryHref } from "@/dashboard/company-rules";

// Try it on the Chains tab dry-runs up to eight agents in a row.
export const maxDuration = 300;

const GEAR = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>;

// A department's page (docs/department-pages.md), built to the approved mockup: a short header, glass tabs
// floating over the content (Chat, the default; Agents; Goals; Approvals), and the chat as a glass room where
// the head answers and every run of the department posts its checklist, result and drafts. Every count and
// number on it is worked out in code.

const NO_ORG = "The org chart tables aren’t up to date: apply the org chart migrations.";
const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const PLUS = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;

export default async function DeptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; agent?: string; say?: string; edit?: string; settings?: string; at?: string; days?: string; chain?: string; new?: string }> }) {
  // the pieces this page shows, in one round (card 304): the crew and its runs, what waits on you, the time zone, the org switch
  const [{ id }, sp, roster, counts, tz, org, me] = await Promise.all([params, searchParams, getRoster(), getCounts(), getTz(), getOrgSwitch(), requireSession()]);
  const chart = roster.chart;
  if (!chart) return <div className="card"><span className="sub">{NO_ORG}</span></div>;
  const index = chart.departments.findIndex((d) => d.id === id);
  if (index < 0) notFound();
  const dept = chart.departments[index];
  const tab = deptTab(sp.tab);
  const waiting = needsByDept(chart.departments.map((d) => d.id), counts.approvalOwners.map((o) => o.dept)).byDept[id] ?? 0;
  const headId = headAgentId(chart, id), head = headId ? roster.byId[headId] : null, headSeat = headOf(chart, id);
  const ids = deptAgentIds(chart, id).filter((a) => roster.byId[a]);
  const spend = await monthSpendByAgent(ids).catch(() => ({} as Record<string, number>));
  const spent = deptSpent(chart, id, spend);
  const goals = tab === "goals" ? await goalsByDept(chart) : undefined;
  const goalCount = goals ? (goals[id] ?? []).length : undefined;
  const title = headSeat?.title ?? "head";
  const led = head ? `Led by ${head.name}, your ${title}` : headSeat?.holder === "owner" ? `You lead ${dept.name}` : "No head yet";
  const needs = `${waiting} need${waiting === 1 ? "s" : ""} you`;

  return (
    <div className={`dp${tab === "chat" ? " chat" : ""}`} style={{ "--hue": deptHue(index) } as React.CSSProperties}>
      <Link href={settingsHref(id, tab)} scroll={false} className="dp-ttl" aria-label={`${dept.name} settings`}><b>{dept.name}</b><span className={waiting ? "warn" : undefined}>{head ? `${head.name}, ${title}` : led}{waiting ? ` · ${needs}` : ""}</span></Link>
      <div className="dp-head">
        <div className="dp-icon"><i /></div>
        <div><h1>{dept.name}</h1><div className="dp-led">{led} · {s(ids.length, "agent")}</div></div>
        <div className="dp-stat">
          <span className="dp-pill">AI spend {usd(spent)}{dept.monthlyBudgetUsd != null ? ` of ${usd(dept.monthlyBudgetUsd)}` : ""} this month</span>
          {waiting > 0 && <Link href={tabHref(id, "approvals")} className="dp-pill warn">{needs}</Link>}
          <Link href={settingsHref(id, tab)} scroll={false} className="dp-gear" aria-label={`${dept.name} settings`} title="Department settings">{GEAR}</Link>
        </div>
      </div>
      <div className="dp-stage">
        <DeptTabs label={`${dept.name} tabs`} open={tab} tabs={DEPT_TABS.map((t) => ({
          key: t, label: TAB_LABEL[t], href: tabHref(id, t),
          count: t === "agents" ? ids.length : t === "goals" ? goalCount : t === "approvals" ? waiting : undefined, red: t === "approvals",
        }))} />
        <div className="dp-pane" key={tab}>
          <Pane tab={tab} id={id} name={dept.name} title={title} roster={roster} counts={counts} tz={tz} orgOn={org.on} owner={me.role === "owner"} goals={goals} say={typeof sp.say === "string" ? sp.say.slice(0, 300) : ""} chain={typeof sp.chain === "string" ? sp.chain.slice(0, 40) : undefined} startWith={typeof sp.new === "string" ? sp.new.slice(0, 80) : undefined} />
        </div>
      </div>
      {sp.settings != null && !sp.agent && <DeptSettingsFor chart={chart} id={id} closeHref={tabHref(id, tab)} names={Object.fromEntries(Object.values(roster.byId).map((a) => [a.id, a.name]))} />}
      {sp.agent && <AgentSheetFor id={sp.agent} closeHref={tabHref(id, tab)} tz={tz} now={roster.now} edit={sp.edit != null} fill={readFill(sp.at, sp.days)} dept={id} openHref={madeAgentHref(id)} />}
    </div>
  );
}

type Roster = Awaited<ReturnType<typeof getRoster>>;
type Counts = Awaited<ReturnType<typeof getCounts>>;
type P = { id: string; name: string; title: string; roster: Roster; counts: Counts; tz: string; orgOn: boolean; owner?: boolean; goals?: Record<string, GoalView[]> | null; say?: string; chain?: string; startWith?: string };

async function Pane({ tab, ...p }: P & { tab: DeptTab }) {
  if (tab === "goals") return <Goals {...p} />;
  if (tab === "approvals") return <Approvals {...p} />;
  if (tab === "chat") return <Chat {...p} />;
  if (tab === "chains") return <Chains {...p} />;
  return <Agents {...p} />;
}

/** The chat: the conversation with the head and every run of the department, with its drafts as approval cards. */
async function Chat({ id, name, title, roster, tz, say }: P) {
  const chart = roster.chart!;
  const headId = headAgentId(chart, id), head = headId ? roster.byId[headId] : null;
  const ids = deptAgentIds(chart, id).filter((a) => roster.byId[a]);
  const [hires, changes] = await Promise.all([
    deptHires(id, roster).catch(() => ({ cards: [], fresh: new Set<string>() })),
    deptChanges(id, roster).catch(() => ({ cards: [], trying: new Set<string>() })),
  ]);
  // tries post in the chat for a new agent's card and for a draft a change card saved
  const posts = new Set([...hires.fresh, ...changes.trying]);
  const [history, runs, view] = await Promise.all([head ? headHistory(id, 40).catch(() => null) : Promise.resolve([]), deptRuns(ids, roster.byId, undefined, 25, posts), getApprovals().catch(() => null)]);
  const open = new Set(runs.flatMap((r) => r.drafts));
  const items = view ? [...view.pending, ...view.withLead].filter((i) => open.has(i.id)) : [];
  const rules = await rulesFor(items);
  const cards = Object.fromEntries(items.map((i) => [i.id, <ApprovalCard key={i.id} i={i} view={view} byId={roster.byId} tz={tz} rules={rules} look="chat" />]));
  const talk = (history ?? []).map((r) => ({ id: r.id, role: r.role, text: r.text, notes: r.notes, runId: r.run_id, at: r.created_at }));
  const seat = headOf(chart, id);
  return (
    <HeadChat deptId={id} dept={name} head={head?.name ?? null} title={title} tz={tz} talk={talk} runs={runs} cards={cards} send={sendToHead.bind(null, id)}
      missing={head ? (history ? null : HEAD_CHAT_MISSING) : seat?.holder === "owner" ? `You lead ${name}, so there’s no head agent to talk to here. Ask Avery about this department instead.` : `${name} has no head yet. Fill its head seat on the Agents tab to talk to one.`}
      starters={[`How is ${name} doing?`, "What needs me here?", "Who is behind?"]}
      hires={hires.cards} hireActs={{ hire: hireInChat, tryIt: tryBuilt, goLive, duty: setEnabled }}
      changes={changes.cards} changeActs={{ approve: changeInChat, decline: proposalDecline, goLive }} controls={controlsOn()} say={say} />
  );
}

/** Who works here, as rows: state, the model it runs on, its last run and result, what needs you, its next run, Run now. */
function Agents({ id, name, roster, counts, tz, orgOn, owner }: P) {
  const chart = roster.chart!;
  const ids = deptAgentIds(chart, id).filter((a) => roster.byId[a]);
  const head = headOf(chart, id);
  const open = head ? [head, ...below(chart, head.id)].filter((x) => x.holder === "open") : [];
  const headName = (head?.agentId && roster.byId[head.agentId]?.name) || "the head";
  const controls = controlsOn();
  return (
    <div className="dp-scroll">
      <div className="dp-panel">
        <div className="dp-panel-h"><h3>{name} agents</h3><span className="sp" /><span className="dp-note">Tap an agent to see its runs or edit it.</span>{owner && <Link href={newAgentHref(id)} scroll={false} className="dp-btn dark sm">+ New agent</Link>}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {ids.map((aid) => {
            const a = roster.byId[aid];
            const st = stateOf(a, roster.agents[aid], roster.runs, roster.spentToday[aid] ?? 0);
            const last = roster.runs.find((r) => r.agent_id === aid && r.status !== "skipped");
            const model = MODEL_LIST.find((m) => m.id === (a.model ?? roster.agents[aid]?.model))?.label ?? null;
            const need = counts.approvalOwners.filter((o) => o.agent === aid).length;
            const next = nextRuns(a.schedule, roster.now, 1, tz)[0];
            const dot = st === "running" ? "live" : st === "over" ? "bad" : st === "active" || st === "manual" ? "" : "off";
            return (
              <div key={aid} className="dp-agent">
                <span className={`dp-dot ${dot}`} title={stateLook(st, orgOn).label} />
                <Link href={sheetHref(id, "agents", aid)} scroll={false} className="dp-hit" aria-label={`Open ${a.name}`} /><div className="dp-nm"><b>{a.name}</b><span>{a.role}{head?.agentId === aid ? ` · head of ${name}` : ""}</span>{model && <><br /><span className="dp-where">Runs on {model}</span></>}</div>
                <div className="dp-last"><small>{last ? when(last.started_at, tz) : "Never run"}</small>{last ? firstSentence(last.summary ?? (last.status === "failed" ? last.error ?? "The run failed." : "Working now."), 200) : a.job}</div>
                <div className="dp-act">
                  {need > 0 && <Link href={tabHref(id, "approvals")} className="dp-need">{need} need{need === 1 ? "s" : ""} you</Link>}
                  <span className="dp-note">{next ? `Next: ${when(next, tz)}` : schedWords(a.schedule) === "Manual only" ? "By hand" : schedWords(a.schedule)}</span>
                  <ActionButton className="dp-btn" action={realRun.bind(null, aid)} disabled={!controls} title={!controls ? "Real runs are off on this OPERATOR" : undefined}>Run now</ActionButton>
                </div>
              </div>
            );
          })}
        </div>
        {open.map((x) => (
          <Link key={x.id} href={hireHref(id, x)} className="dp-newline">{PLUS}<span><b>{x.title} is open.</b> Ask {headName} to hire for it{x.sub ? `: ${x.sub}` : ""}.</span></Link>
        ))}
        {!ids.length && !open.length && <span className="dp-note">No agents in {name} yet. Ask {headName} in the chat to hire one{owner ? ", or press New agent to build one yourself" : ""}.</span>}
      </div>
    </div>
  );
}

/** The department's chains and its agents' chains (chains slice 1), as a list and the open chain's lane. */
async function Chains({ id, name, roster, tz, owner, chain, startWith }: P) {
  const d = await getChains(roster, tz);
  return (
    <div className="dp-scroll">
      <ChainsBoard d={d} scope={{ dept: id }} place={name} pick={chain} startWith={startWith} newAgentHref={owner ? newAgentHref(id) : undefined}
        actions={{ save: saveChain, remove: deleteChain, runNow: runChainNow, preview: previewChain, discardDraft: discardChainDraft }} />
    </div>
  );
}

/** The numbers the department is held to, measured in code, each with its head's latest line. */
async function Goals({ id, name, roster, goals }: P) {
  if (goals == null) return <div className="dp-scroll"><div className="dp-panel"><span className="dp-note">{GOALS_MISSING}</span></div></div>;
  const mine = goals[id] ?? [];
  const head = headOf(roster.chart!, id);
  const headId = head?.holder === "agent" ? head.agentId : null;
  const outs = headId ? await latestOutputs([headId]).catch(() => ({} as Awaited<ReturnType<typeof latestOutputs>>)) : {};
  const word = headId && outs[headId] ? { who: roster.byId[headId]?.name ?? headId, text: firstSentence(outs[headId].summary) } : null;
  const who = (headId && roster.byId[headId]?.name) || "the head";
  return (
    <div className="dp-scroll">
      {mine.length > 0 && <GoalTiles deptId={id} goals={mine} word={word} />}
      <Link href={goalHref(id)} className="dp-newline">{PLUS}<span><b>{mine.length ? `Set or change a goal by telling ${who}.` : `${name} has no goals yet. Set one by telling ${who}.`}</b> A new or changed goal comes back as a card for your OK, because goals steer what the agents do.</span></Link>
    </div>
  );
}

/** Every draft from this department waiting on an approver: the same card and the same tap as the chat and the Approvals page. */
async function Approvals({ id, name, roster, tz }: P) {
  const view: ApprovalsView | null = await getApprovals();
  if (!view) return <div className="dp-scroll"><div className="dp-panel"><span className="dp-note">The approvals tables aren’t there yet. Apply the gateway migration to your Supabase project.</span></div></div>;
  const mine = (i: ApprovalItem) => i.department_id === id;
  const pending = view.pending.filter(mine), withLead = view.withLead.filter(mine);
  const [rules, allOks] = await Promise.all([rulesFor([...pending, ...withLead]), getChainOks()]);
  const oks = (allOks ?? []).filter((c) => c.dept === id);
  const card = (i: ApprovalItem) => <ApprovalCard key={i.id} i={i} view={view} byId={roster.byId} tz={tz} rules={rules} look="tab" chatHref={tabHref(id, "chat")} />;
  return (
    <div className="dp-scroll">
      <div className="dp-panel">
        <div className="dp-panel-h"><h3>Waiting for your OK</h3><span className="sp" /><span className="dp-note">Everything {name}’s agents drafted, in one place. Approving here or in the chat is the same tap. <Link href={approvalsHistoryHref()} style={{ color: "var(--ink2)", textDecoration: "underline" }}>History and trust levels</Link></span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {!pending.length && !withLead.length && !oks.length && <div className="dp-note" style={{ padding: "28px 16px", textAlign: "center", fontSize: 14 }}>Nothing from {name} is waiting for your OK.</div>}
          {oks.map((c) => <ChainOkCard key={c.id} c={c} tz={tz} chainHref={okChainHref(c)} />)}
          {pending.map(card)}
          {withLead.length > 0 && <span className="dp-note">With the lead first ({withLead.length}): the lead adds a note or sends a draft back once; only your tap approves.</span>}
          {withLead.map(card)}
        </div>
      </div>
    </div>
  );
}
