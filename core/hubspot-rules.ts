// HubSpot (card 253, docs/mcp-everywhere.md "HubSpot"). Pure, so `npm run check:mcp` and
// `npm run check:policy` can test it.
//
// HubSpot's hosted MCP server takes its scopes from its own tool list, writes included, so our own
// server (integrations/hubspot-server.ts) runs in the app over HubSpot's CRM API, with two service keys
// the owner makes in HubSpot (Development, Keys, Service keys; pasted keys for now, with a
// HubSpot app for one-tap Connect later):
// - "HubSpot" (agents): open deals by stage with amounts, and counts of contacts and companies. No
//   contact list, no email address or phone. A key that can write deals is refused when pasted.
// - "HubSpot deal moves" (gateway only): one write, move one deal to another stage of its own pipeline
//   and log a note on it, after an approver approves. A key that can't write deals is refused.
// The host is fixed (api.hubapi.com) and requests never follow redirects.

import { REPORT_PERIODS } from "@/core/mcp-rules";

export const HUBSPOT_TOOLS = ["hubspot_deals", "hubspot_contacts"] as const;
export const MOVE_TOOL = "hubspot_move_deal";
export const MOVE_FIELDS = ["stage", "note"] as const;
export const NOTE_MAX = 500;
export type HsPeriod = (typeof REPORT_PERIODS)[number];
const DAYS: Record<HsPeriod, number> = { last_7_days: 7, last_30_days: 30, last_90_days: 90, last_365_days: 365 };
/** At most this many pages of 100 deals are read for one call; more is said, never guessed. */
export const MAX_PAGES = 5;
/** A deal untouched this many days is listed as gone quiet. */
export const QUIET_DAYS = 14;
/** Note to deal, HubSpot-defined association type. */
export const NOTE_TO_DEAL = 214;

export const HUBSPOT_API = "https://api.hubapi.com";
/** A HubSpot service key: pat-, the account's region, and a UUID. */
export const looksLikeHubSpotKey = (k: string) => /^pat-[a-z]{2,3}\d-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(k.trim());

/** The deal properties asked for: no contact, owner email or description. */
export const DEAL_PROPS = ["dealname", "amount", "dealstage", "pipeline", "closedate", "hs_lastmodifieddate"] as const;

/** HubSpot record ids are digits; stage ids are HubSpot's own (letters, digits, dashes, underscores). */
export const dealIdOk = (s: unknown): s is string => typeof s === "string" && /^\d{1,20}$/.test(s);
export const stageIdOk = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(s);

/** A read tool's input, checked again on our server. Anything not named here is refused. */
export function checkHubSpotArgs(tool: string, raw: unknown): { tool: "hubspot_deals" } | { tool: "hubspot_contacts"; period: HsPeriod } | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const allowed: Record<string, string[]> = { hubspot_deals: [], hubspot_contacts: ["period"] };
  if (!(tool in allowed)) return { problem: `${tool || "that"} isn't a HubSpot read tool` };
  const extra = Object.keys(a).filter((k) => !allowed[tool].includes(k));
  if (extra.length) return { problem: `unknown input: ${extra.join(", ")}` };
  if (tool === "hubspot_deals") return { tool: "hubspot_deals" };
  const period = (a.period ?? "last_30_days") as HsPeriod;
  if (!REPORT_PERIODS.includes(period)) return { problem: `period is one of ${REPORT_PERIODS.join(", ")}` };
  return { tool: "hubspot_contacts", period };
}

/** The first moment a period covers, in epoch milliseconds, as HubSpot's search filters take it. */
export const sinceMs = (p: HsPeriod, nowMs: number) => nowMs - DAYS[p] * 86_400_000;

const num = (v: unknown) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : 0);
const plain = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max);
const cents = (n: number) => Math.round(n * 100) / 100;

export interface Stage { id: string; label: string; pipeline: string; pipelineLabel: string; closed: boolean; order: number }
/** Pipelines as HubSpot lists them: each stage with its pipeline and whether it closes a deal. */
export function readPipelines(j: unknown): Stage[] {
  const out: Stage[] = [];
  for (const p of ((j ?? {}) as { results?: Record<string, unknown>[] }).results ?? []) {
    if (!stageIdOk(p.id)) continue;
    for (const s of (p.stages as Record<string, unknown>[] | undefined) ?? []) {
      if (!stageIdOk(s.id)) continue;
      const meta = (s.metadata ?? {}) as Record<string, unknown>;
      out.push({ id: s.id, label: plain(s.label, 60), pipeline: p.id, pipelineLabel: plain(p.label, 60), closed: String(meta.isClosed) === "true", order: num(s.displayOrder) });
    }
  }
  return out;
}

export interface DealRow { id: string; name: string; amount: number; stage: string; stageId: string; pipeline: string; days_quiet: number; closes: string }
/** Open deals, by stage, with amounts and the ones gone quiet, all counted here. Names were typed by people, so they are cut. */
export function readDeals(raw: readonly unknown[], stages: readonly Stage[], nowMs: number, truncated: boolean) {
  const byId = new Map(stages.map((s) => [s.id, s]));
  const rows: DealRow[] = [];
  for (const d of raw) {
    const r = (d ?? {}) as { id?: unknown; properties?: Record<string, unknown> };
    const p = r.properties ?? {};
    if (!dealIdOk(r.id)) continue;
    const st = byId.get(String(p.dealstage));
    if (!st || st.closed) continue;
    const mod = Date.parse(String(p.hs_lastmodifieddate ?? ""));
    rows.push({ id: r.id, name: plain(p.dealname, 80), amount: cents(num(p.amount)), stage: st.label, stageId: st.id, pipeline: st.pipelineLabel, days_quiet: Number.isFinite(mod) ? Math.max(0, Math.floor((nowMs - mod) / 86_400_000)) : 0, closes: plain(p.closedate, 10) });
  }
  const perStage = stages.filter((s) => !s.closed).map((s) => {
    const inIt = rows.filter((r) => r.stageId === s.id);
    return { pipeline: s.pipelineLabel, stage: s.label, deals: inIt.length, amount: cents(inIt.reduce((n, r) => n + r.amount, 0)) };
  });
  const quiet = rows.filter((r) => r.days_quiet >= QUIET_DAYS);
  return {
    deals: [...rows].sort((a, b) => b.amount - a.amount).slice(0, 50),
    stages: perStage,
    totals: { open_deals: rows.length, open_amount: cents(rows.reduce((n, r) => n + r.amount, 0)), gone_quiet: quiet.length, quiet_days: QUIET_DAYS },
    truncated,
  };
}

/** Why a deal move is refused: a stage id and a plain note, nothing else. */
export function refuseMove(args: Record<string, unknown>): string | null {
  const extra = Object.keys(args).filter((k) => !(MOVE_FIELDS as readonly string[]).includes(k));
  if (extra.length) return `Fields not on the allow-list: ${extra.join(", ")}. A move has only its stage and a note.`;
  if (!stageIdOk(args.stage)) return "stage must be a HubSpot stage id.";
  const note = args.note;
  if (typeof note !== "string" || !note.trim()) return "The move needs a note saying why.";
  if (note.length > NOTE_MAX) return `The note is longer than ${NOTE_MAX} characters.`;
  if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(note)) return "The note may not hold control characters.";
  if (/https?:\/\/|www\.|<[a-z/!]/i.test(note)) return "A note may not hold links or markup.";
  return null;
}

/** What the server accepts for its one write tool, checked again there. */
export function checkMoveArgs(raw: unknown): { dealId: string; stage: string; note: string } | { problem: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (!dealIdOk(a.dealId)) return { problem: "dealId must be a HubSpot deal id" };
  const { dealId, ...rest } = a;
  const no = refuseMove(rest);
  return no ? { problem: no } : { dealId: dealId as string, stage: String(a.stage), note: String(a.note).trim() };
}

/** The note HubSpot stores: plain text, escaped, since HubSpot shows note bodies as HTML. */
export const noteBody = (note: string) => note.trim().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
