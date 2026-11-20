import "server-only";
// First-run setup, step 2 (card 152, docs/setup.md): each tool tile's state and which picked
// departments need it. The rules are in core/tools-step-rules.ts; this reads the business's state.
import { TEMPLATES } from "@/core/templates";
import { TOOLS } from "@/core/tools/catalog";
import { mcpStatuses, type McpStatus } from "@/integrations/mcp";
import { orgId } from "@/core/tenancy";
import { mercuryOrgName } from "@/integrations/mercury";
import { ga4PropertyList } from "@/integrations/ga4";
import { settings } from "@/core/settings";
import type { IntegrationId } from "./crew";
import { TOOL_TILES, neededBy, permissionsOf, waitingOn, type TemplateTools, type ToolTile, type ToolTileId } from "@/core/tools-step-rules";

export interface TileView {
  tile: ToolTile;
  state: "connected" | "paused" | "not" | "coming";
  /** Why it paused, in the service's words (scrubbed by integrations/mcp). */
  problem: string | null;
  /** Departments the founder picked, or Avery leans toward, that need it. */
  neededBy: string[];
  permissions: { scope: string; words: string }[];
  /** Who it is signed in as, when code can tell (Mercury's org). */
  who: string | null;
  /** Google Analytics signed in but no property picked yet: the properties to pick from. */
  pick: { id: string; name: string; account: string }[] | null;
  /** The second sign-in (Gmail drafts): null when the tile has none. */
  also: { connected: boolean } | null;
}

const toolsOfTemplate = (id: string): TemplateTools | null => {
  const t = TEMPLATES.find((x) => x.id === id);
  return t ? { id: t.id, name: t.name, tools: Object.values((t.specs ?? {}) as Record<string, { tools?: string[] }>).flatMap((s) => s.tools ?? []) } : null;
};
const needsOf = (toolId: string): readonly string[] => (TOOLS as Record<string, { needs?: readonly string[] }>)[toolId]?.needs ?? [];

/** Every connection's status in one query (card 202, docs/speed.md), not one per tile. */
const statuses = async (): Promise<(id: string) => McpStatus | null> => { const all = await mcpStatuses().catch(() => ({} as Record<string, McpStatus>)); return (id) => all[id] ?? null; };

// the Mercury account's name is a call to Mercury itself: kept a few minutes per business, so a setup click doesn't wait on it
const MERCURY_NAME_MS = 10 * 6e4;
const mercuryNames = new Map<string, { name: string | null; at: number }>();
async function mercuryName(): Promise<string | null> {
  const org = await orgId();
  const hit = mercuryNames.get(org);
  if (hit && Date.now() - hit.at < MERCURY_NAME_MS) return hit.name;
  const name = await mercuryOrgName().catch(() => null);
  if (name) mercuryNames.set(org, { name, at: Date.now() });
  return name;
}

export async function toolsStep(picked: readonly string[], health: Record<IntegrationId, boolean>, extra: readonly TemplateTools[] = []): Promise<{ tiles: TileView[]; shopifyDomain: string; connected: Set<ToolTileId> }> {
  // the kits Avery sketched, and her bespoke departments' tools (card 193), ask for the same tiles
  const chosen = [...picked.map(toolsOfTemplate).filter((t): t is TemplateTools => !!t), ...extra];
  const need = neededBy(chosen, needsOf);
  const [s, mcpStatus] = await Promise.all([settings(), statuses()]);
  const tiles = await Promise.all(TOOL_TILES.map(async (tile): Promise<TileView> => {
    const alsoSt = tile.also ? mcpStatus(tile.also.mcp) : null;
    const base = { tile, neededBy: need[tile.id] ?? [], permissions: permissionsOf(tile), problem: null, who: null, pick: null, also: tile.also ? { connected: !!alsoSt?.connected && !alsoSt.paused } : null };
    if (!tile.mcp) return { ...base, state: "coming" };
    const st = mcpStatus(tile.mcp);
    if (st?.paused) return { ...base, state: "paused", problem: st.lastError };
    if (tile.id === "analytics" && st?.connected && !st.settings.propertyId) return { ...base, state: "not", pick: await ga4PropertyList().catch(() => []) };
    const on = !!st?.connected && health[tile.mcp as IntegrationId] !== false;
    if (!on) return { ...base, state: "not" };
    const who = tile.id === "mercury" ? await mercuryName() : tile.id === "gmail" ? st?.settings.mailbox ?? null : tile.id === "shopify" ? s.shopifyDomain : tile.id === "analytics" ? st?.settings.propertyName ?? null : null;
    return { ...base, state: "connected", who };
  }));
  return { tiles, shopifyDomain: s.shopifyDomain ?? "", connected: new Set(tiles.filter((t) => t.state === "connected").map((t) => t.tile.id)) };
}

/** On step 3: the tools each department still waits on, by template id. */
/** The tiles a bespoke department (card 193) still waits on, by name. */
export const waitingForTools = (t: TemplateTools, connected: ReadonlySet<ToolTileId>): string[] => waitingOn(t, needsOf, connected).map((id) => TOOL_TILES.find((x) => x.id === id)!.name);

export function waitingByTemplate(connected: ReadonlySet<ToolTileId>): Record<string, string[]> {
  return Object.fromEntries(TEMPLATES.map((t) => {
    const tt = toolsOfTemplate(t.id)!;
    return [t.id, waitingOn(tt, needsOf, connected).map((id) => TOOL_TILES.find((x) => x.id === id)!.name)];
  }));
}

/** The tiles connected now, without the who and the property list (the Desk's first job, card 154). */
export async function connectedTiles(health: Record<IntegrationId, boolean>): Promise<Set<ToolTileId>> {
  const mcpStatus = await statuses();
  const on = TOOL_TILES.map((tile) => {
    if (!tile.mcp) return null;
    const st = mcpStatus(tile.mcp);
    if (!st?.connected || st.paused || health[tile.mcp as IntegrationId] === false) return null;
    if (tile.id === "analytics" && !st.settings.propertyId) return null;
    return tile.id;
  });
  return new Set(on.filter((x): x is ToolTileId => !!x));
}
