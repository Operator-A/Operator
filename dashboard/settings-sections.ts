// The sections of Settings (docs/settings.md): one page each under /settings, in menu order. The paid
// layer adds its own sections through the settingsSections slot; app/(room)/settings/[section] draws them.
// Pure, so check:settings-sections can read it.

export interface SectionLink { slug: string; label: string; hint: string }

/** Core sections. "" is /settings itself. Each has its own folder under app/(room)/settings. */
export const CORE_SECTIONS: readonly SectionLink[] = [
  { slug: "", label: "General", hint: "Time zone, theme, you" },
  { slug: "business", label: "Business", hint: "What agents know and where things go" },
  { slug: "people", label: "People", hint: "Who signs in, and their role" },
  { slug: "limits", label: "Limits", hint: "Caps, vendors, no-email list" },
];

/** Always last in the menu, after any sections the paid layer adds. */
export const LAST_SECTIONS: readonly SectionLink[] = [{ slug: "audit", label: "Audit log", hint: "Who did what" }];

/** Old anchors on the one long page, and the section each now lives on. */
export const OLD_ANCHORS: Readonly<Record<string, string>> = { billing: "billing", brain: "brain", playbook: "brain" };

export const sectionHref = (slug: string) => (slug ? `/settings/${slug}` : "/settings");

/** The whole menu: core, then the paid layer's, then the audit log. An extension slug that clashes with a core one is dropped. */
export function sectionMenu(extra: readonly SectionLink[]): SectionLink[] {
  const taken = new Set([...CORE_SECTIONS, ...LAST_SECTIONS].map((s) => s.slug));
  return [...CORE_SECTIONS, ...extra.filter((s) => /^[a-z][a-z-]{1,30}$/.test(s.slug) && !taken.has(s.slug)), ...LAST_SECTIONS];
}
