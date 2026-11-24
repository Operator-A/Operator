import "server-only";
// Wait for my OK (chains slice 3, docs/chains.md): keeps a hold when a chain reaches the step, goes on or stops when
// an approver decides, and stops holds nobody answered in time. The rules are core/chain-ok-rules.ts.
import { db } from "@/core/db";
import { loadCrew } from "@/agents/registry";
import { loadFlow, type Chain } from "@/core/flow";
import { readChainPayload, type ChainCtx } from "@/core/job-rules";
import { keepFacts, okCard, okDept, okDoneWords, okDue, okStillHolds, type OkCard, type OkDecision, type OkFacts } from "@/core/chain-ok-rules";
import { loadOrg, seatOf } from "@/core/org";
import { imageLink } from "@/core/image-step";

/**
 * Holds chain `c` at its Wait for my OK step: one row with how the chain was started, the step before's run and what
 * it said. Once per chain run and step (a second call for the same step does nothing). The chain doesn't go on here.
 */
export async function holdForOk(c: Chain, ctx: ChainCtx, facts: OkFacts | null): Promise<string> {
  if (!ctx.parent) return "Skipped: Wait for my OK needs a step before it.";
  const org = await loadOrg();
  const dept = okDept(c, (a) => (org ? seatOf(org, a)?.departmentId ?? null : null));
  const { error } = await db().from("chain_oks").insert({
    chain_key: c.key, chain_id: ctx.chainId, step: ctx.step, ctx, parent_run: ctx.parent, facts: keepFacts(facts),
    department_id: dept, due_at: new Date(okDue(Date.now())).toISOString(),
  });
  if (error && error.code !== "23505") throw new Error(error.message);
  return "Waiting for your OK on Approvals. It stops if nobody answers in 3 days.";
}

/**
 * An approver's tap. Decided once (guarded by status pending and not past due). Approve goes on with the chain from the
 * held step, the step before's run handed on; reject stops it. Returns what to tell them, or null when it was already
 * decided or ran out of time.
 */
export async function decideOk(id: string, d: OkDecision, by: string, goOn: (c: Chain, ctx: ChainCtx, parent: string, flow: { chains: Chain[] }) => Promise<string>): Promise<{ text: string; chain: string } | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await db().from("chain_oks").update({ status: d === "approve" ? "approved" : "rejected", decided_by: by.slice(0, 200), decided_at: nowIso })
    .eq("id", id).eq("status", "pending").gt("due_at", nowIso).select("chain_key, step, ctx, parent_run");
  if (error) throw new Error(error.message);
  const row = data?.[0];
  if (!row) return null;
  const flow = await loadFlow(await loadCrew());
  const c = flow.flow.chains.find((x) => x.key === row.chain_key);
  const stale = okStillHolds(c, row.step as number);
  if (d === "reject") return { text: okDoneWords("reject", c?.name ?? "The chain", null), chain: row.chain_key as string };
  if (stale) return { text: `Approved, but ${stale.charAt(0).toLowerCase()}${stale.slice(1)}`, chain: row.chain_key as string };
  const ctx = readChainPayload(row.ctx);
  if (!ctx) return { text: "Approved, but the chain’s details couldn’t be read, so nothing ran.", chain: row.chain_key as string };
  const then = await goOn(c!, ctx, row.parent_run as string, flow.flow);
  return { text: okDoneWords("approve", c!.name, then), chain: row.chain_key as string };
}

/** Marks holds nobody answered in time as expired (the scheduler, every 15 minutes); their chains stop. Returns how many. */
export async function expireOks(now = Date.now()): Promise<number> {
  const { data, error } = await db().from("chain_oks").update({ status: "expired", decided_at: new Date(now).toISOString() })
    .eq("status", "pending").lte("due_at", new Date(now).toISOString()).select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

/** The holds waiting on an approver, as cards, oldest first; null when the table isn't there yet. */
export async function pendingOks(nameOf: (agent: string) => string): Promise<OkCard[] | null> {
  const { data, error } = await db().from("chain_oks").select("id, chain_key, step, facts, department_id, created_at, due_at, parent_run")
    .eq("status", "pending").gt("due_at", new Date().toISOString()).order("created_at", { ascending: true }).limit(100);
  if (error) return null;
  if (!data?.length) return [];
  const flow = await loadFlow(await loadCrew());
  const cards = data.map((r) => { const card = okCard(r as Parameters<typeof okCard>[0], flow.flow.chains.find((c) => c.key === r.chain_key), nameOf); return card ? { card, parent: r.parent_run as string } : null; }).filter((x): x is { card: OkCard; parent: string } => !!x);
  // a card after a Make an image step shows its picture (chains slice 4)
  return Promise.all(cards.map(async ({ card, parent }) => {
    const c = flow.flow.chains.find((x) => x.key === card.chain);
    return c?.steps[card.step - 1]?.image ? { ...card, image: await imageLink(parent).catch(() => null) } : card;
  }));
}
