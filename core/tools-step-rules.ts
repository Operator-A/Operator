// First-run setup (cards 152, 195, docs/setup.md): the parts of a business a tool runs, and connecting them step by step. Pure, so
// `npm run check:tools-step` can test it. Which tools a department needs is worked out from its
// template's tools and each tool's `needs`, never typed by hand. Connecting itself is unchanged: the
// same Connect pages and key forms as Connections, the same profiles (core/mcp-rules.ts).
import { checkServiceName, knownServer } from "@/core/connector-rules";
import { MCP_SERVERS, type McpId } from "@/core/mcp-rules";
import type { FactTopic } from "@/core/setup-rules";

export type ToolTileId = "shopify" | "mercury" | "klaviyo" | "gmail" | "analytics" | "calendar";

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
  {
    id: "calendar", name: "Google Calendar", gives: "Your week and free time", icon: "calendar", mcp: "calendar",
    steps: [
      "Tap Connect Google Calendar below. Google’s own sign-in page opens.",
      "Pick the Google account whose calendar the business runs on.",
      "Google shows one box, to see your calendar events. Leave it ticked and tap Continue.",
    ],
    also: { mcp: "calendar_holds", label: "Calendar holds", why: "An agent you give holds to can block time for you, as a private event with no guests. Only the gateway uses this second sign-in, after you approve, and it never invites or emails anyone." },
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
  "https://www.googleapis.com/auth/calendar.events.readonly": "see the events on your calendars. It can’t change, add or delete anything",
  "https://www.googleapis.com/auth/calendar.events": "add a private hold you approved to your calendar. Our server has no code to change or delete an event, or to invite anyone",
  "https://www.googleapis.com/auth/gmail.compose": "Gmail drafts only: put an email you approved in Drafts. There is no send tool, so you send it from Gmail",
  "the app’s read scopes": "read orders, products and stock",
  write_orders: "add tags to an order, only after you approve",
  write_customers: "add tags to a customer, only after you approve",
};

/** The permissions a tile asks for, each with what it is for. */
export function permissionsOf(tile: ToolTile): { scope: string; words: string }[] {
  if (!tile.mcp) return [];
  return [tile.mcp, ...(tile.also ? [tile.also.mcp] : [])].flatMap((id) => MCP_SERVERS[id].scopes.map((s) => ({ scope: s, words: SCOPE_WORDS[s] ?? s })))
    .filter((p, i, all) => all.findIndex((q) => q.scope === p.scope) === i);
}

/** A tool's `needs` setting that means a tile must be connected. */
export const NEED_TILE: Record<string, ToolTileId> = {
  SHOPIFY_CONNECTED: "shopify", MERCURY_CONNECTED: "mercury", KLAVIYO_CONNECTED: "klaviyo", GMAIL_CONNECTED: "gmail", ANALYTICS_CONNECTED: "analytics", CALENDAR_CONNECTED: "calendar", CALENDAR_HOLDS_CONNECTED: "calendar",
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

/**
 * The parts of a business a tool runs (card 195, docs/setup.md). Avery asks about one inside her
 * interview by naming its id only; code draws the card from this list: the common tools for the part,
 * Something else, None yet and Skip. A tool with a tile connects right there; any other is the founder's
 * answer, saved as a fact and put on our build list. Core parts show in the Your tools panel from the
 * start; the others only once Avery asks, because only she knows whether a part fits this business.
 * Nobody types which department a part feeds: that comes from the tiles' needs.
 */
export const CATEGORY_IDS = ["store", "payments", "money", "books", "list", "inbox", "site", "leads", "ads", "social", "support", "bookings", "shipping", "team"] as const;
export type CategoryId = (typeof CATEGORY_IDS)[number];
/** A tool Avery walks a founder into when they have none for the part (card 183): the founder creates the account and accepts its terms. */
export interface Starter { tile: ToolTileId; name: string; promise: string; steps: readonly string[] }
/** A tool on a part's card: its name, and its tile when it connects today. */
export interface ListedTool { name: string; tile?: ToolTileId }
export interface ToolCategory {
  id: CategoryId; area: string; question: string; value: string; ready: string;
  /** What Avery learns once it is connected, in a few words (the card's top line). */
  learns: string;
  /** Shown in the Your tools panel from the start; the rest appear once Avery asks. */
  core: boolean;
  /** The fact topic the founder's answer is saved under. */
  topic: FactTopic;
  /** The common tools, the connectable ones first. At most MAX_LISTED. */
  tools: readonly ListedTool[];
  /** The tools that connect today, from `tools`. */
  tiles: readonly ToolTileId[];
  starter?: Starter;
}
export const MAX_LISTED = 6;
type Def = Omit<ToolCategory, "tiles">;
const part = (d: Def): ToolCategory => ({ ...d, tiles: d.tools.flatMap((t) => (t.tile ? [t.tile] : [])) });
export const TOOL_CATEGORIES: readonly ToolCategory[] = [
  part({ id: "store", area: "Where you sell", core: true, topic: "channels", learns: "orders, products and stock", question: "Where do you sell?", value: "Your agents read orders, products and stock, and tell you what sold in plain words.", ready: "Your agents can see your orders, products and stock.",
    tools: [{ name: "Shopify", tile: "shopify" }, { name: "WooCommerce" }, { name: "Square Online" }, { name: "Wix" }, { name: "Squarespace" }, { name: "Etsy" }] }),
  part({ id: "payments", area: "Payments", core: true, topic: "sells", learns: "what you’re paid, refunds and unpaid invoices", question: "How do people pay you?", value: "Know what came in, what’s owed and what got refunded, without opening another dashboard.", ready: "Your payments are in reach.",
    tools: [{ name: "Stripe" }, { name: "Square" }, { name: "PayPal" }] }),
  part({ id: "money", area: "Bank", core: true, topic: "other", learns: "balances and every charge", question: "Where does the money live?", value: "Your bookkeeper categorizes every charge and matches the receipts.", ready: "Your books can start from your real transactions.",
    tools: [{ name: "Mercury", tile: "mercury" }, { name: "Chase" }, { name: "Bank of America" }, { name: "Wells Fargo" }] }),
  part({ id: "books", area: "Books", core: true, topic: "other", learns: "profit and loss, bills and what’s owed to you", question: "What do you keep your books in?", value: "Monthly numbers come from your own books, not a guess.", ready: "Your books are in reach.",
    tools: [{ name: "QuickBooks Online" }, { name: "Xero" }, { name: "Wave" }] }),
  part({ id: "list", area: "Email marketing", core: true, topic: "channels", learns: "your lists and how campaigns did", question: "What do you use for email marketing?", value: "Campaigns get drafted from what sold best. You press send.", ready: "Your lists and past campaigns are in reach.",
    tools: [{ name: "Klaviyo", tile: "klaviyo" }, { name: "Mailchimp" }, { name: "Shopify Email" }, { name: "Kit" }],
    starter: { tile: "klaviyo", name: "Klaviyo", promise: "The free plan needs no card. It’s your account, I show you each tap, then you connect it here.", steps: [
      "Open klaviyo.com and tap Sign up.",
      "Type your email, your business’s name and your store’s address, and choose a password. Klaviyo shows its terms: read them and accept them yourself.",
      "Open the email Klaviyo sends you and tap the button to confirm your address.",
      "When Klaviyo asks about your store, choose Shopify and follow its steps so your customers and orders come across.",
      "Stay on the free plan: you don’t need to add a card.",
      "Come back here and tap Connect Klaviyo.",
    ] } }),
  part({ id: "inbox", area: "Inbox and calendar", core: true, topic: "other", learns: "receipts, threads and your week", question: "What do you use for email?", value: "Receipts get matched from your inbox, and emails you approve wait in your Drafts.", ready: "Your agents can read your inbox and your week.",
    tools: [{ name: "Gmail", tile: "gmail" }, { name: "Google Calendar", tile: "calendar" }, { name: "Outlook" }] }),
  part({ id: "site", area: "Website traffic", core: true, topic: "channels", learns: "visits, pages and where people drop off", question: "How do you track your website?", value: "Know where visitors come from and where they drop off.", ready: "Visits and conversions go into your summaries.",
    tools: [{ name: "Google Analytics", tile: "analytics" }, { name: "Plausible" }],
    starter: { tile: "analytics", name: "Google Analytics", promise: "It’s free. You create the property, I show you each tap, then you connect it here.", steps: [
      "Open analytics.google.com and sign in with the Google account you use for the business.",
      "Tap Start measuring. Type the business’s name as the account name, then tap Next.",
      "Type a property name (your store’s name), pick your time zone and currency, then tap Next.",
      "Pick your industry and size, tap Next, pick what you want to measure, then tap Create. Google shows its terms: read them and accept them yourself.",
      "Choose Web, type your store’s address, and tap Create stream.",
      "In Shopify, open Sales channels > Google & YouTube (add the app if it isn’t there), sign in with the same Google account and pick the property you just made.",
      "Come back here and tap Connect Google Analytics.",
    ] } }),
  part({ id: "leads", area: "Leads and customers", core: true, topic: "customers", learns: "your contacts, deals and who went quiet", question: "Where do you keep track of leads and customers?", value: "Follow-ups get drafted for the people who went quiet.", ready: "Your contacts and deals are in reach.",
    tools: [{ name: "HubSpot" }, { name: "Salesforce" }, { name: "Pipedrive" }] }),
  part({ id: "ads", area: "Ads", core: false, topic: "channels", learns: "spend and what each ad brought in", question: "Where do you run ads?", value: "See what each dollar of ads brought back.", ready: "Your ad numbers are in reach.",
    tools: [{ name: "Meta Ads" }, { name: "Google Ads" }, { name: "TikTok Ads" }] }),
  part({ id: "social", area: "Social", core: false, topic: "channels", learns: "posts and what people respond to", question: "Where do you post?", value: "Posts get drafted from what your customers respond to. You approve each one.", ready: "Your posts are in reach.",
    tools: [{ name: "Instagram" }, { name: "Facebook" }, { name: "TikTok" }] }),
  part({ id: "support", area: "Customer support", core: false, topic: "customers", learns: "what customers ask and how long they wait", question: "Where do customer questions land?", value: "Replies get drafted for the common questions.", ready: "Your support inbox is in reach.",
    tools: [{ name: "Gorgias" }, { name: "Zendesk" }, { name: "Help Scout" }] }),
  part({ id: "bookings", area: "Bookings", core: false, topic: "sells", learns: "appointments, no-shows and busy hours", question: "What do people book you through?", value: "Open slots and no-shows get followed up.", ready: "Your bookings are in reach.",
    tools: [{ name: "Square Appointments" }, { name: "Calendly" }, { name: "Acuity" }] }),
  part({ id: "shipping", area: "Shipping", core: false, topic: "other", learns: "what shipped, what’s late and what it cost", question: "How do you ship?", value: "Late and lost packages get flagged before the customer asks.", ready: "Your shipments are in reach.",
    tools: [{ name: "ShipStation" }, { name: "Shippo" }, { name: "Pirate Ship" }] }),
  part({ id: "team", area: "Team and work", core: false, topic: "other", learns: "who’s doing what", question: "Where does your team keep its work?", value: "Your crew posts its updates where your team already looks.", ready: "Your team’s tools are in reach.",
    tools: [{ name: "Slack" }, { name: "Notion" }, { name: "Asana" }] }),
];
/** The listed tool a founder picked on a part's card, by its exact name. Only names from the list. */
export const listedTool = (cat: CategoryId, name: unknown): ListedTool | null => TOOL_CATEGORIES.find((c) => c.id === cat)?.tools.find((t) => t.name === name) ?? null;
/** The fact a founder's answer on a card saves: the part, then the tool or "none yet". Code writes it, never a model. */
export const answerFact = (c: Pick<ToolCategory, "area">, tool: string | null): string => `${c.area}: ${tool ?? "none yet"}`;
export const isCategory = (c: unknown): c is CategoryId => typeof c === "string" && (CATEGORY_IDS as readonly string[]).includes(c);
export const categoryOfTile = (tile: unknown): CategoryId | null => TOOL_CATEGORIES.find((c) => (c.tiles as readonly unknown[]).includes(tile))?.id ?? null;
/** The tile a sign-in belongs to: its own, or its second one (Gmail drafts). */
export const tileOfMcp = (mcp: string): ToolTileId | null => TOOL_TILES.find((t) => t.mcp === mcp || t.also?.mcp === mcp)?.id ?? null;

/** The categories the founder skipped, as stored: only real ones, each once. */
export function readSkipped(raw: unknown): CategoryId[] {
  return Array.isArray(raw) ? CATEGORY_IDS.filter((c) => raw.includes(c)) : [];
}

/**
 * What the founder chose for a part they can't connect today (card 183): Avery guides them into the
 * part's starter tool after setup, or the part starts from an export of a tool that has no connection.
 * The tool's name is the founder's typed text: checked, shown, and never used to choose anything.
 * Card 195 adds two: `uses`, a tool from the part's list that doesn't connect yet (it's on our build
 * list), and `none`, the founder has no tool for the part.
 */
export type CategoryPlan = { kind: "guide" } | { kind: "export"; tool: string } | { kind: "uses"; tool: string } | { kind: "none" };
export type Plans = Partial<Record<CategoryId, CategoryPlan>>;
export function readPlans(raw: unknown): Plans {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Plans = {};
  for (const c of TOOL_CATEGORIES) {
    const p = r[c.id] as { kind?: unknown; tool?: unknown } | null | undefined;
    if (!p || typeof p !== "object") continue;
    if (p.kind === "guide" && c.starter) out[c.id] = { kind: "guide" };
    if (p.kind === "export" && typeof p.tool === "string") { const n = checkServiceName(p.tool); if (!("problem" in n)) out[c.id] = { kind: "export", tool: n.name }; }
    if (p.kind === "uses") { const t = listedTool(c.id, p.tool); if (t && !t.tile) out[c.id] = { kind: "uses", tool: t.name }; }
    if (p.kind === "none") out[c.id] = { kind: "none" };
  }
  return out;
}

export type CategoryState = "connected" | CategoryPlan["kind"] | "skipped" | "open";
/** A connected tool wins, then what the founder planned for the part, then a skip. */
export function categoryState(c: ToolCategory, connected: ReadonlySet<ToolTileId>, skipped: readonly CategoryId[], plans: Plans = {}): CategoryState {
  return c.tiles.some((t) => connected.has(t)) ? "connected" : plans[c.id]?.kind ?? (skipped.includes(c.id) ? "skipped" : "open");
}

/** Every part with a state, for the Your tools panel and Avery's directive: core parts, and any other once asked or answered. */
export function partsShown(connected: ReadonlySet<ToolTileId>, skipped: readonly CategoryId[], plans: Plans, asked: readonly CategoryId[]): { c: ToolCategory; state: CategoryState }[] {
  return TOOL_CATEGORIES.map((c) => ({ c, state: categoryState(c, connected, skipped, plans) }))
    .filter(({ c, state }) => c.core || state !== "open" || asked.includes(c.id));
}

/** The card on screen in the chat: the part the founder tapped, else the one Avery asked about while it is still open. */
export function cardCategory(tapped: unknown, asking: CategoryId | null, connected: ReadonlySet<ToolTileId>, skipped: readonly CategoryId[], plans: Plans): ToolCategory | null {
  if (isCategory(tapped)) return TOOL_CATEGORIES.find((c) => c.id === tapped)!;
  const c = asking ? TOOL_CATEGORIES.find((x) => x.id === asking) : null;
  return c && categoryState(c, connected, skipped, plans) === "open" ? c : null;
}

/** What a department waiting on a tool is told on Your company, by tool name: the plan for the tool's part. */
export function planNotes(plans: Plans): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of TOOL_CATEGORIES) {
    const p = plans[c.id];
    if (!p || (p.kind !== "guide" && p.kind !== "export")) continue;
    for (const id of c.tiles) out[TILE_BY_ID[id].name] = p.kind === "guide" ? `Avery sets up ${c.starter?.name ?? TILE_BY_ID[id].name} with you after setup, then it starts working.` : `Starts from an export of ${p.tool} until it has a connection.`;
  }
  return out;
}

/** Which planned kind each waiting tool has, by tool name, for the reveal's status (card 184). */
export function planKinds(plans: Plans): Record<string, "guide" | "export"> {
  const out: Record<string, "guide" | "export"> = {};
  for (const c of TOOL_CATEGORIES) { const p = plans[c.id]; if (p && (p.kind === "guide" || p.kind === "export")) for (const id of c.tiles) out[TILE_BY_ID[id].name] = p.kind; }
  return out;
}

/**
 * What is left to finish after setup, for the Desk: a guided part until its tool is connected, an export
 * part until a file with that tool's name is uploaded. `exportKeys` are the service keys of uploaded exports.
 */
export type FollowUp =
  | { cat: CategoryId; area: string; kind: "guide"; starter: Starter }
  | { cat: CategoryId; area: string; kind: "export"; tool: string };
export function followUps(plans: Plans, connected: ReadonlySet<ToolTileId>, exportKeys: ReadonlySet<string>): FollowUp[] {
  const out: FollowUp[] = [];
  for (const c of TOOL_CATEGORIES) {
    const p = plans[c.id];
    if (!p || c.tiles.some((t) => connected.has(t))) continue;
    if (p.kind === "guide" && c.starter) out.push({ cat: c.id, area: c.area, kind: "guide", starter: c.starter });
    if (p.kind === "export") { const n = checkServiceName(p.tool); if (!("problem" in n) && !exportKeys.has(n.key)) out.push({ cat: c.id, area: c.area, kind: "export", tool: n.name }); }
  }
  return out;
}

/**
 * Where Connect sends the founder back to. Only "start" is a place; anything else is Connections, so it
 * can't become an open redirect. From setup it comes back to the question the tool answers.
 */
export const BACK_COOKIE = "op_conn_back";
export function backTarget(from: string | null | undefined, id: string): string {
  if (from !== "start") return `/connections?c=${encodeURIComponent(id)}`;
  const tile = tileOfMcp(id);
  return tile ? `/start?c=${tile}` : "/start";
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
