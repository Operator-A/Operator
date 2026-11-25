"use client";
// A department page's tabs (docs/department-pages.md), as in the approved mockup: glass, floating over the
// content, with a dark ink that slides to the open tab. The tab is in the address, so each one is a link.
// On a phone each tab is an icon over a small label, all on one line (approved mockup, option C, 2026-11-25):
// the icons are drawn here and hidden on wide screens, where the tabs keep their words.
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { IntentLink } from "./intentLink";

/** Every tab that has an icon: a department's five and Company's four. */
export type TabIcon = "chat" | "agents" | "goals" | "chains" | "approvals" | "departments";
export interface TabLink { key: string; label: string; href: string; icon: TabIcon; count?: number; red?: boolean }

// Lucide's outlines (message-circle, users, target, workflow, circle-check, layout-grid), drawn inline
const ICON_PATHS: Record<TabIcon, React.ReactNode> = {
  chat: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
  agents: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  goals: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
  chains: <><rect x="3" y="3" width="8" height="8" rx="2" /><path d="M7 11v4a2 2 0 0 0 2 2h4" /><rect x="13" y="13" width="8" height="8" rx="2" /></>,
  approvals: <><circle cx="12" cy="12" r="10" /><path d="m9 12 2 2 4-4" /></>,
  departments: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
};
const TabSvg = ({ icon }: { icon: TabIcon }) => (
  <svg className="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{ICON_PATHS[icon]}</svg>
);

export function DeptTabs({ tabs, open, label }: { tabs: TabLink[]; open: string; label: string }) {
  const [on, setOn] = useState(open);
  const [seen, setSeen] = useState(open);
  // follow the address when it changes (back and forward), without an effect
  if (open !== seen) { setSeen(open); setOn(open); }
  const bar = useRef<HTMLElement>(null);
  const ink = useRef<HTMLSpanElement>(null);
  const [ready, setReady] = useState(false);

  useLayoutEffect(() => {
    const place = () => {
      const el = bar.current?.querySelector<HTMLAnchorElement>(`a[data-tab="${on}"]`);
      if (!el || !ink.current) return;
      ink.current.style.width = `${el.offsetWidth}px`;
      ink.current.style.transform = `translateX(${el.offsetLeft}px)`;
    };
    place();
    const f = requestAnimationFrame(() => setReady(true));
    window.addEventListener("resize", place);
    return () => { cancelAnimationFrame(f); window.removeEventListener("resize", place); };
  }, [on]);

  return (
    <nav className="dp-tabs" ref={bar} aria-label={label} style={{ "--n": tabs.length } as React.CSSProperties}>
      <span className="dp-ink" ref={ink} style={ready ? undefined : { transition: "none" }} />
      {tabs.map((t) => (
        <IntentLink key={t.key} href={t.href} data-tab={t.key} className={on === t.key ? "on" : ""} aria-current={on === t.key ? "page" : undefined} onClick={() => setOn(t.key)}>
          <TabSvg icon={t.icon} /><span className="tl">{t.label}</span>{t.count != null && t.count > 0 && <span className={`c${t.red ? " red" : ""}`}>{t.count}</span>}
        </IntentLink>
      ))}
    </nav>
  );
}

/** A department in the side menu, as in the mockup: its colour, its name, its head and title, and a red count. */
export function SideDept({ href, name, sub, hue, count }: { href: string; name: string; sub?: string; hue: string; count?: number }) {
  const path = usePathname();
  const on = path === href;
  return (
    <IntentLink href={href} className={`side-dept${on ? " on" : ""}`} aria-current={on ? "page" : undefined} style={{ "--hue": hue } as React.CSSProperties}>
      <i className="hue" />
      <span className="t">{name}{sub && <span className="sub">{sub}</span>}</span>
      {!!count && <span className="n">{count}</span>}
    </IntentLink>
  );
}
