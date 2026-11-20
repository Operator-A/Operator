// `npm run check:claude-choice` (card 162): how agents think, own Claude key or OPERATOR's hosted
// Claude on credits, and which option setup and Connections show. Pure: no database, no network.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CHOICE_WORDS, claudeOptions, claudeReady, inUse, pickedChoice, readChoice, type ClaudeState } from "../core/claude-choice-rules";
import { billingFor } from "../core/cost-rules";

const st = (s: Partial<ClaudeState>): ClaudeState => ({ edition: "cloud", ownKey: false, ownKeyPaused: false, hostedReady: false, ...s });

// the options: the open edition has no hosted Claude
assert.deepEqual(claudeOptions("open"), ["own"]);
assert.deepEqual(claudeOptions("cloud"), ["hosted", "own"], "the cloud recommends hosted first");

// a tap counts only for an option the edition offers
assert.equal(readChoice("cloud", "hosted"), "hosted");
assert.equal(readChoice("cloud", "own"), "own");
assert.equal(readChoice("open", "hosted"), null, "the open edition never shows hosted, whatever the query says");
assert.equal(readChoice("cloud", "https://evil.example"), null);
assert.equal(readChoice("cloud", ["hosted"]), null);
assert.equal(readChoice("cloud", undefined), null);

// the option shown open: the tap, else the one in use, else the first offered
assert.equal(pickedChoice(st({}), undefined), "hosted", "a new cloud business sees OPERATOR's Claude first");
assert.equal(pickedChoice(st({}), "own"), "own");
assert.equal(pickedChoice(st({ ownKey: true }), undefined), "own", "a saved key is what's in use");
assert.equal(pickedChoice(st({ ownKey: true }), "hosted"), "hosted", "the founder can still look at credits");
assert.equal(pickedChoice(st({ edition: "open" }), "hosted"), "own");
assert.equal(pickedChoice(st({ edition: "open" }), undefined), "own");

// ready: an own key that works, or hosted with credits on the cloud
assert.equal(claudeReady(st({})), false, "no key, no credits: Avery can't think yet");
assert.equal(claudeReady(st({ hostedReady: true })), true, "credits open the setup conversation");
assert.equal(claudeReady(st({ ownKey: true })), true);
assert.equal(claudeReady(st({ ownKey: true, ownKeyPaused: true, hostedReady: true })), false, "a paused key is never skipped for credits (runs use the key first)");
assert.equal(claudeReady(st({ edition: "open", hostedReady: true })), false, "the open edition never uses a hosted key");
assert.equal(claudeReady(st({ edition: "open", ownKey: true })), true);

// in use matches who pays (core/cost-rules.ts billingFor)
for (const s of [st({}), st({ hostedReady: true }), st({ ownKey: true }), st({ edition: "open", ownKey: true })]) {
  const u = inUse(s);
  if (u) assert.equal(billingFor({ ownKey: s.ownKey, edition: s.edition }), u === "own" ? "own_key" : "credits", `inUse agrees with billing for ${JSON.stringify(s)}`);
}
assert.equal(inUse(st({})), null);
assert.match(CHOICE_WORDS.hosted.line, /plus 20%/, "the price says the margin from CREDITS_MARGIN");

// the screens: setup and Connections read readiness from the rules, not only the own key
const start = readFileSync("app/start/page.tsx", "utf8");
assert.match(start, /const keyed = claudeReady\(claude\)/, "setup step 1 opens with either option");
assert.doesNotMatch(start, /First, Avery needs a Claude key/, "setup no longer demands a key");
assert.match(start, /inUse\(claude\) === "hosted" \? extensions\.HostedClaude : null/, "on OPERATOR's Claude, setup says what's free and what needs credits");
assert.match(start, /href="\/connections\?claude=own#claude"/, "the own-key option stays one tap away once setup is free");
assert.match(readFileSync("dashboard/data.ts", "utf8"), /h\.claude = h\.web = claudeReady\(await claudeState\(\)\)/, "health counts hosted Claude");
const choice = readFileSync("dashboard/components/claudeChoice.tsx", "utf8");
assert.match(choice, /extensions\.HostedClaude/, "the hosted option comes only from the slot");
assert.doesNotMatch(choice, /from ["']@\/ee|from ["']\.\.\/\.\.\/ee/, "core never imports ee");
// the hosted key never reaches a page: only a yes or no leaves core/extensions.ts
assert.match(readFileSync("core/extensions.ts", "utf8"), /return !!\(await pooledKey\(\)\)/);
assert.doesNotMatch(readFileSync("dashboard/claude.ts", "utf8"), /pooledKey/);

console.log("check:claude-choice ok");
