"use server";
// First-run setup actions (card 151, docs/setup.md). Each checks the login and role again. A message to
// Avery makes real model calls, so it also needs DASHBOARD_CONTROLS=on, like her chat.
import { revalidatePath } from "next/cache";
import { addFact, askSetup, confirmFact, editFact, endWrapUp, ensureAvery, finishSetup, inSetup, planCategory, removeFact, setStage, setupState, skipCategory, startIdea, wantIdea, type SetupAnswer } from "@/core/setup";
import { ideaSeed, isStage } from "@/core/setup-rules";
import { readPick } from "@/core/company-rules";
import { companyChart } from "./company";
import { cleanMessage } from "@/core/chat-rules";
import { withActor } from "@/core/actor";
import { audit } from "@/core/audit";
import { installTemplates } from "@/core/install";
import { saveSettingsFields } from "@/core/settings";
import { askFor } from "@/core/connector-requests";
import { TOOL_CATEGORIES, isCategory, routeUnlisted } from "@/core/tools-step-rules";
import { asRole } from "./data";
import { controlsOn } from "./session";
import type { ActionResult } from "./actions";

/** What a founder reads when real runs are switched off for this app: no setting names, they can't change one. */
const CONTROLS_OFF = "I can’t answer here yet: real runs are switched off for this OPERATOR. Whoever runs it turns them on.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/start"); return { ok: true, text }; };

/** Setup moves to another step (card 181): Next, Back or a step's own button. Only a step on the list. */
export async function setupGo(stage: string): Promise<ActionResult> {
  const { no } = await asRole("approver"); if (no) return no;
  if (!isStage(stage)) return { ok: false, text: "Unknown step." };
  try {
    if (!(await inSetup())) return { ok: false, text: "Setup is finished for this business." };
    await setStage(stage);
    return done("");
  } catch (e) { return fail(e); }
}

/** The tools step (card 182): this part of the company waits. Saved, so the flow moves to the next question. */
export async function setupSkipTool(cat: string): Promise<ActionResult & { href?: string }> {
  const { no } = await asRole("approver"); if (no) return no;
  if (!isCategory(cat)) return { ok: false, text: "Unknown part of the company." };
  try {
    if (!(await inSetup())) return { ok: false, text: "Setup is finished for this business." };
    await skipCategory(cat);
    revalidatePath("/start");
    return { ok: true, href: "/start", text: "Left for later. Tap its box any time to connect it." };
  } catch (e) { return fail(e); }
}

/** "Nothing yet" (card 183): the part is marked for Avery to walk the founder into its starter tool after setup. Creates no account. */
export async function setupPlanGuide(cat: string): Promise<ActionResult & { href?: string }> {
  const { no } = await asRole("approver"); if (no) return no;
  if (!isCategory(cat)) return { ok: false, text: "Unknown part of the company." };
  const starter = TOOL_CATEGORIES.find((c) => c.id === cat)?.starter;
  if (!starter) return { ok: false, text: "There’s no tool to set up for this part yet." };
  try {
    if (!(await inSetup())) return { ok: false, text: "Setup is finished for this business." };
    await planCategory(cat, { kind: "guide" });
    revalidatePath("/start");
    return { ok: true, href: `/start?q=${cat}`, text: `Noted. The steps for ${starter.name} wait on your Desk after setup.` };
  } catch (e) { return fail(e); }
}

/** Takes back a part's plan (card 183): "Change my answer" in setup, "Not now" on the Desk afterwards. */
export async function setupPlanClear(cat: string): Promise<ActionResult & { href?: string }> {
  const { no } = await asRole("approver"); if (no) return no;
  if (!isCategory(cat)) return { ok: false, text: "Unknown part of the company." };
  try {
    const setup = await inSetup();
    await planCategory(cat, null);
    revalidatePath("/start"); revalidatePath("/");
    return setup ? { ok: true, href: `/start?q=${cat}`, text: "Cleared." } : { ok: true, text: "Removed from your Desk. You can connect it any time on Connections." };
  } catch (e) { return fail(e); }
}

export async function sendSetup(raw: string, site: string): Promise<SetupAnswer> {
  const none = (reply: string): SetupAnswer => ({ ok: false, reply, notes: [], runId: null, costUsd: 0, kept: false, saved: 0, suggested: 0 });
  const { me, no } = await asRole("approver");
  if (no) return none(no.text);
  if (!controlsOn()) return none(CONTROLS_OFF);
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
    const st = await setupState();
    const pick = readPick((Array.isArray(picked) ? picked : []).slice(0, 20), companyChart(st.leaning, new Set(), "own_key").depts);
    if ("problem" in pick) return { ok: false, text: pick.problem };
    const ids = pick.ids;
    await ensureAvery();
    const { counts } = await installTemplates(ids);
    await finishSetup(true);
    await audit(me, "install_template", ids.join(","), counts);
    revalidatePath("/", "layout");
    return { ok: true, href: "/start", text: `Installed: ${counts.agents ?? 0} agents in ${counts.departments ?? 0} departments, all off duty.` };
  } catch (e) { return fail(e); }
}

/** Go to your Desk (card 186): ends the wrap-up after the first job, or when no agent is ready yet. Changes nothing else. */
export async function setupToDesk(): Promise<ActionResult & { href?: string }> {
  const { no } = await asRole("approver"); if (no) return no;
  try {
    await endWrapUp();
    revalidatePath("/", "layout");
    return { ok: true, href: "/", text: "" };
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

/** Avery's idea on the reveal (card 185): Build it with Avery puts it on the plan, Not now takes it off. Builds nothing. */
export async function setupIdeaWant(on: boolean): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  try {
    await wantIdea(on === true);
    revalidatePath("/start"); revalidatePath("/");
    return done(on === true ? "On your plan. Avery starts it with you after your first job." : "Not now. You can build any department later with Avery.");
  } catch (e) { return fail(e); }
}

/** Start with Avery on the Desk (card 185): opens a department draft named for the idea. The founder still answers every question. */
export async function ideaStart(): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const idea = await startIdea();
    const { seedDraft } = await import("@/core/departments");
    const fresh = await seedDraft(ideaSeed(idea));
    await audit(me, "start_department_idea", idea.name);
    revalidatePath("/");
    return done(fresh ? `Avery opened a draft for ${idea.name}. Answer a few questions in the chat on the right.` : "You already have a department draft open. Finish or discard it first, then ask Avery about this one.");
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
 * built-in, a known server to add by address, or a connection request, and then the part it answers starts
 * from an export of it (card 183). No model call; nothing is connected.
 */
export async function setupOtherTool(cat: string, name: string): Promise<ActionResult & { href?: string; follow?: boolean }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isCategory(cat)) return { ok: false, text: "Unknown part of the company." };
  const r = routeUnlisted(String(name ?? ""));
  if ("problem" in r) return { ok: false, text: r.problem };
  if (r.kind === "tile") return { ok: true, text: `${r.name} connects right here.`, href: `/start?c=${r.id}` };
  if (r.kind === "builtIn") return { ok: true, text: `${r.name} connects on Connections.`, href: r.href };
  if (r.kind === "known") return { ok: true, text: `${r.name} has its own server. Add it on Connections with its address filled in: you turn on each read-only tool yourself.`, href: r.href };
  try {
    await askFor({ name: r.name, what: "A tool the business already uses, named in setup", by: me.email });
    if (await inSetup()) await planCategory(cat, { kind: "export", tool: r.name });
    revalidatePath("/start");
    return { ok: true, href: `/start?q=${cat}`, follow: true, text: `There’s no direct line to ${r.name} yet, so this part starts from an export. I’ve put ${r.name} on our build list.` };
  } catch (e) { return fail(e); }
}
