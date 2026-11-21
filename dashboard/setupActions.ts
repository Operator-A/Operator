"use server";
// First-run setup actions (card 151, docs/setup.md). Each checks the login and role again. A message to
// Avery makes real model calls, so it also needs DASHBOARD_CONTROLS=on, like her chat.
import { revalidatePath } from "next/cache";
import { addFact, answerCategory, askSetup, takeSnapshot, confirmFact, editFact, endWrapUp, finishSetup, keepAnswerFact, startCompany, inSetup, planCategory, removeFact, setStage, setupState, skipCategory, type SetupAnswer } from "@/core/setup";
import { isStage } from "@/core/setup-rules";
import { readPick } from "@/core/company-rules";
import { companyChart } from "./company";
import { cleanMessage } from "@/core/chat-rules";
import { withActor } from "@/core/actor";
import { audit } from "@/core/audit";
import { saveSettingsFields, settings } from "@/core/settings";
import { validTz } from "@/core/time";
import { askFor } from "@/core/connector-requests";
import { isCategory, routeUnlisted } from "@/core/tools-step-rules";
import { hasSnapshot } from "@/core/snapshot-rules";
import { asRole, getHealth } from "./data";
import { connectedTiles } from "./toolsStep";
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

/** Skip for now on a part's card (card 195): nothing is saved but the skip, and the part stays in the Your tools panel to tap later. */
export async function setupSkipTool(cat: string): Promise<ActionResult & { href?: string }> {
  const { no } = await asRole("approver"); if (no) return no;
  if (!isCategory(cat)) return { ok: false, text: "Unknown part of the company." };
  try {
    if (!(await inSetup())) return { ok: false, text: "Setup is finished for this business." };
    await skipCategory(cat);
    revalidatePath("/start");
    return { ok: true, href: "/start", text: "Left for later. Tap it under Your tools any time." };
  } catch (e) { return fail(e); }
}

/**
 * The founder's answer on a part's card in the chat (card 195): a tool from the part's list, or None yet
 * (null). Saved as a fact and the part's plan in code; a listed tool that doesn't connect yet goes on our
 * build list. A tool that connects opens its steps on the card. No model call, nothing connected here.
 */
export async function setupAnswerTool(cat: string, tool: string | null): Promise<ActionResult & { href?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isCategory(cat)) return { ok: false, text: "Unknown part of the business." };
  if (tool !== null && typeof tool !== "string") return { ok: false, text: "Unknown tool." };
  try {
    if (!(await inSetup())) return { ok: false, text: "Setup is finished for this business." };
    const r = await answerCategory(cat, tool);
    await audit(me, "answer_tool", cat, { tool: r.name });
    revalidatePath("/start");
    if (r.tile) return { ok: true, href: `/start?c=${r.tile}`, text: "" };
    if (r.name) {
      await askFor({ name: r.name, what: "A tool the business already uses, picked in setup", by: me.email });
      return { ok: true, href: "/start", text: `Noted. There’s no direct line to ${r.name} yet, so it’s on our build list, and it starts working the day it connects.` };
    }
    return { ok: true, href: "/start", text: "Noted." };
  } catch (e) { return fail(e); }
}

/**
 * The snapshot (card 195 slice B): once a tool is connected in setup, its card asks code for a few
 * numbers from it, saved as facts. Only a connected tile with a snapshot; no model call.
 */
export async function setupSnapshot(tile: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!hasSnapshot(tile)) return { ok: false, text: "That tool has no snapshot." };
  try {
    if (!(await inSetup())) return { ok: false, text: "Setup is finished for this business." };
    if (!(await connectedTiles(await getHealth())).has(tile)) return { ok: false, text: "Connect it first." };
    const facts = await takeSnapshot(tile);
    await audit(me, "snapshot_tool", tile, { facts: facts.length });
    return done(facts.length ? `Saved ${facts.length} fact${facts.length === 1 ? "" : "s"} from it.` : "Nothing to save from it yet.");
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
    // which parts are connected, so Avery asks only about open ones (card 195)
    const connected = await connectedTiles(await getHealth()).catch(() => new Set<never>());
    const a = await withActor(me.email, () => askSetup(m.text, site, connected));
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
    const pick = readPick((Array.isArray(picked) ? picked : []).slice(0, 20), companyChart(st.leaning, st.designs, new Set(), "own_key").depts);
    if ("problem" in pick) return { ok: false, text: pick.problem };
    const ids = pick.ids;
    const counts = await startCompany(ids, me.email);
    await finishSetup(true);
    await audit(me, "install_template", ids.join(","), counts);
    revalidatePath("/", "layout");
    return { ok: true, href: "/start", text: `Started: ${counts.agents} agents in ${counts.departments} departments, all off duty.` };
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

/**
 * Step 1 (card 187): the founder's browser says its time zone with the first message, and it becomes the
 * business's, only while none is set (Settings can change it any time; this never overwrites that).
 */
export async function setupTimeZone(tz: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const zone = validTz(tz);
  if (!zone) return { ok: false, text: "That isn’t a time zone." };
  try {
    if ((await settings()).timeZone) return { ok: true, text: "Already set." };
    const r = await saveSettingsFields({ timeZone: zone }, ["timeZone"], () => 64);
    if ("problem" in r) return { ok: false, text: r.problem };
    await audit(me, "save_time_zone", null, { time_zone: zone, from: "setup" });
    return done("Saved.");
  } catch (e) { return fail(e); }
}

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
  if (r.kind === "tile") return { ok: true, text: `${r.name} connects right here.`, href: `/start?c=${r.id}`, follow: true };
  if (r.kind === "builtIn") return { ok: true, text: `${r.name} connects on Connections.`, href: r.href };
  if (r.kind === "known") return { ok: true, text: `${r.name} has its own server. Add it on Connections with its address filled in: you turn on each read-only tool yourself.`, href: r.href };
  try {
    await askFor({ name: r.name, what: "A tool the business already uses, named in setup", by: me.email });
    if (await inSetup()) { await planCategory(cat, { kind: "export", tool: r.name }); await keepAnswerFact(cat, r.name); }
    revalidatePath("/start");
    return { ok: true, href: "/start", follow: true, text: `There’s no direct line to ${r.name} yet, so this part starts from an export. I’ve put ${r.name} on our build list.` };
  } catch (e) { return fail(e); }
}
