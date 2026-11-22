// Settings in sections (docs/settings.md): `npm run check:settings-sections`. Pure: reads files.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { CORE_SECTIONS, LAST_SECTIONS, OLD_ANCHORS, sectionHref, sectionMenu } from "../dashboard/settings-sections";
import none from "../core/extensions/none";

const ROOT = "app/(room)/settings";
const read = (p: string) => readFileSync(p, "utf8");
const pageOf = (slug: string) => join(ROOT, slug, "page.tsx");

// every core section has its page, and every folder is a section (or the paid layer's [section])
const core = [...CORE_SECTIONS, ...LAST_SECTIONS];
for (const s of core) assert.ok(existsSync(pageOf(s.slug)), `${sectionHref(s.slug)} has a page`);
const folders = readdirSync(ROOT).filter((f) => statSync(join(ROOT, f)).isDirectory());
for (const f of folders) assert.ok(f === "[section]" || core.some((s) => s.slug === f), `${ROOT}/${f} is a listed section`);
assert.ok(existsSync(join(ROOT, "layout.tsx")), "the section menu lives in the settings layout");
assert.match(read(join(ROOT, "layout.tsx")), /<SettingsNav sections=\{menu\} \/>/);

// the menu: core first, the paid layer's in the middle, the audit log last; clashes and odd slugs are dropped
assert.deepEqual(sectionMenu([]).map((s) => s.slug), ["", "business", "people", "limits", "audit"]);
const withExtra = sectionMenu([{ slug: "billing", label: "Billing", hint: "" }, { slug: "people", label: "Clash", hint: "" }, { slug: "../x", label: "Odd", hint: "" }]);
assert.deepEqual(withExtra.map((s) => s.slug), ["", "business", "people", "limits", "billing", "audit"], "extras go after the core sections, before the audit log");
assert.equal(withExtra.find((s) => s.slug === "people")?.label, "People", "an extension never replaces a core section");
assert.deepEqual(none.settingsSections, [], "the open edition has no extra sections");
assert.match(read(join(ROOT, "[section]", "page.tsx")), /if \(!s\) notFound\(\);/, "an unknown section is not found");
for (const to of Object.values(OLD_ANCHORS)) assert.ok(!core.some((s) => s.slug === to), `old anchor target ${to} is a paid-layer section`);

// each section loads only its own data
const imports = (slug: string) => [...read(pageOf(slug)).matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
const general = imports("");
for (const heavy of ["@/core/audit", "@/core/members", "@/dashboard/guardrails", "@/core/goals"]) assert.ok(!general.includes(heavy), `General doesn't load ${heavy}`);
assert.ok(!imports("audit").includes("@/dashboard/guardrails"), "the audit log doesn't load caps");
assert.ok(!imports("people").includes("@/core/audit"), "People doesn't load the audit log");
assert.match(read(pageOf("limits")), /capLines\(\)/, "caps live on Limits");
assert.match(read(pageOf("audit")), /FIRST = 25/, "the audit log starts with 25 lines");

// no link or redirect to the old anchors, and actions refresh the whole settings layout
const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []; });
const code = ["app", "dashboard", "ee", "core"].flatMap(walk);
for (const p of code) {
  const src = read(p);
  assert.doesNotMatch(src, /\/settings\?[^"`'\s]*#/, `${p} links to an old /settings anchor`);
  assert.doesNotMatch(src, /\/settings#/, `${p} links to an old /settings anchor`);
  assert.doesNotMatch(src, /revalidatePath\("\/settings"\)/, `${p} revalidates only /settings, not its sections`);
}

// one look for every dropdown: our chevron and room for it
const css = read("app/globals.css");
const rule = css.slice(css.indexOf("select.input:not([multiple]) {"));
assert.match(rule, /appearance: none/, "dropdowns drop the browser's arrow");
const pad = Number(rule.match(/padding-right: (\d+)px/)?.[1] ?? 0);
assert.ok(pad >= 36, "dropdowns leave room for the chevron");
assert.match(css, /:root\[data-theme="dark"\] select\.input:not\(\[multiple\]\)/, "the chevron has a dark version");
for (const p of [...walk(ROOT), ...walk("ee"), "dashboard/components/settingsForms.tsx", "dashboard/components/people.tsx"].filter((p) => p.endsWith(".tsx"))) {
  for (const m of read(p).matchAll(/<select\b[^>]*>/g)) assert.match(m[0], /className="input/, `${p}: every select uses the input look`);
}

// the playbook editor saves before it publishes
const card = read("ee/playbook-card.tsx");
assert.match(card, /name="then" value=\{published \? "unpublish" : "publish"\}/, "Publish sends then=publish with the edits");
assert.match(card, /formAction=\{playbookRemove\} formNoValidate/, "Delete needs no filled fields");

console.log("check:settings-sections ok");
