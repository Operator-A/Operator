"use client";
// The Settings section menu (docs/settings.md): a column on a desktop, a row of chips on a phone.
// Also moves an old link with a #billing style anchor to its section, once.
import { IntentLink } from "./intentLink";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { OLD_ANCHORS, sectionHref, type SectionLink } from "../settings-sections";

export function SettingsNav({ sections }: { sections: SectionLink[] }) {
  const path = usePathname();
  const router = useRouter();
  useEffect(() => {
    const to = OLD_ANCHORS[window.location.hash.slice(1)];
    if (path === "/settings" && to && sections.some((s) => s.slug === to)) router.replace(`${sectionHref(to)}${window.location.search}`);
  }, [path, router, sections]);
  return (
    <nav className="set-nav" aria-label="Settings sections">
      {sections.map((s) => {
        const href = sectionHref(s.slug);
        const on = path === href;
        return (
          <IntentLink key={s.slug} href={href} className={"set-link" + (on ? " on" : "")} aria-current={on ? "page" : undefined}>
            <span className="set-link-t">{s.label}</span>
            <span className="set-link-h">{s.hint}</span>
          </IntentLink>
        );
      })}
    </nav>
  );
}
