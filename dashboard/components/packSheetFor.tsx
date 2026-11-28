import "server-only";
// The pack sheets on their pages (packs slice 3): reads what's connected and what's on the chart, works out each
// pack's card in code (core/pack-card-rules.ts) and binds the owner-only install actions.
import type { Org } from "@/core/org-rules";
import { AGENT_PACKS, DEPT_PACKS } from "@/core/packs";
import { SETUP_TEMPLATE } from "@/core/setup-rules";
import { seatFits } from "@/core/pack-install-rules";
import { getHealth } from "@/dashboard/data";
import { connectedTiles } from "@/dashboard/toolsStep";
import { agentCard, deptCard } from "@/core/pack-card-rules";
import { installDeptPack, installSeatPack } from "@/dashboard/packActions";
import { AddDeptSheet, FillSeatSheet } from "./packSheet";

/** Add a department: Avery first, then every built-in department pack but the Chief of Staff setup installs. */
export async function AddDeptSheetFor({ chart, owner, averyHref, closeHref, start }: { chart: Org | null; owner: boolean; averyHref: string; closeHref: string; start?: string }) {
  const connected = owner ? await connectedTiles(await getHealth()) : new Set<never>();
  const have = (chart?.departments ?? []).map((d) => d.name);
  const packs = owner ? DEPT_PACKS.filter((p) => p.id !== SETUP_TEMPLATE).map((p) => deptCard(p, connected, have)) : [];
  return <AddDeptSheet packs={packs} averyHref={averyHref} closeHref={closeHref} install={installDeptPack} startAt={start} />;
}

/** Fill an open seat from a pack: the agent packs whose words match the seat. Null when the seat isn't open. */
export async function FillSeatSheetFor({ chart, seatId, head, closeHref }: { chart: Org; seatId: string; head: string | null; closeHref: string }) {
  const seat = chart.seats.find((s) => s.id === seatId);
  if (!seat || seat.holder !== "open" || seat.departmentId == null) return null;
  const connected = await connectedTiles(await getHealth());
  const packs = AGENT_PACKS.filter((p) => seatFits(p, seat)).map((p) => agentCard(p, connected));
  return <FillSeatSheet seat={{ id: seat.id, title: seat.title }} head={head} packs={packs} closeHref={closeHref} install={installSeatPack} />;
}
