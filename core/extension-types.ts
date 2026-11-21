// The slots the paid layer (ee/) may fill, and nothing else (docs/extensions.md). Types only, so
// core/extensions/none.ts and ee/index.ts can both import them without a cycle.
import type { ComponentType } from "react";
import type { Billing } from "@/core/cost-rules";

/** What a plan check is asked about. Each is checked as the current org, after the role check. */
export type PlanAsk =
  | { kind: "run"; agentId: string; trigger: string; billing?: Billing }
  | { kind: "invite"; email: string; role: string }
  | { kind: "agent_on"; agentIds: string[] }
  | { kind: "custom_server" };

/** The pages a payment on Stripe may come back to: a fixed list, never an address from a form. */
export const RETURN_PLACES = ["settings", "start", "connections"] as const;
export type ReturnPlace = (typeof RETURN_PLACES)[number];

export interface Extensions {
  /** "open" is the AGPL app on its own; "cloud" is the hosted edition built with ee/. */
  edition: "open" | "cloud";
  /**
   * Why the business's plan doesn't allow this now (no plan, trial over, seat limit), or null.
   * It can only say no on top of every check in core: core's hard rules, roles, caps and budgets
   * run whatever it answers, and nothing it returns turns one of them off.
   */
  planBlock(ask: PlanAsk): Promise<string | null>;
  /**
   * Extra cards at the bottom of Settings (billing, seats). Server component, given the page's query
   * (a card's own short messages, such as a problem after a redirect); null for none.
   */
  SettingsCards: ComponentType<{ query: Readonly<Record<string, string | undefined>> }> | null;
  /**
   * The hosted Claude option (card 162): the credit balance, the price and the buttons to buy credits,
   * shown on setup step 1 and Connections > Claude when the founder picks OPERATOR's Claude. Server
   * component; back says where Stripe comes back to after a pack is paid; compact shows one line, no
   * buttons. Free setup (a setup conversation on OPERATOR, up to a limit) is said here too. null: no hosted Claude, so
   * only the own-key option is offered (the open edition).
   */
  HostedClaude: ComponentType<{ back: ReturnPlace; owner: boolean; query: Readonly<Record<string, string | undefined>>; compact?: boolean }> | null;
  /** The sign-up page at /signup, given its query. null: no sign-up, /signup is not found (the open edition). */
  SignupPage: ComponentType<{ query: Readonly<Record<string, string | undefined>> }> | null;
  /**
   * Routes at /api/ee/<name> (POST), such as a billing webhook. Each checks its own caller (a
   * signature), since /api is outside the sign-in guard. Empty: every /api/ee route is not found.
   */
  api: Readonly<Record<string, (req: Request) => Promise<Response>>>;
  /** Told after People changes (someone added or removed), as the current org. Never stops the change. */
  afterMembersChange(): Promise<void>;
  /**
   * The hosted edition's own Claude key, for a business with no key of its own that is on managed
   * credits with enough balance and a plan that allows runs (card 128 slice 4); null otherwise. Asked
   * by integrations/anthropic.ts only, and only when the business has no key of its own.
   */
  pooledKey(): Promise<string | null>;
  /**
   * Told after every run ends, as the run's org, with its cost from the price list and who paid for
   * the model. Credits take the run's charge here, once per run. Never stops or changes the run.
   */
  afterRun(run: { runId: string; costUsd: number; billing: Billing }): Promise<void>;
  /**
   * Told once per scheduler round, after every business's turn, as no business (card 232): the cloud
   * edition's weekly shared-brain sync. Never stops the scheduler; says what it did in a few words.
   */
  afterSchedule(now: number): Promise<string | null>;
}

/** Every slot, so check:open-core can make sure each edition fills each one. */
export const SLOTS = ["edition", "planBlock", "SettingsCards", "HostedClaude", "SignupPage", "api", "afterMembersChange", "pooledKey", "afterRun", "afterSchedule"] as const satisfies readonly (keyof Extensions)[];
