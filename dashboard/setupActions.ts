"use server";
// First-run setup actions (card 151, docs/setup.md). Each checks the login and role again. A message to
// Avery makes real model calls, so it also needs DASHBOARD_CONTROLS=on, like her chat.
import { revalidatePath } from "next/cache";
import { addFact, askSetup, confirmFact, editFact, ensureAvery, finishSetup, inSetup, removeFact, type SetupAnswer } from "@/core/setup";
import { cleanMessage } from "@/core/chat-rules";
import { withActor } from "@/core/actor";
import { audit } from "@/core/audit";
import { installTemplates } from "@/core/install";
import { saveSettingsFields } from "@/core/settings";
import { askFor } from "@/core/connector-requests";
import { routeUnlisted } from "@/core/tools-step-rules";
import { asRole } from "./data";
import { controlsOn } from "./session";
import type { ActionResult } from "./actions";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/start"); return { ok: true, text }; };

export async function sendSetup(raw: string, site: string): Promise<SetupAnswer> {
  const none = (reply: string): SetupAnswer => ({ ok: false, reply, notes: [], runId: null, costUsd: 0, kept: false, saved: 0, suggested: 0 });
  const { me, no } = await asRole("approver");
  if (no) return none(no.text);
  if (!controlsOn()) return none("Controls are off, so I can’t answer: each message is a real model call. Set DASHBOARD_CONTROLS=on in Vercel.");
  const m = cleanMessage(raw);
  if ("problem" in m) return none(m.problem);
  if (typeof site !== "string" || site.length > 300) return none("That site address is too long.");
  try {
    if (!(await inSetup())) return none("Setup is finished for this business. Talk to me from the chat on any page.");
    const a = await withActor(me.email, () => askSetup(m.text, site));
    revalidatePath("/start");
    return a;
  } catch (e) { return none(`Something went wrong: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`); }
}

export async function setupAddFact(topic: string, text: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  try { await addFact(String(topic), String(text ?? "").slice(0, 400)); await audit(me, "add_fact", String(topic)); return done("Saved."); } catch (e) { return fail(e); }
}

export async function setupEditFact(id: string, text: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown fact." };
  try { await editFact(id, String(text ?? "").slice(0, 400)); await audit(me, "edit_fact", id); return done("Saved in your words."); } catch (e) { return fail(e); }
}

export async function setupConfirmFact(id: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown fact." };
  try { await confirmFact(id); await audit(me, "confirm_fact", id); return done("Confirmed. Every agent now knows it."); } catch (e) { return fail(e); }
}

export async function setupRemoveFact(id: string): Promise<ActionResult> {
  const { me, no } = await asRole("approver"); if (no) return no;
  if (!UUID.test(String(id))) return { ok: false, text: "Unknown fact." };
  try { await removeFact(id); await audit(me, "remove_fact", id); return done("Removed."); } catch (e) { return fail(e); }
}

/** Step 3 until card 153: install the picked department templates beside Avery, which ends setup. */
export async function setupInstall(picked: string[]): Promise<ActionResult & { href?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const ids = (Array.isArray(picked) ? picked : []).map(String).slice(0, 20);
    await ensureAvery();
    const { counts } = await installTemplates(ids);
    await finishSetup();
    await audit(me, "install_template", ids.join(","), counts);
    revalidatePath("/", "layout");
    return { ok: true, href: "/", text: `Installed: ${counts.agents ?? 0} agents in ${counts.departments ?? 0} departments, all off duty. Approve each playbook on Crew before it runs.` };
  } catch (e) { return fail(e); }
}

/** Start empty: setup ends with Avery alone, and the founder builds the rest. */
export async function setupStartEmpty(): Promise<ActionResult & { href?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    await finishSetup();
    await audit(me, "finish_setup", "empty");
    revalidatePath("/", "layout");
    return { ok: true, href: "/", text: "Setup finished. Add departments on Crew > Org chart, or ask Avery to hire." };
  } catch (e) { return fail(e); }
}

/** Step 2 (card 152): the Shopify store's address, saved with the business's other settings before its key is pasted. */
export async function setupShopifyStore(domain: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const d = String(domain ?? "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(d)) return { ok: false, text: "Use the store’s .myshopify.com address, like your-store.myshopify.com." };
  try {
    const r = await saveSettingsFields({ shopifyDomain: d }, ["shopifyDomain"], () => 120);
    if ("problem" in r) return { ok: false, text: r.problem };
    await audit(me, "save_settings", null, { shopify: d });
    return done("Saved. Now paste the read-only key.");
  } catch (e) { return fail(e); }
}

/**
 * Step 2: a tool the founder uses that isn't a tile. Code routes it (core/tools-step-rules.ts): a tile, a
 * built-in, a known server to add by address, or a connection request. No model call; nothing is connected.
 */
export async function setupToolAsk(name: string): Promise<ActionResult & { href?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const r = routeUnlisted(String(name ?? ""));
  if ("problem" in r) return { ok: false, text: r.problem };
  if (r.kind === "tile") return { ok: true, text: `${r.name} is on the list above: open its card and follow the steps.`, href: `/start?c=${r.id}#step-2` };
  if (r.kind === "builtIn") return { ok: true, text: `${r.name} connects on Connections.`, href: r.href };
  if (r.kind === "known") return { ok: true, text: `${r.name} has its own server. Add it on Connections with its address filled in: you turn on each read-only tool yourself.`, href: r.href };
  try {
    await askFor({ name: r.name, what: "A tool the business already uses, named in setup", by: me.email });
    return { ok: true, text: `Noted: ${r.name} isn’t built in yet, so it’s on the list of connections to build. Until then, a file export from ${r.name} will do (coming soon).` };
  } catch (e) { return fail(e); }
}
