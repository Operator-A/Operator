import Link from "next/link";
import { cookies } from "next/headers";
import { toConnect } from "@/dashboard/connections";
import { getFloor, requireSession } from "@/dashboard/data";
import { alerting, interruptCount, needs } from "@/dashboard/needs";
import { SEEN_COOKIE, parseSeen } from "@/dashboard/seen";
import { isLive } from "@/dashboard/status";
import { HeaderPop, LiveRefresher, MobileMenu, SideLink, ThemeToggle, type RecentRun } from "@/dashboard/components/client";
import { Icon } from "@/dashboard/components/Icon";
import { SignOutButton } from "@/dashboard/components/signOut";
import { headOf } from "@/core/org";
import { deptHue, headAgentId, needsByDept } from "@/dashboard/dept-rules";
import { SideDept } from "@/dashboard/components/deptTabs";
import { addDeptHref } from "@/dashboard/company-rules";
import { loadBusiness } from "@/core/business";
import { UNKNOWN_BUSINESS, initials } from "@/core/business-rules";
import { ROLE_LABELS } from "@/core/roles";
import { bellRows, liveRows, minsWord, workingWord } from "@/dashboard/header-rules";
import { companyHref } from "@/dashboard/company-rules";

// a message to Avery (the Company page) or to a head (a department page) is a run on that page
export const maxDuration = 120;

export default async function RoomLayout({ children }: { children: React.ReactNode }) {
  // one round for everything the frame shows (card 202, docs/speed.md); a bad session still redirects before anything is drawn
  const [floor, jar, biz, me] = await Promise.all([getFloor(), cookies(), loadBusiness().catch(() => UNKNOWN_BUSINESS), requireSession()]);
  const org = floor.chart; // read once with the floor (card 302)
  const theme = jar.get("cr_theme")?.value === "dark" ? "dark" : "light";
  const open = needs(floor, floor.now, parseSeen(jar.get(SEEN_COOKIE)?.value));
  const red = alerting(open);
  // the top bar (slice 9): one working pill for the runs live now, and the bell's list of what needs you
  const live = liveRows(floor.runs, floor.byId, org, floor.now);
  const bell = bellRows(open);
  // runs from the last 10 minutes, so the refresher can poll while one is live and say when it ends
  const recent: RecentRun[] = floor.runs
    .filter((r) => floor.now - Date.parse(r.started_at) < 10 * 6e4)
    .map((r) => ({ id: r.id, name: floor.byId[r.agent_id]?.name ?? r.agent_id, status: r.status, live: isLive(r, floor.now) }));
  // card 158: the badge counts only the four kinds that interrupt (dashboard/needs-rules.ts)
  const waiting = interruptCount(open);
  // six places (docs/builder-flow.md, slice 5): Settings sits apart at the bottom of the sidebar
  const nav = [
    // Company carries the count of what interrupts you: its Approvals tab holds what the Approvals page did (slice 10)
    { href: "/", match: ["/", "/proposals*"], icon: "layout-dashboard", label: "Company", count: waiting ? String(waiting) : undefined },
    { href: "/crew", match: ["/crew", "/agents/*", "/build*"], icon: "users", label: "Crew", count: `${floor.crew.length}` },
    { href: "/runs", match: "/runs*", icon: "history", label: "Runs" },
    { href: "/connections", match: "/connections", icon: "plug", label: "Connections", note: toConnect(floor.health, floor.grants), noteColor: "var(--ink2)" },
  ];
  // each department under its own name, with its head and a red count of what waits on you there (docs/department-pages.md)
  const deptNeeds = org ? needsByDept(org.departments.map((d) => d.id), floor.approvalOwners.map((o) => o.dept)).byDept : {};
  const depts = (org?.departments ?? []).map((d, i) => {
    const head = headAgentId(org!, d.id), seat = headOf(org!, d.id);
    const who = head ? floor.byId[head]?.name : seat?.holder === "owner" ? "You" : null;
    return { href: `/dept/${d.id}`, name: d.name, sub: who ? `${who} · ${seat?.title ?? "Head"}` : "No head yet", hue: deptHue(i), count: deptNeeds[d.id] ?? 0 };
  });
  // Add a department is Avery's department interview, in her chat on the Company page (slice 8)
  const deptList = <><span className="side-h6">Departments</span>{depts.map((it) => <SideDept key={it.href} {...it} />)}<SideLink href={addDeptHref()} match={[]} icon="plus" label="Add a department" /></>;
  const deptGroup = deptList && <div className="side-group">{deptList}</div>;

  return (
    <div className="page">
      <div className="ws">
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-mark">{initials(biz.name)}</span>
            <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}><span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-.02em" }}>{biz.name}</span><span style={{ fontSize: 12 }} className="muted">Mission control</span></span>
          </Link>
          <div className="top-right">
            <HeaderPop label="What’s running now" className={"hp-live" + (live.length ? "" : " quiet")} trigger={<><i className="hp-pulse" /><span className="hp-n">{live.length || ""}</span><span className="hp-word">{workingWord(live.length)}</span></>}>
              <h5>{live.length ? "Running now" : "Nothing is running"}</h5>
              {live.map((r) => (
                <Link key={r.id} href={r.href} className="hp-row" style={r.hue ? ({ "--hue": r.hue } as React.CSSProperties) : undefined}>
                  <i /><b>{r.name} · {r.role}</b><em>{minsWord(r.mins)}</em><span>{r.dept ? `${r.dept}: its checklist posts in the chat.` : "Opens its runs."}</span>
                </Link>
              ))}
              {!live.length && <span className="hp-foot">Agents show here while they work.</span>}
            </HeaderPop>
            <HeaderPop label={bell.rows.length ? "What needs you" : "Nothing needs you"} className="round hp-bell" trigger={<><Icon name="bell" />{red.length > 0 && <span className="hp-pip">{red.length}</span>}</>}>
              <h5>{bell.rows.length ? "Needs you" : "Nothing needs you"}</h5>
              {bell.rows.map((n) => (
                <Link key={`${n.title}:${n.href}`} href={n.href} className={"hp-row" + (n.red ? " red" : "")}><i /><b>{n.title}</b>{n.sub && <span>{n.sub}</span>}</Link>
              ))}
              {bell.more > 0 && <span className="hp-foot">and {bell.more} more</span>}
              <Link href={companyHref("approvals")} className="hp-mi">See everything on Company › Approvals</Link>
            </HeaderPop>
            <HeaderPop label="Your account" className="hp-me" panelClass="narrow" trigger={me.email.slice(0, 1).toUpperCase()}>
              <div className="hp-who"><b>{me.email}</b>{ROLE_LABELS[me.role]}</div>
              <div className="hp-theme"><ThemeToggle initial={theme} wide /></div>
              <Link href="/settings" className="hp-mi"><Icon name="settings" size={16} />Settings</Link>
              <SignOutButton look="menu" />
            </HeaderPop>
            <MobileMenu alert={!!waiting}>
              <div className="sheet-group">
                {nav.map((it) => <SideLink key={it.label} {...it} />)}
              </div>
              <div className="sheet-group">{deptList}</div>
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
            {/* the top places and departments scroll inside the panel when they don't fit; Status, Settings and Sign out stay pinned */}
            <div className="side-scroll">
              <div className="side-group">
                {nav.map((it) => <SideLink key={it.label} {...it} />)}
              </div>
              {deptGroup}
            </div>
            <SideLink href="/status" match="/status" icon="circle-alert" label="Status" />
            <SideLink href="/settings" match="/settings*" icon="settings" label="Settings" />
          </aside>
          <main className="main">{children}</main>
          <LiveRefresher runs={recent} />
        </div>
      </div>
    </div>
  );
}
