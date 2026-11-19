import "server-only";
// First-run setup, step 2 (card 152, docs/setup.md): each tool tile's state and which picked
// departments need it. The rules are in core/tools-step-rules.ts; this reads the business's state.
import { TEMPLATES } from "@/core/templates";
import { TOOLS } from "@/core/tools/catalog";
import { mcpStatus } from "@/integrations/mcp";
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

export async function toolsStep(picked: readonly string[], health: Record<IntegrationId, boolean>): Promise<{ tiles: TileView[]; shopifyDomain: string; connected: Set<ToolTileId> }> {
  const chosen = picked.map(toolsOfTemplate).filter((t): t is TemplateTools => !!t);
  const need = neededBy(chosen, needsOf);
  const s = await settings();
  const tiles = await Promise.all(TOOL_TILES.map(async (tile): Promise<TileView> => {
    const alsoSt = tile.also ? await mcpStatus(tile.also.mcp) : null;
    const base = { tile, neededBy: need[tile.id] ?? [], permissions: permissionsOf(tile), problem: null, who: null, pick: null, also: tile.also ? { connected: !!alsoSt?.connected && !alsoSt.paused } : null };
    if (!tile.mcp) return { ...base, state: "coming" };
    const st = await mcpStatus(tile.mcp);
    if (st?.paused) return { ...base, state: "paused", problem: st.lastError };
    if (tile.id === "analytics" && st?.connected && !st.settings.propertyId) return { ...base, state: "not", pick: await ga4PropertyList().catch(() => []) };
    const on = !!st?.connected && health[tile.mcp as IntegrationId] !== false;
    if (!on) return { ...base, state: "not" };
    const who = tile.id === "mercury" ? await mercuryOrgName().catch(() => null) : tile.id === "gmail" ? st?.settings.mailbox ?? null : tile.id === "shopify" ? s.shopifyDomain : tile.id === "analytics" ? st?.settings.propertyName ?? null : null;
    return { ...base, state: "connected", who };
  }));
  return { tiles, shopifyDomain: s.shopifyDomain ?? "", connected: new Set(tiles.filter((t) => t.state === "connected").map((t) => t.tile.id)) };
}

/** On step 3: the tools each department still waits on, by template id. */
export function waitingByTemplate(connected: ReadonlySet<ToolTileId>): Record<string, string[]> {
  return Object.fromEntries(TEMPLATES.map((t) => {
    const tt = toolsOfTemplate(t.id)!;
    return [t.id, waitingOn(tt, needsOf, connected).map((id) => TOOL_TILES.find((x) => x.id === id)!.name)];
  }));
}
