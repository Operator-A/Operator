// First-run setup, step 2 (card 152, docs/setup.md): `npm run check:tools-step`. No database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_SERVERS } from "../core/mcp-rules";
import { TEMPLATES } from "../core/templates";
import { TOOLS } from "../core/tools/catalog";
import { readSetupState } from "../core/setup-rules";
import { waitLine } from "../core/company-rules";
import { CATEGORY_IDS, NEED_TILE, SCOPE_WORDS, TOOL_CATEGORIES, TOOL_TILES, backTarget, categoryOfTile, categoryState, currentCategory, followUps, orderCategories, planNotes, readPlans, readSkipped, tileOfMcp, type Plans, type ToolTileId, neededBy, permissionsOf, routeUnlisted, tilesFor, waitingOn, type TemplateTools } from "../core/tools-step-rules";

const read = (f: string) => readFileSync(f, "utf8");
const needsOf = (id: string): readonly string[] => (TOOLS as Record<string, { needs?: readonly string[] }>)[id]?.needs ?? [];
const tpl = (id: string): TemplateTools => {
  const t = TEMPLATES.find((x) => x.id === id)!;
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

// one question per part of the company (card 182)
{
  const built = TOOL_TILES.filter((t) => t.mcp).map((t) => t.id);
  for (const id of built) assert.equal(TOOL_CATEGORIES.filter((c) => c.tiles.includes(id)).length, 1, `${id} answers exactly one question`);
  for (const c of TOOL_CATEGORIES) {
    assert.ok(c.question.endsWith("?") && c.value && c.ready && c.area, `${c.id}: a question, what it gets you, and the line once connected`);
    assert.ok(c.value.length <= 110, `${c.id}: value in few words`);
    for (const t of c.tiles) assert.ok(TOOL_TILES.some((x) => x.id === t), `${c.id}: ${t} is a tile`);
  }
  assert.deepEqual(TOOL_CATEGORIES.map((c) => c.id), [...CATEGORY_IDS]);
  assert.equal(categoryOfTile("mercury"), "money");
  assert.equal(categoryOfTile("nope"), null);
  assert.equal(tileOfMcp("gmail"), "gmail");
  assert.equal(tileOfMcp("mercury_write"), null, "a gateway-only sign-in is no tile");
  // order: what a leaned-toward department needs comes first, the rest keep list order
  assert.deepEqual(orderCategories(new Set()).map((c) => c.id), [...CATEGORY_IDS]);
  assert.deepEqual(orderCategories(new Set(["mercury", "klaviyo"] as const)).map((c) => c.id), ["money", "list", "store", "site", "inbox", "calendar"]);
  // skipped: only real categories, each once
  assert.deepEqual(readSkipped(["inbox", "nope", "inbox", "store", 3]), ["store", "inbox"]);
  assert.deepEqual(readSkipped("store"), []);
  assert.deepEqual(readSetupState({ skipped: ["site", "x"] }, []).skipped, ["site"]);
  // the question on screen
  const order = orderCategories(new Set());
  const cur = (connected: ToolTileId[], skipped: string[], asked?: unknown) => currentCategory(order, new Set(connected), readSkipped(skipped), asked)?.id ?? null;
  assert.equal(cur([], []), "store", "the first open one");
  assert.equal(cur(["shopify"], ["site"]), "money", "connected and skipped ones are answered");
  assert.equal(cur(["shopify"], [], "store"), "store", "one asked for shows even when answered");
  assert.equal(cur([], [], "nope"), "store", "an unknown one is ignored");
  assert.equal(cur(["shopify", "analytics", "mercury"], ["list", "inbox", "calendar"]), null, "every part connected or skipped: none");
  assert.equal(categoryState(order[0], new Set(["shopify"] as const), ["store"]), "connected", "connected wins over skipped");
  const acts = read("dashboard/setupActions.ts");
  assert.match(acts, /export async function setupSkipTool[\s\S]{0,140}asRole\("approver"\)[\s\S]{0,80}isCategory\(cat\)/, "skipping checks the role, then the category");
  const page = read("app/start/page.tsx");
  assert.ok(!page.includes("ToolTileCard"), "the tile grid is gone");
  assert.match(page, /isCategory\(sp\.q\) \? sp\.q : categoryOfTile\(sp\.c\)/, "the page only takes a category from the list");
}

// no tool yet, or one we don't connect (card 183)
{
  const starters = TOOL_CATEGORIES.filter((c) => c.starter);
  assert.deepEqual(starters.map((c) => c.id), ["site", "list"], "a starter where we have a default tool");
  for (const c of starters) {
    assert.ok(c.tiles.includes(c.starter!.tile), `${c.id}: the starter is one of the part's own tools`);
    assert.ok(c.starter!.steps.length >= 4 && c.starter!.steps.at(-1)!.includes(`Connect ${c.starter!.name}`), `${c.id}: steps end at the normal connect`);
    assert.match(c.starter!.steps.join(" "), /accept them yourself/, `${c.id}: the founder accepts the service's terms, no agent does`);
  }
  // stored plans: only real parts, a guide only where there is a starter, a checked tool name
  assert.deepEqual(readPlans({ list: { kind: "guide" }, money: { kind: "guide" }, nope: { kind: "guide" }, inbox: { kind: "export", tool: "  Outlook " }, store: { kind: "export", tool: "https://evil.example" }, site: { kind: "other" } }),
    { list: { kind: "guide" }, inbox: { kind: "export", tool: "Outlook" } });
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
  // a planned part isn't asked again
  const order = orderCategories(new Set());
  assert.equal(currentCategory(order, new Set(["shopify", "analytics"] as const), [], undefined, plans)?.id, "inbox");
  assert.equal(currentCategory(order, new Set(), [], "list", plans)?.id, "list", "but it shows when tapped");
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
  assert.match(acts, /export async function setupPlanGuide[\s\S]{0,140}asRole\("approver"\)[\s\S]{0,80}isCategory\(cat\)[\s\S]{0,200}starter/, "Nothing yet checks the role, the category, then that the part has a starter");
  assert.match(acts, /export async function setupPlanClear[\s\S]{0,140}asRole\("approver"\)[\s\S]{0,80}isCategory\(cat\)/, "taking a plan back checks the role, then the category");
  assert.match(read("app/(room)/page.tsx"), /<FollowUpsCard items=\{finish\} owner=\{owner\} \/>/, "the Desk shows what setup left to finish");
}

// a tool that isn't listed: a tile, a built-in, a known server, or a request; never a link or a model
assert.deepEqual(routeUnlisted("Shopify"), { kind: "tile", id: "shopify", name: "Shopify" });
assert.deepEqual(routeUnlisted("gmail"), { kind: "tile", id: "gmail", name: "Gmail" });
assert.equal((routeUnlisted("Notion") as { kind: string }).kind, "builtIn");
assert.deepEqual(routeUnlisted("Post Hog"), { kind: "known", name: "PostHog", href: "/connections?s=new&known=posthog" });
assert.deepEqual(routeUnlisted("Square"), { kind: "ask", name: "Square" });
assert.deepEqual(routeUnlisted("Google Analytics"), { kind: "tile", id: "analytics", name: "Google Analytics" });
assert.match((routeUnlisted("https://evil.example") as { problem: string }).problem, /no link/);
assert.match((routeUnlisted("  ") as { problem: string }).problem, /Name the service/);
const actions = read("dashboard/setupActions.ts");
assert.match(actions, /export async function setupOtherTool[\s\S]{0,140}asRole\("owner"\)[\s\S]{0,80}isCategory\(cat\)[\s\S]*?routeUnlisted\(/, "the action checks the role and the category, then routes in code");
assert.doesNotMatch(actions.slice(actions.indexOf("export async function setupOtherTool")), /askSetup|runExplore/, "no model call");
assert.ok(!actions.includes("setupToolAsk"), "the old action is gone");

// Avery may recommend a tool, as advice only
assert.match(read("core/setup-rules.ts"), /that is advice only, the founder connects it/);

console.log("check:tools-step ok");
