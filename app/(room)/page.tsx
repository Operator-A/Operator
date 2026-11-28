import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense, cache } from "react";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import { getApprovals, getChainOks, getFloor, requireSession, rulesFor, type ApprovalItem, type Floor } from "@/dashboard/data";
import { okChainHref } from "@/core/chain-ok-rules";
import { goalsByDept, type GoalView } from "@/dashboard/goals";
import { GOALS_MISSING } from "@/core/goals";
import { interruptCount, needs } from "@/dashboard/needs";
import { INTERRUPT_WORDS, interruptKind, type Interrupt } from "@/dashboard/needs-rules";
import { deskGreeting, firstSentence } from "@/dashboard/desk";
import { companySeat, deptOf, deptSpent, headOf, latestOutputs, monthSpendByAgent } from "@/core/org";
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
import { ApprovalCard, ChainOkCard, Tag } from "@/dashboard/components/approvalBits";
import { DraftCard } from "@/dashboard/components/department";
import { currentDraftView } from "@/dashboard/department";
import { asksOpen, deptAgentIds, deptHue, headAgentId, needsByDept, tabHref, askHref } from "@/dashboard/dept-rules";
import { COMPANY_HUE, COMPANY_TABS, COMPANY_TAB_LABEL, SCHEDULE_HREF, addDeptHref, averyDeptHref, companyAskHref, companyHref, companyReportHref, madeAgentCompanyHref, newAgentCompanyHref, companyTab, deptView, deptViewHref, goalsWord, type CompanyTab, type DeptView } from "@/dashboard/company-rules";
import { OrgChartPane } from "@/dashboard/components/orgChartPane";
import { IntentLink } from "@/dashboard/components/intentLink";
import { controlsOn } from "@/dashboard/session";
import { SheetSkel, SkelLine } from "@/dashboard/components/skeletons";
import { ActionButton } from "@/dashboard/components/client";
import { acceptPromotion, applyWaiting, approveAll, cancelAction, declinePromotion, retryAction, trustToDraft, writeCompanyReportNow } from "@/dashboard/actions";
import { trustView, type TrustView } from "@/dashboard/trust";
import { writeBlocker } from "@/core/gateway";
import { KIND_WORDS } from "@/core/proposal-rules";
import { AgentSheetFor } from "@/dashboard/components/agentSheetFor";
import { readFill } from "@/dashboard/handoff-rules";
import { agentHref } from "@/dashboard/dept-rules";
import { seatOf, type Org } from "@/core/org-rules";
import { stateLook, stateOf } from "@/dashboard/status";
import { md, when } from "@/dashboard/format";
import { AskSheet } from "@/dashboard/components/askSheet";
import { AddDeptSheetFor } from "@/dashboard/components/packSheetFor";
import { CompanyOverview, type CoNeed, type CoTile, type CompanyOverviewData } from "@/dashboard/components/companyOverview";
import { STACK_HUES, companyTiles, deptRuns7, deptStack, goalsTile, headline, lastDays, revenueDays, usd0 } from "@/dashboard/company-overview-rules";
import { recentFailures, reportView } from "@/dashboard/overview-rules";
import { snapshotsSince } from "@/dashboard/overview";
import { latestDayReports, latestReports } from "@/core/reports";
import { COMPANY_SCOPE, todayIn, type Line } from "@/core/report-rules";

// The Company page (docs/department-pages.md, slice 8): home, in place of the Desk and the floating Avery
// panel. The same shape as a department's page: a short header, glass tabs (Overview, the default, built to the
// approved overview canvas in overview slice 3; Departments; Goals; Approvals). Avery's chat, where her runs post,
// opens in a sheet from the header's Ask button. Every count and number on it comes from code.

const GEAR = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></svg>;
const PLUS = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>;
const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;


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

// approving, Approve all and Apply now on the Approvals tab call the outside service once or twice per change
export const maxDuration = 300;

const ASK = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></svg>;

export default async function Company({ searchParams }: { searchParams: Promise<{ tab?: string; say?: string; ask?: string; agent?: string; edit?: string; view?: string; at?: string; days?: string; report?: string; add?: string; pack?: string }> }) {
  const jar = await cookies(); // per request only, so nothing here is read at build time (no database)
  const [f, setup, me, sp, biz] = await Promise.all([getFloor(), inSetup(), requireSession(), searchParams, loadBusiness().catch(() => UNKNOWN_BUSINESS)]);
  // a new business starts with setup (card 151, docs/setup.md), not an empty Company page
  if (setup) redirect("/start");
  const tab = companyTab(sp.tab);
  const dview = deptView(sp.view);
  const week = sp.report === "week";
  const paneKey = `${tab}:${dview}:${week ? "w" : "d"}`; // a new view streams in afresh
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
    tab === "approvals" ? listProposals(["pending", "accepted", "declined", "built", "failed"], 60).catch(() => null) : Promise.resolve(null),
  ]);
  const chief = (chiefId && (f.byId[chiefId]?.name ?? named[chiefId])) || "Avery";
  const spent = Object.values(spend).reduce((t, x) => t + x, 0);
  const budgets = org?.departments.map((d) => d.monthlyBudgetUsd) ?? [];
  const budget = budgets.length && budgets.every((b) => b != null) ? budgets.reduce((t: number, b) => t + (b ?? 0), 0) : null;
  const apCount = view ? view.pending.length + view.withLead.length + (pending ?? []).filter((p) => p.state === "pending" && interruptKind({ from: "proposal", kind: p.kind })).length : undefined;
  const needsWord = `${waiting} need${waiting === 1 ? "s" : ""} you`;
  const depts = org?.departments.length ?? 0;
  const onDuty = f.crew.filter((a) => f.agents[a.id]?.enabled).length;
  const askOpen = asksOpen(sp) && !sp.agent;
  const addOpen = sp.add === "dept" && !askOpen && !sp.agent;

  return (
    <div className="dp co" style={{ "--hue": COMPANY_HUE } as React.CSSProperties}>
      <Link href="/settings" className="dp-ttl" aria-label="Company settings"><b>{biz.name}</b><span className={waiting ? "warn" : undefined}>{chief}{waiting ? ` · ${needsWord}` : ", chief of staff"}</span></Link>
      <div className="dp-head">
        <div className="dp-icon"><i /></div>
        {/* the canvas's header: the day's greeting, then the company in one line */}
        <div><h1>{deskGreeting(f.now, f.tz)}</h1><div className="dp-led">{s(depts, "department")} · {s(onDuty, "agent")} on duty · {chief}, chief of staff</div></div>
        <div className="dp-stat">
          {waiting > 0 && <Link href={companyHref("approvals")} className="dp-pill warn">{needsWord}</Link>}
          <span className="dp-pill">AI spend {usd(spent)}{budget != null ? ` of ${usd(budget)}` : ""}</span>
          {/* while the org is off nothing starts on its own: turning it on stays one tap from home (slice 11) */}
          {!f.org.on && <Link href={SCHEDULE_HREF} className="dp-pill co-org" title="Opens Settings › Schedule">Org is off · Turn on</Link>}
          <Link href={companyAskHref(tab)} scroll={false} className="dp-ask">{ASK}Ask {chief}</Link>
          <Link href="/settings" className="dp-gear" aria-label="Company settings" title="Opens Settings">{GEAR}</Link>
        </div>
      </div>
      <div className="dp-stage">
        <DeptTabs label="Company tabs" open={tab} tabs={COMPANY_TABS.map((t) => ({
          key: t, label: COMPANY_TAB_LABEL[t], href: companyHref(t), icon: t,
          count: t === "departments" ? depts : t === "approvals" ? apCount ?? waiting : undefined, red: t === "approvals",
        }))} />
        <div className="dp-pane" key={tab}>
          {/* each tab's own reads (goal numbers come from the tools) stream in under the title and tabs (card 303) */}
          <Suspense key={paneKey} fallback={<PaneSkel />}><Pane tab={tab} dview={dview} f={f} chiefId={chiefId} chief={chief} spend={spend} owner={atLeast(me.role, "owner")} approver={atLeast(me.role, "approver")} open={open} view={view} pending={pending} week={week} bizName={biz.name} /></Suspense>
        </div>
      </div>
      <Link href={companyAskHref(tab)} scroll={false} className="dp-askfab" aria-label={`Ask ${chief}`}>{ASK}</Link>
      {/* Avery's chat, in a sheet over the tab (overview slice 3; it was the page's first tab) */}
      {askOpen && (
        <AskSheet title={`Ask ${chief}`} sub="Chief of staff, about the whole company" closeHref={companyHref(tab)}>
          <Chat f={f} chiefId={chiefId} chief={chief} say={typeof sp.say === "string" ? sp.say.slice(0, 300) : ""} />
        </AskSheet>
      )}
      {/* Add a department: Avery first, then department packs (packs slice 3) */}
      {addOpen && <Suspense fallback={<SheetSkel />}><AddDeptSheetFor chart={org} owner={atLeast(me.role, "owner")} averyHref={averyDeptHref()} closeHref={companyHref(tab)} start={typeof sp.pack === "string" ? sp.pack.slice(0, 40) : undefined} /></Suspense>}
      {/* the chief of staff and any agent in no department open their sheet here (slice 9, in place of Everyone) */}
      {typeof sp.agent === "string" && <Suspense key={sp.agent} fallback={<SheetSkel />}><AgentSheetFor id={sp.agent} closeHref={companyHref(tab)} tz={f.tz} now={f.now} edit={sp.edit != null} fill={readFill(sp.at, sp.days)} openHref={madeAgentCompanyHref()} /></Suspense>}
    </div>
  );
}

const PaneSkel = () => <div className="dp-scroll"><div className="dp-panel"><SkelLine width="45%" /><SkelLine width="70%" /></div></div>;

type P = {
  dview: DeptView; f: Floor; chiefId: string | null; chief: string; spend: Record<string, number>; owner: boolean; approver: boolean; open: ReturnType<typeof needs>;
  view: Awaited<ReturnType<typeof getApprovals>> | null; pending: Awaited<ReturnType<typeof listProposals>> | null; week: boolean; bizName: string;
};

async function Pane({ tab, ...p }: P & { tab: CompanyTab }) {
  if (tab === "departments") return <Departments {...p} />;
  if (tab === "goals") return <Goals {...p} />;
  if (tab === "approvals") return <Approvals {...p} />;
  return <OverviewPane {...p} />;
}

/** Avery's chat in the Ask sheet: the conversation and her runs (the morning summary among them). */
async function Chat({ f, chiefId, chief, say }: { f: Floor; chiefId: string | null; chief: string; say: string }) {
  const [history, runs] = await Promise.all([chatHistory(40).catch(() => null), chiefId ? deptRuns([chiefId], f.byId, undefined, 15) : Promise.resolve([])]);
  const talk = (history ?? []).map((h) => ({ id: h.id, role: h.role === "owner" ? "owner" as const : "head" as const, text: h.text, notes: h.notes, runId: h.run_id, at: h.created_at }));
  return (
    <HeadChat deptId="company" dept="the company" head={chief} title="Chief of staff" tz={f.tz} talk={talk} runs={runs} cards={{}} send={sendToAvery} live={null}
      missing={history ? null : CHAT_MISSING} controls={controlsOn()} say={say}
      starters={["What needs me today?", "How are the goals?", "Add a department"]}
      empty={`Ask ${chief} about the whole company: how the goals stand, what needs you, or to add a department. A question about one department is best asked to its head, on its page.`} />
  );
}

const NEED_CLS: Record<Interrupt, CoNeed["cls"]> = { money: "red", first_time: "yel", new_agent: "acc", goal: "mint" };

/**
 * The Overview (overview slice 3), to the canvas's Company artboard: setup's leftovers and the department being
 * drafted, what needs you in every department, the company report, four tiles, two charts and a card per department.
 * Every number is worked out in code (dashboard/company-overview-rules.ts).
 */
async function OverviewPane({ f, chiefId, spend, owner, approver, week, bizName }: P) {
  const org = f.chart;
  const now = f.now, tz = f.tz;
  const today = todayIn(tz, now);
  const deptIds = org?.departments.map((d) => d.id) ?? [];
  const from = lastDays(now, tz, 62)[0];
  const heads = org ? org.departments.map((d) => headAgentId(org, d.id)).filter((x): x is string => !!x) : [];
  const [draft, first, finish, skipped, props, bill, reports, snaps, dayReports, outs] = await Promise.all([
    currentDraftView().catch(() => null), firstJobView(f).catch(() => null), followUpsView(f).catch(() => []), skippedFindings().catch(() => []),
    listProposals(["pending"], 12).catch(() => null), billing(),
    latestReports(COMPANY_SCOPE).catch(() => ({ day: null, week: null })), snapshotsSince(from).catch(() => null),
    latestDayReports(deptIds).catch(() => ({} as Record<string, { day: string; lines: Line[] }>)),
    latestOutputs(heads).catch(() => ({} as Awaited<ReturnType<typeof latestOutputs>>)),
  ]);
  const names = await agentNames([...new Set((props ?? []).map((p) => p.from_agent).filter((x): x is string => !!x))]).catch(() => ({} as Record<string, string>));
  const deptName = (id: string | null | undefined) => (id ? org?.departments.find((d) => d.id === id)?.name : null) ?? "Company";
  const agentDept = (aid: string) => (org ? deptOf(org, aid)?.id ?? null : null);
  const byDept = needsByDept(deptIds, f.approvalOwners.map((o) => o.dept));

  // what needs you, in every department: drafts waiting (a row per department), runs that stopped, new agents and goal changes
  const needRows: CoNeed[] = [
    ...org?.departments.filter((d) => (byDept.byDept[d.id] ?? 0) > 0).map((d) => {
      const n = byDept.byDept[d.id];
      return { kind: "To approve", cls: "yel" as const, dept: d.name, title: `${s(n, "draft")} waiting for your OK.`, sub: `Everything ${d.name}’s agents drafted, in one place.`, href: tabHref(d.id, "approvals"), btn: "Review" };
    }) ?? [],
    ...(byDept.none + byDept.gone > 0 ? [{ kind: "To approve", cls: "yel" as const, dept: "Company", title: `${s(byDept.none + byDept.gone, "draft")} waiting for your OK.`, sub: "From agents in no department.", href: companyHref("approvals"), btn: "Review" }] : []),
    ...recentFailures(f.runs, now).map((r) => ({
      kind: "Failed run", cls: "red" as const, dept: deptName(agentDept(r.agent_id)), title: `${f.byId[r.agent_id]?.name ?? r.agent_id}’s run on ${when(r.started_at, tz)} stopped.`,
      sub: firstSentence(r.error ?? r.summary ?? "It failed.", 140), href: `/runs/${r.id}`, btn: "Open run",
    })),
    ...(props ?? []).flatMap((p) => {
      const k = interruptKind({ from: "proposal", kind: p.kind });
      if (!k) return [];
      const who = p.from_agent ? names[p.from_agent] ?? p.from_agent : p.source === "claude" ? "Claude" : "you";
      const more = p.payload.kind === "hire" ? ` ${p.payload.job} · ${monthWords(hireCost(p.payload, bill).byHand)}.` : p.payload.kind === "department" ? ` ${deptLine(p.payload.draft, bill)}.` : p.payload.kind === "goal" ? ` ${goalLine(p.payload, deptName(p.department_id))}.` : "";
      return [{ kind: INTERRUPT_WORDS[k], cls: NEED_CLS[k], dept: deptName(p.department_id), title: `${p.title}.`, sub: `From ${who}: ${firstSentence(p.why, 160)}${more}`, href: `/proposals/${p.id}`, btn: "Review" }];
    }),
  ];

  const report = reportView(week ? reports.week : reports.day, {
    week, name: bizName, today, tz, coming: [], company: true,
    agentsHref: companyHref("departments"), dayHref: companyReportHref(false), weekHref: companyReportHref(true), allHref: null,
  });
  const controls = controlsOn();
  const seatOn = !!(chiefId && f.agents[chiefId]?.enabled);
  const write = (
    <ActionButton className="dp-btn" action={writeCompanyReportNow} disabled={!owner || !controls}
      title={!controls ? "Real runs are off on this OPERATOR" : !owner ? "Only the owner can write the report now" : seatOn ? "One small model call for each period, paid by the chief of staff" : "The company report is paid by the chief of staff, who is off duty"}>Write it now</ActionButton>
  );

  const t = companyTiles(snaps ?? [], now, tz);
  const tiles: CoTile[] = [
    { label: "Revenue this month", ...t.revenue },
    { label: "Cash in the bank", ...t.cash },
    { label: "Orders this month", ...t.orders },
  ];
  // goal numbers are read from the tools, so the Goals tile and each card's goal stream in after the rest (card 303)
  const goalTile = <Suspense fallback={<div className="ov-card ov-tile"><span className="ov-tl">Goals</span><b className="sm">Measuring…</b><span className="ov-ts">Reading each goal’s number</span></div>}><GoalsTileOf org={org} /></Suspense>;

  const rev = revenueDays(snaps ?? [], now, tz, 30);
  const top = Math.max(1, ...rev.map((r) => r.usd ?? 0));
  const dayWord = (k: string) => md(`${k}T12:00:00Z`, "UTC");
  const skippedDays = rev.filter((r) => r.usd == null).length;
  const stack = deptStack(f.runs, agentDept, deptIds, now, tz, 14);
  const stackNames = (org?.departments ?? []).map((d, i) => ({ name: d.name, hue: STACK_HUES[i % STACK_HUES.length] }));
  const runs7 = deptRuns7(f.runs, agentDept, now);

  const d: CompanyOverviewData = {
    needs: needRows, report, tiles,
    rev: rev.map((r) => ({ key: r.key, pct: r.usd == null ? null : (r.usd / top) * 100, tip: `${dayWord(r.key)}: ${r.usd == null ? "no reading saved" : usd0(r.usd)}` })),
    revLabels: [dayWord(rev[0].key), dayWord(rev[15].key), "Today"],
    revNote: snaps == null ? "The daily numbers can’t be read right now." : skippedDays > 0 && skippedDays < rev.length ? `Outlined bars are days with no saved reading (the daily numbers job skipped ${skippedDays} of ${rev.length} days).` : null,
    revEmpty: skippedDays === rev.length,
    stackNames, stackTotal: stack.reduce((t2, x) => t2 + x.total, 0),
    stack: stack.map((x) => ({ key: x.key, parts: x.counts, tip: `${dayWord(x.key)}: ${stackNames.map((n, i) => `${n.name} ${x.counts[i]}`).join(", ") || "no runs"}` })),
    stackLabels: [dayWord(stack[0].key), dayWord(stack[7].key), "Today"],
    depts: (org?.departments ?? []).map((dep, i) => {
      const headId = headAgentId(org!, dep.id), headSeat = headOf(org!, dep.id), head = headId ? f.byId[headId] : null;
      const n = runs7[dep.id] ?? 0;
      return {
        id: dep.id, name: dep.name, hue: deptHue(i),
        led: head ? head.name : headSeat?.holder === "owner" ? "You lead it" : "No head yet",
        need: byDept.byDept[dep.id] ?? 0,
        headline: headline(dayReports[dep.id] ?? null, today, headId && outs[headId] ? firstSentence(outs[headId].summary) : null),
        runs: `${s(n, "run")}, last 7 days`, spend: `${usd(deptSpent(org!, dep.id, spend))} this month`,
        goal: <Suspense fallback={<span>Measuring the goal…</span>}><DeptGoalOf org={org!} id={dep.id} /></Suspense>,
        href: tabHref(dep.id, "overview"),
      };
    }),
  };
  const before = (draft || first || finish.length > 0 || skipped.length > 0) ? (
    <>
      {draft && <DraftCard v={draft} owner={owner} />}
      {first && <FirstJobCard v={first} owner={owner} />}
      {finish.length > 0 && <FollowUpsCard items={finish} owner={owner} />}
      {skipped.length > 0 && <SkippedFindingsCard items={skipped} approver={approver} />}
    </>
  ) : null;
  return <CompanyOverview d={d} write={write} before={before} goalTile={goalTile} />;
}

/** Each goal measured once per request, shared by the Goals tile and the department cards. */
const goalsOnce = cache((org: Org) => goalsByDept(org).catch(() => null));

/** The Goals tile: how many goals are on track and which are behind, measured in code (streams in). */
async function GoalsTileOf({ org }: { org: Org | null }) {
  const goals = org ? await goalsOnce(org) : null;
  if (!org || goals == null) return <Link href={companyHref("goals")} className="ov-card ov-tile"><span className="ov-tl">Goals</span><b className="sm">Not measured</b><span className="ov-ts">{GOALS_MISSING}</span></Link>;
  const g = goalsTile(org.departments.flatMap((d) => goals[d.id] ?? []));
  return (
    <Link href={companyHref("goals")} className="ov-card ov-tile">
      <span className="ov-tl">Goals</span>
      {g.total ? <b>{g.ok}<span className="co-unit"> of {g.total} on track</span></b> : <b className="sm">None yet</b>}
      <span className="ov-ts">{g.sub}</span>
    </Link>
  );
}

/** A department card's goal: its first goal and how it stands (streams in). */
async function DeptGoalOf({ org, id }: { org: Org; id: string }) {
  const goals = await goalsOnce(org);
  const g = goals?.[id]?.[0];
  return <span>{goals == null ? "Goals not measured" : g ? `${g.title}: ${g.statusLabel.toLowerCase()}` : "No goal yet"}</span>;
}

/** One card per department: its head, who is on duty, what needs you, its goals and spend, its head's latest line. */
/** Cards or the living org chart (and its editor), switched in the address (slice 11). */
function DeptViews({ dview }: { dview: DeptView }) {
  return (
    <div className="co-dtools">
      <nav className="co-vseg" aria-label="Departments view">
        {(["cards", "chart"] as const).map((v) => <IntentLink key={v} href={deptViewHref(v)} className={dview === v || (v === "chart" && dview === "edit") ? "on" : ""} aria-current={dview === v ? "page" : undefined}>{v === "cards" ? "Cards" : "Chart"}</IntentLink>)}
      </nav>
      <span className="sp" />
      {dview === "chart" && <Link href={deptViewHref("edit")} className="co-linkbtn">Edit seats and who sits where</Link>}
    </div>
  );
}

async function Departments({ f, spend, dview, owner }: P) {
  const org = f.chart;
  if (dview !== "cards") return <div className="dp-scroll"><DeptViews dview={dview} /><OrgChartPane f={f} edit={dview === "edit"} /></div>;
  if (!org) return <div className="dp-scroll"><div className="dp-panel"><span className="dp-note">The org chart tables aren’t up to date: apply the org chart migrations.</span></div></div>;
  const goals = await goalsByDept(org).catch(() => null);
  const heads = org.departments.map((d) => headAgentId(org, d.id)).filter((x): x is string => !!x);
  const outs = await latestOutputs(heads).catch(() => ({} as Awaited<ReturnType<typeof latestOutputs>>));
  const byDept = needsByDept(org.departments.map((d) => d.id), f.approvalOwners.map((o) => o.dept)).byDept;
  return (
    <div className="dp-scroll">
      <DeptViews dview={dview} />
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
            <Link key={d.id} href={tabHref(d.id, "overview")} className="co-card" style={{ "--hue": deptHue(i) } as React.CSSProperties}>
              <div className="co-card-h"><i /><b>{d.name}</b>{need > 0 ? <span className="co-chip warn">{need} need{need === 1 ? "s" : ""} you</span> : <span className="co-chip ok">All clear</span>}</div>
              <div className="co-led">{head ? `${head.name}, ${seat?.title ?? "head"}` : seat?.holder === "owner" ? "You lead it" : "No head yet"} · {s(onDuty, "agent")} on duty</div>
              <div className="co-goal">{goals == null ? GOALS_MISSING : <><b>{goalsWord(mine.map((g) => g.status))}</b>{mine[0] ? ` ${mine[0].title}: ${mine[0].line}` : ""}</>}</div>
              <div className="co-spend"><span>AI spend {usd(used)}{d.monthlyBudgetUsd != null ? ` of ${usd(d.monthlyBudgetUsd)}` : ""}</span>{pct != null && <div className="dp-bar"><i style={{ width: `${Math.max(2, pct)}%` }} /></div>}</div>
              {word && head && <div className="co-word"><b>{head.name}:</b> {word}</div>}
            </Link>
          );
        })}
      </div>
      <Unplaced f={f} />
      <Link href={addDeptHref()} scroll={false} className="dp-newline">{PLUS}<span><b>Add a department.</b> Start from a pack, or Avery interviews you in the chat (what to track, goals, which tools), then proposes a head, agents and a monthly cost for your OK.</span></Link>
      {owner && <Link href={newAgentCompanyHref()} scroll={false} className="dp-newline">{PLUS}<span><b>New agent.</b> Build one yourself on a blank agent sheet: its job, what it runs on, reads, when it runs and where it sits. It starts off duty.</span></Link>}
    </div>
  );
}

/** The chief of staff and every agent in no department: a row each, opening its sheet here (slice 9). */
function Unplaced({ f }: { f: Floor }) {
  const org = f.chart;
  const ids = f.crew.filter((a) => !(org && seatOf(org, a.id)?.departmentId && org.departments.some((d) => d.id === seatOf(org, a.id)!.departmentId))).map((a) => a.id);
  if (!ids.length) return null;
  return (
    <div className="dp-panel co-unplaced">
      <div className="dp-panel-h"><h3>Not in a department</h3><span className="sp" /><span className="dp-note">Your chief of staff and any agent without a department. Ask in the chat to move one into a department.</span></div>
      {ids.map((aid) => {
        const a = f.byId[aid];
        const st = stateOf(a, f.agents[aid], f.runs, f.spentToday[aid] ?? 0);
        const last = f.runs.find((r) => r.agent_id === aid && r.status !== "skipped");
        const dot = st === "running" ? "live" : st === "over" ? "bad" : st === "active" || st === "manual" ? "" : "off";
        return (
          <div key={aid} className="dp-agent">
            <span className={`dp-dot ${dot}`} title={stateLook(st, f.org.on).label} />
            <Link href={agentHref(org, aid)} scroll={false} className="dp-hit" aria-label={`Open ${a.name}`} /><div className="dp-nm"><b>{a.name}</b><span>{a.role}</span></div>
            <div className="dp-last"><small>{last ? when(last.started_at, f.tz) : "Never run"}</small>{last ? firstSentence(last.summary ?? (last.status === "failed" ? last.error ?? "The run failed." : "Working now."), 200) : a.job}</div>
          </div>
        );
      })}
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
/**
 * Everything waiting on the owner, from every department (slice 10, in place of the Approvals page): an earned-trust
 * offer, drafts (Approve all), the lead's queue, proposals, what goes out on earned trust inside its undo window, what
 * was approved but not applied, then history and trust levels folded away.
 */
async function Approvals({ f, view, pending }: P) {
  if (!view) return <div className="dp-scroll"><div className="dp-panel"><span className="dp-note">The approvals tables aren’t there yet. Apply the gateway migration to your Supabase project.</span></div></div>;
  const all: ApprovalItem[] = [...view.pending, ...view.withLead];
  const controls = controlsOn();
  const [rules, trust, blocker, oks] = await Promise.all([
    rulesFor(all),
    trustView().catch((e): TrustView => ({ offers: [], scheduled: [], lines: [], undoMinutes: 30, problem: e instanceof Error ? e.message : String(e) })),
    !controls ? Promise.resolve("Real runs are off on this OPERATOR") : writeBlocker(),
    getChainOks().then((x) => x ?? []),
  ]);
  const card = (i: ApprovalItem) => <ApprovalCard key={i.id} i={i} view={view} byId={f.byId} tz={f.tz} rules={rules} look="tab" chatHref={i.department_id ? askHref(i.department_id) : "/"} />;
  const props = (pending ?? []).filter((p) => p.state === "pending");
  const decidedProps = (pending ?? []).filter((p) => p.state !== "pending").slice(0, 20);
  const from = (p: NonNullable<P["pending"]>[number]) => (p.from_agent ? f.byId[p.from_agent]?.name ?? p.from_agent : p.source === "claude" ? "Claude" : "You");
  const deptName = (id: string | null) => f.chart?.departments.find((d) => d.id === id)?.name ?? null;
  const nothing = !all.length && !oks.length && !props.length && !trust.offers.length && !trust.scheduled.length && !view.waiting.length;
  return (
    <div className="dp-scroll">
      {blocker && all.length > 0 && <div className="dp-panel co-blocked"><span className="dp-note">Approving records your decision. Nothing is written yet: {blocker}. Approved items stay approved and go out once that’s fixed.</span></div>}
      {trust.offers.map((o) => (
        <div key={`${o.agentId}:${o.tool}`} className="dp-panel co-offer">
          <div className="dp-panel-h"><h3>Earned trust</h3><span className="sp" /><span className="dp-note">Asked only after 28 of the last 30 went through unedited</span></div>
          <span className="co-offer-t">{o.text}</span>
          <span className="dp-note">Caps, refusals and fresh checks still apply to every one. A “wrong” later drops it straight back to Draft.</span>
          <div className="dp-btns">
            <ActionButton className="dp-btn go" action={acceptPromotion.bind(null, o.agentId, o.tool)}>Yes, promote</ActionButton>
            <ActionButton className="dp-btn" action={declinePromotion.bind(null, o.agentId, o.tool)}>Not yet</ActionButton>
          </div>
        </div>
      ))}
      <div className="dp-panel">
        <div className="dp-panel-h">
          <h3>Waiting for your OK</h3><span className="sp" />
          {view.pending.length > 1 && (
            <ActionButton className="dp-btn sm" action={approveAll.bind(null, view.pending.map((i) => i.id))}
              confirm={{ title: `Approve all ${view.pending.length}?`, body: blocker ? `Your approvals are recorded. Nothing is written until this is fixed: ${blocker}.` : "Each one is checked again right before it is written, exactly as when you approve it alone.", lines: [{ k: "Drafts", v: String(view.pending.length) }], confirmLabel: "Approve all" }}>
              Approve all {view.pending.length}
            </ActionButton>
          )}
          <span className="dp-note co-full">Every department’s drafts in one list. Each also sits in its department’s chat, and approving in either place is the same tap.</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {nothing && <div className="dp-note" style={{ padding: "28px 16px", textAlign: "center", fontSize: 14 }}>Nothing is waiting for your OK.</div>}
          {!view.pending.length && !oks.length && !nothing && <span className="dp-note">No drafts right now.</span>}
          {oks.map((c) => <ChainOkCard key={c.id} c={c} tz={f.tz} chainHref={okChainHref(c)} />)}
          {view.pending.map(card)}
          {view.withLead.length > 0 && <span className="dp-note">With the lead first ({view.withLead.length}): departments with “Lead checks drafts first” on. The lead adds a note or sends a draft back once; only your tap approves.</span>}
          {view.withLead.map(card)}
        </div>
      </div>
      {props.length > 0 && (
        <div className="dp-panel">
          <div className="dp-panel-h"><h3>Proposals to decide</h3><span className="sp" /><span className="dp-note">Hires, departments, goal changes, tools and retirements. Nothing happens until you say yes.</span></div>
          <div className="co-rows">
            {props.map((p) => (
              <div key={p.id} className="co-row"><span><b>{p.title}</b><br /><small>{KIND_WORDS[p.kind]} · from {from(p)}{deptName(p.department_id) ? ` · ${deptName(p.department_id)}` : ""}</small></span><Link href={`/proposals/${p.id}`} className="dp-btn sm">Open</Link></div>
            ))}
          </div>
        </div>
      )}
      {trust.scheduled.length > 0 && (
        <div className="dp-panel">
          <div className="dp-panel-h"><h3>Going out on earned trust</h3><span className="sp" /><span className="dp-note">Each goes by itself when its {trust.undoMinutes}-minute undo window ends (checked every 15 minutes). Cancel writes nothing.</span></div>
          <div className="co-rows">
            {trust.scheduled.map((a) => (
              <div key={a.id} className="co-row"><span>{a.name} · {a.what}: {a.label}</span><small>after {when(a.executeAfter, f.tz)}</small>
                <ActionButton className="dp-btn sm" action={cancelAction.bind(null, a.id, "not_now")}>Cancel</ActionButton>
                <ActionButton className="dp-btn sm" action={cancelAction.bind(null, a.id, "wrong")} title="Cancels it and drops this kind back to Draft">Cancel, it’s wrong</ActionButton>
              </div>
            ))}
          </div>
        </div>
      )}
      {view.waiting.length > 0 && (
        <div className="dp-panel">
          <div className="dp-panel-h"><h3>Approved, not applied yet</h3><span className="sp" />
            <ActionButton className="dp-btn sm" disabled={!controls} title={!controls ? "Real runs are off on this OPERATOR" : undefined} action={applyWaiting}
              confirm={{ title: "Apply approved changes?", body: "Each one is checked again first. Each runs as its agent, so it’s skipped while that agent is off duty.", confirmLabel: "Apply now" }}>Apply now</ActionButton>
          </div>
          <div className="co-rows">
            {view.waiting.map((i) => (
              <div key={i.id} className="co-row"><span>{i.title}{i.action_reason && <small> · {i.action_reason}</small>}</span><Tag s={i.action_status} />
                {i.action_status === "failed" && <ActionButton className="dp-btn sm" disabled={!controls} action={retryAction.bind(null, i.action_id)}>Retry</ActionButton>}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="dp-panel" id="history">
        <details className="co-hist">
          <summary>History and trust levels</summary>
          <h5>Trust levels</h5>
          <span className="dp-note">Earned per agent and kind of action: 28 of the last 30 approved unedited, then you confirm.</span>
          {trust.problem && <span className="dp-note">{trust.problem}</span>}
          <div className="co-rows">
            {!trust.lines.length && <span className="dp-note">No kinds of action yet.</span>}
            {trust.lines.map((l) => (
              <div key={`${l.agentId}:${l.tool}`} className="co-row"><span><b>{l.name} · {l.what}</b> <small>· {l.levelWords}</small><br /><small>{l.words}{l.reason && l.level === "draft" && l.changedAt ? ` Last change: ${l.reason}` : ""}</small></span>
                {l.level !== "draft" && <ActionButton className="dp-btn sm" action={trustToDraft.bind(null, l.agentId, l.tool)}>Back to Draft</ActionButton>}
              </div>
            ))}
          </div>
          <h5>Decided</h5>
          <div className="co-rows">
            {!view.decided.length && <span className="dp-note">Nothing decided yet.</span>}
            {view.decided.map((i) => (
              <div key={i.id} className="co-row"><span>{i.title}{i.action_reason && <small> · {i.action_reason}</small>}</span><small>{i.decided_at ? when(i.decided_at, f.tz) : ""}</small><Tag s={i.status === "expired" ? "expired" : i.action_status} /></div>
            ))}
            {decidedProps.map((p) => (
              <Link key={p.id} href={`/proposals/${p.id}`} className="co-row"><span>{p.title}<small> · {KIND_WORDS[p.kind]}</small></span><small>{when(p.created_at, f.tz)}</small><Tag s={p.state} /></Link>
            ))}
          </div>
          <h5>Gateway log</h5>
          <span className="dp-note">Every write an agent asked for, allowed or refused.</span>
          <div className="co-rows">
            {!view.log.length && <span className="dp-note">No actions yet.</span>}
            {view.log.map((g) => (
              <div key={g.id} className="co-row"><span><b>{f.byId[g.agent_id]?.name ?? g.agent_id}</b> · <code>{g.tool}</code> · {g.action_type}{g.reason && <small> · {g.reason}</small>}</span><small>{when(g.created_at, f.tz)}</small><Tag s={g.status} />
                {g.exec_run_id && <Link href={`/runs/${g.exec_run_id}`} className="dp-note">run</Link>}
              </div>
            ))}
          </div>
          <Link href="/connections/find#requests" className="dp-note co-link">Tools your heads asked for, and how many times, are on Find a tool ›</Link>
        </details>
      </div>
    </div>
  );
}

