// The tabs on a department page and on Company stay on one line on a phone: `npm run check:tabs`.
// A department has five tabs (Chat, Agents, Goals, Chains, Approvals) but the phone bar was laid out for four,
// so Approvals wrapped to a second row, the dark ink stretched two rows tall and the taller bar covered the top
// of the page. Now each tab is an icon over a small label in as many equal columns as there are tabs (approved
// mockup, option C, 2026-11-25), the bar has one fixed height, and the panes start below it by reading the same
// numbers. On wide screens the tabs keep their words and the icons are hidden.
// 1. Source: both pages give every tab an icon, the phone grid takes its column count from the tabs, the old
//    four-column rules are gone, and the panes read the bar's height instead of a number of their own.
// 2. Layout: the real globals.css and the bar's markup, measured in Chromium at phone widths from 320 to 430px,
//    light and dark, with each tab open in turn: one row, every label whole, the counts inside the bar, the ink
//    one row tall, and the panes starting below the bar. Then a wide screen: words only, no icons.
//    Skipped, and said so, where Playwright isn't installed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const css = readFileSync("app/globals.css", "utf8");
const tabs = readFileSync("dashboard/components/deptTabs.tsx", "utf8");
const dept = readFileSync("app/(room)/dept/[id]/page.tsx", "utf8");
const company = readFileSync("app/(room)/page.tsx", "utf8");

assert.match(tabs, /icon: TabIcon/, "every tab has an icon (TabLink.icon is required)");
for (const k of ["overview", "chat", "agents", "goals", "chains", "approvals", "departments"]) assert.match(tabs, new RegExp(`^\\s*${k}: <`, "m"), `the ${k} tab has an icon drawn`);
assert.match(dept, /href: tabHref\(id, t\), icon: t,/, "the department page passes each tab's icon");
assert.match(company, /href: companyHref\(t\), icon: t,/, "the Company page passes each tab's icon");
assert.match(tabs, /"--n": tabs\.length/, "the bar tells the CSS how many tabs it has");
assert.match(css, /grid-template-columns: repeat\(var\(--n, 5\), minmax\(0, 1fr\)\)/, "the phone bar has one equal column per tab");
assert.ok(!/grid-template-columns: \.8fr 1fr \.95fr 1\.3fr/.test(css) && !/\.dp\.co \.dp-tabs \{ grid-template-columns/.test(css), "the old four-column rules are gone");
assert.match(css, /\.dp-scroll \{ padding: var\(--below-tabs\)/, "the panes start below the bar by reading its height");
assert.match(css, /\.dp-log \{ padding: calc\(var\(--below-tabs\)/, "the chat starts below the bar by reading its height");
assert.ok(!/\+ 11[24]px\)/.test(css), "no pane keeps its own guess of where the bar ends");

// just what we use, so the typecheck doesn't need Playwright installed
type Page = { setContent(html: string): Promise<void>; evaluate(js: string): Promise<unknown>; close(): Promise<void> };
type Chromium = { launch(): Promise<{ newPage(o: { viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void> }> };
let chromium: Chromium | undefined;
try { chromium = createRequire(`${process.cwd()}/package.json`)("playwright").chromium; } catch { /* not installed here */ }

const svg = '<svg class="ti" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>';
type T = { k: string; l: string; c?: number; red?: boolean };
const DEPT: T[] = [{ k: "overview", l: "Overview" }, { k: "agents", l: "Agents", c: 12 }, { k: "goals", l: "Goals", c: 3 }, { k: "chains", l: "Chains" }, { k: "approvals", l: "Approvals", c: 14, red: true }];
const CO: T[] = [{ k: "chat", l: "Chat" }, { k: "departments", l: "Departments", c: 9 }, { k: "goals", l: "Goals", c: 4 }, { k: "approvals", l: "Approvals", c: 14, red: true }];
const bar = (list: T[], open: string) => `<nav class="dp-tabs" style="--n:${list.length}"><span class="dp-ink" style="transition:none"></span>${list.map((t) =>
  `<a data-tab="${t.k}" class="${t.k === open ? "on" : ""}">${svg}<span class="tl">${t.l}</span>${t.c ? `<span class="c${t.red ? " red" : ""}">${t.c}</span>` : ""}</a>`).join("")}</nav>`;
// the page as the app draws it: .dp around the stage, the bar, and a pane that scrolls
const page = (list: T[], open: string, theme: string) => `<!doctype html><html data-theme="${theme}"><head><style>${css}</style>
  <style>body{font-family:"Plus Jakarta Sans",system-ui,sans-serif}</style></head><body>
  <div class="dp"><div class="dp-stage">${bar(list, open)}<div class="dp-pane"><div class="dp-scroll"><div id="first" style="height:40px">first card</div></div></div></div></div>
  <script>(() => { const el = document.querySelector('.dp-tabs a.on'), ink = document.querySelector('.dp-ink');
    ink.style.width = el.offsetWidth + 'px'; ink.style.transform = 'translateX(' + el.offsetLeft + 'px)'; })()</script></body></html>`;

async function measure() {
  if (!chromium) { console.log("check:tabs: Playwright not installed, layout part skipped"); return; }
  const browser = await chromium.launch();
  try {
    for (const [name, list] of [["department", DEPT], ["Company", CO]] as const) {
      for (const width of [320, 360, 375, 390, 430]) {
        for (const theme of ["light", "dark"]) {
          for (const t of list) {
            const tab = await browser.newPage({ viewport: { width, height: 700 } });
            await tab.setContent(page(list, t.k, theme));
            const m = await tab.evaluate(`(() => {
              const r = (el) => el.getBoundingClientRect().toJSON();
              const nav = document.querySelector(".dp-tabs");
              return { nav: r(nav), links: [...nav.querySelectorAll("a")].map((a) => ({ box: r(a), icon: r(a.querySelector(".ti")),
                  label: { w: a.querySelector(".tl").scrollWidth, cw: a.querySelector(".tl").clientWidth, box: r(a.querySelector(".tl")) },
                  count: a.querySelector(".c") ? r(a.querySelector(".c")) : null })),
                ink: r(document.querySelector(".dp-ink")), first: r(document.querySelector("#first")), docW: document.documentElement.scrollWidth, winW: innerWidth };
            })()`) as { nav: DOMRect; links: { box: DOMRect; icon: DOMRect; label: { w: number; cw: number; box: DOMRect }; count: DOMRect | null }[]; ink: DOMRect; first: DOMRect; docW: number; winW: number };
            const where = `${name} tabs at ${width}px, ${theme}, ${t.l} open`;
            const top = m.links[0].box.top;
            assert.ok(m.links.every((l) => Math.abs(l.box.top - top) < 0.5), `${where}: every tab is on one line`);
            assert.ok(m.links.every((l) => l.box.left >= m.nav.left - 0.5 && l.box.right <= m.nav.right + 0.5 && l.box.bottom <= m.nav.bottom + 0.5), `${where}: every tab is inside the bar`);
            for (const [i, l] of m.links.entries()) {
              assert.ok(l.label.w <= l.label.cw + 0.5, `${where}: "${list[i].l}" fits whole (${l.label.w} > ${l.label.cw})`);
              assert.ok(l.icon.width > 0 && l.icon.bottom <= l.label.box.top + 0.5, `${where}: "${list[i].l}" has its icon above its label`);
              if (l.count) assert.ok(l.count.top >= m.nav.top - 0.5 && l.count.right <= l.box.right + 0.5, `${where}: the ${list[i].l} count sits inside its tab`);
            }
            assert.ok(m.nav.height <= 60, `${where}: the bar is one row tall (${m.nav.height}px)`);
            assert.ok(m.ink.height <= 50 && m.ink.top >= m.nav.top, `${where}: the dark ink is one row tall`);
            const on = m.links[list.indexOf(t)].box;
            assert.ok(Math.abs(m.ink.left - on.left) < 1 && Math.abs(m.ink.width - on.width) < 1, `${where}: the ink sits on the open tab`);
            assert.ok(m.first.top >= m.nav.bottom + 4, `${where}: the page starts below the bar (${m.first.top} < ${m.nav.bottom})`);
            assert.ok(m.docW <= m.winW, `${where}: nothing scrolls sideways`);
            await tab.close();
          }
        }
      }
    }
    // wide screens keep the words: no icons
    const wide = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await wide.setContent(page(DEPT, "goals", "light"));
    const w = await wide.evaluate(`[...document.querySelectorAll(".dp-tabs .ti")].every((s) => getComputedStyle(s).display === "none")`);
    assert.equal(w, true, "on a wide screen the tabs are words only");
    await wide.close();
  } finally { await browser.close(); }
}

measure().then(() => console.log("check:tabs ok"), (e) => { console.error(e); process.exit(1); });
