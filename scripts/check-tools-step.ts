// First-run setup, step 2 (card 152, docs/setup.md): `npm run check:tools-step`. No database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_SERVERS } from "../core/mcp-rules";
import { DEPT_PACKS } from "../core/packs";
import { TOOLS } from "../core/tools/catalog";
import { readAsked, readSetupState, setupDirective, toolLines, FACT_TOPICS, NOTHING_CONNECTS } from "../core/setup-rules";
import { SNAPSHOT_MAX, SNAPSHOT_TILES, bankFacts, capSnapshot, emailFacts, hasSnapshot, siteFacts, storeFacts } from "../core/snapshot-rules";
import { waitLine } from "../core/company-rules";
import { CATEGORY_IDS, NEED_TILE, SCOPE_WORDS, TOOL_CATEGORIES, TOOL_TILES, MAX_LISTED, answerFact, partWords, backTarget, cardCategory, categoryOfTile, categoryState, followUps, listedTool, partsShown, planKinds, planNotes, readPlans, readSkipped, tileOfMcp, type Plans, type ToolTileId, neededBy, permissionsOf, routeUnlisted, tilesFor, waitingOn, type TemplateTools } from "../core/tools-step-rules";

const read = (f: string) => readFileSync(f, "utf8");
const needsOf = (id: string): readonly string[] => (TOOLS as Record<string, { needs?: readonly string[] }>)[id]?.needs ?? [];
const tpl = (id: string): TemplateTools => {
  const t = DEPT_PACKS.find((x) => x.id === id)!;
  return { id, name: t.name, tools: Object.values((t.specs ?? {}) as Record<string, { tools?: string[] }>).flatMap((s) => s.tools ?? []) };
};

// every tile that connects has a profile, steps, and words for every permission it asks for
for (const t of TOOL_TILES) {
  if (!t.mcp) { assert.equal(t.steps.length, 0, `${t.id}: a tile that isn't built has no steps yet`); continue; }
  assert.ok(MCP_SERVERS[t.mcp], `${t.id}: its sign-in is a profile in core/mcp-rules.ts`);
  assert.ok(MCP_SERVERS[t.mcp].readTools.length > 0, `${t.id}: the tile connects a sign-in agents read with, not a gateway-only one`);
  assert.ok(t.steps.length >= 3, `${t.id}: click-by-click steps`);
  for (const p of permissionsOf(t)) assert.notEqual(p.words, p.scope, `${t.id}: "${p.scope}" has words in SCOPE_WORDS`);
  if (t.also) assert.ok(MCP_SERVERS[t.also.mcp], `${t.id}: its second sign-in is a profile`);
}
assert.equal(TOOL_TILES.find((t) => t.id === "analytics")?.mcp, "ga4", "Google Analytics connects our own read-only server (card 152b)");
assert.ok(Object.keys(SCOPE_WORDS).length >= 9);

// every *_CONNECTED a tool needs is a tile, so no department's need is missed
const needs = new Set(Object.values(TOOLS as Record<string, { needs?: readonly string[] }>).flatMap((t) => t.needs ?? []).filter((n) => n.endsWith("_CONNECTED")));
for (const n of needs) if (n !== "NOTION_CONNECTED") assert.ok(NEED_TILE[n], `${n} maps to a tile`);
assert.ok(needs.has("ANALYTICS_CONNECTED"), "the Analytics tools need the Analytics sign-in");

// which tiles each department needs comes from its tools
assert.deepEqual(tilesFor(tpl("finance"), needsOf), ["shopify", "mercury"]);
assert.deepEqual(tilesFor(tpl("email-marketing"), needsOf), ["shopify", "klaviyo"], "the Campaign writer reads Product facts");
assert.deepEqual(tilesFor(tpl("store-analytics"), needsOf), ["analytics"], "Week over week reads saved numbers; the visits need Google Analytics");
assert.deepEqual(tilesFor(tpl("prospecting"), needsOf), ["shopify", "gmail"]);
assert.deepEqual(neededBy([tpl("finance"), tpl("email-marketing")], needsOf), { shopify: ["Finance", "Email marketing"], mercury: ["Finance"], klaviyo: ["Email marketing"] });
assert.deepEqual(waitingOn(tpl("finance"), needsOf, new Set(["shopify"])), ["mercury"]);
assert.deepEqual(waitingOn(tpl("email-marketing"), needsOf, new Set(["klaviyo"])), ["shopify"], "the Campaign writer still waits on Shopify");

// Connect from setup comes back to setup; nothing else is a place
assert.equal(backTarget("start", "mercury"), "/start?c=mercury", "back to the question the tool answers");
assert.equal(backTarget("start", "gmail_read"), "/start?c=gmail");
assert.equal(backTarget("start", "gmail"), "/start?c=gmail", "the drafts sign-in belongs to the Gmail tile");
assert.equal(backTarget("start", "ga4"), "/start?c=analytics");
assert.equal(backTarget("start", "notion"), "/start", "a sign-in with no tile comes back to setup's saved step");
assert.equal(backTarget("https://evil.example", "mercury"), "/connections?c=mercury");
assert.equal(backTarget("//evil.example", "klaviyo"), "/connections?c=klaviyo");
assert.equal(backTarget(null, "klaviyo"), "/connections?c=klaviyo");
const connect = read("app/(room)/connections/[id]/connect/route.ts");
assert.match(connect, /searchParams\.get\("from"\) === "start"/, "the connect route takes from=start only");
assert.match(read("app/(room)/connections/[id]/callback/route.ts"), /req\.cookies\.get\(BACK_COOKIE\)\?\.value === "start"/, "the callback trusts only its own cookie");

// the parts of a business a tool runs, asked inside Avery's interview (card 195)
{
  const built = TOOL_TILES.filter((t) => t.mcp).map((t) => t.id);
  for (const id of built) assert.equal(TOOL_CATEGORIES.filter((c) => c.tiles.includes(id)).length, 1, `${id} answers exactly one part`);
  assert.deepEqual(TOOL_CATEGORIES.map((c) => c.id), [...CATEGORY_IDS]);
  assert.equal(CATEGORY_IDS.length, 14, "8 core parts and 6 that fit only some businesses");
  assert.deepEqual(TOOL_CATEGORIES.filter((c) => c.core).map((c) => c.id), ["store", "payments", "money", "books", "list", "inbox", "site", "leads"]);
  for (const c of TOOL_CATEGORIES) {
    assert.ok(c.question.endsWith("?") && c.value && c.ready && c.area && c.learns, `${c.id}: a question, what it gets you, what Avery learns, the line once connected`);
    assert.ok(c.value.length <= 110, `${c.id}: value in few words`);
    assert.ok((FACT_TOPICS as readonly string[]).includes(c.topic), `${c.id}: its answer is saved under a fact topic`);
    assert.ok(c.tools.length >= 2 && c.tools.length <= MAX_LISTED, `${c.id}: two to ${MAX_LISTED} common tools`);
    assert.equal(new Set(c.tools.map((t) => t.name)).size, c.tools.length, `${c.id}: each tool once`);
    const firstUnbuilt = c.tools.findIndex((t) => !t.tile);
    assert.ok(c.tools.slice(firstUnbuilt < 0 ? c.tools.length : firstUnbuilt).every((t) => !t.tile), `${c.id}: the tools that connect come first`);
    assert.deepEqual([...c.tiles], c.tools.flatMap((t) => (t.tile ? [t.tile] : [])), `${c.id}: tiles come from its own list`);
    for (const t of c.tiles) assert.ok(TOOL_TILES.some((x) => x.id === t && x.mcp), `${c.id}: ${t} is a built tile`);
    assert.ok(answerFact(c, c.tools[0].name).length <= 160 && answerFact(c, null).endsWith(": none yet"), `${c.id}: the answer fits one fact`);
  }
  assert.equal(categoryOfTile("mercury"), "money");
  assert.equal(categoryOfTile("nope"), null);
  assert.equal(tileOfMcp("gmail"), "gmail");
  assert.equal(tileOfMcp("mercury_write"), null, "a gateway-only sign-in is no tile");
  // a picked tool must be on the part's own card, by its exact name
  assert.deepEqual(listedTool("bookings", "Calendly"), { name: "Calendly" });
  assert.deepEqual(listedTool("store", "Shopify"), { name: "Shopify", tile: "shopify" });
  assert.equal(listedTool("bookings", "Shopify"), null, "a tool from another part's card is refused");
  assert.equal(listedTool("store", "https://evil.example"), null);
  assert.equal(listedTool("store", undefined), null);
  // skipped: only real parts, each once; asked: only real parts, the latest ask last
  assert.deepEqual(readSkipped(["inbox", "nope", "inbox", "store", 3]), ["store", "inbox"]);
  assert.deepEqual(readSkipped("store"), []);
  assert.deepEqual(readSetupState({ skipped: ["site", "x"] }, []).skipped, ["site"]);
  assert.deepEqual(readAsked(["bookings", "nope", "store", "bookings", 4]), ["store", "bookings"], "asking again moves a part to the end");
  assert.deepEqual(readAsked("store"), []);
  assert.deepEqual(readSetupState({ asked: ["ads", "x"] }, []).asked, ["ads"]);
  // the card in the chat: the tapped part, else Avery's last ask while it is still open
  const card = (tapped: unknown, asking: string | null, connected: ToolTileId[] = [], skipped: string[] = [], plans: Plans = {}) =>
    cardCategory(tapped, asking as never, new Set(connected), readSkipped(skipped), plans)?.id ?? null;
  assert.equal(card(undefined, null), null, "no card until Avery asks");
  assert.equal(card(undefined, "bookings"), "bookings");
  assert.equal(card(undefined, "store", ["shopify"]), null, "an answered ask closes its card");
  assert.equal(card(undefined, "store", [], ["store"]), null, "so does a skip");
  assert.equal(card(undefined, "bookings", [], [], { bookings: { kind: "uses", tool: "Calendly" } }), null, "and an answer");
  assert.equal(card("store", null, ["shopify"]), "store", "a tapped part shows even when answered");
  assert.equal(card("nope", "ads"), "ads", "an unknown tap is ignored");
  // Your tools: core parts from the start, the others once asked or answered
  const shown = (asked: string[], plans: Plans = {}) => partsShown(new Set(), [], plans, readAsked(asked)).map((p) => p.c.id);
  assert.deepEqual(shown([]), TOOL_CATEGORIES.filter((c) => c.core).map((c) => c.id));
  assert.ok(shown(["bookings"]).includes("bookings") && !shown(["bookings"]).includes("shipping"), "a part that fits only some businesses shows once asked");
  assert.ok(shown([], { ads: { kind: "none" } }).includes("ads"), "or once answered");
  assert.equal(categoryState(TOOL_CATEGORIES[0], new Set(["shopify"] as const), ["store"]), "connected", "connected wins over skipped");
  // Avery names a part only; its state comes from code, and the tools come from the list
  const lines = toolLines([{ id: "store", state: "connected" }, { id: "bookings", state: "open" }]);
  assert.match(lines, /- store \(an online store or shop software where customers order\): connected/);
  assert.match(lines, new RegExp(`- bookings \\(appointments and online booking, only if it fits, ${NOTHING_CONNECTS}\\): open`), "a part where nothing connects says so (card 196)");
  assert.ok(!toolLines([]).includes(`customers order, ${NOTHING_CONNECTS}`), "a part with a tile that connects doesn't");
  for (const c of TOOL_CATEGORIES) assert.equal(toolLines([]).includes(`- ${c.id} (${c.covers}${c.core ? "" : ", only if it fits"}, ${NOTHING_CONNECTS})`), c.tiles.length === 0, `${c.id}: marked exactly when no tool connects`);
  // card 206: Avery picks a card by what each part covers; the register at the counter is payments
  for (const c of TOOL_CATEGORIES) assert.ok(c.covers.length > 8 && c.covers.length <= 100 && !/https?:/.test(c.covers), `${c.id}: says what it covers`);
  const pay = TOOL_CATEGORIES.find((c) => c.id === "payments")!, store = TOOL_CATEGORIES.find((c) => c.id === "store")!;
  assert.match(pay.covers, /register or card reader/);
  assert.ok(pay.tools.some((t) => t.name === "Square") && pay.tools.some((t) => t.name === "Clover") && pay.tools.length <= MAX_LISTED);
  assert.match(store.covers, /online/);
  assert.equal(partWords(pay), `payments (${pay.covers})`);
  const setupSrc = readFileSync("core/setup.ts", "utf8");
  assert.match(setupSrc, /description: TOOL_CATEGORIES\.map\(partWords\)/, "Ask about a tool lists each part by what it covers");
  assert.match(setupSrc, /rings up sales in person \(a register or card reader\) is payments, not store/);
  assert.match(readFileSync("core/brain-tools.ts", "utf8"), /TOOL_CATEGORIES\.map\(partWords\)/);
  assert.ok(toolLines([]).includes(`- payments (${pay.covers})`), "the directive reads the same words");
  assert.ok(!/Shopify|Calendly|https?:/.test(lines), "the directive lists parts, never tools or links");
  const dir = setupDirective("Avery", [], []);
  assert.match(dir, /call Ask about a tool with that part's id/);
  assert.match(dir, /Never name a tool, a link or a sign-in step yourself: the card does that/);
  assert.match(dir, /Never ask which tool they use in words alone: call Ask about a tool/, "card 196: a tool question always comes with its card");
  assert.match(dir, /If the founder already named the tool for an open part, still call it/);
  assert.match(dir, /Say the card connects a tool only for a part that has one/);
  assert.match(dir, /it does once the founder names it \(Instagram means social/);
  assert.ok(!dir.includes("that is advice only"), "the old line that sent tools to a later step is gone");
  const setup = read("core/setup.ts");
  assert.match(setup, /function askToolTool[\s\S]{0,900}if \(rows\.length\) return \{ problem: "one card per reply" \}[\s\S]{0,200}if \(!open\.has\(cat\)\) return \{ problem: "that part already has an answer" \}/, "one card per reply, and only an open part");
  assert.match(setup, /options: \[\.\.\.CATEGORY_IDS\]/, "ask_tool takes a part id from the list, nothing else");
  assert.match(setup, /if \(heldAsk\.cat\) \{ const now = await setupState\(\); await saveSetupState/, "the ask is kept only after a run that finished");
  assert.match(setup, /export async function answerCategory[\s\S]{0,500}listedTool\(cat, tool\)[\s\S]{0,120}throw new Error/, "an answer is checked against the part's own list");
  const acts = read("dashboard/setupActions.ts");
  assert.match(acts, /planCategory\(cat, \{ kind: "uses", tool: r\.name \}\)/, "a typed tool we don't connect is saved like a listed one (card 196)");
  assert.doesNotMatch(acts, /kind: "export"/, "no new answer is saved as an export plan");
  assert.match(read("app/globals.css"), /\.wg \{[^}]*overflow: clip;/, "card 196: the setup page clips, so a tap never scrolls it sideways and the steps bar can stick");
  assert.doesNotMatch(read("app/start/page.tsx"), /"From an export"/, "the panel has one word for a tool we don't connect");
  assert.match(acts, /export async function setupAnswerTool[\s\S]{0,200}asRole\("owner"\)[\s\S]{0,80}isCategory\(cat\)/, "answering checks the role, then the part");
  assert.doesNotMatch(acts.slice(acts.indexOf("export async function setupAnswerTool"), acts.indexOf("export async function setupPlanClear")), /askSetup|runExplore/, "no model call");
  assert.match(acts, /export async function setupSkipTool[\s\S]{0,140}asRole\("approver"\)[\s\S]{0,80}isCategory\(cat\)/, "skipping checks the role, then the part");
  assert.match(acts, /connectedTiles\(await getHealth\(\)\)[\s\S]{0,120}askSetup\(m\.text, site, connected\)/, "Avery is told which parts are connected");
  const page = read("app/start/page.tsx");
  assert.ok(!page.includes('state.stage === "tools"') && !page.includes("PartBox"), "the separate tools step is gone");
  assert.match(page, /const tapped = isCategory\(sp\.q\) \? sp\.q : categoryOfTile\(sp\.c\)/, "the page only takes a part from the list");
  assert.match(page, /c\.tools\.map\(\(t\) => \(\s*<ActionButton key=\{t\.name\} className="wg-tool" action=\{setupAnswerTool\.bind\(null, c\.id, t\.name\)\}/, "the card's tools come from the list in code");
  assert.match(read("dashboard/components/setup.tsx"), /\{!busy && card\}/, "the card sits under the last message");
}

// the snapshot once a tool connects (card 195 slice B): numbers in code, never the tool's own text
{
  const sh = storeFacts([{ total: 100, repeat: true }, { total: 50.5, repeat: false }, { total: 49.5, repeat: false }, { total: Number.NaN, repeat: true }], 3);
  assert.deepEqual(sh.map((f) => f.topic), ["sells", "customers", "other"]);
  assert.equal(sh[0].text, "From Shopify: 3 orders and $200 in the last 30 days, $67 on average", "a bad total is left out, sums in code");
  assert.equal(sh[1].text, "From Shopify: 33% of those orders came from repeat customers");
  assert.equal(sh[2].text, "From Shopify: 3 orders waiting to ship");
  assert.deepEqual(storeFacts([], 0), [{ topic: "sells", text: "From Shopify: no orders in the last 30 days" }]);
  assert.equal(storeFacts([{ total: 10, repeat: false }], 0).length, 2, "nothing to ship, no line");
  const bank = bankFacts({ cash_usd: 41250.4, spend_per_30d_usd: 12000, income_per_30d_usd: 9000, runway_months: 13.7 });
  assert.deepEqual(bank.map((f) => f.text), ["From Mercury: $41,250 cash across the business accounts", "From Mercury: about $12,000 goes out and $9,000 comes in a month", "From Mercury: about 13 months of runway at that rate"]);
  assert.equal(bankFacts({ cash_usd: 100, runway_months: 0.4 })[1].text, "From Mercury: less than a month of runway at that rate");
  assert.deepEqual(bankFacts({}), [], "no numbers, no facts");
  const mail = emailFacts(3, { messages: 4, open_rate_pct: 41.2, click_rate_pct: 2.8, orders: 12, revenue_usd: 980 });
  assert.deepEqual(mail.map((f) => f.text), ["From Klaviyo: 3 email lists", "From Klaviyo: 4 campaigns sent in the last 30 days, 41% opened, 3% clicked", "From Klaviyo: those campaigns brought in 12 orders and $980"]);
  assert.equal(emailFacts(1, { messages: 0 })[1].text, "From Klaviyo: no campaigns sent in the last 30 days");
  assert.equal(emailFacts(1, { messages: 0 })[0].text, "From Klaviyo: 1 email list", "one, not ones");
  const site = siteFacts({ sessions: 2100, users: 1500, key_events: 63, key_events_per_100_sessions: 3 });
  assert.deepEqual(site.map((f) => f.text), ["From Google Analytics: 2,100 visits from 1,500 people in the last 30 days", "From Google Analytics: 63 key events (sales, sign-ups and the like), 3 per 100 visits"]);
  assert.deepEqual(siteFacts({}), []);
  for (const f of [...sh, ...bank, ...mail, ...site]) assert.ok(f.text.length <= 160 && (FACT_TOPICS as readonly string[]).includes(f.topic), "each fits one fact");
  assert.equal(capSnapshot(Array.from({ length: 9 }, () => ({ topic: "other" as const, text: "x".repeat(300) }))).length, SNAPSHOT_MAX);
  assert.ok(capSnapshot([{ topic: "other", text: "x".repeat(300) }])[0].text.length === 160);
  assert.deepEqual([...SNAPSHOT_TILES], ["shopify", "mercury", "klaviyo", "analytics"], "every built tile but Gmail");
  assert.ok(!hasSnapshot("gmail") && hasSnapshot("mercury"));
  const rules = read("core/snapshot-rules.ts");
  assert.doesNotMatch(rules, /: string\b[^)]*\)\s*:\s*SnapshotFact/, "no formatter takes free text from a tool");
  const setup = read("core/setup.ts");
  const snap = setup.slice(setup.indexOf("export async function takeSnapshot"), setup.indexOf("/** The first job started"));
  assert.match(snap, /withRun\(SETUP_AGENT, "setup"/, "a snapshot is a logged run");
  assert.doesNotMatch(snap, /runExplore|askSetup|anthropic/i, "no model call");
  assert.match(snap, /x\.source === "owner" && x\.text\.startsWith\(prefix\)/, "a new snapshot replaces the tool's last one");
  const acts = read("dashboard/setupActions.ts");
  assert.match(acts, /export async function setupSnapshot[\s\S]{0,140}asRole\("owner"\)[\s\S]{0,80}hasSnapshot\(tile\)[\s\S]{0,300}connectedTiles\(await getHealth\(\)\)\)\.has\(tile\)/, "only an owner, only a connected tile with a snapshot");
  assert.match(read("core/setup-rules.ts"), /facts that start "From <tool>:"/, "Avery is told those facts are the founder's own data");
}

// no tool yet, or one we don't connect (card 183)
{
  const starters = TOOL_CATEGORIES.filter((c) => c.starter);
  assert.deepEqual(starters.map((c) => c.id), ["list", "site"], "a starter where we have a default tool");
  for (const c of starters) {
    assert.ok(c.tiles.includes(c.starter!.tile), `${c.id}: the starter is one of the part's own tools`);
    assert.ok(c.starter!.steps.length >= 4 && c.starter!.steps.at(-1)!.includes(`Connect ${c.starter!.name}`), `${c.id}: steps end at the normal connect`);
    assert.match(c.starter!.steps.join(" "), /accept them yourself/, `${c.id}: the founder accepts the service's terms, no agent does`);
  }
  // stored plans: only real parts, a guide only where there is a starter, a checked tool name
  assert.deepEqual(readPlans({ list: { kind: "guide" }, money: { kind: "guide" }, nope: { kind: "guide" }, inbox: { kind: "export", tool: "  Outlook " }, store: { kind: "export", tool: "https://evil.example" }, site: { kind: "other" } }),
    { list: { kind: "guide" }, inbox: { kind: "export", tool: "Outlook" } });
  // card 195: a listed tool that doesn't connect yet, or none; card 196: or one the founder typed, never one that connects
  assert.deepEqual(readPlans({ bookings: { kind: "uses", tool: "Calendly" }, ads: { kind: "none" }, store: { kind: "uses", tool: "Shopify" }, books: { kind: "uses", tool: "  Made Up " }, leads: { kind: "uses", tool: "https://evil.example" } }),
    { bookings: { kind: "uses", tool: "Calendly" }, ads: { kind: "none" }, books: { kind: "uses", tool: "Made Up" } }, "uses names a tool that doesn't connect here, checked");
  // card 196: a tool we don't connect means that part's work starts from an export, picked or typed alike
  assert.deepEqual(planKinds({ money: { kind: "uses", tool: "Chase" }, bookings: { kind: "uses", tool: "Calendly" } }), { Mercury: "export" });
  assert.deepEqual(planKinds({ money: { kind: "uses", tool: "Chase" } }), planKinds({ money: { kind: "export", tool: "Chase" } }), "the old export plan reads the same");
  assert.match(planNotes({ money: { kind: "uses", tool: "Capital One" }, list: { kind: "none" } }).Mercury, /^Starts from an export of Capital One/);
  assert.deepEqual(followUps({ money: { kind: "uses", tool: "Chase" }, bookings: { kind: "uses", tool: "Calendly" }, list: { kind: "none" } }, new Set(), new Set()).map((f) => [f.cat, f.kind]), [["money", "export"]], "a Desk follow-up only where a tool would connect");
  assert.deepEqual(planNotes({ list: { kind: "none" } }), {}, "none adds no wait note");
  assert.deepEqual(readPlans(["list"]), {});
  assert.deepEqual(readPlans(null), {});
  assert.deepEqual(readSetupState({ plans: { list: { kind: "guide" }, x: 1 } }, []).plans, { list: { kind: "guide" } }, "the saved state keeps its plans");
  // state: connected wins, then the plan, then a skip
  const list = TOOL_CATEGORIES.find((c) => c.id === "list")!;
  const plans: Plans = { list: { kind: "guide" }, money: { kind: "export", tool: "Chase" } };
  assert.equal(categoryState(list, new Set(), ["list"], plans), "guide");
  assert.equal(categoryState(list, new Set(["klaviyo"] as const), [], plans), "connected");
  assert.equal(categoryState(TOOL_CATEGORIES.find((c) => c.id === "money")!, new Set(), [], plans), "export");
  assert.equal(categoryState(list, new Set(), ["list"]), "skipped");
  // a planned part's card closes, but shows when tapped
  assert.equal(cardCategory(undefined, "list", new Set(), [], plans), null);
  assert.equal(cardCategory("list", null, new Set(), [], plans)?.id, "list");
  // Your company: a waiting department says the plan
  const notes = planNotes(plans);
  assert.match(notes.Klaviyo, /^Avery sets up Klaviyo with you after setup/);
  assert.match(notes.Mercury, /^Starts from an export of Chase/);
  assert.equal(waitLine(["Shopify", "Klaviyo"], notes), `Waits on Shopify: it starts working once that’s connected. ${notes.Klaviyo}`);
  assert.equal(waitLine(["Shopify", "Gmail"], {}), "Waits on Shopify and Gmail: it starts working once that’s connected.");
  // the Desk: a part leaves once connected, or once its export is uploaded
  assert.deepEqual(followUps(plans, new Set(), new Set()).map((f) => [f.cat, f.kind]), [["money", "export"], ["list", "guide"]]);
  assert.deepEqual(followUps(plans, new Set(["klaviyo"] as const), new Set()).map((f) => f.cat), ["money"]);
  assert.deepEqual(followUps(plans, new Set(), new Set(["chase"])).map((f) => f.cat), ["list"]);
  assert.deepEqual(followUps({}, new Set(), new Set()), []);
  const acts = read("dashboard/setupActions.ts");
  assert.match(read("core/setup.ts"), /if \(!t\) await planCategory\(cat, c\.starter \? \{ kind: "guide" \} : \{ kind: "none" \}\)/, "None yet on a part with a starter means Avery sets it up after");
  assert.ok(!acts.includes("setupPlanGuide"), "the old Nothing yet action is gone");
  assert.match(acts, /export async function setupPlanClear[\s\S]{0,140}asRole\("approver"\)[\s\S]{0,80}isCategory\(cat\)/, "taking a plan back checks the role, then the category");
  assert.match(read("app/(room)/page.tsx"), /<FollowUpsCard items=\{finish\} owner=\{owner\} \/>/, "the Desk shows what setup left to finish");
}

// a tool that isn't listed: a tile, a built-in, a known server, or a request; never a link or a model
assert.deepEqual(routeUnlisted("Shopify"), { kind: "tile", id: "shopify", name: "Shopify" });
assert.deepEqual(routeUnlisted("gmail"), { kind: "tile", id: "gmail", name: "Gmail" });
assert.equal((routeUnlisted("Notion") as { kind: string }).kind, "builtIn");
assert.deepEqual(routeUnlisted("Post Hog"), { kind: "known", name: "PostHog", href: "/connections?s=new&known=posthog" });
assert.deepEqual(routeUnlisted("Square"), { kind: "tile", id: "square", name: "Square" });
assert.deepEqual(routeUnlisted("Toast"), { kind: "ask", name: "Toast" });
assert.deepEqual(routeUnlisted("Google Analytics"), { kind: "tile", id: "analytics", name: "Google Analytics" });
assert.match((routeUnlisted("https://evil.example") as { problem: string }).problem, /no link/);
assert.match((routeUnlisted("  ") as { problem: string }).problem, /Name the service/);
const actions = read("dashboard/setupActions.ts");
assert.match(actions, /export async function setupOtherTool[\s\S]{0,140}asRole\("owner"\)[\s\S]{0,80}isCategory\(cat\)[\s\S]*?routeUnlisted\(/, "the action checks the role and the category, then routes in code");
assert.doesNotMatch(actions.slice(actions.indexOf("export async function setupOtherTool")), /askSetup|runExplore/, "no model call");
assert.ok(!actions.includes("setupToolAsk"), "the old action is gone");


console.log("check:tools-step ok");
