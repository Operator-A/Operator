import { NextResponse } from "next/server";
import { db } from "@/core/db";
import { env } from "@/core/env";
import { settings } from "@/core/settings";
import { hasEmail } from "@/integrations/email";
import { NO_ORG_PARAM, cronAuthorized, orgParam } from "@/core/runs";
import { withOrg } from "@/core/tenancy";
import { notionConnected } from "@/integrations/notion";
import { hasMercury } from "@/integrations/mercury";
import { localReady } from "@/integrations/mcp";
import { hasGmail } from "@/integrations/gmail";
import { hasGmailRead } from "@/integrations/gmail-read";

// Which settings are present for one business (?org=<org id>) and whether Supabase answers. Never
// returns a secret's value.
export async function GET(req: Request) {
  if (!cronAuthorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const org = orgParam(req);
  if (!org) return NextResponse.json({ error: NO_ORG_PARAM }, { status: 400 });
  return withOrg(org, check);
}

async function check() {
  const s = await settings();
  const set = {
    supabase: !!(env.supabaseUrl && env.supabaseServiceKey),
    shopify: !!s.shopifyDomain && (await localReady("shopify")),
    mercury: !!s.mercuryAccountIds.length && (await hasMercury()),
    notion: !!s.notionBriefParent && (await notionConnected()),
    email: await hasEmail(),
    gmail: await hasGmail(),
    gmail_read: await hasGmailRead(),
    ga4: await localReady("ga4"),
    stripe: await localReady("stripe"),
    quickbooks: await localReady("quickbooks"),
    calendar: await localReady("calendar"),
    calendar_holds: await localReady("calendar_holds"),
    mailchimp: await localReady("mailchimp"),
    mailchimp_drafts: await localReady("mailchimp_drafts"),
    woo: await localReady("woo"),
    woo_notes: await localReady("woo_notes"),
    hubspot: await localReady("hubspot"),
    hubspot_deals: await localReady("hubspot_deals"),
    meta: await localReady("meta"),
    meta_pauses: await localReady("meta_pauses"),
  };
  let agents: { id: string; enabled: boolean }[] | string = "not checked";
  if (set.supabase) {
    const { data, error } = await db().from("agents").select("id, enabled").order("id");
    agents = error ? `error: ${error.message}` : data ?? [];
  }
  return NextResponse.json({ set, agents });
}
