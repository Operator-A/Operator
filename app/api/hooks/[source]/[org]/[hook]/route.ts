import { NextResponse, after } from "next/server";
import { isUuid } from "@/core/job-rules";
import { HOOK_ID, MAX_BODY, isEventSource, readEvent } from "@/core/event-rules";
import { keepEvent, startForEvent } from "@/core/events";
import { checkHook } from "@/integrations/mcp";
import { withOrg } from "@/core/tenancy";

export const maxDuration = 60;

// Live events (docs/live-events.md, slice 1): a business's hook address for one service,
// /api/hooks/<source>/<org>/<hook id>. The org id names the business, so everything runs as that org
// through withOrg and no read crosses businesses; the hook id must match the one saved on Connections,
// and the signature must check out under the business's signing secret (integrations/mcp.ts checkHook).
// A bad one gets an error and nothing is kept. A good one is kept (a retry is a duplicate), answered
// at once, and only then matched to the saved chains (core/events.ts), so the service never waits on a run.
const HEADERS = ["x-shopify-hmac-sha256", "x-shopify-topic", "x-shopify-event-id", "x-shopify-webhook-id", "stripe-signature"] as const;

export async function POST(req: Request, { params }: { params: Promise<{ source: string; org: string; hook: string }> }) {
  const { source, org, hook } = await params;
  if (!isEventSource(source) || !isUuid(org) || !HOOK_ID.test(hook)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BODY) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const raw = await req.text();
  if (raw.length > MAX_BODY) return NextResponse.json({ error: "Too large" }, { status: 413 });
  const headers = Object.fromEntries(HEADERS.map((h) => [h, req.headers.get(h)]));
  const origin = new URL(req.url).origin;
  return withOrg(org, async () => {
    let check: Awaited<ReturnType<typeof checkHook>>;
    try { check = await checkHook(source, hook, raw, headers); }
    catch (e) { console.error("[hooks] check", e instanceof Error ? e.message : e); return NextResponse.json({ error: "Can't check it now" }, { status: 503 }); }
    if (!check.ok) return NextResponse.json({ error: check.why }, { status: check.status });
    const read = readEvent(source, headers, raw);
    if ("ignore" in read) return NextResponse.json({ received: true, ignored: read.ignore });
    let id: string | null;
    // a database hiccup answers 500, and the service sends the event again later
    try { id = await keepEvent(source, read.event.providerId, read.event.facts); }
    catch (e) { console.error("[hooks] keep", e instanceof Error ? e.message : e); return NextResponse.json({ error: "Not kept" }, { status: 500 }); }
    if (!id) return NextResponse.json({ received: true, duplicate: true });
    const kept = id, facts = read.event.facts;
    after(() => withOrg(org, () => startForEvent(origin, kept, facts).catch((e) => console.error("[hooks] start", e instanceof Error ? e.message : e))));
    return NextResponse.json({ received: true });
  });
}
