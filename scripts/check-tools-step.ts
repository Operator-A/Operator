// First-run setup, step 2 (card 152, docs/setup.md): `npm run check:tools-step`. No database.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MCP_SERVERS } from "../core/mcp-rules";
import { TEMPLATES } from "../core/templates";
import { TOOLS } from "../core/tools/catalog";
import { NEED_TILE, SCOPE_WORDS, TOOL_TILES, backTarget, neededBy, permissionsOf, routeUnlisted, tilesFor, waitingOn, type TemplateTools } from "../core/tools-step-rules";

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
assert.equal(backTarget("start", "mercury"), "/start#step-2");
assert.equal(backTarget("https://evil.example", "mercury"), "/connections?c=mercury");
assert.equal(backTarget("//evil.example", "klaviyo"), "/connections?c=klaviyo");
assert.equal(backTarget(null, "klaviyo"), "/connections?c=klaviyo");
const connect = read("app/(room)/connections/[id]/connect/route.ts");
assert.match(connect, /searchParams\.get\("from"\) === "start"/, "the connect route takes from=start only");
assert.match(read("app/(room)/connections/[id]/callback/route.ts"), /req\.cookies\.get\(BACK_COOKIE\)\?\.value === "start"/, "the callback trusts only its own cookie");

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
assert.match(actions, /export async function setupToolAsk[\s\S]*?routeUnlisted\(/, "the action routes in code");
assert.doesNotMatch(actions.slice(actions.indexOf("export async function setupToolAsk")), /askSetup|runExplore/, "no model call");

// Avery may recommend a tool, as advice only
assert.match(read("core/setup-rules.ts"), /that is advice only, the founder connects it/);

console.log("check:tools-step ok");
