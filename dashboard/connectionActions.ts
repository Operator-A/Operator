"use server";
// MCP connection actions (docs/company-mode.md, slice 6). Each checks the login again. Disconnect
// forgets the token; the email list is a choice for the Email list size measure. Neither grants a
// tool: that stays a builder step.
import { audit } from "@/core/audit";
import { planBlock } from "@/core/extensions";
import { revalidatePath } from "next/cache";
import { isMcpId } from "@/core/mcp-rules";
import { addCustomServer, checkCustomServer, disconnectMcp, removeClaudeKey, saveClaudeKey, removeModelKey, saveModelKey, saveHookSecret, removeHookSecret, pauseCustom, removeCustomServer, resealAll, saveCustomKey, setCustomNumber, saveCustomScopes, saveMcpKey, saveMcpSetting, setCustomTool } from "@/integrations/mcp";
import { isCustomId } from "@/core/custom-mcp-rules";
import { PROVIDER_BY_ID, isModelProvider } from "@/core/model-key-rules";
import { SOURCE_BY_ID, isEventSource } from "@/core/event-rules";
import { knownByAddress } from "@/core/connector-rules";
import { askFor, closeRequest } from "@/core/connector-requests";
import { removeExport, switchExports, uploadExport } from "@/core/exports";
import { EXPORT_LIMITS } from "@/core/export-rules";
import { controlsOn } from "./session";
import { klaviyoLists } from "@/integrations/klaviyo";
import { ga4PropertyList } from "@/integrations/ga4";
import { db } from "@/core/db";
import { RESULT_KINDS, RESULT_LABEL, TARGET_KEYS, targetProblem, type MetaResult } from "@/core/meta-rules";
import type { ActionResult } from "./actions";
import { asRole } from "./data";

const fail = (e: unknown): ActionResult => ({ ok: false, text: e instanceof Error ? e.message : String(e) });
const done = (text: string): ActionResult => { revalidatePath("/", "layout"); return { ok: true, text }; };

export async function mcpDisconnect(id: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isMcpId(id)) return { ok: false, text: "Unknown connection." };
  try {
    const r = await disconnectMcp(id);
    await audit(me, "disconnect", id);
    return done(r.revoked ? "Disconnected, and the server cancelled the sign-in. Agents can’t read it until you connect again." : `Disconnected here. ${r.note ?? ""}`.trim());
  } catch (e) { return fail(e); }
}

/** Locks a pasted key in the vault, after the service says whose it is. The key is never sent back. */
export async function mcpSaveKey(id: string, key: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isMcpId(id)) return { ok: false, text: "Unknown connection." };
  if (typeof key !== "string" || key.length > 300) return { ok: false, text: "That isn’t a key." };
  try {
    const who = await saveMcpKey(id, key);
    await audit(me, "save_key", id);
    return done(`Key locked in the vault. It belongs to “${who.name}”${who.workspace ? ` in ${who.workspace}` : ""}. Agents see only the pages shared with it.`);
  } catch (e) { return fail(e); }
}

/** The business's own Claude key (Connections > Claude API): locked in the vault after Anthropic accepts it. */
export async function claudeSaveKey(key: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (typeof key !== "string" || key.length > 300) return { ok: false, text: "That isn’t a key." };
  try {
    await saveClaudeKey(key);
    await audit(me, "save_key", "anthropic_key");
    return done("Claude key locked in the vault. Agents’ model calls are billed to it from their next run.");
  } catch (e) { return fail(e); }
}

export async function claudeRemoveKey(): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    await removeClaudeKey();
    await audit(me, "disconnect", "anthropic_key");
    return done("Claude key forgotten here. Delete it in the Claude Console too if it shouldn’t work anywhere.");
  } catch (e) { return fail(e); }
}

/** A business's own key for another model provider (Connections > Other models): locked in the vault after the provider accepts it. */
export async function modelSaveKey(provider: string, key: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isModelProvider(provider)) return { ok: false, text: "That provider isn’t on the list." };
  if (typeof key !== "string" || key.length > 300) return { ok: false, text: "That isn’t a key." };
  try {
    await saveModelKey(provider, key);
    await audit(me, "save_key", PROVIDER_BY_ID[provider].vaultId);
    return done(`${PROVIDER_BY_ID[provider].name} key locked in the vault.`);
  } catch (e) { return fail(e); }
}

export async function modelRemoveKey(provider: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isModelProvider(provider)) return { ok: false, text: "That provider isn’t on the list." };
  try {
    await removeModelKey(provider);
    await audit(me, "disconnect", PROVIDER_BY_ID[provider].vaultId);
    return done(`${PROVIDER_BY_ID[provider].name} key forgotten here. Delete it at ${PROVIDER_BY_ID[provider].name} too if it shouldn’t work anywhere.`);
  } catch (e) { return fail(e); }
}

/** A source's live events signing secret (Connections > Live events, docs/live-events.md): locked in the vault; makes the hook address. */
export async function hookSaveSecret(source: string, key: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isEventSource(source)) return { ok: false, text: "That service has no live events." };
  if (typeof key !== "string" || key.length > 300) return { ok: false, text: "That isn’t a signing secret." };
  try {
    await saveHookSecret(source, key);
    await audit(me, "save_key", SOURCE_BY_ID[source].vaultId);
    return done(`${SOURCE_BY_ID[source].name} signing secret locked in the vault. Events sent to the hook address are checked with it from now on.`);
  } catch (e) { return fail(e); }
}

/** Forgets a source's signing secret and hook address: events sent there are refused from now on. */
export async function hookRemove(source: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isEventSource(source)) return { ok: false, text: "That service has no live events." };
  try {
    await removeHookSecret(source);
    await audit(me, "disconnect", SOURCE_BY_ID[source].vaultId);
    return done(`${SOURCE_BY_ID[source].name} live events turned off here. Delete the webhook in ${SOURCE_BY_ID[source].name} too.`);
  } catch (e) { return fail(e); }
}

/** Re-seals every saved sign-in with MCP_SECRET_KEY (after a new key is put in). */
export async function vaultReseal(): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const r = await resealAll();
    const bad = r.unreadable.length ? ` ${r.unreadable.join(", ")} couldn’t be unlocked with either key: sign in to ${r.unreadable.length === 1 ? "it" : "them"} again.` : "";
    await audit(me, "vault_reseal", null, { moved: r.moved, unreadable: r.unreadable.length });
    return done(`${r.moved} sign-in${r.moved === 1 ? "" : "s"} moved onto the current key.${bad}${r.unreadable.length ? "" : " You can remove MCP_SECRET_KEY_OLD now."}`);
  } catch (e) { return fail(e); }
}

/** The Google Analytics property every Analytics tool reports on (card 152b): one the sign-in can see, picked by an owner. */
export async function ga4PickProperty(propertyId: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const p = (await ga4PropertyList()).find((x) => x.id === String(propertyId));
    if (!p) return { ok: false, text: "That property isn’t one this Google sign-in can see." };
    await saveMcpSetting("ga4", "propertyId", p.id);
    await saveMcpSetting("ga4", "propertyName", p.name);
    await audit(me, "pick_ga4_property", p.id);
    revalidatePath("/start");
    return done(`Analytics now reports on “${p.name}”.`);
  } catch (e) { return fail(e); }
}

/**
 * A Meta Ads cost target (card 255): an owner sets the most one result may cost before an agent may
 * propose pausing the ad. Blank clears it, and then nothing is paused on that result. Agents never set it.
 */
export async function metaSetTarget(result: string, value: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    if (!RESULT_KINDS.includes(result as MetaResult)) return { ok: false, text: "Unknown kind of result." };
    const problem = targetProblem(String(value));
    if (problem) return { ok: false, text: problem };
    const key = TARGET_KEYS[result as MetaResult];
    const v = String(value).trim() ? Number(String(value).trim().replace(/^\$/, "")) : null;
    const { data: old } = await db().from("policies").select("value_json").eq("key", key).maybeSingle();
    const { error } = v === null
      ? await db().from("policies").delete().eq("key", key)
      : await db().from("policies").upsert({ key, value_json: v, updated_at: new Date().toISOString() });
    if (error) return fail(error.message);
    await db().from("policy_log").insert({ key, old_value: old?.value_json ?? null, new_value: v, changed_by: me.email });
    await audit(me, "set_meta_target", key, { value: v });
    return done(v === null ? `No cost per ${RESULT_LABEL[result as MetaResult]} target: nothing is paused on it.` : `Cost per ${RESULT_LABEL[result as MetaResult]} target: ${v}. Agents given pauses can propose pausing ads over it.`);
  } catch (e) { return fail(e); }
}

/** The list the Email list size measure counts, checked against Klaviyo's own lists. */
export async function klaviyoPickList(listId: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const lists = await klaviyoLists();
    const l = lists.find((x) => x.id === String(listId));
    if (!l) return { ok: false, text: "That list isn’t in Klaviyo any more." };
    await saveMcpSetting("klaviyo", "emailListId", l.id);
    await saveMcpSetting("klaviyo", "emailListName", l.name);
    await audit(me, "pick_klaviyo_list", listId);
    return done(`Email list size now counts “${l.name}”.`);
  } catch (e) { return fail(e); }
}

// ---- Custom servers (docs/custom-servers.md, slice 1). Adding a server, connecting it and turning a
// tool on need Controls on; turning a tool off, pausing and removing never do, so the owner can
// always stop a server. None of these grants a tool to an agent: that stays a builder step.

const CONTROLS_OFF: ActionResult = { ok: false, text: "Real runs are switched off on this OPERATOR, so custom servers can’t be added or changed yet." };
const unknown: ActionResult = { ok: false, text: "Unknown server." };

/** Adds a server by address, all tools off. The text carries its id for the page to open. */
export async function customAdd(name: string, url: string, auth: string): Promise<ActionResult & { id?: string }> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return CONTROLS_OFF;
  const plan = await planBlock({ kind: "custom_server" }); if (plan) return { ok: false, text: plan };
  try {
    const id = await addCustomServer({ name: String(name ?? ""), url: String(url ?? ""), auth: String(auth ?? "") });
    // adding a server counts as an ask for that service, so the most wanted get built in (never stops the add)
    const service = knownByAddress(String(url))?.name ?? String(name);
    await askFor({ name: service, what: "Added its server by address on Connections.", by: me.email }).catch(() => undefined);
    // a server for a tool with an uploaded export: the export switches over and uploads stop (card 160)
    await switchExports(service);
    revalidatePath("/", "layout");
    await audit(me, "custom_add", id);
    return { ok: true, text: auth === "oauth" ? "Added. Tick the scopes it should ask for, then connect." : "Added. Paste its key to connect.", id };
  } catch (e) { return fail(e); }
}

/** Saves the ticked scopes; the page then goes to the server's own sign-in page. */
export async function customScopes(id: string, scopes: string[]): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return CONTROLS_OFF;
  if (!isCustomId(id)) return unknown;
  if (!Array.isArray(scopes) || scopes.length > 30) return { ok: false, text: "Pick fewer scopes." };
  try { await saveCustomScopes(id, scopes.map(String)); await audit(me, "custom_scopes", id, { scopes: scopes.length }); return { ok: true, text: "Saved." }; } catch (e) { return fail(e); }
}

export async function customKey(id: string, key: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return CONTROLS_OFF;
  if (!isCustomId(id)) return unknown;
  if (typeof key !== "string" || key.length > 900) return { ok: false, text: "That isn’t a key." };
  try {
    const r = await saveCustomKey(id, key);
    await audit(me, "custom_key", id);
    return done(`Key locked in the vault. The server lists ${r.tools} tool${r.tools === 1 ? "" : "s"}, all off.`);
  } catch (e) { return fail(e); }
}

/** Checks the turned-on tools against the server's list now, or (accept) takes the server's tools as they are now. */
export async function customCheck(id: string, accept: boolean): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  if (!isCustomId(id)) return unknown;
  if (accept && !controlsOn()) return CONTROLS_OFF;
  try {
    const r = await checkCustomServer(id, !!accept);
    if (!r.ok) return { ok: false, text: `Paused: ${r.note}. Look at the change below, then accept it if it’s fine.` };
    revalidatePath("/", "layout");
    return { ok: true, text: accept ? `Accepted.${r.turnedOff.length ? ` Turned off ${r.turnedOff.join(", ")}: gone, or no longer read-only.` : ""}` : `Tools checked: the turned-on ones are as you accepted them. ${r.tools} listed.` };
  } catch (e) { return fail(e); }
}

export async function customToolOn(id: string, tool: string, label: string, line: string, pins: Record<string, string>): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!controlsOn()) return CONTROLS_OFF;
  if (!isCustomId(id)) return unknown;
  if (typeof tool !== "string" || tool.length > 120 || !pins || typeof pins !== "object") return { ok: false, text: "That isn’t a tool." };
  try { await setCustomTool(id, tool, { label: String(label ?? ""), line: String(line ?? ""), pins }); await audit(me, "custom_tool_on", id, { tool }); return done("On. No agent can use it yet: giving custom tools to agents comes in the next update."); } catch (e) { return fail(e); }
}

/** Uses a turned-on tool as a goal number, or stops (`f` null). Owner, Controls on to set one; stopping is always allowed. */
export async function customNumber(id: string, tool: string, f: { field: string; label: string; unit: string; shape: string; brief?: boolean } | null): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (f && !controlsOn()) return CONTROLS_OFF;
  if (!isCustomId(id)) return unknown;
  if (typeof tool !== "string" || tool.length > 120 || (f != null && typeof f !== "object")) return { ok: false, text: "That isn’t a tool." };
  try {
    await setCustomNumber(id, tool, f ? { field: f.field, label: f.label, unit: f.unit, shape: f.shape, brief: f.brief === true } : null);
    await audit(me, f ? "custom_goal_number" : "custom_goal_number_off", id, { tool, ...(f ? { field: String(f.field).slice(0, 80) } : {}) });
    return done(f ? "Saved. It shows in the goal picker under From your own tools." : "No longer a goal number. Goals on it show No measure yet.");
  } catch (e) { return fail(e); }
}

export async function customToolOff(id: string, tool: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isCustomId(id)) return unknown;
  try { await setCustomTool(id, String(tool), null); await audit(me, "custom_tool_off", id, { tool }); return done("Off."); } catch (e) { return fail(e); }
}

export async function customPause(id: string, paused: boolean): Promise<ActionResult> {
  // pausing a server is a stop, so approvers may; running it again is the owner's
  const { me, no } = await asRole(paused ? "approver" : "owner"); if (no) return no;
  if (!isCustomId(id)) return unknown;
  if (!paused && !controlsOn()) return CONTROLS_OFF;
  try { await pauseCustom(id, !!paused); await audit(me, paused ? "custom_pause" : "custom_resume", id); return done(paused ? "Paused for every agent." : "Running again."); } catch (e) { return fail(e); }
}

export async function customRemove(id: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  if (!isCustomId(id)) return unknown;
  try {
    const r = await removeCustomServer(id);
    await audit(me, "custom_remove", id);
    return done(r.revoked ? "Removed, and the server cancelled the sign-in." : `Removed here. ${r.note ?? ""}`.trim());
  } catch (e) { return fail(e); }
}

// ---- Find a tool (docs/custom-servers.md, slice 3). Asking for a connector and closing a request
// change no agent and reach no service but the business's own Build Board, so neither needs Controls on.

const PROPOSAL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** One ask for a built-in connector, in the owner's own words. */
export async function connectorAsk(name: string, what: string, proposalId: string | null): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const pid = typeof proposalId === "string" && PROPOSAL_ID.test(proposalId) ? proposalId : null;
  try { return done(await askFor({ name: String(name ?? ""), what: String(what ?? ""), by: me.email, proposalId: pid })); } catch (e) { return fail(e); }
}

/** Closes a request: a built-in connector is ready, or it isn't needed. */
export async function connectorClose(id: string, why: string): Promise<ActionResult> {
  const { no } = await asRole("owner"); if (no) return no;
  if (why !== "ready" && why !== "not_needed") return { ok: false, text: "Unknown choice." };
  try { return done(await closeRequest(String(id), why)); } catch (e) { return fail(e); }
}

/**
 * An uploaded export (card 160): a CSV for a tool with no connection, read by agents through Uploaded
 * export. Also asks for a real connection to that tool. Owner only, audited.
 */
export async function exportUpload(form: FormData): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  const file = form.get("file");
  if (!(file instanceof File) || !file.size) return { ok: false, text: "Pick a CSV file." };
  if (file.size > EXPORT_LIMITS.bytes) return { ok: false, text: `The file is over ${EXPORT_LIMITS.bytes / 1_000_000} MB.` };
  if (!/\.csv$/i.test(file.name) && !/csv|text\/plain/.test(file.type)) return { ok: false, text: "Upload a .csv file." };
  try {
    const r = await uploadExport({ name: form.get("name"), text: await file.text(), bytes: file.size, fresh: form.get("fresh") ?? undefined, by: me.email });
    await audit(me, "upload_export", r.key);
    const asked = r.created ? await askFor({ name: r.name, what: "Uploaded an export because it has no connection.", by: me.email }).then(() => " A connection to it is asked for too.", () => "") : "";
    return done(`${r.name}: ${r.rows} row${r.rows === 1 ? "" : "s"} ready for agents that have Uploaded export.${asked}`);
  } catch (e) { return fail(e); }
}

/** Removes an uploaded export and its rows. Owner only, audited. */
export async function exportRemove(id: string): Promise<ActionResult> {
  const { me, no } = await asRole("owner"); if (no) return no;
  try {
    const name = await removeExport(String(id));
    await audit(me, "remove_export", String(id));
    return done(`${name}: export removed. Agents can’t read it any more.`);
  } catch (e) { return fail(e); }
}
