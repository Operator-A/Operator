// Checks Avery's chat panel (card 290, dashboard/chat-ui.ts): how a reply's light formatting is read,
// how wide the panel may be dragged, and that closing the phone sheet never changes the wide-screen panel.
// No database, no network, no browser. Run: npm run check:chat-ui
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { WIDTH, clampWidth, closeEffect, defaultWidth, inline, parseReply, storedWidth } from "../dashboard/chat-ui";

// plain text stays plain: one paragraph, its single line breaks kept
assert.deepEqual(parseReply("Sales is fine.\nNothing needs you."), [
  { kind: "p", lines: [[{ kind: "text", text: "Sales is fine." }], [{ kind: "text", text: "Nothing needs you." }]] },
]);
assert.equal(parseReply("One.\n\n\nTwo.").length, 2, "a blank line starts a new paragraph");
assert.deepEqual(parseReply("   \n\n"), [], "nothing to show");

// bold, italic and code inside a line
assert.deepEqual(inline("Rowan found **3 leads** and *one* is `hot`"), [
  { kind: "text", text: "Rowan found " }, { kind: "b", text: "3 leads" }, { kind: "text", text: " and " },
  { kind: "i", text: "one" }, { kind: "text", text: " is " }, { kind: "code", text: "hot" },
]);
assert.deepEqual(inline("__bold__ and _soft_"), [{ kind: "b", text: "bold" }, { kind: "text", text: " and " }, { kind: "i", text: "soft" }]);
assert.deepEqual(inline("snake_case_name stays"), [{ kind: "text", text: "snake_case_name stays" }], "underscores inside a word are not italic");
assert.deepEqual(inline("5 * 3 = 15"), [{ kind: "text", text: "5 * 3 = 15" }], "a lone star is just a star");
assert.deepEqual(inline("**not closed"), [{ kind: "text", text: "**not closed" }], "unmatched marks stay as typed");

// lists: bullets (-, *, •) and numbers, with the number the list starts at
const lists = parseReply("Today:\n- Approve **2** emails\n* Check Quinn\n• Read the brief\n\n3. Third\n4) Fourth");
assert.equal(lists[0].kind, "p");
assert.equal(lists[1].kind, "ul");
assert.equal(lists[1].kind === "ul" && lists[1].items.length, 3);
assert.deepEqual(lists[1].kind === "ul" && lists[1].items[0], [{ kind: "text", text: "Approve " }, { kind: "b", text: "2" }, { kind: "text", text: " emails" }]);
assert.ok(lists[2].kind === "ol" && lists[2].start === 3 && lists[2].items.length === 2);
// a list right under a line, no blank line between
assert.deepEqual(parseReply("Two things:\n1. One\n2. Two").map((b) => b.kind), ["p", "ol"]);
// an indented line carries on the item above it
const wrapped = parseReply("- First item\n  goes on here\n- Second");
assert.ok(wrapped[0].kind === "ul" && wrapped[0].items.length === 2);
assert.ok(wrapped[0].kind === "ul" && wrapped[0].items[0].map((p) => p.text).join("") === "First item goes on here");

// short headings
assert.deepEqual(parseReply("## This week\nAll good."), [
  { kind: "h", text: [{ kind: "text", text: "This week" }] },
  { kind: "p", lines: [[{ kind: "text", text: "All good." }]] },
]);

// never HTML and never a link: tags and URLs come back as plain text to draw as text
const risky = parseReply("<img src=x onerror=alert(1)> see [here](https://evil.example) or https://evil.example");
const flat = JSON.stringify(risky);
assert.ok(risky.every((b) => b.kind === "p"));
assert.ok(!/"kind":"(a|link|html)"/.test(flat), "no link or HTML kind exists");
assert.ok(flat.includes("<img src=x onerror=alert(1)>"), "the tag is text, kept as typed");
// and the panel never sets raw HTML
const panel = readFileSync(new URL("../dashboard/components/avery.tsx", import.meta.url), "utf8");
assert.ok(!panel.includes("dangerouslySetInnerHTML"), "the chat panel never sets raw HTML");
assert.ok(!/<a\s|href=\{[^}]*\.text/.test(panel.replace(/<Link href=\{`\/runs\/\$\{m\.runId\}`\}/g, "")), "reply text never becomes a link");

// the panel's width: between the minimum and the most this window allows (60% of it, at most 720)
assert.equal(clampWidth(100, 1600), WIDTH.min);
assert.equal(clampWidth(5000, 1600), WIDTH.max);
assert.equal(clampWidth(700, 1000), 600, "never over 60% of the window");
assert.equal(clampWidth(500, 400), WIDTH.min, "a tiny window still gets the minimum");
assert.equal(clampWidth(Number.NaN, 1600), WIDTH.def);
assert.equal(clampWidth(450.6, 1600), 451);
assert.equal(defaultWidth(1000), WIDTH.min, "narrower by default on a smaller screen");
assert.equal(defaultWidth(1440), WIDTH.def);
assert.equal(storedWidth(null, 1440), WIDTH.def);
assert.equal(storedWidth("abc", 1440), WIDTH.def);
assert.equal(storedWidth("540", 1440), 540);
assert.equal(storedWidth("900", 1000), 600, "a width saved on a big screen is cut down on a smaller one");

// closing: the phone sheet closes only itself and never changes what this browser remembers
assert.deepEqual(closeEffect(true, "/crew"), { sheet: "close", panel: "keep", remember: null });
assert.deepEqual(closeEffect(true, "/"), { sheet: "close", panel: "keep", remember: null });
// the wide-screen close is remembered, except on the Desk where the panel always starts open
assert.deepEqual(closeEffect(false, "/crew"), { sheet: "keep", panel: "close", remember: "closed" });
assert.deepEqual(closeEffect(false, "/"), { sheet: "keep", panel: "close", remember: null });

// the panel stays mounted so it can slide, and is inert while closed
assert.ok(/inert=\{!shown\}/.test(panel), "the closed panel is inert");
assert.ok(!/\(open \|\| sheet\) && \(/.test(panel), "the panel is no longer mounted only while open");
assert.ok(!panel.includes('maxHeight: "45%"'), "the old scrolling draft box is gone");

console.log("check:chat-ui ok");
