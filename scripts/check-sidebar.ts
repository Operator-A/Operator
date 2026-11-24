// The desktop sidebar never spills out of its panel: `npm run check:sidebar`.
// On the Company and department pages the workspace is exactly the window's height, so a sidebar taller
// than the window (a short laptop, or many departments) used to run past its rounded panel and the app's
// frame, taking Settings and Sign out with it. Now the top places and the departments list scroll inside
// the panel and Settings stays pinned at its bottom (Sign out is in your initial's menu, slice 9; Status became the top of
// Activity, which scrolls with the rest, slice 12).
// On a phone the same sidebar is the menu (decided 2026-11-24, the approved mockup): the menu button at the left
// of the top bar slides it in from the left over a dimmed page; the old floating menu card is gone.
// 1. Source: the layout wraps the nav, departments and More in .side-scroll; Settings sits after it; the menu
//    button comes first in the top bar; one sidebar serves both widths.
// 2. Layout: the real globals.css, the sidebar's markup and 12 departments, measured in Chromium at
//    several desktop heights, on a full-height (Company) page and an ordinary page, and at phone sizes
//    closed (off screen, out of the tab order) and open. Skipped, and said so, where Playwright isn't installed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const layout = readFileSync("app/(room)/layout.tsx", "utf8");
const css = readFileSync("app/globals.css", "utf8");
const client = readFileSync("dashboard/components/client.tsx", "utf8");
const side = layout.slice(layout.indexOf("<SideMenu>"), layout.indexOf("</SideMenu>"));
assert.ok(side.length > 0, "the layout still has the desktop sidebar");
const scroll = side.indexOf('<div className="side-scroll">');
assert.ok(scroll > 0, "the sidebar wraps its scrolling part in .side-scroll");
assert.ok(side.indexOf("nav.map") > scroll && side.indexOf("{deptGroup}") > scroll, "the top places and departments are inside the scrolling part");
const pinned = side.indexOf('label="Settings"');
assert.ok(!side.includes('label="Status"') && !layout.includes('href="/status"'), "Status left the menu: it is the top of Activity (slice 12)");
assert.ok(side.indexOf("{moreList}") > side.indexOf("{deptGroup}") && side.indexOf("{moreList}") < pinned, "Activity and Connections sit under the departments, inside the scrolling part");
assert.ok(pinned > side.indexOf("{deptGroup}"), "Settings comes after the departments");
const phoneFoot = side.indexOf('<div className="side-me phone-only">');
assert.ok(phoneFoot > pinned, "the phone-only foot (who you are, light or dark, Sign out) comes after Settings");
assert.ok(!side.slice(0, phoneFoot).includes("<SignOutButton"), "on wide screens Sign out is in your initial's menu in the top bar (slice 9)");
// one menu: the phone menu is this sidebar, opened by the button at the left of the top bar
assert.ok(!/MobileMenu|sheet-group/.test(layout) && !/export function MobileMenu/.test(client), "the old floating phone menu is gone");
assert.ok(!/^\.sheet(-bg|-group)? /m.test(css), "its styles are gone too");
const top = layout.slice(layout.indexOf('<header className="topbar">'), layout.indexOf("</header>"));
assert.ok(top.indexOf("<MenuButton") > 0 && top.indexOf("<MenuButton") < top.indexOf('className="brand"'), "the menu button sits at the left of the top bar, before the brand");
assert.equal((layout.match(/<SideMenu>/g) ?? []).length, 1, "one sidebar for every width");
assert.ok(layout.indexOf("<MenuRoot>") < layout.indexOf("<header") && layout.indexOf("</MenuRoot>") > layout.indexOf("</SideMenu>"), "the button and the sidebar share one open state");
const between = side.slice(side.indexOf("{moreList}"), pinned);
assert.match(between, /<\/div>\s*<\/div>\s*$/m, "the scrolling part closes before Settings, so it is pinned outside it");
assert.doesNotMatch(side, /side-spacer/, "no spacer: the scrolling part takes the free space");
const rule = (sel: string) => css.match(new RegExp(`^\\${sel} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
assert.match(rule(".side"), /min-height: 0/, ".side can shrink to the workspace's height");
assert.match(rule(".side-scroll"), /flex: 1/, ".side-scroll takes the free space");
assert.match(rule(".side-scroll"), /min-height: 0/, ".side-scroll can shrink below its content");
assert.match(rule(".side-scroll"), /overflow-y: auto/, ".side-scroll scrolls");

// just what we use, so the typecheck doesn't need Playwright installed
type Page = { setContent(html: string): Promise<void>; evaluate(js: string): Promise<unknown>; close(): Promise<void> };
type Chromium = { launch(): Promise<{ newPage(o: { viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void> }> };
let chromium: Chromium | undefined;
try { chromium = createRequire(`${process.cwd()}/package.json`)("playwright").chromium; } catch { /* not installed here */ }

async function measure() {
  if (!chromium) { console.log("check:sidebar: Playwright not installed, layout part skipped"); return; }
  const item = (label: string) => `<a class="side-item"><svg width="17" height="17"></svg><span style="flex:1;min-width:0;white-space:nowrap">${label}</span></a>`;
  const depts = Array.from({ length: 12 }, (_, i) => `<a class="side-dept" style="--hue:#9AA4FF"><i class="hue"></i><span class="t">Department ${i + 1}<span class="sub">Lead · Head of it</span></span></a>`).join("");
  const sidebar = `<aside class="side">
      <div class="side-scroll">
        <div class="side-group">${["Company"].map(item).join("")}</div>
        <div class="side-group"><span class="side-h6">Departments</span>${depts}${item("Add a department")}</div>
        <div class="side-group"><span class="side-h6">More</span>${["Activity", "Connections"].map(item).join("")}</div>
      </div>
      <a class="side-item" id="last"><svg width="17" height="17"></svg><span style="flex:1;min-width:0;white-space:nowrap">Settings</span></a>
    </aside>`;
  const page = (full: boolean) => `<!doctype html><html><head><style>${css}</style></head><body>
    <div class="page"><div class="ws"><header class="topbar" style="height:64px"></header>
      <div class="body">${sidebar}<main class="main">${full ? '<div class="dp"></div>' : '<p>short page</p>'}</main></div>
    </div></div></body></html>`;
  const browser = await chromium.launch();
  try {
    for (const full of [true, false]) {
      for (const height of [560, 700, 800, 1100]) {
        const tab = await browser.newPage({ viewport: { width: 1280, height } });
        await tab.setContent(page(full));
        // a string, so the bundler's helpers don't leak into the page
        const m = await tab.evaluate(`(() => {
          const r = (el) => el.getBoundingClientRect().toJSON();
          const scroll = document.querySelector(".side-scroll");
          return { side: r(document.querySelector(".side")), ws: r(document.querySelector(".ws")), out: r(document.querySelector("#last")),
            scrolls: scroll.scrollHeight > scroll.clientHeight, docH: document.documentElement.scrollHeight, winH: innerHeight };
        })()`) as { side: DOMRect; ws: DOMRect; out: DOMRect; scrolls: boolean; docH: number; winH: number };
        const where = `${full ? "Company page" : "ordinary page"} at ${height}px`;
        assert.ok(m.out.bottom <= m.side.bottom + 0.5, `${where}: Settings is inside the sidebar panel (${m.out.bottom} > ${m.side.bottom})`);
        assert.ok(m.side.bottom <= m.ws.bottom + 0.5, `${where}: the sidebar panel is inside the app frame`);
        if (full) {
          assert.ok(m.docH <= m.winH + 1, `${where}: the page itself doesn't scroll (the header stays in view)`);
          assert.ok(m.out.bottom <= m.winH, `${where}: Settings is on screen`);
          if (height <= 800) assert.ok(m.scrolls, `${where}: the department list scrolls instead`);
        }
        await tab.close();
      }
    }
    // phones: the same sidebar, as a drawer from the left
    const phone = `<!doctype html><html><head><style>${css}</style><style>*{transition:none!important}</style></head><body>
      <div class="page"><div class="ws"><header class="topbar"><button class="round menu-btn" id="btn"></button><a class="brand">Brand</a><div class="top-right"></div></header>
        <div class="body"><div class="side-bg" id="bg"></div>${sidebar.replace("</aside>", '<div class="side-me phone-only"><div class="hp-who"><b>a@b.co</b>Owner</div><button class="side-item" id="out">Sign out</button></div></aside>')}
        <main class="main"><p>page</p></main></div></div></div></body></html>`;
    for (const [width, height] of [[390, 844], [360, 640], [700, 900]]) {
      const tab = await browser.newPage({ viewport: { width, height } });
      await tab.setContent(phone);
      const read = `(() => {
        const r = (el) => el.getBoundingClientRect().toJSON();
        const side = document.querySelector(".side"), bg = document.querySelector("#bg");
        return { side: r(side), vis: getComputedStyle(side).visibility, bgOn: getComputedStyle(bg).pointerEvents !== "none" && +getComputedStyle(bg).opacity > 0.5,
          bg: r(bg), btn: r(document.querySelector("#btn")), brand: r(document.querySelector(".brand")), out: r(document.querySelector("#out")),
          last: r(document.querySelector("#last")), winH: innerHeight, winW: innerWidth };
      })()`;
      type M = { side: DOMRect; vis: string; bgOn: boolean; bg: DOMRect; btn: DOMRect; brand: DOMRect; out: DOMRect; last: DOMRect; winH: number; winW: number };
      const shut = await tab.evaluate(read) as M;
      const where = `phone ${width}x${height}`;
      assert.ok(shut.btn.width > 0 && shut.btn.right <= shut.brand.left + 0.5, `${where}: the menu button shows, left of the brand`);
      assert.ok(shut.side.right <= 0, `${where}: closed, the sidebar is off screen to the left (${shut.side.right})`);
      assert.equal(shut.vis, "hidden", `${where}: closed, its links are out of the tab order`);
      assert.ok(!shut.bgOn, `${where}: closed, nothing dims the page`);
      await tab.evaluate(`document.querySelector(".side").classList.add("open"); document.querySelector("#bg").classList.add("open")`);
      const open = await tab.evaluate(read) as M;
      assert.ok(Math.abs(open.side.left) < 0.5 && Math.abs(open.side.top) < 0.5 && Math.abs(open.side.bottom - open.winH) < 0.5, `${where}: open, it runs the full height from the left edge`);
      assert.ok(open.side.width <= 300.5 && open.side.width <= open.winW * 0.84 + 0.5, `${where}: open, it leaves the page showing on the right (${open.side.width}px)`);
      assert.equal(open.vis, "visible", `${where}: open, it is visible`);
      assert.ok(open.bgOn && open.bg.width >= open.winW - 0.5 && open.bg.height >= open.winH - 0.5, `${where}: open, the page behind is dimmed and a tap there closes it`);
      assert.ok(open.last.bottom <= open.winH && open.out.bottom <= open.winH + 0.5 && open.out.top >= open.last.bottom - 0.5, `${where}: open, Settings and then Sign out are on screen at the bottom`);
      await tab.close();
    }
  } finally { await browser.close(); }
}

measure().then(() => console.log("check:sidebar ok"), (e) => { console.error(e); process.exit(1); });
