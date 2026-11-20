import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import { getFloor, requireSession } from "@/dashboard/data";
import { goalsByDept } from "@/dashboard/goals";
import { GOALS_MISSING } from "@/core/goals";
import { GoalTile } from "@/dashboard/components/goals";
import { hm, longDay } from "@/dashboard/format";
import { PRI_COLOR, interruptCount, needs, split } from "@/dashboard/needs";
import { INTERRUPT_WORDS, interruptKind, type Interrupt } from "@/dashboard/needs-rules";
import { deskGreeting, deskLine, firstSentence } from "@/dashboard/desk";
import { companySeat, deptOf, groupByDepartment, headOf, latestOutputs, loadOrg } from "@/core/org";
import { listProposals } from "@/core/proposals";
import { billing, hireCost } from "@/dashboard/cost";
import { monthWords, usd, type Billing } from "@/core/cost-rules";
import { peopleOf, type DeptDraft } from "@/core/department-rules";
import type { ProposalPlan } from "@/core/proposal-rules";
import { agentNames } from "@/core/org";
import { Icon } from "@/dashboard/components/Icon";
import { inSetup, setupState } from "@/core/setup";
import { ideaOffer } from "@/core/setup-rules";
import { IdeaCard } from "@/dashboard/components/idea";
import { firstJobView } from "@/dashboard/firstJob";
import { FirstJobCard } from "@/dashboard/components/firstJob";
import { followUpsView } from "@/dashboard/followUps";
import { FollowUpsCard } from "@/dashboard/components/followUps";
import { atLeast } from "@/core/roles";

// The Desk (docs/company-mode.md, slice 5): home. Goals with where each stands and its head's latest
// word, then Needs you: only the four kinds that interrupt (card 158, dashboard/needs-rules.ts), each
// labelled. Everything else waits under the chief of staff's latest summary. Avery's chat sits beside
// it (the layout draws it). Every count and status here comes from code.

const LOOK: Record<Interrupt, { bg: string; fg: string }> = {
  money: { bg: "var(--red-soft)", fg: "var(--red-ink)" },
  first_time: { bg: "var(--yel-soft)", fg: "var(--yel-ink)" },
  new_agent: { bg: "var(--acc-soft)", fg: "var(--acc-ink)" },
  goal: { bg: "var(--mint-soft)", fg: "var(--mint-ink)" },
};
const Label = ({ k }: { k: Interrupt }) => (
  <span className="pill sm" style={{ background: LOOK[k].bg, color: LOOK[k].fg, textTransform: "uppercase", letterSpacing: ".05em", fontWeight: 700 }}>{INTERRUPT_WORDS[k]}</span>
);

/** Card 156: a department proposal's line in Needs you: its people, goals and month if each ran daily, from code. */
function deptLine(d: DeptDraft, bill: Billing): string {
  const people = peopleOf(d);
  const month = people.reduce((s, p) => s + hireCost(p, bill).daily.month, 0);
  return `${people.length} agent${people.length === 1 ? "" : "s"}, ${d.goals.length} goal${d.goals.length === 1 ? "" : "s"} · ${usd(month)} a month if each runs daily`;
}

/** Card 158: a goal proposal's line: its department, and the measure and target code will count. */
function goalLine(p: Extract<ProposalPlan, { kind: "goal" }>, dept?: string | null): string {
  const what = p.change === "drop" ? "Drops the goal" : [p.measure && p.measure !== "none" ? `measure ${p.measure}` : null, p.target ? `target ${p.target}` : null, p.dueOn ? `by ${p.dueOn}` : null].filter(Boolean).join(", ") || "Words only";
  return `${dept ?? "A department"} · ${what}`;
}

export default async function Desk() {
  const f = await getFloor(); // checks the login first, so the page is never built ahead of a request
  // a new business starts with setup (card 151, docs/setup.md), not an empty Desk
  if (await inSetup()) redirect("/start");
  const now = f.now;
  const owner = atLeast((await requireSession()).role, "owner");
  const open = needs(f, now, parseSeen((await cookies()).get(SEEN_COOKIE)?.value));
  const org = await loadOrg().catch(() => null);
  const [goals, pending, first, bill, finish, idea] = await Promise.all([goalsByDept(org), listProposals(["pending"], 12).catch(() => null), firstJobView(f).catch(() => null), billing(), followUpsView(f).catch(() => []),
    setupState().then((s) => (ideaOffer(s) ? s.idea : null)).catch(() => null)]);
  const allGoals = org && goals ? org.departments.flatMap((d) => goals[d.id] ?? []) : [];
  // each goal tile carries its head's latest word (the head's own report, so its words, not code's)
  const heads = org ? org.departments.map((d) => headOf(org, d.id)).filter((s) => s?.holder === "agent" && s.agentId).map((s) => s!.agentId as string) : [];
  const cos = org ? companySeat(org) : null;
  const chiefId = cos?.holder === "agent" ? cos.agentId : null;
  const [outs, names] = await Promise.all([
    latestOutputs([...heads, ...(chiefId ? [chiefId] : [])]).catch(() => ({} as Awaited<ReturnType<typeof latestOutputs>>)),
    agentNames([...new Set([...heads, ...(chiefId ? [chiefId] : []), ...(pending ?? []).map((p) => p.from_agent).filter((x): x is string => !!x)])]).catch(() => ({} as Record<string, string>)),
  ]);
  const quoteOf = (deptId: string) => {
    const h = org ? headOf(org, deptId) : null;
    const o = h?.agentId ? outs[h.agentId] : undefined;
    return o && h?.agentId ? { who: names[h.agentId] ?? h.agentId, text: firstSentence(o.summary) } : null;
  };
  const chief = chiefId ? names[chiefId] ?? "Avery" : "Avery";
  const summary = chiefId ? outs[chiefId] : undefined;
  // the four kinds; their proposals show as cards, so their count lines go
  const { now: asks, later } = split(open);
  const lines = asks.filter((x) => x.source.from !== "proposal");
  const props = (pending ?? []).map((p) => ({ p, k: interruptKind({ from: "proposal", kind: p.kind }) })).filter((x): x is { p: typeof x.p; k: Interrupt } => !!x.k);
  const groups = groupByDepartment(later, (id) => (org ? deptOf(org, id) : null));
  const waitCount = later.reduce((t, x) => t + x.n, 0);

  return (
    <>
      <div className="stack" style={{ gap: 6 }}>
        <span style={{ fontSize: 13 }} className="muted">{longDay(now)} · {hm(now)} CT</span>
        <h1 style={{ fontSize: 32, lineHeight: 1.15, fontWeight: 600, letterSpacing: "-.025em" }}>{deskGreeting(now)}.</h1>
        <p style={{ fontSize: 14.5, textWrap: "pretty" }} className="ink2">{deskLine(allGoals.map((g) => g.status), interruptCount(open), waitCount, chief)}</p>
      </div>

      {!f.ok && <div className="card" style={{ background: "var(--red-soft)", color: "var(--red-ink)", borderColor: "transparent" }}>{f.problem}</div>}

      {first && <FirstJobCard v={first} owner={owner} />}
      <FollowUpsCard items={finish} owner={owner} />
      <IdeaCard idea={idea} owner={owner} />


      <section className="card" style={{ gap: 12 }} aria-labelledby="goals-h">
        <div className="row wrap" style={{ gap: 12 }}>
          <h2 id="goals-h" className="card-t">Goals</h2>
          <Link href="/goals/new" className="btn outline sm"><Icon name="plus" size={14} />Set a goal</Link>
        </div>
        {goals == null ? <span className="sub">{GOALS_MISSING}</span>
          : allGoals.length ? <div className="goal-tiles">{allGoals.map((g) => <GoalTile key={g.id} g={g} showDept quote={quoteOf(g.deptId)} />)}</div>
          : <span className="sub">No goals yet. Give each department one, with a measure code can count, and its head plans around it.</span>}
      </section>

      <section className="stack" style={{ gap: 12 }} aria-labelledby="needs-h">
        <h2 id="needs-h" className="card-t">Needs you</h2>
        {lines.map((x, i) => (
          <Link key={i} href={x.href} className="card row wrap" style={{ flexDirection: "row", gap: 14, color: "var(--ink)", textDecoration: "none" }}>
            <Label k={x.interrupt!} />
            <span style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <b style={{ fontSize: 15.5, fontWeight: 600 }}>{x.title}</b>
              <span className="ink2" style={{ fontSize: 13.5, lineHeight: 1.5 }}>{x.sub}</span>
            </span>
            <span className="btn dark">Review</span>
          </Link>
        ))}
        {props.map(({ p, k }) => (
          <div key={p.id} className="card row wrap" style={{ flexDirection: "row", gap: 14 }}>
            <Label k={k} />
            <span style={{ flex: "1 1 320px", minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              <b style={{ fontSize: 15.5, fontWeight: 600 }}>{p.title}</b>
              <span className="ink2" style={{ fontSize: 13.5, lineHeight: 1.5 }}>From {p.from_agent ? names[p.from_agent] ?? p.from_agent : p.source === "claude" ? "Claude" : "you"}: {firstSentence(p.why, 220)}</span>
              {p.payload.kind === "hire" && <span className="muted" style={{ fontSize: 12.5 }}>{p.payload.job} · {monthWords(hireCost(p.payload, bill).byHand)}</span>}
              {p.payload.kind === "department" && <span className="muted" style={{ fontSize: 12.5 }}>{deptLine(p.payload.draft, bill)}</span>}
              {p.payload.kind === "goal" && <span className="muted" style={{ fontSize: 12.5 }}>{goalLine(p.payload, org?.departments.find((d) => d.id === p.department_id)?.name)}</span>}
            </span>
            <Link href={`/proposals/${p.id}`} className="btn dark">Review</Link>
          </div>
        ))}
        {!lines.length && !props.length && <span className="sub">Nothing needs you. You’re asked only about an agent’s first time doing something, money, a new agent or a goal change.</span>}
      </section>

      {(summary || later.length > 0) && (
        <section className="card" style={{ gap: 12 }} aria-labelledby="later-h">
          <div className="stack" style={{ gap: 4 }}>
            <h2 id="later-h" className="card-t">Waiting for {chief}’s summary</h2>
            <span className="sub">None of this needs you now. {chief} rolls it into the next summary; each item is still one tap away.</span>
          </div>
          {summary && (
            <div className="stack" style={{ gap: 4 }}>
              <span className="ted-k">{chief}’s latest · {longDay(Date.parse(summary.at))}</span>
              <p className="ink2" style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: "pre-line", textWrap: "pretty" }}>{summary.summary}</p>
            </div>
          )}
          {groups.map((g) => (
            <div key={g.name ?? "all"} className="stack" style={{ gap: 4 }}>
              {g.name && <span className="ted-k" style={{ padding: "4px 2px 0" }}>{g.name}</span>}
              {g.items.map((x, i) => (
                <Link key={i} href={x.href} className="row" style={{ flexDirection: "row", padding: "8px 2px", gap: 12, color: "var(--ink)", textDecoration: "none" }}>
                  <span className="dot" style={{ width: 8, height: 8, background: PRI_COLOR[x.pri] }} />
                  <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{x.title}</span><span className="clip muted" style={{ fontSize: 12.5 }}>{x.sub}</span></span>
                  <Icon name="chevron-right" size={15} style={{ opacity: 0.5 }} />
                </Link>
              ))}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
