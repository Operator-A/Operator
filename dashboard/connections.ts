import "server-only";
// Connections (docs/builder-flow.md, slice 1): the one place that says which integrations the business has, what
// each lets an agent read, do and hand the owner, and which agents have each of those in their saved
// setup. It replaces the hand-written access map, so what the Control Room shows is what the
// runner would really allow. Nothing is granted here: granting is a builder step, and code (the
// tool list and the gateway) decides what can be granted at all.
import { TOOL_LIST } from "@/core/tools/catalog";
import type { ToolDef, ToolGroup } from "@/core/tools/types";
import type { IntegrationId } from "./crew";
import type { McpId } from "@/core/mcp-rules";

export type ConnId = "shopify" | "mercury" | "gmail" | "notion" | "klaviyo" | "analytics" | "calendar" | "mailchimp" | "woo" | "hubspot" | "meta" | "email" | "web" | "agents" | "control_room" | "math" | "stripe" | "quickbooks" | "square";
/** A server the owner added by its address (docs/custom-servers.md): its id is the connection's. */
export type CustomConnId = `c_${string}`;

/** One settings check. `tools` names the tools that need it when that isn't simply every tool of the connection. */
export interface Check { key: IntegrationId; label: string; setup: string; tools?: string[] }

export interface Connection {
  id: ConnId;
  name: string;
  sub: string;
  icon: string;
  /** Built into the Control Room: nothing to connect. */
  builtIn: boolean;
  /** What the connection is and its limits, in plain words. */
  about: string;
  /** The settings checks behind it (dashboard/data.ts health), each with a label when there is more than one. */
  checks: Check[];
  /** An MCP server (core/mcp-rules.ts): signed in with Connect on this page, not with a setting. */
  mcp?: McpId;
  /** More sign-ins shown on the same page (the gateway-only write sign-ins: Mercury writes, Gmail drafts). */
  mcpMore?: McpId[];
}

export const CONNECTIONS: Connection[] = [
  {
    id: "shopify", name: "Shopify", sub: "Orders, products, stock", icon: "shopping-bag", builtIn: false, mcp: "shopify",
    about: "Our own Shopify server, run in the app with the custom app the business makes in Shopify. Each read runs one fixed query written in code and can’t change anything; no tool takes GraphQL. Store actions (tagging an order or a customer, setting a stock count, rewriting a product’s description and SEO text, marking an order shipped with tracking, creating a discount code inside your caps) are one fixed change each, made only by the gateway after you approve. The app may have read scopes plus write_orders, write_customers, write_inventory, write_products, write_merchant_managed_fulfillment_orders and write_discounts; a key with any other write scope is refused when you paste it. Shopify’s write_products also covers prices and deleting products: OPERATOR’s server never sends either, so the server is the limit. Order reads carry no customer names or addresses. Marking an order shipped makes Shopify email the customer its own shipping confirmation; that is the only customer email any store action causes.",
    checks: [{ key: "shopify", label: "Store", setup: "Paste your OPERATOR app’s key below, and fill in the store (and the client id if the key is a client secret) on Settings > Where things go." }],
  },
  {
    id: "mercury", name: "Mercury", sub: "Bank", icon: "landmark", builtIn: false, mcp: "mercury", mcpMore: ["mercury_write", "mercury_files"],
    about: "Mercury’s own MCP server, signed in with the read scope only, so this sign-in can’t use any tool that changes Mercury or moves money. Code may call only the read tools named in code (accounts, charges, categories). Sums are worked out in code. After you approve, the gateway sets a charge’s category and memo through its own Mercury sign-in (that one change only), and attaches the receipt file with a separate Mercury token, also locked in the vault, that only it uses.",
    checks: [{ key: "mercury", label: "Bank", setup: "Tap Connect and sign in to Mercury, picking the business’s Mercury org. Pick the accounts that count as cash (all, or a comma list) on Settings > Where things go." }],
  },
  {
    id: "gmail", name: "Gmail", sub: "Receipts in, drafts out", icon: "mail", builtIn: false, mcp: "gmail_read", mcpMore: ["gmail"],
    about: "Our own Gmail server, run in the app. Google’s Gmail MCP server isn’t used: it’s a preview program and can’t download receipt files. Two separate Google sign-ins to the business’s mailbox, each granted one scope: one only reads (Quinn’s receipts), one only makes drafts and is used only by the gateway after you approve. There is no send tool, so you send every email from Gmail. Email is untrusted data.",
    checks: [
      { key: "gmail_read", label: "Receipts (read only)", setup: "Tap Connect under Gmail (read only) and sign in to the business’s mailbox. Needs GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Vercel.", tools: ["report_books_sync"] },
      { key: "gmail", label: "Drafts", tools: ["gmail_draft_lead"], setup: "Tap Connect under Gmail drafts and sign in to the same mailbox." },
    ],
  },
  {
    id: "notion", name: "Notion", sub: "Pages and the Briefs database", icon: "file-text", builtIn: false, mcp: "notion",
    about: "Our own Notion server, run in the app with the agents’ integration key, so it sees only pages and databases shared with that integration. Agents may read a page you link; code writes report pages under a page you pick, plus rows in Briefs and the Build Board. Notion’s hosted server isn’t used: it signs in as you and reaches your whole workspace.",
    checks: [{ key: "notion", label: "Workspace", setup: "Paste the integration’s key below, and pick the briefs page (shared with the integration) on Settings > Where things go, with the briefs database too for brief rows. Set NOTION_BUILD_BOARD_DB_ID for a Build Board card when you say yes to a new tool." }],
  },
  {
    id: "klaviyo", name: "Klaviyo", sub: "Email lists, campaigns, flows", icon: "send", builtIn: false, mcp: "klaviyo", mcpMore: ["klaviyo_drafts"],
    about: "Klaviyo’s own MCP server, called by our runner with the server’s read-only switch on. Code may call only the read tools named in code (lists, a list’s size, campaign and flow results); that sign-in can’t change Klaviyo. Counts and rates are added up in code. After you approve a campaign, the gateway makes it a draft in Klaviyo with a separate private key, locked in the vault, that only it uses. Nothing in the app can send or schedule a campaign: you send it from Klaviyo.",
    checks: [{ key: "klaviyo", label: "Account", setup: "Tap Connect and sign in to Klaviyo as an Owner, Admin or Manager. Klaviyo signs in with its own page, so there is no key to paste. For campaign drafts, also paste a key under Klaviyo campaign drafts." }],
  },
  {
    id: "analytics", name: "Google Analytics", sub: "Visits, pages, channels", icon: "chart-line", builtIn: false, mcp: "ga4",
    about: "Our own Google Analytics server, run in the app. Google’s own Analytics MCP server runs on a person’s computer with their own credentials, so it isn’t used. One Google sign-in granted analytics.readonly alone, so Google refuses it any change. Each tool runs one fixed report on the property you pick below; agents never choose the property. Rates are worked out in code.",
    checks: [{ key: "ga4", label: "Property", setup: "Tap Connect, sign in with a Google account that can see the business’s Analytics, then pick the property below. Needs GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Vercel, with the Analytics APIs turned on for that Google client." }],
  },
  {
    id: "meta", name: "Meta Ads", sub: "Spend and cost per result per ad, pauses", icon: "chart-line", builtIn: false, mcp: "meta", mcpMore: ["meta_pauses"],
    about: "Our own Meta Ads server, run in the app over Meta’s Marketing API. Meta’s hosted Ads MCP server asks to manage ads on every sign-in, so it isn’t used. Two sign-ins with OPERATOR’s Meta app: one that reads (ad accounts, and each ad’s spend, results and cost per result, worked out in code, never audiences or people), and one only the gateway uses, after you approve, to pause a running ad that is over the cost target you set below. Meta grants permissions to a person rather than to one sign-in, so once both are connected the reading sign-in could manage ads too: our server is the limit, and only reads with it. There is no code to change a budget or bid, or to start, resume, edit or delete anything.",
    checks: [
      { key: "meta", label: "Ads (read)", setup: "Tap Connect under Meta Ads and sign in with a Facebook account that can see the business’s ad account. Needs META_APP_ID and META_APP_SECRET in Vercel.", tools: ["meta_ad_accounts", "meta_ad_results"] },
      { key: "meta_pauses", label: "Ad pauses", tools: ["meta_pause_ad"], setup: "Tap Connect under Meta Ads pauses with the same Facebook account, then set a cost target below. With no target, nothing is paused." },
    ],
  },
  {
    id: "hubspot", name: "HubSpot", sub: "Deals by stage, contact counts, deal moves", icon: "users", builtIn: false, mcp: "hubspot", mcpMore: ["hubspot_deals"],
    about: "Our own HubSpot server, run in the app over HubSpot’s CRM API. HubSpot’s hosted MCP server asks for write access on every sign-in, so it isn’t used. Two service keys you make in HubSpot: a read key for agents (open deals by stage with amounts, deals gone quiet, and how many contacts and companies you have, never a contact list, email or phone), and a key that can change deals, which only the gateway uses, after you approve, to move a deal to another stage of its own pipeline and log a note on it. A key that can write is refused for agents. There is no code to create, delete or merge a record, or to email anyone.",
    checks: [
      { key: "hubspot", label: "CRM (read only)", setup: "In HubSpot: Development, Keys, Service keys, Create service key, with the scopes crm.objects.deals.read, crm.objects.contacts.read and crm.objects.companies.read. Paste it under HubSpot below.", tools: ["hubspot_deals", "hubspot_contacts"] },
      { key: "hubspot_deals", label: "Deal moves", tools: ["hubspot_move_deal"], setup: "Make a second service key with crm.objects.deals.read and crm.objects.deals.write and paste it under HubSpot deal moves." },
    ],
  },
  {
    id: "woo", name: "WooCommerce", sub: "Orders, best sellers, stock, order notes", icon: "shopping-bag", builtIn: false, mcp: "woo", mcpMore: ["woo_notes"],
    about: "Our own WooCommerce server, run in the app over your store’s REST API. WooCommerce’s MCP plugin is a preview with no read-only mode, so it isn’t used. Two keys you make in WooCommerce: a Read key for agents (orders, best sellers, repeat buyers and low stock, with no customer names, emails or addresses), and a Read/Write key only the gateway uses, after you approve, to add a private note to an order. A key with the wrong permission is refused. There is no code to change an order, product, stock or customer. Your store’s address is checked as a public https site before every request.",
    checks: [
      { key: "woo", label: "Store (read only)", setup: "In WordPress: WooCommerce, Settings, Advanced, REST API, Add key, with Permissions set to Read. Paste your store’s address, the consumer key and the consumer secret under WooCommerce below.", tools: ["woo_orders", "woo_low_stock"] },
      { key: "woo_notes", label: "Order notes", tools: ["woo_order_note"], setup: "Make a second key with Permissions set to Read/Write and paste it the same way under WooCommerce order notes." },
    ],
  },
  {
    id: "mailchimp", name: "Mailchimp", sub: "Audiences, campaign results, drafts", icon: "send", builtIn: false, mcp: "mailchimp", mcpMore: ["mailchimp_drafts"],
    about: "Our own Mailchimp server, run in the app. Mailchimp’s hosted MCP server isn’t documented for other apps. Mailchimp keys can’t be narrowed, so every key reaches your whole account; our server is the limit. Agents’ key: audience counts and campaign results only, with no member or email address, and rates worked out in code. After you approve a campaign, the gateway makes it a draft in Mailchimp with a second key, locked in the vault, that only it uses. Nothing in the app can send or schedule a campaign: you send it from Mailchimp.",
    checks: [
      { key: "mailchimp", label: "Account (reads)", setup: "In Mailchimp, open your profile, Extras, API keys, and tap Create A Key. Paste it under Mailchimp below.", tools: ["mailchimp_audiences", "mailchimp_results"] },
      { key: "mailchimp_drafts", label: "Campaign drafts", tools: ["mailchimp_campaign_draft"], setup: "Make a second key the same way and paste it under Mailchimp campaign drafts." },
    ],
  },
  {
    id: "calendar", name: "Google Calendar", sub: "Your week, free time, holds", icon: "calendar", builtIn: false, mcp: "calendar", mcpMore: ["calendar_holds"],
    about: "Our own Google Calendar server, run in the app. Google’s Calendar MCP server is a gated preview, so it isn’t used. Two separate Google sign-ins to the business’s calendar, each granted one scope: one only reads events (and our server never asks Google for guests’ email addresses, descriptions, places or links), one only puts a private hold you approved on the calendar and is used only by the gateway. A hold has no guests and emails no one; there is no code to change or delete an event. Free time is worked out in code. Event titles come from whoever sent the invite, so they are untrusted data.",
    checks: [
      { key: "calendar", label: "Calendar (read only)", setup: "Tap Connect under Google Calendar and sign in with the account whose calendar the business runs on. Needs GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Vercel, with the Google Calendar API turned on for that Google client.", tools: ["calendar_week", "calendar_free_time"] },
      { key: "calendar_holds", label: "Holds", tools: ["calendar_hold"], setup: "Tap Connect under Calendar holds and sign in with the same account." },
    ],
  },
  {
    id: "stripe", name: "Stripe", sub: "Payments, subscriptions, invoices", icon: "credit-card", builtIn: false, mcp: "stripe", mcpMore: ["stripe_drafts"],
    about: "Our own Stripe server, run in the app with a restricted key the business makes in Stripe. Stripe’s own MCP server isn’t used: its tools can read or change anything, refunds included. The key may only read balance, payments, subscriptions, invoices and customers; a key that can change anything is refused when you paste it. Each tool runs one fixed request, and every total is worked out in code. After you approve an invoice, the gateway makes it a draft in Stripe with a second restricted key, locked in the vault, that can write invoices and nothing else. Nothing is finalized, sent or charged: you do that from Stripe.",
    checks: [{ key: "stripe", label: "Read key", setup: "In Stripe, go to Developers, API keys, Create restricted key. Name it OPERATOR read, set Balance, Balance transaction sources, Subscriptions, Invoices and Customers to Read, leave everything else None, tap Create key, and paste it below. For invoice drafts, also paste a second key under Stripe invoice drafts." }],
  },
  {
    id: "quickbooks", name: "QuickBooks Online", sub: "Books", icon: "book-open", builtIn: false, mcp: "quickbooks",
    about: "Our own QuickBooks server, run in the app, signed in on Intuit’s own page. Intuit’s own QuickBooks MCP server isn’t used: it runs on a person’s computer and can create, change and delete almost anything. Intuit has one accounting permission and it can read and write, so the limits are in our code: each read runs one fixed request and every total is worked out in code. The only change it can make is moving an expense out of Uncategorized Expense into one of your expense accounts, after you approve; it never changes an amount and never creates or deletes anything.",
    checks: [{ key: "quickbooks", label: "Books", setup: "Tap Connect and sign in to QuickBooks as an admin, picking the business’s company on Intuit’s page. Needs QUICKBOOKS_CLIENT_ID and QUICKBOOKS_CLIENT_SECRET in Vercel (the app’s Intuit OAuth client, docs/mcp-everywhere.md)." }],
  },
  {
    id: "square", name: "Square", sub: "Sales, appointments, invoices", icon: "store", builtIn: false, mcp: "square",
    about: "Our own Square server, run in the app, signed in on Square’s own page. Square’s own MCP server isn’t used: it reaches everything Square’s APIs offer. The sign-in asks only for what our tools need and is refused if Square grants more. Each read runs fixed requests and every total is worked out in code. The only change it can make is a draft invoice you approved, to one of your Square customers: nothing is published, sent or charged, you do that from Square. Square’s invoice permission could also publish or cancel; our server has no code to do either.",
    checks: [{ key: "square", label: "Sales and invoices", setup: "Tap Connect and sign in to Square as the business’s owner, then tap Allow. Needs SQUARE_CLIENT_ID and SQUARE_CLIENT_SECRET in Vercel (the app’s Square application, docs/mcp-everywhere.md)." }],
  },
  {
    id: "email", name: "Email to you", sub: "Briefs and alerts", icon: "inbox", builtIn: false,
    about: "Your morning brief and alerts, emailed to one of this business’s owners. The code has no way to email anyone else.",
    // what this card says it does (or why not) is worked out per business: emailLine in core/settings-rules.ts
    checks: [{ key: "email", label: "Email", setup: "No emails go out yet. Pick who gets the morning brief and alerts on Settings > Business > Where things go." }],
  },
  {
    id: "web", name: "The web", sub: "Search and read pages", icon: "globe", builtIn: false,
    about: "Claude’s own web search and fetch. Pages are written by strangers, so they are information only: a page never chooses a recipient, URL, product or category.",
    checks: [{ key: "web", label: "Web", setup: "Runs through Claude: your own key or OPERATOR’s Claude (Connections > Claude)." }],
  },
  {
    id: "agents", name: "Your other agents", sub: "What they saved on their last run", icon: "users", builtIn: true,
    about: "Every finished run is saved as an output other agents can pick as a source. Their words are untrusted; their numbers were traced by code.",
    checks: [{ key: "supabase", label: "Agent database", setup: "Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }],
  },
  {
    id: "control_room", name: "Control Room", sub: "Runs, numbers, leads, approvals", icon: "layout-dashboard", builtIn: true,
    about: "The agents’ own database: the run log, Morgan’s daily numbers, Rowan’s leads, approvals waiting. Each agent writes only its own tables.",
    checks: [{ key: "supabase", label: "Agent database", setup: "Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." }],
  },
  {
    id: "math", name: "Math done in code", sub: "Days of cover, burn rate, margins", icon: "calculator", builtIn: true,
    about: "Plain code, no model. Money, margins and counts are always worked out here, never by the AI.",
    checks: [],
  },
];

export const CONN_BY_ID = Object.fromEntries(CONNECTIONS.map((c) => [c.id, c])) as Record<ConnId, Connection>;

/** Which connection each tool group belongs to. */
type BuiltInGroup = Exclude<ToolGroup, "custom">;
const GROUP_CONN: Record<BuiltInGroup, ConnId> = {
  shopify: "shopify", mercury: "mercury", gmail: "gmail", klaviyo: "klaviyo", analytics: "analytics", calendar: "calendar", stripe: "stripe", quickbooks: "quickbooks", square: "square", mailchimp: "mailchimp", woo: "woo", hubspot: "hubspot", meta: "meta", notion: "notion", email: "email", web: "web", agents: "agents", supabase: "control_room", calculate: "math",
};
/** For tools on the list in code. A custom server's tools belong to that server (dashboard/builder.ts customMenuFor). */
export const connOf = (t: ToolDef): ConnId => GROUP_CONN[t.group as BuiltInGroup];

/** The settings behind the Control Room itself, not something an agent is granted. */
export const BEHIND_THE_SCENES: { key: IntegrationId; name: string; icon: string; about: string; setup: string }[] = [
    { key: "supabase", name: "Supabase", icon: "database", about: "The agents’ database. Service role, server only.", setup: "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY." },
  { key: "vault", name: "Token vault", icon: "lock", about: "Locks every sign-in made with a Connect button, with a key of its own. Tokens are never shown, logged or given to a model.", setup: "Set MCP_SECRET_KEY (at least 32 characters, made with openssl rand -base64 32). Until then nothing can be connected." },
];

export type Ability = "read" | "do" | "hands";
const ABILITY: Record<ToolDef["kind"], Ability> = { read: "read", calculate: "read", action: "do", report: "hands" };
export const abilityOf = (t: ToolDef): Ability => ABILITY[t.kind];

/** One connection's tools, split the way the builder and this page show them. */
export function toolsOf(id: ConnId): Record<Ability, ToolDef[]> {
  const out: Record<Ability, ToolDef[]> = { read: [], do: [], hands: [] };
  for (const t of TOOL_LIST) if (connOf(t) === id) out[abilityOf(t)].push(t);
  return out;
}

/** Tool ids granted in each agent's active setup (agent_defs), by agent id. */
export type Grants = Record<string, string[]>;

export const isSetUp = (c: Connection, health: Record<IntegrationId, boolean>) => c.checks.every((k) => health[k.key]);

/** `ability` is the strongest one; `has` lists every kind it has there. */
export interface Reach { conn: Connection; ability: Ability; has: Ability[]; tools: string[]; by: Partial<Record<Ability, string[]>> }

/**
 * What one agent can reach, per connection: the strongest ability it has there (do, then hands,
 * then read) and the labels of the tools behind it. Empty when it has no saved setup.
 */
export function reachOf(agentId: string, grants: Grants): Reach[] {
  const ids = new Set(grants[agentId] ?? []);
  const rank: Record<Ability, number> = { read: 0, hands: 1, do: 2 };
  const by = new Map<ConnId, Reach>();
  for (const t of TOOL_LIST) {
    if (!ids.has(t.id)) continue;
    const c = CONN_BY_ID[connOf(t)];
    const ab = abilityOf(t);
    const cur = by.get(c.id) ?? { conn: c, ability: ab, has: [], tools: [], by: {} };
    if (rank[ab] > rank[cur.ability]) cur.ability = ab;
    if (!cur.has.includes(ab)) cur.has.push(ab);
    cur.tools.push(t.label);
    (cur.by[ab] ??= []).push(t.label);
    by.set(c.id, cur);
  }
  return CONNECTIONS.flatMap((c) => (by.has(c.id) ? [by.get(c.id)!] : []));
}

/** Agents that have at least one tool of this connection granted. */
export const usersOf = (id: ConnId, grants: Grants) => Object.keys(grants).filter((a) => grants[a].some((t) => TOOL_LIST.some((x) => x.id === t && connOf(x) === id)));

export const ABILITY_WORD: Record<Ability, string> = { read: "Reads", hands: "Hands you", do: "Asks first" };

/** Agents whose saved setup has a tool that needs this check. */
/** The sidebar's note on Connections: tools an agent uses that aren't set up yet, as setup to do, not a fault. */
export function toConnect(health: Record<IntegrationId, boolean>, grants: Grants): string | undefined {
  const n = CONNECTIONS.filter((c) => !c.builtIn && !isSetUp(c, health) && usersOf(c.id, grants).length > 0).length;
  return n ? `${n} to connect` : undefined;
}

export function usersOfCheck(c: Connection, k: Check, grants: Grants): string[] {
  const need = new Set(k.tools ?? TOOL_LIST.filter((t) => connOf(t) === c.id).map((t) => t.id));
  return Object.keys(grants).filter((a) => grants[a].some((t) => need.has(t)));
}
