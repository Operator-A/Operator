import Link from "next/link";
import { notFound } from "next/navigation";
import { realRun } from "@/dashboard/actions";
import { getApprovals, getCounts, getOrgSwitch, getReactRules, getRoster, getTz, type ApprovalItem, type ReactRules } from "@/dashboard/data";
import { DEPT_TABS, TAB_LABEL, deptAgentIds, deptTab, headAgentId, needsByDept, tabHref, type DeptTab } from "@/dashboard/dept-rules";
import { HEAD_CHAT_MISSING, headHistory } from "@/core/head-chat";
import { sendToHead } from "@/dashboard/chatActions";
import { HeadChat } from "@/dashboard/components/headChat";
import { goalsByDept } from "@/dashboard/goals";
import { GOALS_MISSING } from "@/core/goals";
import { headOf, below } from "@/core/org";
import { nextRuns, schedWords } from "@/dashboard/schedule";
import { stateLook, stateOf } from "@/dashboard/status";
import { when } from "@/dashboard/format";
import { controlsOn } from "@/dashboard/session";
import { MODEL_LIST } from "@/integrations/models";
import { ActionButton } from "@/dashboard/components/client";
import { IntentLink } from "@/dashboard/components/intentLink";
import { ApprovalCard } from "@/dashboard/components/approvalBits";
import { GoalTile } from "@/dashboard/components/goals";
import { Avatar, Empty, Pill } from "@/dashboard/components/ui";
import { Icon } from "@/dashboard/components/Icon";

// A department's page (docs/department-pages.md): its head, then tabs for the chat with the head (the
// default), the agents who work here, the goals it is held to, and every draft from it waiting on an approver.
// Every count and number on it is worked out in code.

const NO_ORG = "The org chart tables aren’t up to date: apply the org chart migrations.";
const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default async function DeptPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  // the pieces this page shows, in one round (card 304): the crew and its runs, what waits on you, the time zone, the org switch
  const [{ id }, sp, roster, counts, tz, org] = await Promise.all([params, searchParams, getRoster(), getCounts(), getTz(), getOrgSwitch()]);
  const chart = roster.chart;
  if (!chart) return <div className="card"><span className="sub">{NO_ORG}</span></div>;
  const dept = chart.departments.find((d) => d.id === id);
  if (!dept) notFound();
  const tab = deptTab(sp.tab);
  const waiting = needsByDept(chart.departments.map((d) => d.id), counts.approvalOwners.map((o) => o.dept)).byDept[id] ?? 0;
  const headId = headAgentId(chart, id), head = headId ? roster.byId[headId] : null, headSeat = headOf(chart, id);

  return (
    <>
      <div className="dept-head">
        {head ? <Avatar a={head} size={40} /> : <span className="dept-av"><Icon name="users" size={18} /></span>}
        <div className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
          <h1 className="h1" style={{ fontSize: 26 }}>{dept.name}</h1>
          <span className="sub">{head ? `${head.name}, ${headSeat?.title ?? "head"}` : headSeat?.holder === "owner" ? `You lead ${dept.name}` : "No head yet"}</span>
        </div>
        {waiting > 0 && <Link href={`/dept/${id}?tab=approvals`} className="pill" style={{ background: "var(--red-soft)", color: "var(--red-ink)" }}>{waiting} need{waiting === 1 ? "s" : ""} you</Link>}
      </div>
      <nav className="seg dept-tabs" aria-label={`${dept.name} tabs`}>
        {DEPT_TABS.map((t) => (
          <IntentLink key={t} href={tabHref(id, t)} className={tab === t ? "on" : ""} aria-current={tab === t ? "page" : undefined}>
            {TAB_LABEL[t]}{t === "approvals" && waiting > 0 && <span className="dept-n">{waiting}</span>}
          </IntentLink>
        ))}
      </nav>
      <Pane tab={tab} id={id} name={dept.name} roster={roster} counts={counts} tz={tz} orgOn={org.on} />
    </>
  );
}

type Roster = Awaited<ReturnType<typeof getRoster>>;
type Counts = Awaited<ReturnType<typeof getCounts>>;

async function Pane({ tab, id, name, roster, counts, tz, orgOn }: { tab: DeptTab; id: string; name: string; roster: Roster; counts: Counts; tz: string; orgOn: boolean }) {
  if (tab === "goals") return <Goals id={id} name={name} roster={roster} />;
  if (tab === "approvals") return <Approvals id={id} name={name} roster={roster} tz={tz} />;
  if (tab === "chat") return <Chat id={id} name={name} roster={roster} />;
  return <Agents id={id} name={name} roster={roster} counts={counts} tz={tz} orgOn={orgOn} />;
}

/** Talk to the head: each message is one logged run of the head inside its budget (core/head-chat.ts). */
async function Chat({ id, name, roster }: { id: string; name: string; roster: Roster }) {
  const chart = roster.chart!;
  const headId = headAgentId(chart, id), head = headId ? roster.byId[headId] : null;
  if (!head) {
    const seat = headOf(chart, id);
    return <Empty title={seat?.holder === "owner" ? `You lead ${name}` : `${name} has no head yet`}>{seat?.holder === "owner" ? "There’s no head agent to talk to here. Ask Avery about this department instead." : "Fill its head seat on the Agents tab, then talk to the head here."}</Empty>;
  }
  const history = await headHistory(id, 40).catch(() => null);
  const initial = (history ?? []).map((r) => ({ id: r.id, role: r.role, text: r.text, runId: r.run_id, notes: r.notes }));
  return <HeadChat deptId={id} dept={name} head={head.name} initial={initial} missing={history ? null : HEAD_CHAT_MISSING} send={sendToHead}
    starters={[`How is ${name} doing?`, "What needs me here?", "Who is behind?"]} />;
}

/** Who works here: state, model, last run and its result, what needs you, and when it runs next. */
function Agents({ id, name, roster, counts, tz, orgOn }: { id: string; name: string; roster: Roster; counts: Counts; tz: string; orgOn: boolean }) {
  const chart = roster.chart!;
  const ids = deptAgentIds(chart, id).filter((a) => roster.byId[a]);
  const head = headOf(chart, id);
  const open = head ? [head, ...below(chart, head.id)].filter((x) => x.holder === "open") : [];
  const controls = controlsOn();
  return (
    <div className="stack" style={{ gap: 12 }}>
      {!ids.length && <Empty title={`No agents in ${name} yet.`}>Fill one of its open seats to start.</Empty>}
      <div className="dept-grid">
        {ids.map((aid) => {
          const a = roster.byId[aid];
          const st = stateOf(a, roster.agents[aid], roster.runs, roster.spentToday[aid] ?? 0);
          const last = roster.runs.find((r) => r.agent_id === aid && r.status !== "skipped");
          const model = MODEL_LIST.find((m) => m.id === (a.model ?? roster.agents[aid]?.model))?.label ?? null;
          const need = counts.approvalOwners.filter((o) => o.agent === aid).length;
          const next = nextRuns(a.schedule, roster.now, 1, tz)[0];
          return (
            <div key={aid} className="card dept-agent">
              <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
                <Avatar a={a} size={34} working={st === "running"} />
                <div className="stack" style={{ gap: 3, flex: 1, minWidth: 0 }}>
                  <Link href={`/agents/${aid}`} className="dept-name">{a.name}</Link>
                  <span className="sub">{a.role}</span>
                  {model && <span className="dept-model">Runs on {model}</span>}
                </div>
                <Pill look={stateLook(st, orgOn)} sm />
              </div>
              <div className="stack" style={{ gap: 3 }}>
                <span className="muted" style={{ fontSize: 12 }}>{last ? when(last.started_at, tz) : "Never run"}</span>
                <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>{last ? last.summary ?? (last.status === "failed" ? last.error ?? "The run failed." : "Working now.") : a.job}</span>
              </div>
              <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
                {need > 0 && <Link href={`/dept/${id}?tab=approvals`} className="pill sm" style={{ background: "var(--yel-soft)", color: "var(--yel-ink)" }}>{s(need, "draft")} for you</Link>}
                <span className="muted" style={{ fontSize: 12, flex: 1 }}>{next ? `Next: ${when(next, tz)}` : schedWords(a.schedule) === "Manual only" ? "Runs when you press Run now" : schedWords(a.schedule)}</span>
                <ActionButton className="btn outline sm" action={realRun.bind(null, aid)} disabled={!controls} title={!controls ? "Real runs are off on this OPERATOR" : undefined}>Run now</ActionButton>
              </div>
            </div>
          );
        })}
      </div>
      {open.length > 0 && (
        <div className="card" style={{ gap: 8 }}>
          <span className="card-t">Open seats</span>
          {open.map((x) => (
            <div key={x.id} className="row rule wrap" style={{ gap: 10, padding: "8px 0", fontSize: 13.5 }}>
              <span style={{ flex: 1 }}>{x.title}{x.sub && <span className="muted"> · {x.sub}</span>}</span>
              <Link href={`/build/new?seat=${x.id}`} className="btn ghost xs">Build an agent for it</Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The numbers the department is held to, measured in code. */
async function Goals({ id, name, roster }: { id: string; name: string; roster: Roster }) {
  const all = await goalsByDept(roster.chart);
  if (all == null) return <div className="card"><span className="sub">{GOALS_MISSING}</span></div>;
  const goals = all[id] ?? [];
  return (
    <div className="stack" style={{ gap: 12 }}>
      {!goals.length && <Empty title={`${name} has no goals yet.`} action={{ href: `/goals/new?dept=${id}`, label: `Set a goal for ${name}` }}>A goal is a number measured in code, like margin or orders a week.</Empty>}
      <div className="dept-grid">{goals.map((g) => <GoalTile key={g.id} g={g} />)}</div>
    </div>
  );
}

/** Every draft from this department waiting on an approver: the same card as the Approvals page, so it is the same tap. */
async function Approvals({ id, name, roster, tz }: { id: string; name: string; roster: Roster; tz: string }) {
  const view = await getApprovals();
  if (!view) return <Empty title="The approvals tables aren’t there yet">Apply the gateway migration to your Supabase project.</Empty>;
  const mine = (i: ApprovalItem) => i.department_id === id;
  const pending = view.pending.filter(mine), withLead = view.withLead.filter(mine);
  const ruleIds = [...new Set([...pending, ...withLead].map((i) => i.agent_id))];
  const rules: Record<string, ReactRules> = Object.fromEntries(await Promise.all(ruleIds.map(async (a) => [a, await getReactRules(a)] as const)));
  const card = (i: ApprovalItem) => <ApprovalCard key={i.id} i={i} view={view} byId={roster.byId} tz={tz} rules={rules} />;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="row wrap" style={{ gap: 10 }}>
        <span className="card-t" style={{ flex: 1 }}>Waiting on you ({pending.length})</span>
        <Link href={`/approvals?dept=${id}`} className="sub">History and trust levels ›</Link>
      </div>
      {!pending.length && <Empty title="Nothing waiting on you.">Nothing from {name} right now.</Empty>}
      {pending.map(card)}
      {withLead.length > 0 && (
        <>
          <div className="stack" style={{ gap: 2 }}>
            <span className="card-t">With the lead first ({withLead.length})</span>
            <span className="sub">The lead adds a note or sends a draft back once; only your tap approves.</span>
          </div>
          {withLead.map(card)}
        </>
      )}
    </div>
  );
}
