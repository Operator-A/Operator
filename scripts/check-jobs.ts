// The job queue's rules (core/job-rules.ts, docs/tenancy.md slice 3). Run: npm run check:jobs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { migration } from "./lib/schema";
import { join } from "node:path";
import { JOB_KINDS, MISSED_MS, STALE_MS, chainDedupe, chainPayload, fetchFailure, isUuid, kickHeaders, outcomeText, readChainPayload } from "../core/job-rules";

const C = "0e1a7c4e-0001-4000-8000-0000000000aa", R = "0e1a7c4e-0001-4000-8000-0000000000bb";

// a payload round-trips, and only the chain's own fields survive
assert.deepEqual(readChainPayload(chainPayload({ chainId: C, key: "morning", step: 1, parent: R, manual: true })), { chainId: C, key: "morning", step: 1, parent: R, manual: true });
assert.deepEqual(readChainPayload({ chainId: C, key: "morning", step: 0, agent: "cfo", to: "x@example.com" }), { chainId: C, key: "morning", step: 0 });
assert.deepEqual(chainPayload({ chainId: C, key: "k", step: 0, manual: false }), { chainId: C, key: "k", step: 0 });
// malformed payloads are refused
for (const bad of [null, [], "x", { chainId: "nope", key: "k", step: 0 }, { chainId: C, key: "K Y", step: 0 }, { chainId: C, key: "k", step: 10 },
  { chainId: C, key: "k", step: 1.5 }, { chainId: C, key: "k", step: "1" }, { chainId: C, key: "k", step: 0, parent: "x" }, { chainId: C, key: "k", step: 0, manual: "1" }])
  assert.equal(readChainPayload(bad), null, JSON.stringify(bad));
// one job per step of a chain
assert.equal(chainDedupe({ chainId: C, step: 2 }), `chain:${C}:2`);
assert.ok(chainDedupe({ chainId: C, step: 2 }).length <= 200);
assert.ok(isUuid(C) && !isUuid("x") && !isUuid(undefined));
assert.equal(outcomeText("x".repeat(2000)).length, 1000);
// a claimed job is only called stale after a worker's limit (300 s) has surely passed
const worker = readFileSync(join(process.cwd(), "app/api/jobs/[id]/route.ts"), "utf8");
const limit = Number(/maxDuration = (\d+)/.exec(worker)?.[1]);
assert.ok(limit > 0 && STALE_MS > limit * 1000, "STALE_MS is longer than the worker's maxDuration");

// a kick always carries the bearer, and Vercel's protection bypass only when the project has one
assert.deepEqual(kickHeaders("cron-secret-123"), { authorization: "Bearer cron-secret-123" });
assert.deepEqual(kickHeaders("cron-secret-123", "bypass-456"), { authorization: "Bearer cron-secret-123", "x-vercel-protection-bypass": "bypass-456" });
assert.deepEqual(kickHeaders("cron-secret-123", ""), { authorization: "Bearer cron-secret-123" });
const jobsTs = readFileSync(join(process.cwd(), "core/jobs.ts"), "utf8");
assert.match(jobsTs, /headers: kickHeaders\(env\.cronSecret, env\.vercelBypass\)/, "kick sends kickHeaders");
assert.match(jobsTs, /redirect: "error"/, "a kick carries a secret, so it never follows a redirect");
assert.match(jobsTs, /scrubSecrets\(fetchFailure\(e\), \[env\.cronSecret, env\.vercelBypass\]\)/, "a failed kick's log is scrubbed of both secrets");
// a failed kick says why: undici hides the reason in the cause
const undici = Object.assign(new TypeError("fetch failed"), { cause: new Error("unexpected redirect") });
assert.equal(fetchFailure(undici), "fetch failed: unexpected redirect");
assert.equal(fetchFailure(new Error("The operation was aborted due to timeout")), "The operation was aborted due to timeout");
assert.equal(fetchFailure("x"), "x");
// a waiting job hours late is skipped, not run at the wrong time of day; a scheduler round late is still run
assert.ok(MISSED_MS >= 60 * 60_000 && MISSED_MS <= 6 * 60 * 60_000, "MISSED_MS is between 1 and 6 hours");
assert.ok(MISSED_MS > 2 * 15 * 60_000, "longer than a late scheduler round");
const dispatch = readFileSync(join(process.cwd(), "app/api/dispatch/route.ts"), "utf8");
assert.ok(dispatch.indexOf("failMissed(now)") > 0 && dispatch.indexOf("failMissed(now)") < dispatch.indexOf("dueJobs(now)"), "missed jobs are failed before due jobs are kicked");

// the table allows exactly the kinds the code knows, and holds each job to its org
const sql = migration("20261205090000_jobs.sql"); // check:baseline checks the kinds in the public repo
if (sql) {
  const kinds = /kind text not null check \(kind in \(([^)]*)\)\)/.exec(sql)?.[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(kinds, [...JOB_KINDS]);
  assert.match(sql, /unique \(org_id, dedupe_key\)/);
  assert.match(sql, /create policy org_rows on jobs/);
}

// chain steps reach agents only as jobs: the agent route refuses trigger=chain, and nothing calls it for a step
const agentRoute = readFileSync(join(process.cwd(), "app/api/agents/[agent]/route.ts"), "utf8");
assert.match(agentRoute, /asked === "chain"\) return NextResponse\.json\(\{ error/);
assert.doesNotMatch(readFileSync(join(process.cwd(), "core/chain.ts"), "utf8"), /\/api\/agents/);

console.log(`check:jobs ok (${JOB_KINDS.length} kind)`);
