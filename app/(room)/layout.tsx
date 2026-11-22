import Link from "next/link";
import { cookies } from "next/headers";
import { toConnect } from "@/dashboard/connections";
import { getFloor, requireSession } from "@/dashboard/data";
import { longDay } from "@/dashboard/format";
import { alerting, interruptCount, needs } from "@/dashboard/needs";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import { isLive, stateLook, stateOf } from "@/dashboard/status";
import { LiveRefresher, MobileMenu, RailLink, SideLink, ThemeToggle, type RecentRun } from "@/dashboard/components/client";
import { Icon } from "@/dashboard/components/Icon";
import { AveryChat } from "@/dashboard/components/avery";
import { SignOutButton } from "@/dashboard/components/signOut";
import { DraftCard } from "@/dashboard/components/department";
import { currentDraftView } from "@/dashboard/department";
import { atLeast } from "@/core/roles";
import { sendToAvery } from "@/dashboard/chatActions";
import { CHAT_MISSING, chatHistory } from "@/core/avery-chat";
import { agentNames, companySeat, loadOrg } from "@/core/org";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS, initials } from "@/core/business-rules";

// a message to Avery is a run on the page the owner is on (docs/company-mode.md, slice 5)
export const maxDuration = 120;

export default async function RoomLayout({ children }: { children: React.ReactNode }) {
  // one round for everything the frame shows (card 202, docs/speed.md); a bad session still redirects before anything is drawn
  const [floor, jar, history, org, biz, me, draft] = await Promise.all([
    getFloor(), cookies(), chatHistory(30).catch(() => null), loadOrg().catch(() => null), loadBusiness().catch(() => UNKNOWN_BUSINESS), requireSession(),
    // card 156: the department draft Avery is filling in, at the top of her panel
    currentDraftView().catch(() => null),
  ]);
  const theme = jar.get("cr_theme")?.value === "dark" ? "dark" : "light";
  const open = needs(floor, floor.now, parseSeen(jar.get(SEEN_COOKIE)?.value));
  const red = alerting(open);
  const rail = floor.crew.map((a) => {
    const st = stateOf(a, floor.agents[a.id], floor.runs, floor.spentToday[a.id] ?? 0);
    return { a, st, badge: red.filter((n) => n.agentId === a.id).length };
  });
  // runs from the last 10 minutes, so the refresher can poll while one is live and say when it ends
  const recent: RecentRun[] = floor.runs
    .filter((r) => floor.now - Date.parse(r.started_at) < 10 * 6e4)
    .map((r) => ({ id: r.id, name: floor.byId[r.agent_id]?.name ?? r.agent_id, status: r.status, live: isLive(r, floor.now) }));
  // card 158: the badge counts only the four kinds that interrupt (dashboard/needs-rules.ts)
  const waiting = interruptCount(open);
  // Avery's chat: whoever holds the company seat, with the conversation so far
  const frontId = org ? companySeat(org)?.agentId ?? null : null;
  const frontName = frontId ? floor.byId[frontId]?.name ?? (await agentNames([frontId]))[frontId] ?? "Avery" : "Avery";
  // six places (docs/builder-flow.md, slice 5): Settings sits apart at the bottom of the sidebar
  const nav = [
    { href: "/", match: "/", icon: "layout-dashboard", label: "Desk" },
    { href: "/approvals", match: ["/approvals", "/proposals*"], icon: "inbox", label: "Approvals", count: waiting ? String(waiting) : undefined },
    { href: "/crew", match: ["/crew", "/agents/*", "/build*"], icon: "users", label: "Crew", count: `${floor.crew.length}` },
    { href: "/runs", match: "/runs*", icon: "history", label: "Runs" },
    { href: "/connections", match: "/connections", icon: "plug", label: "Connections", note: toConnect(floor.health, floor.grants), noteColor: "var(--ink2)" },
  ];

  return (
    <div className="page">
      <div className="ws">
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-mark">{initials(biz.name)}</span>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}><span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.02em" }}>{biz.name}</span><span style={{ fontSize: 12 }} className="muted">Mission control</span></span>
          </Link>
          <nav className="rail" aria-label="Crew">
            {rail.map(({ a, st, badge }) => <RailLink key={a.id} id={a.id} name={a.name} icon={a.icon} title={`${a.name} · ${a.role} · ${stateLook(st, floor.org.on).label}`} running={st === "running"} badge={badge} />)}
          </nav>
          <div className="top-right">
            <span className="wide-only"><ThemeToggle initial={theme} /></span>
            <Link href="/" className="round" title={red.length ? `${red.length} thing${red.length === 1 ? "" : "s"} need${red.length === 1 ? "s" : ""} you` : "Nothing needs you"} style={{ position: "relative" }}>
              <Icon name="bell" />
              {!!red.length && <span style={{ position: "absolute", top: 11, right: 12, width: 7, height: 7, borderRadius: 999, background: "var(--red)", border: "1.5px solid var(--soft)" }} />}
            </Link>
            <span className="date-pill"><Icon name="calendar" size={16} />{longDay(floor.now, floor.tz).replace(/^(\w{3})\w*/, "$1")}</span>
            <span className="me" title={me.email}>{me.email.slice(0, 1).toUpperCase()}</span>
            <MobileMenu alert={!!waiting}>
              <div className="sheet-group">
                {nav.map((it) => <SideLink key={it.label} {...it} />)}
              </div>
              <div className="sheet-group">
                <SideLink href="/status" match="/status" icon="circle-alert" label="Status" />
                <SideLink href="/settings" match="/settings*" icon="settings" label="Settings" />
                <SignOutButton />
                <div style={{ padding: "8px 12px 0" }}><ThemeToggle initial={theme} wide /></div>
              </div>
            </MobileMenu>
          </div>
        </header>
        <div className="body">
          <aside className="side">
            <div className="side-group">
              {nav.map((it) => <SideLink key={it.label} {...it} />)}
            </div>
            <div className="side-spacer" style={{ flex: 1 }} />
            <SideLink href="/status" match="/status" icon="circle-alert" label="Status" />
            <SideLink href="/settings" match="/settings*" icon="settings" label="Settings" />
            <SignOutButton />
          </aside>
          <main className="main">{children}</main>
          <AveryChat name={frontName} send={sendToAvery} missing={history ? null : CHAT_MISSING} draft={draft ? <DraftCard v={draft} owner={atLeast(me.role, "owner")} /> : null}
            initial={(history ?? []).map((h) => ({ id: h.id, role: h.role, text: h.text, runId: h.run_id, notes: h.notes }))} />
          <LiveRefresher runs={recent} />
        </div>
      </div>
    </div>
  );
}
