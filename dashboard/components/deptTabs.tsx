"use client";
// A department page's tabs (docs/department-pages.md), as in the approved mockup: glass, floating over the
// content, with a dark ink that slides to the open tab. The tab is in the address, so each one is a link.
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";
import { IntentLink } from "./intentLink";

export interface TabLink { key: string; label: string; href: string; count?: number; red?: boolean }

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
    <nav className="dp-tabs" ref={bar} aria-label={label}>
      <span className="dp-ink" ref={ink} style={ready ? undefined : { transition: "none" }} />
      {tabs.map((t) => (
        <IntentLink key={t.key} href={t.href} data-tab={t.key} className={on === t.key ? "on" : ""} aria-current={on === t.key ? "page" : undefined} onClick={() => setOn(t.key)}>
          {t.label}{t.count != null && t.count > 0 && <span className={`c${t.red ? " red" : ""}`}>{t.count}</span>}
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
