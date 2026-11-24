// Run view (chains slice 5, docs/chains.md): one chain run as a timeline of its steps, with where each ran, what it
// cost and what it passed on. Pure: no database, no network, so `npm run check:runview` tests it; the run page reads
// the rows (dashboard/data.ts getChainRuns) and draws what this returns.
import { OK, stepName, type Step } from "@/core/flow-rules";
import { IMAGE_KEEP_DAYS, imageModel, SIZE_LABEL } from "@/core/image-rules";

export type RunStatus = "running" | "ok" | "failed" | "skipped";
/** One run of the chain (agent_runs), as getChainRuns reads it. */
export interface TimelineRun { id: string; step: number; agentId: string; status: RunStatus; startedAt: string; endedAt: string | null; costUsd: number; summary: string | null }
/** A Wait for my OK hold of this chain run (chain_oks). */
export interface TimelineOk { step: number; status: "pending" | "approved" | "rejected" | "expired"; decidedBy: string | null; decidedAt: string | null; createdAt: string; dueAt: string }

export type Kind = "agent" | "claude" | "ask" | "image" | "ok";
export type ItemState = RunStatus | "waiting" | "approved" | "rejected" | "expired" | "not_run";

export interface TimelineItem {
  step: number; kind: Kind; title: string;
  /** The agent behind an agent step (for its colour and link), else null. */
  agentId: string | null;
  /** Where it ran: "OPERATOR · Claude Sonnet 5.5", "Your Claude routine", "Ask GPT-6.2 Sol", "GPT Image 2.5 Flare", "Approvals". */
  where: string;
  state: ItemState;
  /** The run behind the step (none for an OK, or a step that didn't run). */
  runId: string | null; at: string | null; costUsd: number;
  /** What it said (its run's summary, or for an OK who decided and when). */
  said: string | null;
  /** What reached the next step: its result, a line about its picture, the OK card, or why nothing did. */
  passed: string | null;
}

export interface Timeline { items: TimelineItem[]; totalUsd: number; ran: number; steps: number; ending: string }

/** The labels a timeline needs that live outside the chain: agent names, where each agent runs, model labels. */
export interface TimelineNames { agent: (id: string) => string; claude: (id: string) => boolean; agentModel: (id: string) => string | null; model: (id: string) => string }

const cut = (t: string | null, n = 220) => (t ? (t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t) : null);

function kindOf(s: Step | undefined, run: TimelineRun | undefined, n: TimelineNames): Kind {
  if (s?.ok) return "ok";
  if (s?.image) return "image";
  if (s?.ask) return "ask";
  const agent = s?.agent ?? run?.agentId;
  return agent && n.claude(agent) ? "claude" : "agent";
}

function whereOf(s: Step | undefined, kind: Kind, run: TimelineRun | undefined, n: TimelineNames): string {
  if (kind === "ok") return "Approvals";
  if (kind === "image") return `${imageModel(s!.image!.model)?.label ?? s!.image!.model} · your key`;
  if (kind === "ask") return `Ask ${n.model(s!.ask!.model)}`;
  const agent = s?.agent ?? run?.agentId ?? "";
  if (kind === "claude") return "Your Claude routine";
  const m = n.agentModel(agent);
  return m ? `OPERATOR · ${m}` : "OPERATOR";
}

function titleOf(s: Step | undefined, run: TimelineRun | undefined, n: TimelineNames): string {
  if (s?.image) return `Make an image: ${SIZE_LABEL[s.image.size].toLowerCase()}, ${s.image.quality} quality`;
  if (s?.ask || s?.ok) return stepName(s);
  return n.agent(s?.agent ?? run?.agentId ?? "?");
}

const OK_STATE = { pending: "waiting", approved: "approved", rejected: "rejected", expired: "expired" } as const;

/**
 * The timeline of one chain run. `steps` is the chain as saved now (empty when it can't be read: the runs alone are
 * shown); `runs` and `oks` are this chain run's rows. A step after the last one that ran shows as not run, and the
 * ending says where and why the chain stopped, or that it is still going.
 */
export function timeline(steps: readonly Step[], runs: readonly TimelineRun[], oks: readonly TimelineOk[], n: TimelineNames, tzWhen: (iso: string) => string): Timeline {
  const count = Math.max(steps.length, ...runs.map((r) => r.step + 1), ...oks.map((o) => o.step + 1), 0);
  const items: TimelineItem[] = [];
  for (let k = 0; k < count; k++) {
    const s = steps[k];
    // a step re-run in the same chain run (a retried job) shows its latest run
    const run = runs.filter((r) => r.step === k).at(-1);
    const ok = oks.find((o) => o.step === k);
    const kind = kindOf(s, run, n);
    let state: ItemState = run ? run.status : "not_run";
    let said = cut(run?.summary ?? null), at = run?.startedAt ?? null;
    if (kind === "ok") {
      state = ok ? OK_STATE[ok.status] : "not_run";
      at = ok?.createdAt ?? null;
      said = !ok ? null
        : ok.status === "pending" ? `Waiting for your OK on Approvals. It stops by itself ${tzWhen(ok.dueAt)} if nobody answers.`
        : ok.status === "expired" ? `Nobody answered in ${OK.days} days, so the chain stopped.`
        : `${ok.status === "approved" ? "Approved" : "Rejected"}${ok.decidedBy ? ` by ${ok.decidedBy}` : ""}${ok.decidedAt ? `, ${tzWhen(ok.decidedAt)}` : ""}.`;
    }
    items.push({ step: k, kind, agentId: kind === "agent" || kind === "claude" ? (s?.agent ?? run?.agentId ?? null) : null, title: titleOf(s, run, n), where: whereOf(s, kind, run, n), state, runId: run?.id ?? null, at, costUsd: run?.costUsd ?? 0, said, passed: null });
  }
  // what each step handed on: the next step's own pass along decides it; an OK hands on the step before it
  for (let k = 0; k < items.length; k++) {
    const it = items[k], next = steps[k + 1], nextItem = items[k + 1];
    if (!nextItem || nextItem.state === "not_run") continue;
    if (it.kind === "ok") { it.passed = it.state === "approved" ? "Let the step before’s result through" : null; continue; }
    if (next?.ok) { it.passed = "Its result went on the OK card"; continue; }
    // its words are on its own card already, so the link says they went on rather than repeating them
    const src = it.kind === "image" ? `A line saying a picture was made (the picture stays in OPERATOR ${IMAGE_KEEP_DAYS} days)` : it.said ? "Its result, as above" : "Nothing: it had no result to hand on";
    it.passed = next?.passAlong ? src : "Nothing: the next step doesn’t get this result";
  }
  const ran = items.filter((i) => i.state !== "not_run").length;
  const last = [...items].reverse().find((i) => i.state !== "not_run");
  const stoppedAt = items.find((i) => i.state === "not_run");
  let ending: string;
  if (!last) ending = "Nothing has run yet.";
  else if (last.state === "running") ending = `Step ${last.step + 1} is running now.`;
  else if (last.state === "waiting") ending = `Waiting for your OK at step ${last.step + 1}.`;
  else if (!stoppedAt) ending = last.state === "ok" || last.state === "approved" ? "Every step ran." : `Every step ran; the last one ${last.state}.`;
  else if (last.state === "skipped") ending = `Stopped after step ${last.step + 1}: it was skipped (off duty, over budget, or a quick step that couldn’t run).`;
  else if (last.state === "rejected") ending = `Stopped at step ${last.step + 1}: you rejected it.`;
  else if (last.state === "expired") ending = `Stopped at step ${last.step + 1}: nobody answered in ${OK.days} days.`;
  else if (last.state === "failed") ending = `Stopped after step ${last.step + 1} failed.`;
  else ending = `Stopped after step ${last.step + 1}: step ${stoppedAt.step + 1}’s conditions didn’t pass, or it hasn’t started yet.`;
  return { items, totalUsd: items.reduce((t, i) => t + i.costUsd, 0), ran, steps: items.length, ending };
}

/** The words and colour token for each state. */
export const STATE_LOOK: Record<ItemState, { label: string; tone: "ok" | "bad" | "wait" | "off" }> = {
  ok: { label: "Worked", tone: "ok" }, approved: { label: "Approved", tone: "ok" },
  running: { label: "Running", tone: "wait" }, waiting: { label: "Waiting for you", tone: "wait" },
  failed: { label: "Failed", tone: "bad" }, rejected: { label: "Rejected", tone: "bad" },
  skipped: { label: "Skipped", tone: "off" }, expired: { label: "Ran out of time", tone: "off" }, not_run: { label: "Didn’t run", tone: "off" },
};
