// First-run setup, step 2 (card 152, docs/setup.md): connect your tools, step by step. Pure, so
// `npm run check:tools-step` can test it. Which tools a department needs is worked out from its
// template's tools and each tool's `needs`, never typed by hand. Connecting itself is unchanged: the
// same Connect pages and key forms as Connections, the same profiles (core/mcp-rules.ts).
import { checkServiceName, knownServer } from "@/core/connector-rules";
import { MCP_SERVERS, type McpId } from "@/core/mcp-rules";

export type ToolTileId = "shopify" | "mercury" | "klaviyo" | "gmail" | "analytics";

export interface ToolTile {
  id: ToolTileId;
  name: string;
  /** What agents get from it, in a few words. */
  gives: string;
  icon: string;
  /** The sign-in or key on Connections it stands for. Null for a tool that isn't built yet. */
  mcp: McpId | null;
  /** Click-by-click, in the order the founder does them. */
  steps: readonly string[];
  /** A second sign-in some departments need, offered once the first is connected (Gmail drafts, held only by the gateway). */
  also?: { mcp: McpId; label: string; why: string };
}

export const TOOL_TILES: readonly ToolTile[] = [
  {
    id: "shopify", name: "Shopify", gives: "Orders, products and stock", icon: "shopping-bag", mcp: "shopify",
    steps: [
      "Type your store’s address below (it ends in .myshopify.com; Shopify shows it under Settings > Domains) and tap Save.",
      "In Shopify admin, open Settings > Apps and sales channels > Develop apps. If Shopify asks, tap Allow custom app development.",
      "Tap Create an app, name it Agents (read), and tap Create app.",
      "Tap Configure Admin API scopes. Tick only read_orders, read_products and read_inventory, then tap Save.",
      "Open API credentials and tap Install app, then Install.",
      "Under Admin API access token, tap Reveal token once, copy it (it starts with shpat_) and paste it below.",
    ],
  },
  {
    id: "mercury", name: "Mercury", gives: "Bank balances and charges", icon: "landmark", mcp: "mercury",
    steps: [
      "Tap Connect Mercury below. Mercury’s own sign-in page opens.",
      "Sign in as an admin of the business’s Mercury account.",
      "On Mercury’s page, pick the business (not a personal or household account) and tap Allow.",
      "Back here, check that the name shown is your business.",
    ],
  },
  {
    id: "klaviyo", name: "Klaviyo", gives: "Email lists, campaigns and flows", icon: "send", mcp: "klaviyo",
    steps: [
      "Tap Connect Klaviyo below. Klaviyo’s own sign-in page opens.",
      "Sign in as an Owner, Admin or Manager of the account.",
      "If you have more than one account, pick the business’s, then tap Allow.",
    ],
  },
  {
    id: "gmail", name: "Gmail", gives: "Receipts from your inbox", icon: "mail", mcp: "gmail_read",
    steps: [
      "Tap Connect Gmail below. Google’s own sign-in page opens.",
      "Pick the business mailbox your receipts come to.",
      "Google shows one box, to read your email. Leave it ticked and tap Continue.",
    ],
    also: { mcp: "gmail", label: "Gmail drafts", why: "Prospecting puts each email you approve in Drafts with a second sign-in that can only make drafts. Only the gateway uses it, and you send every email from Gmail." },
  },
  {
    id: "analytics", name: "Google Analytics", gives: "Visits, pages and conversions", icon: "chart-line", mcp: "ga4",
    steps: [
      "Tap Connect Google Analytics below. Google’s own sign-in page opens.",
      "Pick a Google account that can see the business’s Analytics (any role, even Viewer, is enough).",
      "Google shows one box, to see your Analytics data. Leave it ticked and tap Continue.",
      "Back here, if the account sees more than one property, tap Use this one next to the business’s site.",
    ],
  },
];

export const TILE_BY_ID = Object.fromEntries(TOOL_TILES.map((t) => [t.id, t])) as Record<ToolTileId, ToolTile>;

/** What each permission a tile asks for is for, in plain words. Every scope of every tile's profile is here (check:tools-step). */
export const SCOPE_WORDS: Record<string, string> = {
  "accounts:read": "see which Klaviyo account this is",
  "lists:read": "see your lists and how many people are on each",
  "metrics:read": "read opens, clicks and other counts",
  "campaigns:read": "read how each campaign did",
  "flows:read": "read how each flow did",
  read: "see accounts, balances, charges and categories. It can’t move money or change anything",
  offline_access: "stay signed in, so morning runs work while you sleep",
  "https://www.googleapis.com/auth/gmail.readonly": "search and read email. Google refuses it anything that drafts, sends, labels or deletes",
  "https://www.googleapis.com/auth/analytics.readonly": "see your Analytics reports. Google refuses it any change to your Analytics account",
  "https://www.googleapis.com/auth/gmail.compose": "Gmail drafts only: put an email you approved in Drafts. There is no send tool, so you send it from Gmail",
  "the read-only app’s read scopes (a key with any write scope is refused)": "read orders, products and stock. A key that can change anything is refused",
};

/** The permissions a tile asks for, each with what it is for. */
export function permissionsOf(tile: ToolTile): { scope: string; words: string }[] {
  if (!tile.mcp) return [];
  return [tile.mcp, ...(tile.also ? [tile.also.mcp] : [])].flatMap((id) => MCP_SERVERS[id].scopes.map((s) => ({ scope: s, words: SCOPE_WORDS[s] ?? s })))
    .filter((p, i, all) => all.findIndex((q) => q.scope === p.scope) === i);
}

/** A tool's `needs` setting that means a tile must be connected. */
export const NEED_TILE: Record<string, ToolTileId> = {
  SHOPIFY_CONNECTED: "shopify", MERCURY_CONNECTED: "mercury", KLAVIYO_CONNECTED: "klaviyo", GMAIL_CONNECTED: "gmail", ANALYTICS_CONNECTED: "analytics",
};

/** A template's tools, from every agent's spec in it. */
export interface TemplateTools { id: string; name: string; tools: readonly string[] }

/** The tiles a template's tools need, in tile order. `needsOf` gives a tool's `needs` (core/tools/catalog.ts). */
export function tilesFor(t: TemplateTools, needsOf: (toolId: string) => readonly string[]): ToolTileId[] {
  const want = new Set(t.tools.flatMap((id) => needsOf(id).map((n) => NEED_TILE[n]).filter(Boolean)));
  return TOOL_TILES.map((x) => x.id).filter((id) => want.has(id));
}

/** For each tile, the names of the picked templates that need it. */
export function neededBy(picked: readonly TemplateTools[], needsOf: (toolId: string) => readonly string[]): Partial<Record<ToolTileId, string[]>> {
  const out: Partial<Record<ToolTileId, string[]>> = {};
  for (const t of picked) for (const id of tilesFor(t, needsOf)) (out[id] ??= []).push(t.name);
  return out;
}

/** The tiles a template still waits on: needed and not connected. */
export const waitingOn = (t: TemplateTools, needsOf: (toolId: string) => readonly string[], connected: ReadonlySet<ToolTileId>) =>
  tilesFor(t, needsOf).filter((id) => !connected.has(id));

/** Where Connect sends the founder back to. Only "start" is a place; anything else is Connections, so it can't become an open redirect. */
export const BACK_COOKIE = "op_conn_back";
export function backTarget(from: string | null | undefined, id: string): string {
  return from === "start" ? "/start" : `/connections?c=${encodeURIComponent(id)}`;
}

/**
 * A tool the founder uses that isn't a tile: a built-in opens that tile (or Connections), a server on
 * the known list goes to Add a server with its address filled in, anything else is a connection request.
 */
export type Unlisted =
  | { kind: "tile"; id: ToolTileId; name: string }
  | { kind: "builtIn"; name: string; href: string }
  | { kind: "known"; name: string; href: string }
  | { kind: "ask"; name: string };

export function routeUnlisted(raw: string): Unlisted | { problem: string } {
  const n = checkServiceName(raw);
  if ("problem" in n) return n;
  const k = knownServer(n.name);
  const tile = TOOL_TILES.find((t) => t.id === n.key || t.name.toLowerCase() === n.name.toLowerCase() || (k?.builtIn && t.id === k.builtIn));
  if (tile && tile.mcp) return { kind: "tile", id: tile.id, name: tile.name };
  if (k?.builtIn) return { kind: "builtIn", name: k.name, href: `/connections?c=${k.builtIn}` };
  if (k?.url) return { kind: "known", name: k.name, href: `/connections?s=new&known=${encodeURIComponent(k.key)}` };
  return { kind: "ask", name: n.name };
}
