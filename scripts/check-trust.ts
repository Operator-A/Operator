// Trust levels (card 7, docs/trust.md): `npm run check:trust`. The rules are pure; the wiring is checked
// from source, so no database is needed.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TOOLS } from "../core/gateway/policy";
import { REJECT_KINDS, TRUST, demotes, effectiveLevel, executeAfter, isDue, nextLevel, offerWords, standing, standingWords, type Outcome } from "../core/trust-rules";
import { TENANT_TABLES } from "../core/tenancy";

const ok = (n: number): Outcome[] => Array.from({ length: n }, () => ({ clean: true, kind: null }));
const no = (kind: Outcome["kind"]): Outcome => ({ clean: false, kind });

// the bar: 28 of the last 30, from the record since the level changed
assert.deepEqual(TRUST, { window: 30, needed: 28, cooldown: 10 });
assert.deepEqual(standing({ level: "draft", promotable: true, outcomes: ok(30) }), { kind: "offer", to: "act_undo", clean: 30 });
assert.deepEqual(standing({ level: "draft", promotable: true, outcomes: [no("not_now"), no("other"), ...ok(28)] }), { kind: "offer", to: "act_undo", clean: 28 });
assert.equal(standing({ level: "draft", promotable: true, outcomes: [no("not_now"), no("other"), no("not_now"), ...ok(27)] }).kind, "progress", "27 of 30 is not enough");
assert.deepEqual(standing({ level: "draft", promotable: true, outcomes: ok(29) }), { kind: "progress", clean: 29, decided: 29, blocked: false }, "it needs 30 decisions");
assert.equal(standing({ level: "draft", promotable: true, outcomes: [...ok(29), no("wrong")] }).kind, "progress", "a wrong in the last 30 holds it back");
assert.equal(standing({ level: "draft", promotable: true, outcomes: [no("policy"), ...ok(29)] }).kind, "progress", "so does a policy rejection");
assert.equal(standing({ level: "draft", promotable: true, outcomes: [...ok(30), no("wrong")] }).kind, "offer", "only the last 30 count");
assert.equal(standing({ level: "draft", promotable: true, outcomes: [{ clean: false, kind: null }, { clean: false, kind: null }, { clean: false, kind: null }, ...ok(27)] }).kind, "progress", "an edited approval is not clean");
// next level, the top, never
assert.equal(standing({ level: "act_undo", promotable: true, outcomes: ok(30) }).kind, "offer");
assert.deepEqual(standing({ level: "act_undo", promotable: true, outcomes: ok(30) }), { kind: "offer", to: "act", clean: 30 });
assert.deepEqual(standing({ level: "act", promotable: true, outcomes: ok(30) }), { kind: "top" });
assert.deepEqual(standing({ level: "draft", promotable: false, outcomes: ok(30) }), { kind: "never" }, "a first email is never promoted");
assert.equal(nextLevel("draft"), "act_undo");
assert.equal(nextLevel("act_undo"), "act");
assert.equal(nextLevel("act"), null);
// after "Not yet": 10 more decisions first
assert.equal(standing({ level: "draft", promotable: true, outcomes: ok(30), sinceDecline: 9 }).kind, "progress");
assert.equal(standing({ level: "draft", promotable: true, outcomes: ok(30), sinceDecline: 10 }).kind, "offer");
// what drops a type back to Draft
assert.deepEqual([...REJECT_KINDS], ["wrong", "policy", "not_now", "other"]);
assert.ok(demotes("wrong") && demotes("policy") && !demotes("not_now") && !demotes("other") && !demotes(null));
// code wins over the table
assert.equal(effectiveLevel("act", false), "draft", "a tool never promoted runs at Draft whatever the table says");
assert.equal(effectiveLevel("act_undo", true), "act_undo");
assert.equal(effectiveLevel(null, true), "draft", "no row: Draft");
assert.equal(effectiveLevel("bogus" as never, true), "draft");
assert.equal(TOOLS["gmail.create_draft"].promotable, false, "first contact: Draft for good (CLAUDE.md)");
for (const t of Object.values(TOOLS)) assert.equal(t.tier, "Draft", "every action type starts at Draft");
// the undo window
assert.equal(executeAfter(Date.parse("2026-12-01T12:00:00Z"), 30), "2026-12-01T12:30:00.000Z");
assert.equal(executeAfter(Date.parse("2026-12-01T12:00:00Z"), 0), "2026-12-01T12:01:00.000Z", "never no window");
assert.ok(isDue("2026-12-01T12:30:00.000Z", Date.parse("2026-12-01T12:30:00Z")) && !isDue("2026-12-01T12:30:00.000Z", Date.parse("2026-12-01T12:29:59Z")) && !isDue(null, Date.now()));
// words
assert.equal(offerWords({ agent: "Quinn", what: "receipt and category changes", clean: 29, to: "act_undo", undoMinutes: 30 }), "Quinn’s receipt and category changes: 29 of the last 30 approved unedited. Let these run by themselves after a 30-minute undo window?");
assert.match(offerWords({ agent: "Quinn", what: "x", clean: 30, to: "act", undoMinutes: 30 }), /ran without a cancel\. Let these run by themselves right away/);
assert.match(standingWords("draft", { kind: "progress", clean: 12, decided: 14, blocked: true }), /12 of 30 clean so far \(a recent “wrong”/);
assert.match(standingWords("draft", { kind: "never" }), /never promoted/);

// wiring, from source
const src = (f: string) => readFileSync(f, "utf8");
const trust = src("core/trust.ts");
const gw = src("core/gateway/index.ts");
const actions = src("dashboard/actions.ts");
assert.ok((TENANT_TABLES as readonly string[]).includes("trust_levels"), "trust_levels is a tenant table");
// only acceptOffer raises a level, and only an owner's tap calls it
const raises = [...trust.matchAll(/\.update\(\{ level: s\.to/g)].length;
assert.equal(raises, 1, "one place moves a level up");
assert.ok(trust.indexOf("export async function acceptOffer") < trust.indexOf(".update({ level: s.to"), "and it is acceptOffer");
for (const f of ["core/gateway/index.ts", "dashboard/trust.ts", "app/api/dispatch/route.ts", "core/runner.ts", "core/tools/catalog.ts"]) assert.doesNotMatch(src(f), /acceptOffer/, `${f} never promotes`);
const accept = actions.slice(actions.indexOf("export async function acceptPromotion"), actions.indexOf("export async function declinePromotion"));
assert.match(accept, /await asRole\("owner"\)/, "the owner confirms the promotion card (CLAUDE.md)");
assert.match(accept, /acceptOffer\(/);
assert.match(trust, /if \(s\.kind !== "offer" \|\| s\.to !== row\.offer_level\)/, "the record is checked again at the tap");
// demotion paths
assert.match(gw, /export async function onBreach[\s\S]*?await demote\(b\.agentId, b\.tool/, "a cap breach drops the type back to Draft");
assert.match(trust, /if \(demotes\(kind\)\) return \(await demote\(/, "a wrong or policy decision demotes");
assert.match(trust, /\.update\(\{ status: "cancelled"[^\n]*\n\s+\.eq\("agent_id", agentId\)\.eq\("tool", tool\)\.eq\("status", "scheduled"\)/, "demoting cancels what waits in the undo window");
// the gateway: the level picks the path, caps and refusals first
const prop = gw.slice(gw.indexOf("export async function propose"), gw.indexOf("// ---- Gmail drafts"));
assert.ok(prop.indexOf("refuseProposal(") < prop.indexOf("levelOf("), "refusals before the level");
assert.match(prop, /level === "act_undo"\s*\n?\s*\? \{ status: "scheduled", level, execute_after: executeAfter\(now, undo\) \}/);
assert.match(src("app/api/dispatch/route.ts"), /controlsOn\(\) \? await applyTrusted\(/, "the scheduler applies trusted actions only with controls on");
const applyT = gw.slice(gw.indexOf("export async function applyTrusted"), gw.indexOf("export async function applyTrusted") + 1500);
assert.match(applyT, /\.eq\("status", "scheduled"\)\.lte\("execute_after", iso\)/, "only after the window");
assert.match(applyT, /applyApproved\(/, "through the same fresh checks as an approved action");
// a rejection says why
assert.match(actions, /if \(!isRejectKind\(kind\)\) return \{ ok: false, text: "Say why/);
const mig = src("supabase/migrations/20261225090000_trust_levels.sql");
assert.match(mig, /level text not null default 'draft'/);
assert.match(mig, /'scheduled', 'cancelled'/);
assert.match(mig, /reject_kind text check/);

console.log("check:trust ok");
