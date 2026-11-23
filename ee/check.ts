// Copyright Operator Enterprises and Technologies, LLC. Licensed under ee/LICENSE, not the AGPL-3.0.
// The paid layer's checks: `npm run check:ee`. Pure: no database, no network.
import assert from "node:assert/strict";
import { EE_TABLES } from "../scripts/lib/schema";
import { readFileSync, readdirSync } from "node:fs";
import { createHmac } from "node:crypto";
import { checkSignup, codeHash, newCode, normalCode, slugFor } from "./signup-rules";
import { formEncode, ourStatus, rowFromSubscription, trialEndFor, validSignature } from "./stripe-rules";
import { PLAN, monthlyUsd, planBlockFor, planState, planWords, type Subscription } from "./plan-rules";
import type { PlanAsk } from "../core/extension-types";
import { CREDITS_TAX_CODE, MIN_BALANCE_USD, PACKS_USD, packLineItem, balanceOf, creditBlock, creditFromSession, creditWords, isPack, mayUsePooledKey, packProblem, packReturn, runCharge, SETUP_FREE_USD, setupFreeLeft, setupRunCharge, usdWords } from "./credit-rules";
import { billingFor } from "../core/cost-rules";
import { cohortsFor, pickSimilar, recallTags } from "./brain-rules";
import { BANK_DIRECTIVE, BANK_SETTINGS, PATTERN_PREFIX, RETAIN_BATCH, SYNC_EVERY_MS, cohortWords, docIdOf, statementOf, statementProblem, syncDue, syncPlan, syncWith, tagsOf, type Bank } from "./brain-rules";
import type { PatternRow } from "../core/brain-rules";
import { PLAYBOOK_PREFIX, howToOf, lessonDoc, lessonProblem, playbookPlan, readLesson, syncPlaybook } from "./playbook-rules";

const now = Date.parse("2026-12-01T12:00:00Z");
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const sub = (s: Partial<Subscription>): Subscription => ({ status: "trialing", trialEndsAt: null, pastDueSince: null, seats: 1, currentPeriodEnd: null, hasCard: false, ...s });
const ASKS: PlanAsk[] = [{ kind: "run", agentId: "cfo", trigger: "cron" }, { kind: "invite", email: "a@b.co", role: "viewer" }, { kind: "agent_on", agentIds: ["cfo"] }, { kind: "custom_server" }];
const blocksAll = (s: ReturnType<typeof planState>) => ASKS.every((a) => typeof planBlockFor(s, a) === "string");
const blocksNone = (s: ReturnType<typeof planState>) => ASKS.every((a) => planBlockFor(s, a) === null);

// price: $20 with the owner, $5 for each other person
assert.equal(monthlyUsd(1), 20);
assert.equal(monthlyUsd(3), 30);
assert.equal(monthlyUsd(0), 20, "never below the base");
assert.deepEqual(PLAN, { baseUsd: 20, seatUsd: 5, trialDays: 14, graceDays: 7 });

// a comped row is never billed and never paused (card 135): no business is exempt by being first
assert.deepEqual(planState(sub({ status: "comped" }), { now }), { kind: "comped" });
assert.ok(blocksNone(planState(sub({ status: "comped", trialEndsAt: iso(now - DAY) }), { now })), "nothing pauses a comped business");

// no row: no plan, so the crew can't run or grow
assert.deepEqual(planState(null, { now }), { kind: "none" });
assert.ok(blocksAll(planState(null, { now })));

// trial: live until its end, then over; a trial with no end date isn't live
const trial = planState(sub({ trialEndsAt: iso(now + 3.5 * DAY) }), { now });
assert.deepEqual(trial, { kind: "trial", until: iso(now + 3.5 * DAY), daysLeft: 4 });
assert.ok(blocksNone(trial));
assert.deepEqual(planState(sub({ trialEndsAt: iso(now - 1) }), { now }), { kind: "lapsed", why: "trial_over" });
assert.deepEqual(planState(sub({}), { now }), { kind: "lapsed", why: "trial_over" });

// active, grace for 7 days after a failed payment, then paused; canceled pauses
assert.ok(blocksNone(planState(sub({ status: "active" }), { now })));
const grace = planState(sub({ status: "past_due", pastDueSince: iso(now - 6 * DAY) }), { now });
assert.equal(grace.kind, "grace");
assert.ok(blocksNone(grace), "the grace period pauses nothing");
assert.deepEqual(planState(sub({ status: "past_due", pastDueSince: iso(now - 8 * DAY) }), { now }), { kind: "lapsed", why: "unpaid" });
assert.equal(planState(sub({ status: "past_due" }), { now }).kind, "grace", "no date yet: the grace period starts now");
assert.ok(blocksAll(planState(sub({ status: "canceled" }), { now })));

// what the owner reads: says what's paused and that nothing was deleted
const no = planBlockFor({ kind: "lapsed", why: "trial_over" }, ASKS[0])!;
assert.match(no, /trial is over\. Runs are paused\. .*nothing has been deleted/);
assert.match(planWords(trial, 3), /4 days left\. Then \$30\/month for 3 people/);
assert.match(planWords({ kind: "comped" }, 1), /Comped: no charge and no limits/);

// a plan never reaches past its slot: no vault, no gateway, no write tools, no deletes, no send
for (const f of ["ee/plan-rules.ts", "ee/plan.ts", "ee/billing-card.tsx", "ee/index.ts"]) {
  const s = readFileSync(f, "utf8");
  assert.doesNotMatch(s, /core\/vault|core\/gateway|callWriteTool|callMcpTool|\.delete\(|\.update\(|\.insert\(|\.upsert\(/, `${f} only reads`);
  assert.match(s, /^\/\/ Copyright Operator Enterprises and Technologies, LLC\. Licensed under ee\/LICENSE/, `${f} carries the ee license line`);
}
for (const f of readdirSync("ee").filter((f) => /\.tsx?$/.test(f) && f !== "check.ts")) assert.doesNotMatch(readFileSync(`ee/${f}`, "utf8"), /HOME_ORG_ID/, `ee/${f}: no business is special by being first (card 135)`);
assert.match(readFileSync(EE_TABLES, "utf8"), /'canceled', 'comped'\)\)/, "the database allows a comped row");

// Stripe: signatures, encoding, and the row a subscription leaves
{
  const secret = "whsec_test_secret";
  const body = '{"type":"customer.subscription.updated"}';
  const t = 1_800_000_000;
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  assert.ok(validSignature(body, `t=${t},v1=${sig}`, secret, t + 10));
  assert.ok(validSignature(body, `t=${t},v1=${"0".repeat(64)},v1=${sig}`, secret, t), "any v1 may match (secret rolling)");
  assert.ok(!validSignature(body + " ", `t=${t},v1=${sig}`, secret, t), "a changed body fails");
  assert.ok(!validSignature(body, `t=${t},v1=${sig}`, "whsec_other", t), "another secret fails");
  assert.ok(!validSignature(body, `t=${t},v1=${sig}`, secret, t + 301), "an old signature fails");
  assert.ok(!validSignature(body, null, secret, t) && !validSignature(body, `t=${t},v1=${sig}`, "", t), "no header or no secret fails");
  assert.ok(!validSignature(body, `t=${t},v1=zz`, secret, t), "a malformed signature fails");
}
assert.equal(formEncode({ mode: "subscription", line_items: { 0: { price: "price_1", quantity: 3 } }, customer: undefined, subscription_data: { metadata: { org_id: "o" } } }),
  "mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=3&subscription_data%5Bmetadata%5D%5Borg_id%5D=o");
assert.equal(ourStatus("unpaid"), "past_due");
assert.equal(ourStatus("incomplete"), null, "an incomplete first payment changes nothing");
assert.equal(ourStatus("incomplete_expired"), "canceled");
{
  const s = { id: "sub_ABC123", customer: "cus_XYZ789", status: "past_due", trial_end: null, metadata: { org_id: "0e1a7c4e-0002-4000-8000-000000000002" }, items: { data: [{ id: "si_1", quantity: 4, current_period_end: 1_800_000_000 }] } };
  const nowIso = "2026-12-01T12:00:00.000Z";
  const first = rowFromSubscription(s, { status: "active", past_due_since: null }, nowIso)!;
  assert.deepEqual(first, { status: "past_due", trial_ends_at: null, past_due_since: nowIso, seats: 4, stripe_customer_id: "cus_XYZ789", stripe_subscription_id: "sub_ABC123", current_period_end: new Date(1_800_000_000_000).toISOString() });
  assert.equal(rowFromSubscription(s, { status: "past_due", past_due_since: "2026-11-28T00:00:00.000Z" }, nowIso)!.past_due_since, "2026-11-28T00:00:00.000Z", "the grace period runs from the first failure");
  assert.equal(rowFromSubscription({ ...s, status: "active" }, { status: "past_due", past_due_since: nowIso }, nowIso)!.past_due_since, null, "paid: grace cleared");
  assert.equal(rowFromSubscription({ ...s, customer: "evil" }, null, nowIso), null, "ids must be Stripe's");
  assert.equal(rowFromSubscription({ ...s, status: "incomplete" }, null, nowIso), null);
}
assert.equal(trialEndFor(iso(now + 3 * DAY), now), Math.floor((now + 3 * DAY) / 1000), "the rest of our trial carries over to Stripe");
assert.equal(trialEndFor(iso(now + 47 * 3_600_000), now), undefined, "under 48 hours: Stripe charges at once");
assert.equal(trialEndFor(null, now), undefined);

// Stripe stays app infrastructure: one file calls it, nothing outside ee/ reaches it, no agent path
assert.deepEqual(readdirSync("ee").filter((f) => f !== "check.ts" && /\.tsx?$/.test(f) && /api\.stripe\.com|STRIPE_SECRET_KEY/.test(readFileSync(`ee/${f}`, "utf8"))), ["stripe.ts"], "only ee/stripe.ts calls Stripe or reads its key");
assert.match(readFileSync("ee/stripe.ts", "utf8"), /redirect: "error"/, "a request carrying the key never follows a redirect");
assert.match(readFileSync("ee/stripe.ts", "utf8"), /scrubSecrets\(/, "errors never show the key");
const billing = readFileSync("ee/billing.ts", "utf8");
assert.doesNotMatch(billing, /core\/vault|core\/gateway|callWriteTool|callMcpTool|\.delete\(/, "billing touches no vault, gateway or tool, and deletes nothing");
assert.deepEqual([...billing.matchAll(/db\(\)\.from\("(\w+)"\)/g)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i).sort(), ["ee_subscriptions", "orgs"], "billing reads only its row and whether the org exists");
assert.match(billing, /if \(prev\?\.status === "comped"\) return "a comped business is never billed"/, "the webhook never writes over a comped row");
assert.ok(billing.indexOf('prev?.status === "comped"') < billing.indexOf("rowFromSubscription(s, prev"), "checked before anything is written");
assert.match(billing, /if \(r\?\.status === "comped"\) throw/, "a comped business can't open Checkout");
assert.match(readFileSync("ee/billing-actions.ts", "utf8"), /^"use server";/);

// Invite-only sign-up: codes, the form, and one code making one business
{
  const code = newCode(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 255]));
  assert.match(code, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/, "codes use letters that can't be misread");
  assert.match(newCode(), /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  assert.notEqual(newCode(), newCode());
  assert.equal(normalCode(` ${code.toLowerCase()} `), code.replace(/-/g, ""), "typed any case, with or without dashes");
  assert.equal(normalCode("ABCD-EFGH-IJK0"), null, "0, 1, I, L and O never appear in a code");
  assert.equal(codeHash("ABCDEFGHJKMN"), codeHash("ABCDEFGHJKMN"));
  assert.match(codeHash("ABCDEFGHJKMN"), /^[0-9a-f]{64}$/);
  assert.equal(slugFor("Café Olé & Sons!", "a1b2c3"), "cafe-ole-sons-a1b2c3");
  assert.equal(slugFor("!!", "a1b2c3"), "business-a1b2c3");
  assert.match(slugFor("x".repeat(200)), /^[a-z0-9][a-z0-9-]{1,40}$/, "a slug core/install accepts");
  const good = { code: code.toLowerCase(), business: "  Acme   Coffee ", ownerName: "Sam", email: "Sam@Acme.example" };
  assert.deepEqual(checkSignup(good), { ok: { code: code.replace(/-/g, ""), business: "Acme Coffee", ownerName: "Sam", email: "sam@acme.example" } });
  assert.ok("problem" in checkSignup({ ...good, code: "nope" }));
  assert.ok("problem" in checkSignup({ ...good, email: "sam@acme" }));
  assert.ok("problem" in checkSignup({ ...good, business: "" }));
  const signup = readFileSync("ee/signup.ts", "utf8");
  assert.match(signup, /\.update\(\{ used_at: now \}\)\.eq\("code_hash", codeHash\(f\.code\)\)\.is\("used_at", null\)\.gt\("expires_at", now\)/, "a code is used once, only while it's open, before anything is made");
  assert.ok(signup.indexOf("if (!claimed)") < signup.indexOf("await newOrg("), "no business without a used code");
  assert.match(signup, /status: "trialing", trial_ends_at: new Date\(Date\.now\(\) \+ PLAN\.trialDays/, "a new business starts on the trial");
  assert.doesNotMatch(signup, /\.delete\(|core\/vault|core\/gateway/, "codes are ended, never deleted");
  const actions = readFileSync("ee/signup-actions.ts", "utf8");
  assert.ok(actions.indexOf("checkSignup(") < actions.indexOf("signUpBusiness(ok)"), "the form is checked first");
  assert.equal(actions.match(/if \(me\.orgId !== adminOrgId\(\)\)/g)?.length, 2, "only the admin business makes and ends codes");
  assert.equal(signup.match(/withOrg\(/g)?.length, 2, "codes are read and written only as the admin business (asAdmin), and the new business as itself");
  assert.match(signup, /if \(!admin\) return Promise\.reject\(new Error\(SIGNUP_CLOSED\)\)/, "no admin business: sign-up is closed");
  const admin = readFileSync("ee/admin.ts", "utf8");
  assert.match(admin, /process\.env\.OPERATOR_ADMIN_ORG_ID/, "the admin business is one setting");
  assert.match(readFileSync("ee/signup-page.tsx", "utf8"), /if \(!adminOrgId\(\)\)/, "/signup says when sign-up is closed");
}

// Managed Claude credits (card 128 slice 4): who pays, a run's charge, the balance, and buying a pack
assert.equal(billingFor({ ownKey: true, edition: "cloud" }), "own_key", "a business's own key always wins");
assert.equal(billingFor({ ownKey: false, edition: "cloud" }), "credits");
assert.equal(billingFor({ ownKey: false, edition: "open" }), "own_key", "the open edition has no credits");
assert.deepEqual([...PACKS_USD], [10, 25, 50]);
assert.equal(MIN_BALANCE_USD, 0.5);
assert.equal(runCharge(0.1), 0.12, "cost plus 20%");
assert.equal(runCharge(0.0021), 0.00252, "a fraction of a cent is charged exactly, not rounded up");
assert.equal(runCharge(0), 0);
assert.equal(runCharge(-1), 0, "never a credit from a run");
assert.equal(runCharge(Number.NaN), 0);
assert.equal(balanceOf([{ amount_usd: "10.000000" }, { amount_usd: -0.12 }, { amount_usd: "-0.00252" }]), 9.87748);
assert.equal(balanceOf([]), 0);
{
  const run = (billing: "own_key" | "credits", trigger: string, balance: number) => creditBlock({ billing, trigger, balance });
  assert.equal(run("own_key", "cron", 0), null, "a business's own key is never held to credits");
  assert.equal(run("credits", "cron", 0.5), null);
  assert.match(run("credits", "cron", 0.49)!, /Claude credits are at \$0\.49.*Runs are paused.*Nothing has been deleted/);
  for (const t of ["manual", "chain", "setup", "preview"]) assert.ok(run("credits", t, 0), `${t} needs credits`);
  assert.equal(run("credits", "approval", 0), null, "a tapped approval is applied whatever the balance");
  assert.equal(creditBlock({ billing: undefined, trigger: "cron", balance: 0 }), null);
}
assert.ok(mayUsePooledKey({ balance: 0.5, planBlocked: false, keySet: true }));
assert.ok(!mayUsePooledKey({ balance: 0.49, planBlocked: false, keySet: true }), "not under the minimum");
assert.ok(!mayUsePooledKey({ balance: 50, planBlocked: true, keySet: true }), "not when the plan pauses runs");
assert.ok(!mayUsePooledKey({ balance: 50, planBlocked: false, keySet: false }), "not when the deployment has no key");
{
  const line = packLineItem(25);
  assert.equal(line.quantity, 1);
  assert.deepEqual(line.price_data, { currency: "usd", unit_amount: 2500, product_data: { name: "OPERATOR Claude credits ($25)", tax_code: "txcd_10105002" } }, "a pack line carries its price and an AI-as-a-service tax code (Managed Payments refuses a line without one)");
  assert.equal(CREDITS_TAX_CODE, "txcd_10105002");
  assert.match(readFileSync("ee/credits.ts", "utf8"), /line_items: \{ 0: packLineItem\(pack\) \}/, "the checkout uses packLineItem");
}
assert.ok(isPack(25) && isPack("10") && !isPack(11) && !isPack("10.0") && !isPack(" 1e1") && !isPack(null));
{
  const org = "0e1a7c4e-0002-4000-8000-000000000002";
  const paid = { id: "cs_test_a1B2c3D4e5", mode: "payment", payment_status: "paid", amount_subtotal: 2500, amount_total: 2500, currency: "usd", client_reference_id: org, metadata: { org_id: org, kind: "credits", pack: "25" } };
  assert.deepEqual(creditFromSession(paid), { org, session: "cs_test_a1B2c3D4e5", usd: 25 });
  assert.ok("skip" in creditFromSession({ ...paid, amount_subtotal: 1000, amount_total: 1000 }), "the pack named must be the amount charged");
  assert.deepEqual(creditFromSession({ ...paid, amount_total: 2706 }), { org, session: "cs_test_a1B2c3D4e5", usd: 25 }, "sales tax on top is paid, never credited");
  assert.ok("skip" in creditFromSession({ ...paid, amount_total: 2400 }), "a total under the pack adds nothing");
  assert.ok("skip" in creditFromSession({ ...paid, amount_subtotal: undefined }), "no subtotal, no credit");
  assert.ok("skip" in creditFromSession({ ...paid, metadata: { ...paid.metadata, pack: "100" }, amount_total: 10000 }), "only our packs");
  assert.ok("skip" in creditFromSession({ ...paid, payment_status: "unpaid" }), "not before it's paid");
  assert.ok("skip" in creditFromSession({ ...paid, mode: "subscription" }), "the plan's checkout is not credits");
  assert.ok("skip" in creditFromSession({ ...paid, metadata: { ...paid.metadata, kind: "other" } }), "only sessions we started for credits");
  assert.ok("skip" in creditFromSession({ ...paid, currency: "eur" }), "dollars only");
  assert.ok("skip" in creditFromSession({ ...paid, client_reference_id: "0e1a7c4e-0003-4000-8000-000000000003" }), "the org must match the session's");
  assert.ok("skip" in creditFromSession({ ...paid, metadata: { ...paid.metadata, org_id: "nope" } }), "an org id we made");
  assert.ok("skip" in creditFromSession({ ...paid, id: "pi_123" }), "a Checkout session id");
}
assert.equal(usdWords(0.004), "$0.01");
assert.equal(usdWords(-0.12), "-$0.12");
assert.match(creditWords({ billing: "credits", balance: 0.2 }), /Claude credits: \$0\.20\. Each run is charged its model cost plus 20%\. Runs are paused until you buy credits\./);
assert.match(creditWords({ billing: "own_key", balance: 3 }), /your own Claude key/);
{
  const credits = readFileSync("ee/credits.ts", "utf8");
  assert.doesNotMatch(credits, /core\/vault|core\/gateway|callWriteTool|callMcpTool|\.delete\(|\.update\(|\.upsert\(/, "credits only add ledger rows: no vault, gateway, tool, change or delete");
  assert.deepEqual([...credits.matchAll(/db\(\)\.from\("(\w+)"\)/g)].map((m) => m[1]).filter((t, i, a) => a.indexOf(t) === i).sort(), ["agent_runs", "ee_credit_ledger", "orgs"], "credits read only their ledger, whether the org exists, and setup runs' cost (free setup, card 162)");
  assert.match(credits, /process\.env\.OPERATOR_CLAUDE_KEY/, "the hosted key is one setting");
  assert.deepEqual(readdirSync("ee").filter((f) => f !== "check.ts" && /\.tsx?$/.test(f) && /OPERATOR_CLAUDE_KEY/.test(readFileSync(`ee/${f}`, "utf8"))), ["credits.ts"], "only ee/credits.ts reads the hosted key");
  assert.ok(credits.indexOf("if (run.billing !== \"credits\") return;") < credits.indexOf(".insert({ kind: \"run\""), "only a credit run is charged");
  assert.match(credits, /mayUsePooledKey\(\{ balance, planBlocked, keySet: true, setupFreeLeft: free \}\) \? hostedKey\(\) : null/, "the hosted key only with a plan, and a balance or free setup left");
  const mig = readFileSync("supabase/migrations/20261224090000_ee_credit_ledger.sql", "utf8");
  assert.match(mig, /stripe_session_id text unique/, "a pack is added once per Checkout session");
  assert.match(mig, /run_id uuid unique/, "a run is charged once");
  assert.match(mig, /revoke update, delete, truncate on ee_credit_ledger/, "ledger rows are never changed or deleted");
  const claude = readFileSync("integrations/anthropic.ts", "utf8");
  assert.ok(claude.indexOf("if (own) return") < claude.indexOf("await pooledKey()"), "a business's own key is used before the hosted one");
  assert.match(claude, /if \(edition\(\) === "open"\) throw new Error\(NO_CLAUDE_KEY\)/, "the open edition never asks for a hosted key");
}

assert.equal(SETUP_FREE_USD, 3); // raised from $2 on 2026-11-22
assert.equal(setupFreeLeft({ inSetup: true, setupSpentUsd: 0 }), 3);
assert.equal(setupFreeLeft({ inSetup: true, setupSpentUsd: 0.75 }), 2.25);
assert.equal(setupFreeLeft({ inSetup: true, setupSpentUsd: 5 }), 0, "never below zero");
assert.equal(setupFreeLeft({ inSetup: false, setupSpentUsd: 0 }), 0, "nothing free once setup is done");
assert.equal(setupFreeLeft({ inSetup: true, setupSpentUsd: Number.NaN }), 0, "a spend that can't be read leaves nothing free");
assert.equal(setupFreeLeft({ inSetup: true, setupSpentUsd: -3 }), 3, "a negative spend never adds to the allowance");
assert.equal(setupRunCharge(0.05, 1), 0, "inside the allowance: free");
assert.equal(setupRunCharge(0.05, 0.03), 0.024, "only the part past the allowance, plus 20%");
assert.equal(setupRunCharge(0.05, 0), 0.06, "allowance used up: the full charge");
assert.equal(setupRunCharge(Number.NaN, 0), 0);
assert.equal(creditBlock({ billing: "credits", trigger: "setup", balance: 0, setupFreeLeft: 0.5 }), null, "a setup message with free setup left runs with no credits");
assert.ok(creditBlock({ billing: "credits", trigger: "setup", balance: 0, setupFreeLeft: 0 }), "free setup used up: buy credits");
for (const t of ["cron", "manual", "chain", "preview"]) assert.ok(creditBlock({ billing: "credits", trigger: t, balance: 0, setupFreeLeft: 2 }), `free setup never pays for a ${t} run`);
assert.ok(mayUsePooledKey({ balance: 0, planBlocked: false, keySet: true, setupFreeLeft: 1 }), "free setup gets the hosted key");
assert.ok(!mayUsePooledKey({ balance: 0, planBlocked: true, keySet: true, setupFreeLeft: 1 }), "not when the plan pauses runs");
assert.ok(!mayUsePooledKey({ balance: 0, planBlocked: false, keySet: true, setupFreeLeft: 0 }));
{
  const credits = readFileSync("ee/credits.ts", "utf8");
  assert.match(credits, /\.eq\("trigger", "setup"\)/, "only setup messages count toward free setup");
  assert.match(credits, /row\?\.trigger === "setup" \? setupRunCharge\(run\.costUsd, await setupFree\(run\.runId\)\)/, "a setup run is charged only past the allowance left before it");
  assert.match(readFileSync("ee/plan.ts", "utf8"), /setupFreeLeft: free/, "the run check lets a free setup message through");
}

// where Stripe comes back to after a pack (card 162): a fixed list, never an address from the form
assert.deepEqual(packReturn("start"), { place: "start", success: "/start?claude=hosted&credits=added", cancel: "/start?claude=hosted" });
assert.equal(packReturn("connections").success, "/connections?credits=added#claude");
assert.equal(packReturn("settings").success, "/settings/billing?credits=added");
for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "/start", "START", ["start"]]) assert.equal(packReturn(bad).place, "settings", `${String(bad)} comes back to Settings`);
for (const p of ["start", "connections", "settings"] as const) {
  const r = packReturn(p);
  for (const u of [r.success, r.cancel, packProblem(p, "x")]) assert.match(u, /^\/(start|connections|settings\/billing)([?#]|$)/, "a path on this app, never another host");
}
assert.equal(packProblem("start", "a&b#c"), "/start?claude=hosted&credits_problem=a%26b%23c", "the problem is encoded");
assert.ok(packProblem("connections", "x".repeat(500)).length < 260, "the problem is cut");
assert.match(readFileSync("ee/billing-actions.ts", "utf8"), /packReturn\(form\.get\("back"\)\)/, "buyCredits reads the return place through the allowlist");
assert.match(readFileSync("ee/index.ts", "utf8"), /^\s+HostedClaude,$/m, "the cloud edition fills the HostedClaude slot");

// the shared brain's bank (card 232): one plain statement per counted pattern, list words and counted numbers only
{
  const kits = { finance: "Finance", email_marketing: "Email marketing" };
  const row = (cohort: string, pattern: string, orgs: number, hits: number, num: number | null = null, den: number | null = null): PatternRow => ({ cohort, pattern, orgs, hits, num, den });
  assert.equal(cohortWords("all"), "Among businesses on OPERATOR");
  assert.equal(cohortWords("kind:online_store|rev:under_10k"), "Among online stores under $10k a month on OPERATOR");
  for (const bad of ["kind:nope", "kind:online_store|rev:unknown", "kind:online_store|rev:x", "name:Acme", "kind:online_store|rev:under_10k|x"]) assert.equal(cohortWords(bad), null, `${bad} is not a cohort from the lists`);
  assert.equal(statementOf(row("kind:online_store|rev:under_10k", "tool:list:klaviyo", 26, 18), kits), "Among online stores under $10k a month on OPERATOR, 18 of 26 use Klaviyo for email marketing.");
  assert.equal(statementOf(row("all", "dept:finance", 12, 7), kits), "Among businesses on OPERATOR, 7 of 12 that are 60 or more days in run a Finance department.");
  assert.equal(statementOf(row("kind:services", "action:gmail.create_draft", 9, 9, 41, 50), kits), "Among service businesses on OPERATOR, 9 businesses decided 50 Gmail drafts to leads in the last 30 days, and 82% went through unedited.");
  assert.equal(statementOf(row("all", "level:calendar.hold", 8, 5), kits), "Among businesses on OPERATOR, 5 of 8 that used calendar holds earned enough trust to let them act with an undo window or on their own.");
  // under the floor, off a list, or numbers that don't add up: never a statement
  for (const r of [row("all", "tool:list:klaviyo", 4, 4), row("all", "tool:list:klaviyo", 9, 4), row("all", "tool:list:klaviyo", 5, 6), row("all", "tool:list:acme_secret", 9, 6), row("all", "tool:nopart:klaviyo", 9, 6),
    row("all", "dept:my_bespoke_team", 9, 6), row("all", "action:gmail.create_draft", 9, 9, 51, 50), row("all", "action:gmail.create_draft", 9, 9, null, 50), row("all", "free text", 9, 6), row("all", "tool:list:klaviyo:x", 9, 6)])
    assert.equal(statementOf(r, kits), null, `${r.cohort} ${r.pattern} ${r.orgs}/${r.hits} is not said`);
  assert.equal(statementProblem("Among businesses on OPERATOR, 5 of 8 use Klaviyo."), null);
  for (const bad of ["", "x".repeat(301), "Reach me at a@b.co", "See https://x.co", "Line\nbreak", "Acme’s \"secret\""]) assert.ok(statementProblem(bad), `${bad.slice(0, 20)} is refused`);
  // document ids are stable and tags carry cohort and kind
  assert.equal(docIdOf({ cohort: "kind:online_store|rev:under_10k", pattern: "tool:list:klaviyo" }), "pat-kind:online_store--rev:under_10k--tool:list:klaviyo");
  assert.ok(docIdOf({ cohort: "all", pattern: "dept:finance" }).startsWith(PATTERN_PREFIX));
  assert.deepEqual(tagsOf({ cohort: "kind:services|rev:none", pattern: "action:calendar.hold" }), ["cohort:kind:services|rev:none", "pattern:action", "kind:services"]);
  assert.deepEqual(tagsOf({ cohort: "all", pattern: "dept:finance" }), ["cohort:all", "pattern:dept"]);
  // the plan: every pattern that can be said, and only stale pattern documents removed (the playbook stays)
  const rows = [row("all", "tool:list:klaviyo", 10, 6), row("all", "dept:finance", 10, 5), row("all", "tool:list:acme_secret", 10, 6), row("all", "tool:list:mailchimp", 4, 4)];
  const plan = syncPlan(rows, ["pat-all--tool:list:klaviyo", "pat-all--tool:list:mailchimp", "playbook-onboarding", "pat-all--dept:old"], kits);
  assert.deepEqual(plan.retain.map((r) => r.documentId), ["pat-all--tool:list:klaviyo", "pat-all--dept:finance"]);
  assert.deepEqual(plan.remove, ["pat-all--tool:list:mailchimp", "pat-all--dept:old"]);
  for (const r of plan.retain) {
    assert.equal(statementProblem(r.content), null);
    assert.ok(!/acme|secret/i.test(JSON.stringify(r)), "nothing off a list is sent");
    assert.deepEqual(Object.keys(r.metadata).sort(), ["cohort", "pattern"]);
  }
  // a sync against a fake bank: the bank is set first, the directive added once, retains in batches, stale deleted
  const fake = (existing: string[], directives: string[] = []) => {
    const calls: string[] = [];
    const batches: number[] = [];
    const bank: Bank = {
      async setBank() { calls.push("setBank"); },
      async directives() { calls.push("directives"); return directives; },
      async addDirective(name) { calls.push(`addDirective:${name}`); directives.push(name); },
      async documents() { calls.push("documents"); return existing; },
      async retain(docs) { calls.push("retain"); batches.push(docs.length); },
      async remove(id) { calls.push(`remove:${id}`); },
    };
    return { bank, calls, batches };
  };
  void (async () => {
    const f = fake(["pat-all--dept:old", "playbook-onboarding"]);
    const many = Array.from({ length: 120 }, (_, i) => row(i % 2 ? "all" : "kind:services", i < 60 ? "tool:list:klaviyo" : "dept:finance", 10 + i, 6));
    const uniq = new Set(many.map((r) => docIdOf(r))).size;
    const r = await syncWith(f.bank, many, kits);
    assert.equal(f.calls[0], "setBank", "the bank is set before anything else");
    assert.ok(f.calls.includes(`addDirective:${BANK_DIRECTIVE.name}`));
    assert.ok(f.batches.every((n) => n <= RETAIN_BATCH) && f.batches.reduce((a, b) => a + b, 0) === 120, "every statement retained, at most a batch per call");
    assert.ok(uniq <= 120);
    assert.deepEqual(r, { retained: 120, removed: 1 });
    assert.ok(f.calls.includes("remove:pat-all--dept:old") && !f.calls.some((c) => c.includes("playbook")), "only stale pattern documents are deleted");
    const g = fake([], [BANK_DIRECTIVE.name]);
    await syncWith(g.bank, [], kits);
    assert.ok(!g.calls.some((c) => c.startsWith("addDirective")), "the directive is added once");
  })().catch((e) => { console.error(e); process.exit(1); });
  assert.equal(BANK_SETTINGS.retainExtractionMode, "verbatim", "statements kept word for word");
  assert.equal(BANK_SETTINGS.enableObservations, false, "no model writes new memories from them");
  // the weekly gate
  const now = Date.parse("2026-12-01T00:00:00Z");
  assert.equal(syncDue(null, now), true);
  assert.equal(syncDue("not a date", now), true);
  assert.equal(syncDue(new Date(now - SYNC_EVERY_MS).toISOString(), now), true);
  assert.equal(syncDue(new Date(now - 6 * 864e5).toISOString(), now), false);
  // Hindsight is reached from one file, and only with both settings and an admin business
  const brain = readFileSync("ee/brain.ts", "utf8");
  assert.match(brain, /if \(!hindsightReady\(\) \|\| !admin\) return "off";/);
  assert.match(readFileSync("ee/index.ts", "utf8"), /afterSchedule: syncBrain/);
  const callers = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.name === "node_modules" || e.name.startsWith(".") ? [] : e.isDirectory() ? callers(`${dir}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) && /from "@vectorize-io\/hindsight-client"/.test(readFileSync(`${dir}/${e.name}`, "utf8")) ? [`${dir}/${e.name}`] : []);
  assert.deepEqual(["app", "core", "dashboard", "ee", "integrations", "scripts"].flatMap((d) => { try { return callers(d); } catch { return []; } }), ["ee/brain.ts"], "only ee/brain.ts talks to Hindsight");
}

// the OPERATOR playbook (card 235): staff lessons, no counts, percentages or addresses, kept apart from the counts in the bank
{
  const ok = { title: "Start email with a welcome series", body: "Before any campaign, set up a short welcome series so new subscribers hear from you while they still care.", kind: null };
  assert.equal(lessonProblem(ok), null);
  assert.equal(lessonProblem({ ...ok, body: "Send weekly, not daily, while the list is under 1,000 subscribers." }), null, "small numbers in advice are fine");
  for (const [bad, why] of [[{ ...ok, title: "x" }, "title"], [{ ...ok, body: "short" }, "body"], [{ ...ok, title: "t".repeat(81) }, "long title"], [{ ...ok, body: "b".repeat(601) }, "long body"],
    [{ ...ok, body: "About 80% of stores kept the email department after two months." }, "percent"], [{ ...ok, body: "Eighteen percent of stores kept the email department after two months." }, "percent word"],
    [{ ...ok, body: "We saw 18 of 26 online stores keep email marketing after sixty days." }, "count"], [{ ...ok, body: "Write to founders@example.com with questions about this lesson." }, "email"],
    [{ ...ok, body: "Read the full guide at https://example.com before setting this up." }, "link"], [{ ...ok, body: "Bad\u0000character in a lesson body that is long enough." }, "control"]] as const)
    assert.ok(lessonProblem(bad as typeof ok), `${why} is refused`);
  assert.deepEqual(readLesson({ title: "  Two\nlines ", body: " a  b\r\n\n\n\nc ", kind: "nope" }), { title: "Two lines", body: "a b\n\nc", kind: null, howTo: null });
  assert.equal(readLesson({ title: "t", body: "b", kind: "online_store" }).kind, "online_store");
  // card 285: a lesson may be a setup how-to; its steps and page are checked by the setup check's own rules
  const how = { tile: "analytics", topic: "ga4.data_retention", steps: "1. Open Admin\n2. Data collection and modification, Data retention\n3. Pick 14 months, Save", help_url: "https://support.google.com/analytics/answer/7667196#x" };
  const hl = readLesson({ ...ok, setup_tile: "analytics", setup_topic: " GA4.Data_Retention ", steps: how.steps, help_url: how.help_url });
  assert.equal(lessonProblem(hl), null);
  const got = howToOf(hl);
  assert.ok(got && "howTo" in got);
  assert.deepEqual(got.howTo, { tile: "analytics", topic: "ga4.data_retention", title: ok.title, steps: ["Open Admin", "Data collection and modification, Data retention", "Pick 14 months, Save"], help_url: "https://support.google.com/analytics/answer/7667196" }, "numbering stripped, the page's hash dropped");
  assert.equal(readLesson({ ...ok, setup_tile: "" }).howTo, null, "no tool: not a how-to");
  for (const [bad, why] of [[{ ...how, tile: "stripe" }, "a tool with no check"], [{ ...how, topic: "Data Retention" }, "a topic that isn't a tag"], [{ ...how, steps: "" }, "no steps"],
    [{ ...how, steps: "Open https://example.com" }, "a link in a step"], [{ ...how, steps: "Keep 100% of data" }, "a percentage in a step"], [{ ...how, help_url: "https://example.com/help" }, "a page off the tool's help site"],
    [{ ...how, steps: Array.from({ length: 9 }, (_, i) => `Step ${i}`).join("\n") }, "more than 8 steps"]] as const)
    assert.ok(lessonProblem({ ...ok, howTo: bad }), `${why} is refused`);
  const id = "0b9d6e1a-1111-4222-8333-444455556666";
  const doc = lessonDoc({ id, ...ok, kind: "online_store" });
  assert.equal(doc.documentId, `${PLAYBOOK_PREFIX}${id}`);
  assert.match(doc.content, /^OPERATOR's playbook, for online stores: Start email with a welcome series\. Before any campaign/);
  assert.deepEqual(doc.tags, ["source:playbook", "kind:online_store"]);
  assert.deepEqual(doc.metadata, { source: "playbook", lesson: id });
  assert.deepEqual(lessonDoc({ id, ...ok }).tags, ["source:playbook", "kind:all"]);
  // the plan keeps patterns and other documents, and drops playbook documents no longer published
  const plan = playbookPlan([{ id, ...ok }, { id: "bad", ...ok, body: "80% of everyone, which is not allowed here." }], [`${PLAYBOOK_PREFIX}old`, `${PLAYBOOK_PREFIX}${id}`, "pat-all--dept:finance"]);
  assert.deepEqual(plan.retain.map((d) => d.documentId), [`${PLAYBOOK_PREFIX}${id}`], "a lesson that breaks the rules is never sent");
  assert.deepEqual(plan.remove, [`${PLAYBOOK_PREFIX}old`]);
  // and the pattern sync never deletes a playbook document
  assert.deepEqual(syncPlan([], [`${PLAYBOOK_PREFIX}${id}`, "pat-all--x"], {}).remove, ["pat-all--x"]);
  void (async () => {
    const calls: string[] = [];
    const bank: Bank = { async setBank() {}, async directives() { return []; }, async addDirective() {}, async documents() { return [`${PLAYBOOK_PREFIX}gone`, "pat-all--dept:finance"]; },
      async retain(docs) { calls.push(`retain:${docs.length}`); }, async remove(d) { calls.push(`remove:${d}`); } };
    assert.deepEqual(await syncPlaybook(bank, [{ id, ...ok }]), { retained: 1, removed: 1 });
    assert.deepEqual(calls, ["retain:1", `remove:${PLAYBOOK_PREFIX}gone`]);
  })().catch((e) => { console.error(e); process.exit(1); });
  // written only in the admin business, by its owners, and audited
  const acts = readFileSync("ee/playbook-actions.ts", "utf8");
  for (const fn of ["playbookSave", "playbookRemove"]) {
    const body = acts.split(`export async function ${fn}`)[1].split("\nexport ")[0];
    assert.match(body, /await asRole\("owner"\)/, `${fn} is owners only`);
    assert.match(body, /me\.orgId !== adminOrgId\(\)/, `${fn} is the admin business only`);
    assert.match(body, /await audit\(me, /, `${fn} is audited`);
  }
  // Publish in the editor saves the edits first, then publishes, each audited (docs/settings.md)
  assert.match(acts, /then === "publish" \|\| then === "unpublish"[\s\S]*await setPublished\(saved, then === "publish"\)[\s\S]*await audit\(me, then === "publish" \? "playbook_publish" : "playbook_unpublish", saved\)/, "publish from the editor saves, then publishes, and is audited");
  assert.match(readFileSync("ee/playbook-card.tsx", "utf8"), /if \(me\.orgId !== adminOrgId\(\) \|\| me\.role !== "owner"\) return null;/, "only the admin business's owners see the card");
  assert.match(readFileSync("ee/playbook.ts", "utf8"), /return withOrg\(admin, fn\);/, "lessons are read and written as the admin business only");
}

// slice 4 (card 233): Hindsight only orders; code says every count from the live rows and every lesson from the table
{
  const kits = { finance: "Finance", email_marketing: "Email marketing" };
  const row = (cohort: string, pattern: string, orgs: number, hits: number, num: number | null = null, den: number | null = null): PatternRow => ({ cohort, pattern, orgs, hits, num, den });
  assert.deepEqual(cohortsFor("online_store", "under_10k"), ["kind:online_store|rev:under_10k", "kind:online_store", "all"]);
  assert.deepEqual(cohortsFor("online_store", "unknown"), ["kind:online_store", "all"]);
  assert.deepEqual(cohortsFor(null, "under_10k"), ["all"]);
  assert.deepEqual(recallTags("services"), ["kind:services", "kind:all", "cohort:all"]);
  assert.deepEqual(recallTags(null), ["kind:all", "cohort:all"]);
  const rows = [
    row("all", "tool:list:klaviyo", 40, 20), row("kind:online_store", "tool:list:klaviyo", 26, 18), row("kind:online_store|rev:under_10k", "tool:list:klaviyo", 12, 9),
    row("kind:online_store", "tool:list:mailchimp", 26, 6), row("kind:services", "tool:list:kit", 9, 7), row("kind:online_store", "tool:books:xero", 26, 8),
    row("kind:online_store", "dept:finance", 20, 12),
  ];
  const lessons = [
    { id: "a1", title: "Start email with a welcome series", body: "Body one, long enough to be a lesson.", kind: "online_store" as const },
    { id: "a2", title: "Connect the bank first", body: "Body two, long enough to be a lesson.", kind: null },
    { id: "a3", title: "Invoice the day the work is done", body: "Body three, long enough to be a lesson.", kind: "agency" as const },
  ];
  const ask = { topic: "list" as const, kind: "online_store" as const, revenue: "under_10k" as const };
  const s = pickSimilar({ ask, rows, lessons, kits, ranked: null });
  assert.deepEqual(s.counts.map((c) => [c.cohort, c.pattern]), [["kind:online_store|rev:under_10k", "tool:list:klaviyo"], ["kind:online_store", "tool:list:mailchimp"]], "one line per pattern, the most specific cohort, on topic, this kind only");
  assert.equal(s.counts[0].statement, "Among online stores under $10k a month on OPERATOR, 9 of 12 use Klaviyo for email marketing.");
  assert.deepEqual(s.playbook.map((l) => l.title), ["Start email with a welcome series", "Connect the bank first"], "this kind's lessons first, never another kind's");
  assert.equal(s.playbook[0].for, "online stores");
  // with Hindsight: its order wins, lessons only those it found, and a document it names that is no longer counted is dropped
  const r = pickSimilar({ ask, rows, lessons, kits, ranked: ["pat-kind:online_store--tool:list:mailchimp", "pat-all--tool:list:gone", "play-a2"] });
  assert.equal(r.counts[0].pattern, "tool:list:mailchimp");
  assert.ok(!r.counts.some((c) => c.pattern === "tool:list:gone"), "a pattern under the floor now never comes back");
  assert.deepEqual(r.playbook.map((l) => l.title), ["Connect the bank first"]);
  // no kind: every business only; a count's numbers are the live row's, never Hindsight's text
  const none = pickSimilar({ ask: { topic: "starting", kind: null, revenue: "unknown" }, rows, lessons, kits, ranked: null });
  assert.deepEqual(none.counts.map((c) => c.pattern), ["tool:list:klaviyo"]);
  assert.deepEqual(none.playbook.map((l) => l.title), ["Connect the bank first"]);
  for (const c of [...s.counts, ...r.counts]) assert.match(c.statement, new RegExp(`${c.hits} of ${c.orgs}`), "the numbers in the words are the row's");
  assert.match(readFileSync("ee/brain.ts", "utf8"), /c\.recall\(BANK_ID, askWords\(ask\), \{ tags: recallTags\(ask\.kind\), tagsMatch: "any_strict"/, "Hindsight is searched only with words from code (askWords) and the kind's tags");
  // slice 4b (card 234): result patterns, said by code, and an agent's ask covers only its action type
  assert.equal(statementOf(row("kind:creator", "result:klaviyo.campaign_draft:subject_short", 7, 6), kits), "Among creators and media businesses on OPERATOR, 6 of 7 that sent Klaviyo campaign drafts with subjects of 40 characters or fewer usually saw opens of 35% or more.");
  assert.equal(statementOf(row("all", "result:mailchimp.campaign_draft:time_morning", 9, 5), kits), "Among businesses on OPERATOR, 5 of 9 that sent Mailchimp campaign drafts with a morning send usually saw opens of 35% or more.");
  for (const bad of ["result:gmail.create_draft:subject_short", "result:klaviyo.campaign_draft:Jane", "result:klaviyo.campaign_draft"]) assert.equal(statementOf(row("all", bad, 9, 6), kits), null, `${bad} is not said`);
  const act = [...rows, row("kind:online_store", "result:klaviyo.campaign_draft:subject_short", 14, 9), row("kind:online_store", "action:klaviyo.campaign_draft", 14, 14, 80, 100), row("kind:online_store", "result:mailchimp.campaign_draft:subject_short", 10, 6)];
  const forAgent = pickSimilar({ ask: { ...ask, topic: "approvals", action: "klaviyo.campaign_draft" }, rows: act, lessons, kits, ranked: null });
  assert.deepEqual(forAgent.counts.map((c) => c.pattern).sort(), ["action:klaviyo.campaign_draft", "result:klaviyo.campaign_draft:subject_short"], "only the agent's own action type");
  for (const c of forAgent.counts) assert.equal(statementProblem(c.statement), null, c.statement);
  // the reveal asks for many: every counted pattern on the topic, not only the first five
  const lots = [...rows, row("kind:online_store", "dept:email_marketing", 20, 11), row("kind:online_store", "tool:store:shopify", 26, 20), row("kind:online_store", "tool:money:mercury", 26, 9)];
  assert.equal(pickSimilar({ ask: { ...ask, topic: "starting" }, rows: lots, lessons, kits, ranked: null }).counts.length, 5, "Avery's ask: at most five");
  assert.equal(pickSimilar({ ask: { ...ask, topic: "starting", many: true }, rows: lots, lessons, kits, ranked: null }).counts.length, 7, "the reveal: every counted pattern on the topic");
  assert.match(readFileSync("ee/index.ts", "utf8"), /^\s+similarBusinesses,$/m, "the cloud edition fills the similarBusinesses slot");
}

console.log("check:ee ok (credits, plan, trial, grace, comped, Stripe signatures and rows, sign-up codes, shared brain bank, playbook, businesses like yours)");
