// Checks how a chat reply's light formatting is read (card 290, dashboard/chat-ui.ts), for Avery's chat on the
// Company page and every head's chat, and that the chat never sets raw HTML or makes reply text a link.
// No database, no network, no browser. Run: npm run check:chat-ui
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { inline, parseReply } from "../dashboard/chat-ui";

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
// and the chat never sets raw HTML, and reply text never becomes a link
for (const f of ["../dashboard/components/headChat.tsx", "../dashboard/components/chatReply.tsx"]) {
  const src = readFileSync(new URL(f, import.meta.url), "utf8");
  assert.ok(!src.includes("dangerouslySetInnerHTML"), `${f} never sets raw HTML`);
  assert.ok(!/href=\{[^}]*\.text/.test(src), `${f}: reply text never becomes a link`);
}
// the floating Avery panel is gone (slice 8): Avery's chat is on the Company page
assert.ok(!existsSync(new URL("../dashboard/components/avery.tsx", import.meta.url)), "the floating Avery panel is deleted");

console.log("check:chat-ui ok");
