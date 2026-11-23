"use server";
// OPERATOR's own MCP server (docs/operator-mcp.md, slice 1): the consent page's Allow, and Disconnect on
// Settings > Connected apps. Any member may connect Claude for themselves (a viewer reads only; the server
// offers each tool by role, checked again on every call). Each action checks the member first.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { audit } from "@/core/audit";
import { originOf, readAuthorize, withQuery } from "@/core/operator-mcp-rules";
import { clientSecret, revokeApp, startGrant } from "@/core/operator-mcp";
import type { ActionResult } from "./actions";
import { asRole } from "./data";

async function selfOrigin() {
  const h = await headers();
  return originOf(`https://${h.get("host") ?? "localhost"}/`, h.get("x-forwarded-host"), h.get("x-forwarded-proto"));
}

/** Allow on the consent page: checks the request again, makes the grant, and returns to the app with a code. */
export async function allowApp(form: FormData): Promise<void> {
  const { me, no } = await asRole("viewer"); if (no) throw new Error(no.text);
  const q = Object.fromEntries(["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "response_type", "resource"].map((k) => [k, form.get(k) == null || form.get(k) === "" ? undefined : String(form.get(k))]));
  const r = readAuthorize(q, clientSecret(), await selfOrigin());
  if ("problem" in r) throw new Error(r.problem);
  const code = await startGrant(me, me.orgId, { name: r.ask.client.name, redirectUri: r.ask.redirectUri, challenge: r.ask.challenge });
  await audit(me, "connect_app", r.ask.client.name, { returns_to: new URL(r.ask.redirectUri).host });
  redirect(withQuery(r.ask.redirectUri, { code, state: r.ask.state }));
}

/** Disconnect: a member ends their own connection; an owner ends anyone's. */
export async function disconnectApp(id: string): Promise<ActionResult> {
  const { me, no } = await asRole("viewer"); if (no) return no;
  try {
    const name = await revokeApp(me, String(id));
    await audit(me, "disconnect_app", name, { grant: String(id) });
    revalidatePath("/settings", "layout");
    return { ok: true, text: `${name} is disconnected. It can't reach OPERATOR until someone connects it again.` };
  } catch (e) { return { ok: false, text: e instanceof Error ? e.message : String(e) }; }
}
