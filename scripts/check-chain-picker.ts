// The Add a step picker on a chain reads properly on a phone: `npm run check:chain-picker`.
// On screens up to 860px a rule meant for the step cards (`.ch-ico { grid-row: span 1 }`) also hit the picker's
// rows, so the line under each name ("Runs in OPERATOR · Claude Sonnet 5.5") dropped into the 30px icon column
// and wrapped one word per line. Now that rule is scoped to step cards, picker rows place their icon and words by
// hand, the picker spans the chain lane on a phone, and in dark mode it has an edge and a shadow you can see.
// 1. Source: the phone icon rule is scoped to `.ch-st`, and the picker rows pin icon to column 1, words to column 2.
// 2. Layout: the real globals.css and the picker's markup, measured in Chromium at phone widths from 320 to 430px,
//    light and dark: every row's name and line sit to the right of its icon, each line wraps to at most three lines,
//    the picker stays inside the screen, nothing scrolls sideways, and step cards still put their icon on one row.
//    Then a wide screen: the picker keeps its 340px width with the same row layout.
//    Skipped, and said so, where Playwright isn't installed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const css = readFileSync("app/globals.css", "utf8");
const chains = readFileSync("dashboard/components/chains.tsx", "utf8");

assert.ok(!/^\s+\.ch-ico \{ width: 30px; height: 30px; grid-row: span 1; \}/m.test(css), "the phone icon rule no longer hits every .ch-ico");
assert.match(css, /\.ch-st \.ch-ico \{ width: 30px; height: 30px; grid-row: span 1; \}/, "the phone icon rule is scoped to step cards");
assert.match(css, /\.ch-po > \.ch-ico \{ grid-column: 1; grid-row: 1 \/ span 2; \}/, "picker icons sit in column 1 across both lines");
assert.match(css, /\.ch-po > b, \.ch-po > small \{ grid-column: 2; min-width: 0; \}/, "picker names and lines sit in column 2");
assert.match(chains, /className="ch-pick" role="menu"/, "the picker is still .ch-pick");

type Page = { setContent(html: string): Promise<void>; evaluate(js: string): Promise<unknown>; close(): Promise<void> };
type Chromium = { launch(): Promise<{ newPage(o: { viewport: { width: number; height: number } }): Promise<Page>; close(): Promise<void> }> };
let chromium: Chromium | undefined;
try { chromium = createRequire(`${process.cwd()}/package.json`)("playwright").chromium; } catch { /* not installed here */ }

const row = (ico: string, cls: string, name: string, line: string, tag = "button") =>
  `<${tag} class="ch-po"><span class="ch-ico ${cls}">${ico}</span><b>${name}</b><small>${line}</small></${tag}>`;
const picker = `<div class="ch-pick" role="menu"><div class="ch-pgrp">An agent</div>
  ${row("Q", "k-agent", "Quinn", "Runs in OPERATOR · Claude Sonnet 5.5")}
  ${row("M", "k-agent", 'Morgan<span class="ch-off">off duty</span>', "Runs in OPERATOR · Claude Sonnet 5.5")}
  ${row("✦", "k-claude", "Sage", "Runs as its Claude routine")}
  ${row("+", "k-agent", "A new agent for this step", "Opens the New agent sheet. Save this chain first, then add it here.", "a")}
  <div class="ch-pgrp">A quick step</div>
  ${row("AI", "k-model", "Ask a model", "Claude, OpenAI, Gemini or Grok. One instruction, text back, no tools")}
  ${row("✓", "k-ok", "Wait for my OK", "A card in Approvals with the step before’s result; the chain goes on when you approve")}
  ${row("▣", "k-image", "Make an image", "Needs the AI Gateway key on Connections")}</div>`;
// the chain editor as the app draws it: a lane of step cards with the + link between them
const page = (theme: string) => `<!doctype html><html data-theme="${theme}"><head><style>${css}</style>
  <style>body{margin:0;font-family:"Plus Jakarta Sans",system-ui,sans-serif}</style></head><body>
  <div class="ch-board"><div class="ch-ed"><div class="ch-lane">
    <div class="ch-stwrap"><div class="ch-st" id="step"><span class="ch-ico k-agent">M</span><button class="ch-stb"><b>Morgan</b><small>CFO</small></button><span class="ch-badge">$0.20</span></div></div>
    <div class="ch-link"><button class="ch-add" aria-expanded="true">+</button>${picker}</div>
  </div></div></div></body></html>`;

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number };
type M = { pick: Box; rows: { ico: Box; name: Box; line: Box; lh: number }[]; step: { ico: Box; title: Box }; docW: number; winW: number };
const read = `(() => {
  const r = (el) => el.getBoundingClientRect().toJSON();
  const step = document.querySelector("#step");
  return { pick: r(document.querySelector(".ch-pick")),
    rows: [...document.querySelectorAll(".ch-po")].map((p) => { const s = p.querySelector("small");
      return { ico: r(p.querySelector(".ch-ico")), name: r(p.querySelector("b")), line: r(s), lh: parseFloat(getComputedStyle(s).lineHeight) }; }),
    step: { ico: r(step.querySelector(".ch-ico")), title: r(step.querySelector(".ch-stb")) },
    docW: document.documentElement.scrollWidth, winW: innerWidth };
})()`;

function rowsOk(m: M, where: string) {
  for (const [i, x] of m.rows.entries()) {
    assert.ok(x.name.left >= x.ico.right + 4, `${where}: row ${i + 1} name sits right of its icon`);
    assert.ok(x.line.left >= x.ico.right + 4, `${where}: row ${i + 1} line sits right of its icon, not under it (${x.line.left} < ${x.ico.right})`);
    assert.ok(x.line.top >= x.name.bottom - 0.5, `${where}: row ${i + 1} line sits under its name`);
    assert.ok(x.line.width >= 150, `${where}: row ${i + 1} line has room (${x.line.width}px wide)`);
    assert.ok(x.line.height <= x.lh * 3 + 1, `${where}: row ${i + 1} line wraps to at most three lines (${x.line.height}px)`);
  }
}

async function measure() {
  if (!chromium) { console.log("check:chain-picker: Playwright not installed, layout part skipped"); return; }
  const browser = await chromium.launch();
  try {
    for (const width of [320, 360, 375, 390, 430]) {
      for (const theme of ["light", "dark"]) {
        const tab = await browser.newPage({ viewport: { width, height: 800 } });
        await tab.setContent(page(theme));
        const m = await tab.evaluate(read) as M;
        const where = `picker at ${width}px, ${theme}`;
        rowsOk(m, where);
        assert.ok(m.pick.left >= 0 && m.pick.right <= width + 0.5, `${where}: the picker stays inside the screen`);
        assert.ok(m.docW <= m.winW, `${where}: nothing scrolls sideways`);
        assert.ok(m.step.ico.width === 30 && m.step.title.left >= m.step.ico.right, `${where}: step cards keep their small icon beside the title`);
        if (theme === "dark") {
          const sh = await tab.evaluate(`getComputedStyle(document.querySelector(".ch-pick")).boxShadow`) as string;
          assert.match(sh, /rgba\(0, 0, 0, 0\.75\)/, `${where}: the picker has a shadow you can see on dark`);
        }
        await tab.close();
      }
    }
    const wide = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await wide.setContent(page("light"));
    const w = await wide.evaluate(read) as M;
    rowsOk(w, "picker at 1280px");
    assert.ok(Math.abs(w.pick.width - 340) < 1, `on a wide screen the picker stays 340px (${w.pick.width})`);
    await wide.close();
  } finally { await browser.close(); }
}

measure().then(() => console.log("check:chain-picker ok"), (e) => { console.error(e); process.exit(1); });
