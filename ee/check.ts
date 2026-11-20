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
import { MIN_BALANCE_USD, PACKS_USD, balanceOf, creditBlock, creditFromSession, creditWords, isPack, mayUsePooledKey, packProblem, packReturn, runCharge, SETUP_FREE_USD, setupFreeLeft, setupRunCharge, usdWords } from "./credit-rules";
import { billingFor } from "../core/cost-rules";

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
assert.ok(isPack(25) && isPack("10") && !isPack(11) && !isPack("10.0") && !isPack(" 1e1") && !isPack(null));
{
  const org = "0e1a7c4e-0002-4000-8000-000000000002";
  const paid = { id: "cs_test_a1B2c3D4e5", mode: "payment", payment_status: "paid", amount_total: 2500, currency: "usd", client_reference_id: org, metadata: { org_id: org, kind: "credits", pack: "25" } };
  assert.deepEqual(creditFromSession(paid), { org, session: "cs_test_a1B2c3D4e5", usd: 25 });
  assert.ok("skip" in creditFromSession({ ...paid, amount_total: 1000 }), "the pack named must be the amount charged");
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

// free setup (card 162, decided 2026-11-20): setup messages are free up to SETUP_FREE_USD while in setup; after setup, credits
assert.equal(SETUP_FREE_USD, 2);
assert.equal(setupFreeLeft({ inSetup: true, setupSpentUsd: 0 }), 2);
assert.equal(setupFreeLeft({ inSetup: true, setupSpentUsd: 0.75 }), 1.25);
assert.equal(setupFreeLeft({ inSetup: true, setupSpentUsd: 5 }), 0, "never below zero");
assert.equal(setupFreeLeft({ inSetup: false, setupSpentUsd: 0 }), 0, "nothing free once setup is done");
assert.equal(setupFreeLeft({ inSetup: true, setupSpentUsd: Number.NaN }), 0, "a spend that can't be read leaves nothing free");
assert.equal(setupFreeLeft({ inSetup: true, setupSpentUsd: -3 }), 2, "a negative spend never adds to the allowance");
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
assert.deepEqual(packReturn("start"), { place: "start", success: "/start?claude=hosted&credits=added#step-1", cancel: "/start?claude=hosted#step-1" });
assert.equal(packReturn("connections").success, "/connections?credits=added#claude");
assert.equal(packReturn("settings").success, "/settings?credits=added#billing");
for (const bad of [null, undefined, "", "https://evil.example", "//evil.example", "/start", "START", ["start"]]) assert.equal(packReturn(bad).place, "settings", `${String(bad)} comes back to Settings`);
for (const p of ["start", "connections", "settings"] as const) {
  const r = packReturn(p);
  for (const u of [r.success, r.cancel, packProblem(p, "x")]) assert.match(u, /^\/(start|connections|settings)[?#]/, "a path on this app, never another host");
}
assert.equal(packProblem("start", "a&b#c"), "/start?claude=hosted&credits_problem=a%26b%23c#step-1", "the problem is encoded");
assert.ok(packProblem("connections", "x".repeat(500)).length < 260, "the problem is cut");
assert.match(readFileSync("ee/billing-actions.ts", "utf8"), /packReturn\(form\.get\("back"\)\)/, "buyCredits reads the return place through the allowlist");
assert.match(readFileSync("ee/index.ts", "utf8"), /^\s+HostedClaude,$/m, "the cloud edition fills the HostedClaude slot");

console.log("check:ee ok (credits, plan, trial, grace, comped, Stripe signatures and rows, sign-up codes)");
