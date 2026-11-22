// MCP connections (docs/company-mode.md, slice 6). Pure: no database, no network, so
// `npm run check:mcp` can test it.
//
// Our runner calls an MCP server itself (never the model provider's server-side connector), so
// every call passes our gate: the agent's saved tools, the run log, the budget, untrusted labels.
// What we may call on each server is written here, tool by tool: read tools only. A tool the
// server adds later does nothing until it is named here in a pull request. A server's write tools
// are never called; a write would become a gateway action type that starts at Draft.

import { createHash } from "node:crypto";
import { SHOPIFY_TOOLS } from "@/core/shopify-queries";
import { STRIPE_DRAFT_TOOL, STRIPE_READ_TOOLS } from "@/core/stripe-rules";
import { SHOPIFY_COPY, SHOPIFY_COPY_TOOL, SHOPIFY_STOCK, SHOPIFY_STOCK_TOOL, SHOPIFY_TAGS, SHOPIFY_TAGS_TOOL, SHOPIFY_WRITE_SCOPES } from "@/core/shopify-actions";

/**
 * A server's profile (docs/mcp-everywhere.md, slice 3). It ships with the app and only a pull
 * request changes it: a business connects its own account, never edits what may be called.
 */
export interface McpServer {
  id: string;
  name: string;
  /**
   * How it is signed in. "oauth": the server's own sign-in page (Connect). "token": a key pasted
   * once on Connections, for a server we run ourselves in the app (integrations/mcp.ts LOCAL), used
   * where the service's hosted server would reach more than the profile needs. "google": a server we
   * run ourselves, signed in on Google's own page (Connect) with the business's own Google OAuth client
   * (GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET), asking for the profile's one scope only. "meta": a server
   * we run ourselves, signed in on Facebook's own page (Connect) with OPERATOR's Meta app (META_APP_ID
   * and META_APP_SECRET), asking for the profile's permissions only.
   */
  auth: "oauth" | "token" | "google" | "meta";
  /** The server's address (for a token server, the API our own server calls), with read-only switches on where it has them. */
  url: string;
  /** The only tools code may call on it, by the server's own names. Read tools only. */
  readTools: readonly string[];
  /**
   * Report tools: writes into the business's own workspace (a page or row the owner reads), made by code after a
   * run, like an email to the owner. A model never calls one. Only a server we run ourselves has them.
   */
  reportTools: readonly string[];
  /** The sign-in scopes asked for: only what the read tools need, never the server's whole list. For a token server, what the key reaches, in words. */
  scopes: readonly string[];
  /**
   * Write tools, each with the gateway action type it becomes (starting at Draft). Code never calls
   * one directly: only core/gateway may, after an approver approves. Empty until a slice builds one.
   */
  writeTools: readonly { tool: string; actionType: string }[];
  /** Who should sign in, shown next to Connect. */
  signInHint: string;
}

export const MCP_SERVERS = {
  klaviyo: {
    id: "klaviyo",
    name: "Klaviyo",
    auth: "oauth",
    // read-only=true turns off every tool that can change the account; no profile reviews or other
    // user-written content (Klaviyo's MCP docs, 2026).
    url: "https://mcp.klaviyo.com/mcp?read-only=true&disable-tools-with-user-generated-content=true",
    readTools: ["get_lists", "get_list", "get_metrics", "get_campaign_report", "get_flow_report"],
    // Klaviyo's read scopes for those tools (lists, metrics, campaign and flow reports).
    scopes: ["accounts:read", "lists:read", "metrics:read", "campaigns:read", "flows:read"],
    reportTools: [],
    writeTools: [],
    signInHint: "Sign in as an Owner, Admin or Manager.",
  },
  mercury: {
    id: "mercury",
    name: "Mercury",
    // Mercury's hosted server (OAuth, dynamic client registration). Each write tool needs its own
    // scope, so this sign-in asks for `read` only: its token can't use a write tool even if code tried
    // (Mercury's MCP docs, 2026). Writes get a second, gateway-only sign-in in slice 5b.
    auth: "oauth",
    url: "https://mcp.mercury.com/mcp",
    readTools: ["getAccounts", "listTransactions", "listCategories", "getTransactionById", "getOrganization"],
    reportTools: [],
    scopes: ["read", "offline_access"],
    writeTools: [],
    signInHint: "Sign in as an admin of the business’s Mercury org, and pick the business (not a personal or household account) on Mercury’s page.",
  },
  mercury_write: {
    id: "mercury_write",
    name: "Mercury writes",
    // A second sign-in to the same server, held only by the gateway (slice 5b). It asks for
    // transactions:update alone: a charge's category and memo, after an approver approves. No payment,
    // transfer, receipt, budget or reimbursement scope, so its token can't use those tools.
    // Receipt files are mercury_files below: Mercury's MCP can't attach a file to a chosen charge.
    auth: "oauth",
    url: "https://mcp.mercury.com/mcp",
    readTools: [],
    reportTools: [],
    scopes: ["transactions:update", "offline_access"],
    writeTools: [{ tool: "updateTransaction", actionType: "mercury_annotate" }],
    signInHint: "Sign in to the business’s Mercury org again. This sign-in asks only to change a charge’s category and memo, and only the gateway uses it, after you approve.",
  },
  mercury_files: {
    id: "mercury_files",
    name: "Mercury receipt files",
    // Our own small server (integrations/mercury-files-server.ts) for the one write Mercury's MCP
    // can't do: attach a file to the charge an approver approved. Its key is a Mercury Custom token with
    // transaction write scope, pasted on Connections into the vault; only the gateway uses it.
    auth: "token",
    url: "https://api.mercury.com/api/v1",
    readTools: [],
    reportTools: [],
    scopes: ["a Mercury Custom token with transaction write scope, used only to attach a file to a charge"],
    writeTools: [{ tool: "mercury_attach_receipt", actionType: "mercury_annotate" }],
    signInHint: "Paste the Custom token you made for receipts (secret-token:mercury_…). Only the gateway uses it, after you approve.",
  },
  klaviyo_drafts: {
    id: "klaviyo_drafts",
    name: "Klaviyo campaign drafts",
    // Our own small server (integrations/klaviyo-drafts-server.ts, card 159b): Klaviyo's hosted server
    // stays read-only for agents. Its key is a Klaviyo private key with campaigns:write, templates:write
    // and lists:read (refused when it can also read profiles, flows or metrics), pasted on Connections
    // into the vault; only the gateway uses it, after you approve. It makes a draft and never sends:
    // the server has no send, schedule or delete code, so you send every campaign from Klaviyo.
    auth: "token",
    url: "https://a.klaviyo.com/api",
    readTools: [],
    reportTools: [],
    scopes: ["a Klaviyo private key with campaigns:write, templates:write and lists:read only, used only to make a draft campaign"],
    writeTools: [{ tool: "klaviyo_create_draft", actionType: "klaviyo.campaign_draft" }],
    signInHint: "In Klaviyo: Settings, API keys, Create Private API Key, name it Campaign drafts, pick Custom Key, then Campaigns Full Access, Templates Full Access and Lists Read Access, nothing else. Paste it here (pk_…). Only the gateway uses it, after you approve; you send from Klaviyo.",
  },
  notion: {
    id: "notion",
    name: "Notion",
    // Our own server over Notion's REST API with the agents' internal integration key. Notion's hosted
    // MCP server signs in as a person and reaches their whole workspace with write tools on; this
    // key reaches only the pages shared with the integration (slice 4, the owner's choice 2026-11-16).
    auth: "token",
    url: "https://api.notion.com/v1",
    readTools: ["notion_page_text", "notion_row_on"],
    reportTools: ["notion_create_page", "notion_create_row", "notion_update_row", "notion_archive_row"],
    scopes: ["only the pages and databases shared with the integration"],
    writeTools: [],
    signInHint: "Paste the Internal Integration Secret of the agents’ Notion integration.",
  },
  shopify: {
    id: "shopify",
    name: "Shopify",
    // Our own server (integrations/shopify-server.ts) over the Admin GraphQL API with the business's own
    // custom app. Shopify's own MCP servers are for storefronts and app building, not an Admin view of
    // one store (slice 7). Each read tool runs one fixed query (core/shopify-rules.ts) and can't change
    // anything; each write tool runs one fixed mutation (core/shopify-actions.ts), called only by the
    // gateway after an approver approves. No tool takes GraphQL. The key may carry read scopes and only
    // the write scopes named below; a key with any other write scope is refused.
    auth: "token",
    url: "https://shopify.dev/docs/api/admin-graphql",
    readTools: SHOPIFY_TOOLS,
    reportTools: [],
    scopes: ["the app’s read scopes", ...SHOPIFY_WRITE_SCOPES],
    writeTools: [{ tool: SHOPIFY_TAGS_TOOL, actionType: SHOPIFY_TAGS }, { tool: SHOPIFY_STOCK_TOOL, actionType: SHOPIFY_STOCK }, { tool: SHOPIFY_COPY_TOOL, actionType: SHOPIFY_COPY }],
    signInHint: "Paste your OPERATOR app’s Admin API access token (shpat_…), or its client secret if it’s a Dev Dashboard app. Give it read scopes, plus write_orders and write_customers if agents may tag orders and customers, write_inventory if they may set stock (always after you approve), and write_products if they may rewrite product descriptions and SEO text. Shopify’s write_products also covers prices and deletes; OPERATOR’s server never sends either. Any other write scope is refused.",
  },
  gmail_read: {
    id: "gmail_read",
    name: "Gmail (read only)",
    // Our own server (integrations/gmail-server.ts) over Gmail's API. Google's Gmail MCP server is a
    // preview program with no self-registration and no attachment download, which Quinn needs for
    // receipt files (slice 6). This sign-in is granted gmail.readonly alone: it can search and read,
    // and Google refuses it anything that drafts, sends, labels or deletes.
    auth: "google",
    url: "https://gmail.googleapis.com/gmail/v1",
    readTools: ["gmail_search", "gmail_message", "gmail_attachment"],
    reportTools: [],
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    writeTools: [],
    signInHint: "Sign in as the business mailbox the receipts come to, and leave the one box Google shows ticked.",
  },
  gmail: {
    id: "gmail",
    name: "Gmail drafts",
    // A second Google sign-in, held only by the gateway: gmail.compose, used for one tool, a plain
    // draft to the address on a lead's row after an approver approves. There is no send tool on our server,
    // so a draft is only ever sent by the owner from Gmail.
    auth: "google",
    url: "https://gmail.googleapis.com/gmail/v1",
    readTools: [],
    reportTools: [],
    scopes: ["https://www.googleapis.com/auth/gmail.compose"],
    writeTools: [{ tool: "gmail_create_draft", actionType: "gmail.create_draft" }],
    signInHint: "Sign in as the same business mailbox. Only the gateway uses this sign-in, to put an email you approved in Drafts; you send it from Gmail.",
  },
  ga4: {
    id: "ga4",
    name: "Google Analytics",
    // Our own server (integrations/ga4-server.ts) over Google Analytics' Data and Admin APIs (card 152b).
    // Google's own Analytics MCP server runs on a person's machine with their own credentials, so it
    // can't be a business's connection. This sign-in is granted analytics.readonly alone: Google refuses
    // it any change to the account. Each tool runs one fixed report on the property the owner picked.
    auth: "google",
    url: "https://analyticsdata.googleapis.com/v1beta",
    readTools: ["ga4_properties", "ga4_overview", "ga4_top_pages", "ga4_channels"],
    reportTools: [],
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    writeTools: [],
    signInHint: "Sign in with a Google account that can see the business’s Google Analytics, and leave the one box Google shows ticked.",
  },
  mailchimp: {
    id: "mailchimp",
    name: "Mailchimp",
    // Our own server (integrations/mailchimp-server.ts) over Mailchimp's Marketing API (card 252).
    // Mailchimp's hosted MCP server isn't documented for other apps, and Mailchimp has no narrower key:
    // every key reaches the whole account. So our server is the limit: these two reads, asking
    // Mailchimp for counts and names only, never a member or an email address.
    auth: "token",
    url: "https://mailchimp.com/developer/marketing/api/",
    readTools: ["mailchimp_audiences", "mailchimp_campaigns"],
    reportTools: [],
    scopes: ["a Mailchimp API key (Mailchimp keys can't be narrowed; our server only reads audience counts and campaign reports)"],
    writeTools: [],
    signInHint: "In Mailchimp: your profile picture, Profile, Extras, API keys, Create A Key, name it OPERATOR agents, Generate Key, then copy it (it ends in -us and a number) and paste it here.",
  },
  mailchimp_drafts: {
    id: "mailchimp_drafts",
    name: "Mailchimp campaign drafts",
    // A second key, held only by the gateway: one tool, a draft campaign to one of the business's own
    // audiences after an approver approves. Our server has no send, schedule or delete code, so the
    // owner sends every campaign from Mailchimp.
    auth: "token",
    url: "https://mailchimp.com/developer/marketing/api/",
    readTools: [],
    reportTools: [],
    scopes: ["a second Mailchimp API key, used only to make a draft campaign you approved"],
    writeTools: [{ tool: "mailchimp_create_draft", actionType: "mailchimp.campaign_draft" }],
    signInHint: "Make a second key the same way (name it OPERATOR drafts) and paste it here. Only the gateway uses it, after you approve; you send from Mailchimp.",
  },
  woo: {
    id: "woo",
    name: "WooCommerce",
    // Our own server (integrations/woo-server.ts) over the store's REST API (card 254). WooCommerce's MCP
    // adapter is a per-store plugin in preview with no read-only mode. This key is a WooCommerce Read
    // key (a Read/Write key is refused when pasted); the server asks the store for no customer name,
    // email, phone or address. The store address must be a public https host, checked before every request.
    auth: "token",
    url: "https://woocommerce.github.io/woocommerce-rest-api-docs/",
    readTools: ["woo_orders", "woo_low_stock"],
    reportTools: [],
    scopes: ["a WooCommerce REST key with Read permission (a Read/Write key is refused)"],
    writeTools: [],
    signInHint: "In WordPress: WooCommerce, Settings, Advanced, REST API, Add key. Name it OPERATOR agents, pick your user, set Permissions to Read, tap Generate API key. Paste your store’s address, the Consumer key and the Consumer secret here, separated by spaces.",
  },
  woo_notes: {
    id: "woo_notes",
    name: "WooCommerce order notes",
    // A second key, held only by the gateway: a Read/Write key (a Read key is refused), used for one tool,
    // a private note on an order after an approver approves. Our server has no other write.
    auth: "token",
    url: "https://woocommerce.github.io/woocommerce-rest-api-docs/",
    readTools: [],
    reportTools: [],
    scopes: ["a WooCommerce REST key with Read/Write permission, used only to add a private note you approved"],
    writeTools: [{ tool: "woo_add_order_note", actionType: "woocommerce.order_note" }],
    signInHint: "Make a second key the same way, named OPERATOR order notes, with Permissions set to Read/Write. Paste the store’s address, Consumer key and Consumer secret here. Only the gateway uses it, to add a private note you approved.",
  },
  hubspot: {
    id: "hubspot",
    name: "HubSpot",
    // Our own server (integrations/hubspot-server.ts) over HubSpot's CRM API (card 253). HubSpot's hosted
    // MCP server takes its scopes from its own tool list, writes included. This is a service key with
    // read scopes only (a key that can change deals is refused when pasted); the server asks HubSpot for
    // no contact list, email or phone, only deals and counts.
    auth: "token",
    url: "https://developers.hubspot.com/docs/api-reference/latest/crm/objects/deals/guide",
    readTools: ["hubspot_deals", "hubspot_contacts"],
    reportTools: [],
    scopes: ["a HubSpot service key with crm.objects.deals.read, crm.objects.contacts.read and crm.objects.companies.read only (a key that can change deals is refused)"],
    writeTools: [],
    signInHint: "In HubSpot: Development, Keys, Service keys, Create service key. Name it OPERATOR agents, add the scopes crm.objects.deals.read, crm.objects.contacts.read and crm.objects.companies.read, tap Create, then copy the key here.",
  },
  hubspot_deals: {
    id: "hubspot_deals",
    name: "HubSpot deal moves",
    // A second service key, held only by the gateway: deal read and write (a key that can't change deals
    // is refused), used for one tool, moving a deal to another stage of its own pipeline with a note,
    // after an approver approves. Our server has no other write.
    auth: "token",
    url: "https://developers.hubspot.com/docs/api-reference/latest/crm/objects/deals/guide",
    readTools: [],
    reportTools: [],
    scopes: ["a second HubSpot service key with crm.objects.deals.read and crm.objects.deals.write, used only to move a deal you approved and note why"],
    writeTools: [{ tool: "hubspot_move_deal", actionType: "hubspot.deal_stage" }],
    signInHint: "Make a second service key named OPERATOR deal moves with the scopes crm.objects.deals.read and crm.objects.deals.write, and paste it here. Only the gateway uses it, after you approve.",
  },
  stripe: {
    id: "stripe",
    name: "Stripe",
    // Our own server (integrations/stripe-server.ts, card 240). Stripe's hosted MCP server has only
    // generic tools (any GET, any write, refunds included) and no read-only switch, so it can't be held
    // to named tools. A restricted key with Read on five lists, refused when it can change anything.
    // Each tool runs one fixed request (core/stripe-rules.ts); sums are made in code.
    auth: "token",
    url: "https://api.stripe.com/v1",
    readTools: STRIPE_READ_TOOLS,
    reportTools: [],
    scopes: ["a Stripe restricted key with Read on Balance, Balance transaction sources, Subscriptions, Invoices and Customers, and None on everything else (a key that can change anything is refused)"],
    writeTools: [],
    signInHint: "In Stripe: Developers, API keys, Create restricted key, name it OPERATOR read. Set Balance, Balance transaction sources, Subscriptions, Invoices and Customers to Read, leave everything else None, then Create key. Paste it here (rk_…).",
  },
  stripe_drafts: {
    id: "stripe_drafts",
    name: "Stripe invoice drafts",
    // A second restricted key, held only by the gateway (card 240): Write on Invoices and Invoice
    // items, Read on Customers, None on everything else (refunds, charges, payouts and customers
    // writes are refused when it is pasted). One tool: a draft invoice with auto_advance off. The
    // server has no finalize, send, pay, void or refund code, so the owner finalizes in Stripe.
    auth: "token",
    url: "https://api.stripe.com/v1",
    readTools: [],
    reportTools: [],
    scopes: ["a Stripe restricted key with Write on Invoices and Invoice items, Read on Customers, and None on everything else, used only to make a draft invoice"],
    writeTools: [{ tool: STRIPE_DRAFT_TOOL, actionType: "stripe.invoice_draft" }],
    signInHint: "In Stripe: Developers, API keys, Create restricted key, name it OPERATOR invoice drafts. Set Invoices to Write (and Invoice items too, if Stripe lists it on its own), Customers to Read, leave everything else None, then Create key. Paste it here (rk_…). Only the gateway uses it, after you approve; you finalize and send from Stripe.",
  },
  calendar: {
    id: "calendar",
    name: "Google Calendar",
    // Our own server (integrations/calendar-server.ts) over Google Calendar's API (card 251). Google's
    // Calendar MCP server is a gated Developer Preview. This sign-in is granted calendar.events.readonly
    // alone: it reads the primary calendar's events, and the server asks Google for no attendee email,
    // description, place or link. Free slots are worked out in code (core/calendar-rules.ts).
    auth: "google",
    url: "https://www.googleapis.com/calendar/v3",
    readTools: ["calendar_events", "calendar_free"],
    reportTools: [],
    scopes: ["https://www.googleapis.com/auth/calendar.events.readonly"],
    writeTools: [],
    signInHint: "Sign in with the Google account whose calendar the business runs on, and leave the one box Google shows ticked.",
  },
  calendar_holds: {
    id: "calendar_holds",
    name: "Calendar holds",
    // A second Google sign-in, held only by the gateway: calendar.events, used for one tool, a private
    // hold with no guests on the primary calendar after an approver approves, made with
    // sendUpdates=none so it emails no one. Our server has no update, move or delete code.
    auth: "google",
    url: "https://www.googleapis.com/calendar/v3",
    readTools: [],
    reportTools: [],
    scopes: ["https://www.googleapis.com/auth/calendar.events"],
    writeTools: [{ tool: "calendar_create_hold", actionType: "calendar.hold" }],
    signInHint: "Sign in with the same Google account. Only the gateway uses this sign-in, to put a private hold you approved on the calendar; it never invites or emails anyone.",
  },
  meta: {
    id: "meta",
    name: "Meta Ads",
    // Our own server (integrations/meta-server.ts) over the Marketing API (card 255). Meta's hosted Ads
    // MCP server asks for ads_management on every sign-in. This sign-in asks for ads_read alone: ad
    // accounts, and spend and results per ad, with cost per result worked out in code
    // (core/meta-rules.ts). Meta grants permissions to a person and an app, not to one sign-in, so once
    // the same person connects pauses this sign-in can manage ads too; our server only reads with it.
    auth: "meta",
    url: "https://graph.facebook.com/v26.0",
    readTools: ["meta_ad_accounts", "meta_ad_results"],
    reportTools: [],
    scopes: ["ads_read"],
    writeTools: [],
    signInHint: "Sign in with a Facebook account that can see the business’s ad account, and allow OPERATOR to read your ads.",
  },
  meta_pauses: {
    id: "meta_pauses",
    name: "Meta Ads pauses",
    // A second sign-in, held only by the gateway: ads_management, used for one tool, pausing one active
    // ad that is over its cost target right now, after an approver approves. Our server has no budget,
    // bid, create, resume or delete code: budget changes wait for a cap the owner sets.
    auth: "meta",
    url: "https://graph.facebook.com/v26.0",
    readTools: [],
    reportTools: [],
    scopes: ["ads_management"],
    writeTools: [{ tool: "meta_pause_ad", actionType: "meta.pause_ad" }],
    signInHint: "Sign in with the same Facebook account and allow OPERATOR to manage your ads. Only the gateway uses this sign-in, to pause an ad you approved; it can’t change a budget or start anything.",
  },
} as const satisfies Record<string, McpServer>;
export type McpId = keyof typeof MCP_SERVERS;
export const MCP_IDS = Object.keys(MCP_SERVERS) as McpId[];
export const isMcpId = (s: string): s is McpId => s in MCP_SERVERS;

/** Code calls only the tools named for that server. */
export function mayCall(id: string, tool: string): boolean {
  return isMcpId(id) && (MCP_SERVERS[id].readTools as readonly string[]).includes(tool);
}

/** A server's write tools: only core/gateway calls one, after an approver approves (integrations/mcp.ts callWriteTool). */
export function mayWrite(id: string, tool: string): boolean {
  return isMcpId(id) && (MCP_SERVERS[id].writeTools as readonly { tool: string }[]).some((w) => w.tool === tool);
}

/** Every tool the tool check watches on a server: its read tools and its write tools. */
export const checkedTools = (id: McpId): string[] => [...MCP_SERVERS[id].readTools, ...(MCP_SERVERS[id].writeTools as readonly { tool: string }[]).map((w) => w.tool)];

/** Report tools: code-delivered writes into the business's own workspace, only on a server we run. */
export function mayReport(id: string, tool: string): boolean {
  return isMcpId(id) && MCP_SERVERS[id].auth === "token" && (MCP_SERVERS[id].reportTools as readonly string[]).includes(tool);
}

/** Hosted servers, signed in on their own page (Connect) with dynamic client registration. */
export const isHosted = (id: McpId) => MCP_SERVERS[id].auth === "oauth";
/** Servers we run ourselves, signed in on Google's page with our own OAuth client. */
export const isGoogle = (id: McpId) => MCP_SERVERS[id].auth === "google";
export const isMeta = (id: McpId) => MCP_SERVERS[id].auth === "meta";
/** Signed in with a Connect button (hosted or Google), not a pasted key. */
export const usesConnect = (id: McpId) => MCP_SERVERS[id].auth !== "token";

/** Google's fixed sign-in addresses (no discovery, no self-registration: our own OAuth client). */
/** Facebook Login with OPERATOR's Meta app, on the one Graph API version our Meta server pins. No revoke address: a sign-in is removed in Facebook's own settings. */
export const META_AUTH: AuthServer = {
  authorization_endpoint: "https://www.facebook.com/v26.0/dialog/oauth",
  token_endpoint: "https://graph.facebook.com/v26.0/oauth/access_token",
};

export const GOOGLE_AUTH: AuthServer = {
  authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
  token_endpoint: "https://oauth2.googleapis.com/token",
  revocation_endpoint: "https://oauth2.googleapis.com/revoke",
};

/** The scopes a token reply says were granted, or null when it doesn't say. */
export function grantedScopes(j: unknown): string[] | null {
  const s = obj(j).scope;
  return typeof s === "string" ? s.split(/\s+/).filter(Boolean) : null;
}

/**
 * Why a sign-in's granted scopes aren't the profile's, or null when they match. Google lets the
 * person untick a box, and an OAuth client can carry older grants, so both ways are refused: a
 * missing scope (the tools wouldn't work) and an extra one (more reach than the profile needs).
 */
export function scopeProblem(granted: readonly string[] | null, wanted: readonly string[]): string | null {
  if (!granted) return "the sign-in didn't say what it was granted";
  const extra = granted.filter((g) => !wanted.includes(g));
  const missing = wanted.filter((w) => !granted.includes(w));
  if (missing.length) return `the sign-in wasn't granted ${missing.join(", ")} (leave the box ticked on Google's page)`;
  if (extra.length) return `the sign-in was granted more than it needs (${extra.join(", ")})`;
  return null;
}

export const MCP_PROTOCOL = "2025-06-18";

// ---- JSON-RPC over Streamable HTTP: a reply is plain JSON or a short event stream.

export type RpcReply = { result: unknown } | { error: string };

/** The reply to request `id`, from a JSON body or an event stream's data lines. */
export function parseRpc(contentType: string | null, body: string, id: number): RpcReply {
  const msgs: unknown[] = [];
  if ((contentType ?? "").includes("text/event-stream")) {
    for (const ev of body.split(/\r?\n\r?\n/)) {
      const data = ev.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n");
      if (!data) continue;
      try { msgs.push(JSON.parse(data)); } catch { /* not JSON: skip */ }
    }
  } else {
    try { const j = JSON.parse(body); msgs.push(...(Array.isArray(j) ? j : [j])); } catch { return { error: `the server sent something that isn't JSON: ${body.slice(0, 120)}` }; }
  }
  const m = msgs.find((x) => !!x && typeof x === "object" && (x as { id?: unknown }).id === id) as { result?: unknown; error?: { message?: string } } | undefined;
  if (!m) return { error: "the server didn't answer the request" };
  if (m.error) return { error: String(m.error.message ?? "error").slice(0, 300) };
  return { result: m.result };
}

/**
 * What a tools/call gave back, as data: structuredContent when the server sends it, else the JSON
 * in its first text block, else the text. A single `result` wrapper is taken off.
 */
export function toolPayload(result: unknown): { data: unknown } | { error: string } {
  const r = (result ?? {}) as { isError?: boolean; structuredContent?: unknown; content?: { type: string; text?: string }[] };
  const text = (r.content ?? []).filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text!).join("\n");
  if (r.isError) return { error: text.slice(0, 300) || "the tool failed" };
  let data: unknown = r.structuredContent;
  if (data === undefined) { try { data = JSON.parse(text); } catch { data = text; } }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const keys = Object.keys(data);
    if (keys.length === 1 && keys[0] === "result") data = (data as { result: unknown }).result;
  }
  return { data };
}

// ---- Reading Klaviyo's replies. Every number is taken from the raw reply and added up here.

type Json = Record<string, unknown>;
const obj = (x: unknown): Json => (x && typeof x === "object" && !Array.isArray(x) ? (x as Json) : {});
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const num = (x: unknown): number => (typeof x === "number" && Number.isFinite(x) ? x : 0);
const str = (x: unknown, max = 160): string => (typeof x === "string" ? x.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Rows of a JSON:API list reply (lists, metrics): id and name. */
export function namedRows(payload: unknown): { id: string; name: string }[] {
  return arr(obj(payload).data).map((d) => ({ id: str(obj(d).id, 40), name: str(obj(obj(d).attributes).name) })).filter((r) => r.id);
}

/** The cursor for the next page, from links.next (`page[cursor]=…`), or null. */
export function nextCursor(payload: unknown): string | null {
  const next = obj(obj(payload).links).next;
  if (typeof next !== "string" || !next) return null;
  try { return new URL(next).searchParams.get("page[cursor]"); } catch { return null; }
}

/** A list's name and profile count from get_list with profile_count. */
export function listSize(payload: unknown): { id: string; name: string; profiles: number } | null {
  const d = obj(obj(payload).data);
  const a = obj(d.attributes);
  if (!str(d.id) || typeof a.profile_count !== "number" || !Number.isFinite(a.profile_count)) return null;
  return { id: str(d.id, 40), name: str(a.name), profiles: a.profile_count };
}

export const REPORT_PERIODS = ["last_7_days", "last_30_days", "last_90_days", "last_365_days"] as const;
export const REPORT_STATS = ["recipients", "delivered", "opens_unique", "clicks_unique", "conversions", "unsubscribes"] as const;
export interface ReportRow { name: string; channel: string; sent: string; recipients: number; delivered: number; opens: number; clicks: number; orders: number; revenue: number; unsubscribes: number }

/** One row per campaign or flow message, with the counts it reported. Names are the business's own words, still shown as data. */
export function reportRows(payload: unknown, kind: "campaign" | "flow"): ReportRow[] {
  return arr(obj(obj(obj(payload).data).attributes).results).map((x) => {
    const r = obj(x), s = obj(r.statistics), g = obj(r.groupings);
    const det = obj(obj(kind === "campaign" ? r.campaign_details : r.flow_details).attributes);
    return {
      name: str(det.name) || str(g.flow_name) || str(g.campaign_message_name) || str(g[`${kind}_id`], 40),
      channel: str(g.send_channel, 30),
      sent: str(det.send_time, 40),
      recipients: num(s.recipients), delivered: num(s.delivered), opens: num(s.opens_unique), clicks: num(s.clicks_unique),
      orders: num(s.conversions), revenue: num(s.conversion_value), unsubscribes: num(s.unsubscribes),
    };
  });
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const rate = (a: number, b: number) => (b > 0 ? r2((a / b) * 100) : 0);

/** Totals and rates over the rows, worked out here (rates in percent of delivered). */
export function reportTotals(rows: readonly ReportRow[]): Record<string, number> {
  const sum = (k: keyof ReportRow) => rows.reduce((t, r) => t + (r[k] as number), 0);
  const delivered = sum("delivered");
  return {
    messages: rows.length, recipients: sum("recipients"), delivered,
    opens: sum("opens"), clicks: sum("clicks"), orders: sum("orders"), revenue_usd: r2(sum("revenue")), unsubscribes: sum("unsubscribes"),
    open_rate_pct: rate(sum("opens"), delivered), click_rate_pct: rate(sum("clicks"), delivered), unsubscribe_rate_pct: rate(sum("unsubscribes"), delivered),
  };
}

// ---- Signing in (OAuth 2.1 with PKCE and dynamic client registration, as MCP's auth spec says).

/** Where to look for the server's sign-in details: the protected-resource document first, then the server's own origin. */
export function discoveryUrls(serverUrl: string): { resource: string[]; authServer: (issuer: string) => string[] } {
  const u = new URL(serverUrl);
  const path = u.pathname.replace(/\/+$/, "");
  return {
    resource: [`${u.origin}/.well-known/oauth-protected-resource${path}`, `${u.origin}/.well-known/oauth-protected-resource`],
    authServer: (issuer: string) => {
      const i = new URL(issuer);
      const p = i.pathname.replace(/\/+$/, "");
      return p
        ? [`${i.origin}/.well-known/oauth-authorization-server${p}`, `${i.origin}/.well-known/openid-configuration${p}`, `${i.origin}${p}/.well-known/openid-configuration`]
        : [`${i.origin}/.well-known/oauth-authorization-server`, `${i.origin}/.well-known/openid-configuration`];
    },
  };
}

/** The server address without its query (what a token is for, RFC 8707). */
export const resourceOf = (serverUrl: string) => { const u = new URL(serverUrl); return `${u.origin}${u.pathname}`; };

export interface AuthServer { authorization_endpoint: string; token_endpoint: string; registration_endpoint?: string; revocation_endpoint?: string; scopes_supported?: string[] }

/** The sign-in details, checked: every endpoint https. */
export function readAuthServer(j: unknown): AuthServer | null {
  const o = obj(j);
  const https = (x: unknown) => typeof x === "string" && /^https:\/\//.test(x);
  if (!https(o.authorization_endpoint) || !https(o.token_endpoint)) return null;
  if (o.registration_endpoint !== undefined && !https(o.registration_endpoint)) return null;
  return {
    authorization_endpoint: o.authorization_endpoint as string, token_endpoint: o.token_endpoint as string,
    registration_endpoint: o.registration_endpoint as string | undefined,
    // a revoke address that isn't https is ignored, not trusted
    revocation_endpoint: https(o.revocation_endpoint) ? (o.revocation_endpoint as string) : undefined,
    scopes_supported: Array.isArray(o.scopes_supported) ? (o.scopes_supported as unknown[]).filter((s): s is string => typeof s === "string") : undefined,
  };
}

/** The address the owner's browser goes to, to say yes on the server's own sign-in page. */
export function authorizeUrl(a: AuthServer, o: { clientId: string; redirectUri: string; challenge: string; state: string; resource?: string; scope?: string; extra?: Record<string, string> }): string {
  const u = new URL(a.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", o.clientId);
  u.searchParams.set("redirect_uri", o.redirectUri);
  u.searchParams.set("code_challenge", o.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("state", o.state);
  if (o.resource) u.searchParams.set("resource", o.resource);
  if (o.scope) u.searchParams.set("scope", o.scope);
  for (const [k, v] of Object.entries(o.extra ?? {})) u.searchParams.set(k, v);
  return u.toString();
}

export interface Tokens { accessToken: string; refreshToken: string | null; expiresAt: number | null }

/** A token reply, checked. `now` in ms. */
export function readTokens(j: unknown, now: number, keepRefresh: string | null = null): Tokens | null {
  const o = obj(j);
  if (typeof o.access_token !== "string" || !o.access_token) return null;
  const exp = typeof o.expires_in === "number" && o.expires_in > 0 ? now + o.expires_in * 1000 : null;
  return { accessToken: o.access_token, refreshToken: typeof o.refresh_token === "string" && o.refresh_token ? o.refresh_token : keepRefresh, expiresAt: exp };
}

/** Refresh a minute early. */
export const needsRefresh = (t: Tokens, now: number) => t.expiresAt != null && t.expiresAt - now < 60_000;

// ---- The tool check (slice 3): a server's tools must still be the ones code was written against.

/** A tool as the server lists it: its name and what inputs it takes. */
export interface ListedTool { name: string; inputSchema: unknown }

const canon = (x: unknown): unknown => Array.isArray(x) ? x.map(canon) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x as object).sort().map((k) => [k, canon((x as Record<string, unknown>)[k])])) : x;

/** A short fingerprint of a tool's inputs (key order doesn't matter; descriptions do, kept simple on purpose). */
export function toolFingerprint(t: ListedTool): string {
  return createHash("sha256").update(JSON.stringify(canon(t.inputSchema ?? null))).digest("base64url").slice(0, 16);
}

/** The tools in one tools/list reply, and the cursor for the next page. */
export function listedTools(result: unknown): { tools: ListedTool[]; next: string | null } {
  const r = obj(result);
  const tools = arr(r.tools).map((t) => ({ name: str(obj(t).name, 120), inputSchema: obj(t).inputSchema })).filter((t) => t.name);
  return { tools, next: typeof r.nextCursor === "string" && r.nextCursor ? r.nextCursor : null };
}

export interface ToolCheck { missing: string[]; changed: string[]; seen: Record<string, string> }

/**
 * Compares the profile's read tools with what the server lists now. `missing`: gone from the
 * server. `changed`: inputs differ from the last accepted fingerprint. `seen`: the fingerprints now,
 * saved when the check passes or the owner signs in again.
 */
export function checkTools(readTools: readonly string[], listed: readonly ListedTool[], accepted: Record<string, string> | null): ToolCheck {
  const by = new Map(listed.map((t) => [t.name, t]));
  const seen: Record<string, string> = {};
  const missing: string[] = [], changed: string[] = [];
  for (const name of readTools) {
    const t = by.get(name);
    if (!t) { missing.push(name); continue; }
    seen[name] = toolFingerprint(t);
    if (accepted && accepted[name] && accepted[name] !== seen[name]) changed.push(name);
  }
  return { missing, changed, seen };
}

/** In words, for the paused note and the log. Empty when the check passed. */
export function toolCheckNote(c: ToolCheck): string {
  const parts: string[] = [];
  if (c.missing.length) parts.push(`no longer offers ${c.missing.join(", ")}`);
  if (c.changed.length) parts.push(`changed the inputs of ${c.changed.join(", ")}`);
  return parts.length ? `the server ${parts.join(" and ")}` : "";
}

/** How long a passed check holds before the next call checks again. */
export const TOOL_CHECK_HOURS = 6;

// ---- Keeping sign-ins safe (docs/mcp-everywhere.md, slice 2).

/**
 * The scopes to ask for: the profile's own list, cut to what the server says it supports. When the
 * server supports none of them the sign-in is not started, rather than asking for everything.
 */
export function pickScopes(wanted: readonly string[], supported?: readonly string[]): { scope: string; missing: string[] } {
  if (!supported?.length) return { scope: wanted.join(" "), missing: [] };
  const ok = wanted.filter((s) => supported.includes(s));
  if (!ok.length) throw new Error(`the server offers none of the scopes code asks for (${wanted.join(", ")}); it offers: ${supported.slice(0, 20).join(", ")}`);
  return { scope: ok.join(" "), missing: wanted.filter((s) => !supported.includes(s)) };
}

const HIDDEN = "[hidden]";

/**
 * Takes sign-in values out of text before it is saved or shown: the given secrets wherever they
 * appear, bearer tokens, and token fields in JSON or form bodies a server may echo back.
 */
export function scrubSecrets(text: string, secrets: readonly (string | null | undefined)[] = []): string {
  let out = text;
  for (const s of secrets) if (s && s.length >= 8) out = out.split(s).join(HIDDEN);
  return out
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${HIDDEN}`)
    .replace(/("(?:access_token|refresh_token|id_token|client_secret|code|code_verifier|token)"\s*:\s*")[^"]*(")/gi, `$1${HIDDEN}$2`)
    .replace(/(\b(?:access_token|refresh_token|id_token|client_secret|code|code_verifier|token)=)[^&\s"]+/gi, `$1${HIDDEN}`);
}

/** What the sign-in log records. Never a token value. */
export const MCP_EVENTS = ["connected", "refreshed", "refresh_failed", "refused", "revoked", "revoke_failed", "disconnected", "resealed", "tools_changed", "tools_checked", "added", "tool_on", "tool_off", "paused", "resumed", "tools_accepted"] as const;
export type McpEvent = (typeof MCP_EVENTS)[number];

/** A connection row as the status query reads it (card 202): never the sealed secret. */
export interface StatusRow { id: string; settings: Record<string, string> | null; connected_at: string | null; last_error: string | null; paused_at: string | null; tools_seen: Record<string, string> | null; tools_checked_at: string | null }

/** Every signed-in connection's status by id, from one query's rows (only rows with a saved sign-in are read). */
export function statusMap(rows: readonly StatusRow[]): Record<string, { connected: boolean; paused: boolean; connectedAt: string | null; lastError: string | null; settings: Record<string, string>; toolsCheckedAt: string | null; toolsSeen: string[] }> {
  return Object.fromEntries(rows.map((r) => [r.id, { connected: true, paused: !!r.paused_at, connectedAt: r.connected_at ?? null, lastError: r.last_error ?? null, settings: r.settings ?? {}, toolsCheckedAt: r.tools_checked_at ?? null, toolsSeen: Object.keys(r.tools_seen ?? {}) }]));
}
