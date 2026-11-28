import "server-only";
// What the Packs page and a pack's page read (packs slice 4): one round for the connections, the chart and who pays,
// then the cards and pages are worked out in code (core/pack-market-rules.ts). Packs come from the app itself.
import { AGENT_PACKS, DEPT_PACKS, packById } from "@/core/packs";
import { SETUP_TEMPLATE } from "@/core/setup-rules";
import { agentPage, deptPage, marketCards, tileChips, type CostOf, type MarketCard } from "@/core/pack-market-rules";
import { TOOL_TILES } from "@/core/tools-step-rules";
import { liveOrgNow } from "@/core/pack-install";
import { seatParentName } from "@/core/org-rules";
import { getHealth, getRoster } from "./data";
import { connectedTiles } from "./toolsStep";
import { billing, monthCostOf } from "./cost";
import type { Billing } from "@/core/cost-rules";

const LISTED = DEPT_PACKS.filter((p) => p.id !== SETUP_TEMPLATE);

/** A month's estimate for one agent, as on a hire card: no real runs yet, at this business's billing. */
const costOf = (bill: Billing): CostOf => (a, runs) => {
  const c = monthCostOf({ model: a.model, effort: a.effort, tools: a.tools, maxSteps: a.maxSteps, maxCostUsd: a.maxCostUsd }, null, runs, bill);
  return { perRun: c.perRun, month: c.month, atMost: c.runsPerMonth ? c.atMost : c.atMostPerRun };
};

async function base() {
  const [roster, connected, bill] = await Promise.all([getRoster(), getHealth().then(connectedTiles), billing()]);
  return { chart: roster.chart, connected, cost: costOf(bill), byId: roster.byId };
}

/** The Packs page: every card, and the Works with chips. */
export async function marketData(): Promise<{ cards: MarketCard[]; chips: ReturnType<typeof tileChips> }> {
  const b = await base();
  const cards = marketCards({ depts: LISTED, agents: AGENT_PACKS, connected: b.connected, have: (b.chart?.departments ?? []).map((d) => d.name), seats: b.chart?.seats ?? [], cost: b.cost });
  return { cards, chips: tileChips(cards, TOOL_TILES, b.connected) };
}

/** A pack's page, or null when there's no such pack (the setup-only pack has none). */
export async function packPageData(id: string) {
  const dept = LISTED.find((p) => p.id === id) ?? null;
  const agent = dept ? null : packById(id, "agent");
  if (!dept && !agent) return null;
  if (dept) {
    const [b, org] = await Promise.all([base(), liveOrgNow().catch(() => null)]);
    return deptPage(dept, { connected: b.connected, have: (b.chart?.departments ?? []).map((d) => d.name), org, cost: b.cost });
  }
  const b = await base();
  const chart = b.chart;
  return agentPage(agent!, {
    connected: b.connected, seats: chart?.seats ?? [], cost: b.cost,
    deptName: (d) => chart?.departments.find((x) => x.id === d)?.name ?? d,
    head: (seatId) => (chart ? seatParentName(chart, seatId, (a) => b.byId[a]?.name) : null),
  });
}
