import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import { getApprovals, getFloor, requireSession, rulesFor, type ApprovalItem, type Floor } from "@/dashboard/data";
import { goalsByDept, type GoalView } from "@/dashboard/goals";
import { GOALS_MISSING } from "@/core/goals";
import { interruptCount, needs, split } from "@/dashboard/needs";
import { INTERRUPT_WORDS, interruptKind, type Interrupt } from "@/dashboard/needs-rules";
import { deskGreeting, deskLine, firstSentence } from "@/dashboard/desk";
import { companySeat, deptOf, deptSpent, groupByDepartment, headOf, latestOutputs, monthSpendByAgent } from "@/core/org";
import { listProposals } from "@/core/proposals";
import { billing, hireCost } from "@/dashboard/cost";
import { monthWords, usd, type Billing } from "@/core/cost-rules";
import { peopleOf, type DeptDraft } from "@/core/department-rules";
import type { ProposalPlan } from "@/core/proposal-rules";
import { agentNames } from "@/core/org";
import { inSetup } from "@/core/setup";
import { firstJobView } from "@/dashboard/firstJob";
import { FirstJobCard } from "@/dashboard/components/firstJob";
import { followUpsView, skippedFindings } from "@/dashboard/followUps";
import { FollowUpsCard, SkippedFindingsCard } from "@/dashboard/components/followUps";
import { atLeast } from "@/core/roles";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS } from "@/core/business-rules";
import { CHAT_MISSING, chatHistory } from "@/core/avery-chat";
import { sendToAvery } from "@/dashboard/chatActions";
import { deptRuns } from "@/dashboard/deptFeed";
import { HeadChat } from "@/dashboard/components/headChat";
import { DeptTabs } from "@/dashboard/components/deptTabs";
import { GoalTiles } from "@/dashboard/components/goalTiles";
import { ApprovalCard } from "@/dashboard/components/approvalBits";
import { DraftCard } from "@/dashboard/components/department";
import { currentDraftView } from "@/dashboard/department";
import { deptAgentIds, deptHue, headAgentId, needsByDept, tabHref } from "@/dashboard/dept-rules";
import { COMPANY_HUE, COMPANY_TABS, COMPANY_TAB_LABEL, addDeptHref, companyHref, companyTab, goalsWord, type CompanyTab } from "@/dashboard/company-rules";
import { controlsOn } from "@/dashboard/session";
import { SkelLine } from "@/dashboard/components/skeletons";

// The Company page (docs/department-pages.md, slice 8): home, in place of the Desk and the floating Avery
// panel, built to the approved mockup. The same shape as a department's page: a short header, glass tabs
// (Chat with Avery, the default; Departments; Goals; Approvals), and Avery's chat as a glass room where her
// runs post and what needs the owner is pinned at the end. Every count and number on it comes from code.

const GEAR = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>;
const PLUS = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const LOOK: Record<Interrupt, { bg: string; fg: string }> = {
  money: { bg: "var(--red-soft)", fg: "var(--red-ink)" },
  first_time: { bg: "var(--yel-soft)", fg: "var(--yel-ink)" },
  new_agent: { bg: "var(--acc-soft)", fg: "var(--acc-ink)" },
  goal: { bg: "var(--mint-soft)", fg: "var(--mint-ink)" },
};
const Label = ({ k }: { k: Interrupt }) => <span className="co-kind" style={{ background: LOOK[k].bg, color: LOOK[k].fg }}>{INTERRUPT_WORDS[k]}</span>;

/** Card 156: a department proposal's line: its people, goals and month if each ran daily, from code. */
function deptLine(d: DeptDraft, bill: Billing): string {
  const people = peopleOf(d);
  const month = people.reduce((t, p) => t + hireCost(p, bill).daily.month, 0);
  return `${s(people.length, "agent")}, ${s(d.goals.length, "goal")} · ${usd(month)} a month if each runs daily`;
}

/** Card 158: a goal proposal's line: its department, and the measure and target code will count. */
function goalLine(p: Extract<ProposalPlan, { kind: "goal" }>, dept?: string | null): string {
  const what = p.change === "drop" ? "Drops the goal" : [p.measure && p.measure !== "none" ? `measure ${p.measure}` : null, p.target ? `target ${p.target}` : null, p.dueOn ? `by ${p.dueOn}` : null].filter(Boolean).join(", ") || "Words only";
  return `${dept ?? "A department"} · ${what}`;
}

export default async function Company({ searchParams }: { searchParams: Promise<{ tab?: string; say?: string }> }) {
  const jar = await cookies(); // per request only, so nothing here is read at build time (no database)
  const [f, setup, me, sp, biz] = await Promise.all([getFloor(), inSetup(), requireSession(), searchParams, loadBusiness().catch(() => UNKNOWN_BUSINESS)]);
  // a new business starts with setup (card 151, docs/setup.md), not an empty Company page
  if (setup) redirect("/start");
  const tab = companyTab(sp.tab);
  const org = f.chart;
  const open = needs(f, f.now, parseSeen(jar.get(SEEN_COOKIE)?.value));
  // the same count as the bell and the menu's Approvals: only the four kinds that interrupt (card 158)
  const waiting = interruptCount(open);
  const seat = org ? companySeat(org) : null;
  const chiefId = seat?.holder === "agent" ? seat.agentId : null;
  // the second round, together: the chief's name if not on the crew, the month's spend, and what the Approvals tab lists
  const [named, spend, view, pending] = await Promise.all([
    chiefId && !f.byId[chiefId] ? agentNames([chiefId]).catch(() => ({} as Record<string, string>)) : Promise.resolve({} as Record<string, string>),
    monthSpendByAgent(f.crew.map((a) => a.id)).catch(() => ({} as Record<string, number>)),
    tab === "approvals" ? getApprovals().catch(() => null) : Promise.resolve(null),
    tab === "approvals" ? listProposals(["pending"], 12).catch(() => null) : Promise.resolve(null),
  ]);
  const chief = (chiefId && (f.byId[chiefId]?.name ?? named[chiefId])) || "Avery";
  const spent = Object.values(spend).reduce((t, x) => t + x, 0);
  const budgets = org?.departments.map((d) => d.monthlyBudgetUsd) ?? [];
  const budget = budgets.length && budgets.every((b) => b != null) ? budgets.reduce((t: number, b) => t + (b ?? 0), 0) : null;
  const apCount = view ? view.pending.length + view.withLead.length + (pending ?? []).filter((p) => interruptKind({ from: "proposal", kind: p.kind })).length : undefined;
  const needsWord = `${waiting} need${waiting === 1 ? "s" : ""} you`;
  const depts = org?.departments.length ?? 0;

  return (
    <div className={`dp co${tab === "chat" ? " chat" : ""}`} style={{ "--hue": COMPANY_HUE } as React.CSSProperties}>
      <Link href="/settings" className="dp-ttl" aria-label="Company settings"><b>{biz.name}</b><span className={waiting ? "warn" : undefined}>{chief}{waiting ? ` · ${needsWord}` : ", chief of staff"}</span></Link>
      <div className="dp-head">
        <div className="dp-icon"><i /></div>
        <div><h1>{biz.name}</h1><div className="dp-led">{chief}, your chief of staff · {s(depts, "department")}, {s(f.crew.length, "agent")}</div></div>
        <div className="dp-stat">
          <span className="dp-pill">AI spend {usd(spent)}{budget != null ? ` of ${usd(budget)}` : ""} this month</span>
          {waiting > 0 && <Link href={companyHref("approvals")} className="dp-pill warn">{needsWord}</Link>}
          <Link href="/settings" className="dp-gear" aria-label="Company settings" title="Opens Settings">{GEAR}</Link>
        </div>
      </div>
      <div className="dp-stage">
        <DeptTabs label="Company tabs" open={tab} tabs={COMPANY_TABS.map((t) => ({
          key: t, label: COMPANY_TAB_LABEL[t], href: companyHref(t),
          count: t === "departments" ? depts : t === "approvals" ? apCount ?? waiting : undefined, red: t === "approvals",
        }))} />
        <div className="dp-pane" key={tab}>
          {/* each tab's own reads (goal numbers come from the tools) stream in under the title and tabs (card 303) */}
          <Suspense key={tab} fallback={<PaneSkel />}><Pane tab={tab} f={f} chiefId={chiefId} chief={chief} spend={spend} owner={atLeast(me.role, "owner")} approver={atLeast(me.role, "approver")} open={open} view={view} pending={pending} say={typeof sp.say === "string" ? sp.say.slice(0, 300) : ""} /></Suspense>
        </div>
      </div>
    </div>
  );
}

const PaneSkel = () => <div className="dp-scroll"><div className="dp-panel"><SkelLine width="45%" /><SkelLine width="70%" /></div></div>;

type P = {
  f: Floor; chiefId: string | null; chief: string; spend: Record<string, number>; owner: boolean; approver: boolean; open: ReturnType<typeof needs>;
  view: Awaited<ReturnType<typeof getApprovals>> | null; pending: Awaited<ReturnType<typeof listProposals>> | null; say: string;
};

async function Pane({ tab, ...p }: P & { tab: CompanyTab }) {
  if (tab === "departments") return <Departments {...p} />;
  if (tab === "goals") return <Goals {...p} />;
  if (tab === "approvals") return <Approvals {...p} />;
  return <Chat {...p} />;
}

/** Avery's chat: the conversation, her runs (the morning summary among them), then what needs you, pinned. */
async function Chat({ f, chiefId, chief, owner, approver, open, say }: P) {
  const [history, runs] = await Promise.all([chatHistory(40).catch(() => null), chiefId ? deptRuns([chiefId], f.byId, undefined, 15) : Promise.resolve([])]);
  const talk = (history ?? []).map((h) => ({ id: h.id, role: h.role === "owner" ? "owner" as const : "head" as const, text: h.text, notes: h.notes, runId: h.run_id, at: h.created_at }));
  return (
    <HeadChat deptId="company" dept="the company" head={chief} title="Chief of staff" tz={f.tz} talk={talk} runs={runs} cards={{}} send={sendToAvery} live={null}
      missing={history ? null : CHAT_MISSING} controls={controlsOn()} say={say}
      starters={["What needs me today?", "How are the goals?", "Add a department"]}
      empty={`Ask ${chief} about the whole company: how the goals stand, what needs you, or to add a department. A question about one department is best asked to its head, on its page.`}
      pinned={<Pinned f={f} chief={chief} owner={owner} approver={approver} open={open} />} />
  );
}

/** What sat on the Desk, now at the end of Avery's chat: the department she is drafting, setup's leftovers, and Needs you. */
async function Pinned({ f, chief, owner, approver, open }: { f: Floor; chief: string; owner: boolean; approver: boolean; open: ReturnType<typeof needs> }) {
  const org = f.chart;
  const [draft, first, finish, skipped, pending, bill] = await Promise.all([
    currentDraftView().catch(() => null), firstJobView(f).catch(() => null), followUpsView(f).catch(() => []), skippedFindings().catch(() => []),
    listProposals(["pending"], 12).catch(() => null), billing(),
  ]);
  const names = await agentNames([...new Set((pending ?? []).map((p) => p.from_agent).filter((x): x is string => !!x))]).catch(() => ({} as Record<string, string>));
  // the four kinds; their proposals show as rows of their own, so their count lines go
  const { now: asks, later } = split(open);
  const lines = asks.filter((x) => x.source.from !== "proposal");
  const props = (pending ?? []).map((p) => ({ p, k: interruptKind({ from: "proposal", kind: p.kind }) })).filter((x): x is { p: typeof x.p; k: Interrupt } => !!x.k);
  const groups = groupByDepartment(later, (id) => (org ? deptOf(org, id) : null));
  const waitCount = later.reduce((t, x) => t + x.n, 0);
  return (
    <div className="co-pin">
      {draft && <div className="co-wide"><DraftCard v={draft} owner={owner} /></div>}
      {first && <div className="co-wide"><FirstJobCard v={first} owner={owner} /></div>}
      {finish.length > 0 && <div className="co-wide"><FollowUpsCard items={finish} owner={owner} /></div>}
      {skipped.length > 0 && <div className="co-wide"><SkippedFindingsCard items={skipped} approver={approver} /></div>}
      <div className="dp-msg">
        <div className="dp-av head">{chief.replace(/[^A-Za-z ]/g, "").slice(0, 2).toUpperCase() || "AV"}</div>
        <div className="dp-bub">
          <div className="dp-who"><b>{chief}</b> Chief of staff <span className="tag">now</span></div>
          <div className="dp-glass dp-headtext dp-text">
            <Suspense fallback={<SkelLine width="60%" />}><TodayLine f={f} interrupts={interruptCount(open)} later={waitCount} chief={chief} /></Suspense>
          </div>
          {(lines.length > 0 || props.length > 0) && (
            <div className="dp-glass dp-card">
              <span className="dp-card-k amber">● Needs you</span>
              <div className="co-needs">
                {lines.map((x, i) => (
                  <div key={`l${i}`} className="co-need"><Label k={x.interrupt!} /><span><b>{x.title}.</b> {x.sub}</span><Link href={x.href} className="dp-btn">Review</Link></div>
                ))}
                {props.map(({ p, k }) => (
                  <div key={p.id} className="co-need"><Label k={k} />
                    <span><b>{p.title}.</b> From {p.from_agent ? names[p.from_agent] ?? p.from_agent : p.source === "claude" ? "Claude" : "you"}: {firstSentence(p.why, 220)}
                      {p.payload.kind === "hire" && <small>{p.payload.job} · {monthWords(hireCost(p.payload, bill).byHand)}</small>}
                      {p.payload.kind === "department" && <small>{deptLine(p.payload.draft, bill)}</small>}
                      {p.payload.kind === "goal" && <small>{goalLine(p.payload, org?.departments.find((d) => d.id === p.department_id)?.name)}</small>}
                    </span>
                    <Link href={`/proposals/${p.id}`} className="dp-btn">Review</Link>
                  </div>
                ))}
              </div>
            </div>
          )}
          {groups.length > 0 && (
            <div className="dp-glass dp-headtext dp-text">
              <p>These can wait; {chief} rolls them into the next summary:</p>
              {groups.map((g) => (
                <div key={g.name ?? "all"} className="co-later">
                  {g.name && <small>{g.name}</small>}
                  <ul>{g.items.map((x, i) => <li key={i}><Link href={x.href}>{x.title}</Link>{x.sub ? ` · ${x.sub}` : ""}</li>)}</ul>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** The greeting and the day's one line: it counts goals by how they stand, so it waits for their numbers. */
async function TodayLine({ f, interrupts, later, chief }: { f: Floor; interrupts: number; later: number; chief: string }) {
  const goals = f.chart ? await goalsByDept(f.chart).catch(() => null) : null;
  const all = f.chart && goals ? f.chart.departments.flatMap((d) => goals[d.id] ?? []) : [];
  return <p>{deskGreeting(f.now, f.tz)}. {deskLine(all.map((g) => g.status), interrupts, later, chief)}</p>;
}

/** One card per department: its head, who is on duty, what needs you, its goals and spend, its head's latest line. */
async function Departments({ f, spend }: P) {
  const org = f.chart;
  if (!org) return <div className="dp-scroll"><div className="dp-panel"><span className="dp-note">The org chart tables aren’t up to date: apply the org chart migrations.</span></div></div>;
  const goals = await goalsByDept(org).catch(() => null);
  const heads = org.departments.map((d) => headAgentId(org, d.id)).filter((x): x is string => !!x);
  const outs = await latestOutputs(heads).catch(() => ({} as Awaited<ReturnType<typeof latestOutputs>>));
  const byDept = needsByDept(org.departments.map((d) => d.id), f.approvalOwners.map((o) => o.dept)).byDept;
  return (
    <div className="dp-scroll">
      <div className="co-cards">
        {org.departments.map((d, i) => {
          const headId = headAgentId(org, d.id), seat = headOf(org, d.id), head = headId ? f.byId[headId] : null;
          const ids = deptAgentIds(org, d.id).filter((a) => f.byId[a]);
          const onDuty = ids.filter((a) => f.agents[a]?.enabled).length;
          const need = byDept[d.id] ?? 0;
          const mine = goals?.[d.id] ?? [];
          const used = deptSpent(org, d.id, spend);
          const pct = d.monthlyBudgetUsd ? Math.min(100, (used / d.monthlyBudgetUsd) * 100) : null;
          const word = headId && outs[headId] ? firstSentence(outs[headId].summary) : null;
          return (
            <Link key={d.id} href={tabHref(d.id, "chat")} className="co-card" style={{ "--hue": deptHue(i) } as React.CSSProperties}>
              <div className="co-card-h"><i /><b>{d.name}</b>{need > 0 ? <span className="co-chip warn">{need} need{need === 1 ? "s" : ""} you</span> : <span className="co-chip ok">All clear</span>}</div>
              <div className="co-led">{head ? `${head.name}, ${seat?.title ?? "head"}` : seat?.holder === "owner" ? "You lead it" : "No head yet"} · {s(onDuty, "agent")} on duty</div>
              <div className="co-goal">{goals == null ? GOALS_MISSING : <><b>{goalsWord(mine.map((g) => g.status))}</b>{mine[0] ? ` ${mine[0].title}: ${mine[0].line}` : ""}</>}</div>
              <div className="co-spend"><span>AI spend {usd(used)}{d.monthlyBudgetUsd != null ? ` of ${usd(d.monthlyBudgetUsd)}` : ""}</span>{pct != null && <div className="dp-bar"><i style={{ width: `${Math.max(2, pct)}%` }} /></div>}</div>
              {word && head && <div className="co-word"><b>{head.name}:</b> {word}</div>}
            </Link>
          );
        })}
      </div>
      <Link href={addDeptHref()} className="dp-newline">{PLUS}<span><b>Add a department.</b> Avery interviews you in the chat (what to track, goals, which tools), then proposes a head, agents and a monthly cost for your OK.</span></Link>
    </div>
  );
}

/** Every goal, by department: the same tiles as each department's Goals tab. */
async function Goals({ f }: P) {
  const org = f.chart;
  const goals = org ? await goalsByDept(org).catch(() => null) : null;
  if (!org || goals == null) return <div className="dp-scroll"><div className="dp-panel"><span className="dp-note">{GOALS_MISSING}</span></div></div>;
  const heads = org.departments.map((d) => headAgentId(org, d.id)).filter((x): x is string => !!x);
  const outs = await latestOutputs(heads).catch(() => ({} as Awaited<ReturnType<typeof latestOutputs>>));
  const shown = org.departments.map((d, i) => ({ d, i, mine: goals[d.id] ?? [] as GoalView[] })).filter((x) => x.mine.length);
  return (
    <div className="dp-scroll">
      {shown.map(({ d, i, mine }) => {
        const headId = headAgentId(org, d.id);
        const word = headId && outs[headId] ? { who: f.byId[headId]?.name ?? headId, text: firstSentence(outs[headId].summary) } : null;
        return (
          <section key={d.id} className="co-gsec" style={{ "--hue": deptHue(i) } as React.CSSProperties}>
            <header><i />{d.name}<Link href={tabHref(d.id, "goals")} className="dp-btn">Open</Link></header>
            <GoalTiles deptId={d.id} goals={mine} word={word} dept={d.name} />
          </section>
        );
      })}
      {!shown.length && <div className="dp-panel"><span className="dp-note">No goals yet. Give each department one, with a measure code can count, by telling its head in its chat.</span></div>}
      {shown.length > 0 && <span className="dp-note">Every number is measured in code. To set or change a goal, tell that department’s head in its chat: a goal steers its agents, so it comes back as a card for your OK.</span>}
    </div>
  );
}

/** Every draft in the company waiting on an approver, the same card and tap as the Approvals page and each department. */
async function Approvals({ f, view, pending }: P) {
  if (!view) return <div className="dp-scroll"><div className="dp-panel"><span className="dp-note">The approvals tables aren’t there yet. Apply the gateway migration to your Supabase project.</span></div></div>;
  const all: ApprovalItem[] = [...view.pending, ...view.withLead];
  const rules = await rulesFor(all);
  const card = (i: ApprovalItem) => <ApprovalCard key={i.id} i={i} view={view} byId={f.byId} tz={f.tz} rules={rules} look="tab" chatHref={i.department_id ? tabHref(i.department_id, "chat") : "/"} />;
  const props = (pending ?? []).filter((p) => interruptKind({ from: "proposal", kind: p.kind }));
  return (
    <div className="dp-scroll">
      <div className="dp-panel">
        <div className="dp-panel-h"><h3>Waiting for your OK</h3><span className="sp" /><span className="dp-note">Every department’s drafts in one list. Each also sits in its department’s chat, and approving in either place is the same tap. <Link href="/approvals" style={{ color: "var(--ink2)", textDecoration: "underline" }}>History and trust levels</Link></span></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {!all.length && !props.length && <div className="dp-note" style={{ padding: "28px 16px", textAlign: "center", fontSize: 14 }}>Nothing is waiting for your OK.</div>}
          {props.map((p) => (
            <div key={p.id} className="dp-ap"><div className="dp-ap-h"><b>{p.title}</b></div><span className="dp-note">{firstSentence(p.why, 220)}</span><div className="dp-btns"><Link href={`/proposals/${p.id}`} className="dp-btn dark">Review</Link></div></div>
          ))}
          {view.pending.map(card)}
          {view.withLead.length > 0 && <span className="dp-note">With the lead first ({view.withLead.length}): the lead adds a note or sends a draft back once; only your tap approves.</span>}
          {view.withLead.map(card)}
        </div>
      </div>
    </div>
  );
}

