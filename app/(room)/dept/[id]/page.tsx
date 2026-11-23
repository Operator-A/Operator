import Link from "next/link";
import { notFound } from "next/navigation";
import { realRun } from "@/dashboard/actions";
import { getApprovals, getCounts, getOrgSwitch, getReactRules, getRoster, getTz, type ApprovalItem, type ApprovalsView, type ReactRules } from "@/dashboard/data";
import { DEPT_TABS, TAB_LABEL, deptAgentIds, deptHue, deptTab, headAgentId, needsByDept, sheetHref, tabHref, type DeptTab } from "@/dashboard/dept-rules";
import { goalNumber } from "@/dashboard/dept-feed";
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
import { ApprovalCard } from "@/dashboard/components/approvalBits";
import { AgentSheetFor } from "@/dashboard/components/agentSheetFor";

// A department's page (docs/department-pages.md), built to the approved mockup: a short header, glass tabs
// floating over the content (Chat, the default; Agents; Goals; Approvals), and the chat as a glass room where
// the head answers and every run of the department posts its checklist, result and drafts. Every count and
// number on it is worked out in code.

const NO_ORG = "The org chart tables aren’t up to date: apply the org chart migrations.";
const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const PLUS = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;

export default async function DeptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; agent?: string }> }) {
  // the pieces this page shows, in one round (card 304): the crew and its runs, what waits on you, the time zone, the org switch
  const [{ id }, sp, roster, counts, tz, org] = await Promise.all([params, searchParams, getRoster(), getCounts(), getTz(), getOrgSwitch()]);
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
      <div className="dp-ttl" aria-hidden="true"><b>{dept.name}</b><span className={waiting ? "warn" : undefined}>{head ? `${head.name}, ${title}` : led}{waiting ? ` · ${needs}` : ""}</span></div>
      <div className="dp-head">
        <div className="dp-icon"><i /></div>
        <div><h1>{dept.name}</h1><div className="dp-led">{led} · {s(ids.length, "agent")}</div></div>
        <div className="dp-stat">
          <span className="dp-pill">AI spend {usd(spent)}{dept.monthlyBudgetUsd != null ? ` of ${usd(dept.monthlyBudgetUsd)}` : ""} this month</span>
          {waiting > 0 && <Link href={tabHref(id, "approvals")} className="dp-pill warn">{needs}</Link>}
        </div>
      </div>
      <div className="dp-stage">
        <DeptTabs label={`${dept.name} tabs`} open={tab} tabs={DEPT_TABS.map((t) => ({
          key: t, label: TAB_LABEL[t], href: tabHref(id, t),
          count: t === "agents" ? ids.length : t === "goals" ? goalCount : t === "approvals" ? waiting : undefined, red: t === "approvals",
        }))} />
        <div className="dp-pane" key={tab}>
          <Pane tab={tab} id={id} name={dept.name} title={title} roster={roster} counts={counts} tz={tz} orgOn={org.on} goals={goals} />
        </div>
      </div>
      {sp.agent && <AgentSheetFor id={sp.agent} closeHref={tabHref(id, tab)} tz={tz} now={roster.now} />}
    </div>
  );
}

type Roster = Awaited<ReturnType<typeof getRoster>>;
type Counts = Awaited<ReturnType<typeof getCounts>>;
type P = { id: string; name: string; title: string; roster: Roster; counts: Counts; tz: string; orgOn: boolean; goals?: Record<string, GoalView[]> | null };

async function Pane({ tab, ...p }: P & { tab: DeptTab }) {
  if (tab === "goals") return <Goals {...p} />;
  if (tab === "approvals") return <Approvals {...p} />;
  if (tab === "chat") return <Chat {...p} />;
  return <Agents {...p} />;
}

/** The rules each card's Not this offers, read once per agent on the cards. */
async function rulesFor(items: ApprovalItem[]): Promise<Record<string, ReactRules>> {
  const agents = [...new Set(items.map((i) => i.agent_id))];
  return Object.fromEntries(await Promise.all(agents.map(async (a) => [a, await getReactRules(a)] as const)));
}

/** The chat: the conversation with the head and every run of the department, with its drafts as approval cards. */
async function Chat({ id, name, title, roster, tz }: P) {
  const chart = roster.chart!;
  const headId = headAgentId(chart, id), head = headId ? roster.byId[headId] : null;
  const ids = deptAgentIds(chart, id).filter((a) => roster.byId[a]);
  const [history, runs, view] = await Promise.all([head ? headHistory(id, 40).catch(() => null) : Promise.resolve([]), deptRuns(ids, roster.byId), getApprovals().catch(() => null)]);
  const open = new Set(runs.flatMap((r) => r.drafts));
  const items = view ? [...view.pending, ...view.withLead].filter((i) => open.has(i.id)) : [];
  const rules = await rulesFor(items);
  const cards = Object.fromEntries(items.map((i) => [i.id, <ApprovalCard key={i.id} i={i} view={view} byId={roster.byId} tz={tz} rules={rules} look="chat" />]));
  const talk = (history ?? []).map((r) => ({ id: r.id, role: r.role, text: r.text, notes: r.notes, runId: r.run_id, at: r.created_at }));
  const seat = headOf(chart, id);
  return (
    <HeadChat deptId={id} dept={name} head={head?.name ?? null} title={title} tz={tz} talk={talk} runs={runs} cards={cards} send={sendToHead}
      missing={head ? (history ? null : HEAD_CHAT_MISSING) : seat?.holder === "owner" ? `You lead ${name}, so there’s no head agent to talk to here. Ask Avery about this department instead.` : `${name} has no head yet. Fill its head seat on the Agents tab to talk to one.`}
      starters={[`How is ${name} doing?`, "What needs me here?", "Who is behind?"]} />
  );
}

/** Who works here, as rows: state, the model it runs on, its last run and result, what needs you, its next run, Run now. */
function Agents({ id, name, roster, counts, tz, orgOn }: P) {
  const chart = roster.chart!;
  const ids = deptAgentIds(chart, id).filter((a) => roster.byId[a]);
  const head = headOf(chart, id);
  const open = head ? [head, ...below(chart, head.id)].filter((x) => x.holder === "open") : [];
  const headName = (head?.agentId && roster.byId[head.agentId]?.name) || "the head";
  const controls = controlsOn();
  return (
    <div className="dp-scroll">
      <div className="dp-panel">
        <div className="dp-panel-h"><h3>{name} agents</h3><span className="sp" /><span className="dp-note">Tap an agent to see its runs or edit it.</span></div>
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
          <Link key={x.id} href={`/build/new?seat=${x.id}`} className="dp-newline">{PLUS}<span><b>{x.title} is open.</b> Build an agent for it{x.sub ? `: ${x.sub}` : ""}.</span></Link>
        ))}
        {!ids.length && !open.length && <span className="dp-note">No agents in {name} yet. Ask {headName} in the chat to hire one.</span>}
      </div>
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
  return (
    <div className="dp-scroll">
      {mine.length > 0 && (
        <div className="dp-goals">
          {mine.map((g) => {
            const n = goalNumber(g.line);
            return (
              <Link key={g.id} href={`/goals/${g.id}`} className="dp-goal">
                <span className="k">Goal · {g.statusLabel}</span>
                <h4>{g.title}</h4>
                <div className="num">{n.big}{n.small && <> <small>{n.small}</small></>}</div>
                {g.pct != null && <div className="dp-bar" role="img" aria-label={`${Math.round(g.pct)}% of the target`}><i style={{ width: `${Math.max(2, g.pct)}%` }} /></div>}
                {word && <div className="by"><b>{word.who}:</b> {word.text}</div>}
                <span className="src">{g.how ? `Measured in code: ${g.how}` : g.measure ? `Measured in code from ${g.measure}.` : "No measure yet: tracked in words."}</span>
              </Link>
            );
          })}
        </div>
      )}
      <Link href={`/goals/new?dept=${id}`} className="dp-newline">{PLUS}<span><b>{mine.length ? "Set another goal." : `${name} has no goals yet.`}</b> A goal is a number measured in code, like margin or orders a week.</span></Link>
    </div>
  );
}

/** Every draft from this department waiting on an approver: the same card and the same tap as the chat and the Approvals page. */
async function Approvals({ id, name, roster, tz }: P) {
  const view: ApprovalsView | null = await getApprovals();
  if (!view) return <div className="dp-scroll"><div className="dp-panel"><span className="dp-note">The approvals tables aren’t there yet. Apply the gateway migration to your Supabase project.</span></div></div>;
  const mine = (i: ApprovalItem) => i.department_id === id;
  const pending = view.pending.filter(mine), withLead = view.withLead.filter(mine);
  const rules = await rulesFor([...pending, ...withLead]);
  const card = (i: ApprovalItem) => <ApprovalCard key={i.id} i={i} view={view} byId={roster.byId} tz={tz} rules={rules} look="tab" chatHref={tabHref(id, "chat")} />;
  return (
    <div className="dp-scroll">
      <div className="dp-panel">
        <div className="dp-panel-h"><h3>Waiting for your OK</h3><span className="sp" /><span className="dp-note">Everything {name}’s agents drafted, in one place. Approving here or in the chat is the same tap. <Link href={`/approvals?dept=${id}`} style={{ color: "var(--ink2)", textDecoration: "underline" }}>History and trust levels</Link></span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {!pending.length && !withLead.length && <div className="dp-note" style={{ padding: "28px 16px", textAlign: "center", fontSize: 14 }}>Nothing from {name} is waiting for your OK.</div>}
          {pending.map(card)}
          {withLead.length > 0 && <span className="dp-note">With the lead first ({withLead.length}): the lead adds a note or sends a draft back once; only your tap approves.</span>}
          {withLead.map(card)}
        </div>
      </div>
    </div>
  );
}
