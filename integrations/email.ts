import "server-only";
// Email to the owner, and only to the owner: the morning brief and (later) alerts. It goes through
// Resend's API from a sending address on the app's own domain, so no agent ever holds a
// Gmail send scope. There is deliberately no recipient argument: the address is the business's owner
// email (Settings, always one of its owners' sign-in addresses), and nothing a model, a web page or an inbound email says can change it.
// Messages to anyone else are gateway action types (core/gateway), not this file.
import { env } from "@/core/env";
import { settings } from "@/core/settings";
import { emailLine } from "@/core/settings-rules";

/** Whether the app can send email (Resend and a sender are set) and this business has an owner email. */
export const hasEmail = async () => !!(env.resendKey && env.briefFrom && (await settings()).ownerEmail);

/** Whether the brief and alerts are emailed, and to whom, in an owner's words (core/settings-rules.ts emailLine). */
export const emailState = async () => emailLine((await settings()).ownerEmail, !!(env.resendKey && env.briefFrom));

/** Sends one email to the current business's owner email and returns Resend's message id. */
export async function emailOwner(subject: string, html: string, text: string) {
  const to = (await settings()).ownerEmail;
  if (!env.resendKey || !env.briefFrom) throw new Error("RESEND_API_KEY and BRIEF_FROM must be set");
  if (!to) throw new Error("This business has no owner email yet (Settings > Business > Where things go)");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.briefFrom, to: [to], subject, html, text }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  return (await res.json() as { id: string }).id;
}
