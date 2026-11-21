// The shared brain, slice 2 (docs/shared-brain.md, card 231): `npm run check:brain`.
// 1. The snapshot rules (core/brain-rules.ts): only values from lists and counts, whatever goes in.
// 2. brain_patterns() on a real Postgres (PGlite, in memory): the 5-business floor, cohorts, sums,
//    and the table refusing free text.
// 3. Who may read across businesses: only core/db.ts calls the function, only ee/brain.ts calls brainPatterns.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  BRAIN_FLOOR, NO_BRAIN, ageBand, buildSnapshot, overFloor, readBrainSettings, revenueBand, snapshotProblem, toolSlug, toolsOf,
  type Snapshot, type SnapshotInput,
} from "../core/brain-rules";

// ---- 1. snapshot rules
assert.equal(revenueBand(null), "unknown");
assert.equal(revenueBand(0), "none");
assert.equal(revenueBand(9_999.99), "under_10k");
assert.equal(revenueBand(10_000), "10k_50k");
assert.equal(revenueBand(249_999), "50k_250k");
assert.equal(revenueBand(1e7), "over_250k");
assert.equal(revenueBand(Number.NaN), "unknown");
assert.equal(ageBand("2026-11-01T00:00:00Z", "2026-11-21"), "0_30");
assert.equal(ageBand("2026-10-01T00:00:00Z", "2026-11-21"), "30_60");
assert.equal(ageBand("2026-09-01T00:00:00Z", "2026-11-21"), "60_90");
assert.equal(ageBand("2026-01-01T00:00:00Z", "2026-11-21"), "90_plus");

// on by default; only off when the owner said so; a kind not on the list is dropped
assert.deepEqual(readBrainSettings(undefined), NO_BRAIN);
assert.equal(NO_BRAIN.share, true);
assert.deepEqual(readBrainSettings({ share: false, kind: "online_store" }), { share: false, kind: "online_store" });
assert.deepEqual(readBrainSettings({ share: "no", kind: "Acme Coffee Roasters" }), { share: true, kind: null });

assert.equal(toolSlug("Square Online"), "square_online");
// a connected sign-in and a listed tool count; a typed name or an export never does
assert.deepEqual(
  toolsOf({ store: { kind: "uses", tool: "WooCommerce" }, books: { kind: "export", tool: "Joe's Secret Ledger" }, payments: { kind: "uses", tool: "My Bank" } }, new Set(["klaviyo", "mercury"])),
  ["list:klaviyo", "money:mercury", "store:woocommerce"],
);

const PRIVATE = ["Acme", "acme", "jane@acme.com", "https://acme.com", "Ethiopia Guji", "4,812.50", "Joe"];
const input: SnapshotInput = {
  today: "2026-11-21",
  kind: "online_store",
  revenue30: 4812.5,
  orgCreatedAt: "2026-08-01T12:00:00Z",
  plans: { store: { kind: "uses", tool: "Etsy" }, books: { kind: "export", tool: "Joe" } },
  connected: new Set(["shopify", "klaviyo", "jane@acme.com"]),
  departmentIds: ["email_marketing", "acme_wholesale", "finance", "joe_s_special_ops"],
  kitDepartmentIds: ["finance", "email_marketing", "prospecting", "store_analytics", "company"],
  onDuty: 4,
  approvals: [
    { tool: "klaviyo.campaign_draft", status: "approved" },
    { tool: "klaviyo.campaign_draft", status: "approved" },
    { tool: "klaviyo.campaign_draft", status: "edited" },
    { tool: "klaviyo.campaign_draft", status: "rejected" },
    { tool: "klaviyo.campaign_draft", status: "pending" },
    { tool: "send_money_to_acme", status: "approved" },
  ],
  levels: [{ tool: "klaviyo.campaign_draft", level: "act_undo" }, { tool: "gmail.draft", level: "draft" }, { tool: "Acme", level: "act" }],
  actionTypes: ["klaviyo.campaign_draft", "gmail.draft", "mercury.annotate"],
};
const snap = buildSnapshot(input);
assert.deepEqual(snap, {
  taken_on: "2026-11-21",
  kind: "online_store",
  revenue_band: "under_10k",
  age_band: "90_plus",
  tools: ["list:klaviyo", "store:etsy", "store:shopify"],
  departments: ["email_marketing", "finance"],
  bespoke: 2,
  on_duty: 4,
  actions: { "klaviyo.campaign_draft": { decided: 4, unedited: 2, rejected: 1 } },
  levels: ["klaviyo.campaign_draft:act_undo"],
});
assert.equal(snapshotProblem(snap), null);
const text = JSON.stringify(snap);
for (const p of PRIVATE) assert.ok(!text.includes(p), `a snapshot never holds "${p}"`);

// anything off the lists is refused before it is saved
const bad = (patch: Partial<Snapshot> & Record<string, unknown>) => snapshotProblem({ ...snap, ...patch } as Snapshot);
assert.ok(bad({ tools: ["store:Acme Coffee Shop"] }));
assert.ok(bad({ departments: ["Acme wholesale"] }));
assert.ok(bad({ kind: "coffee roaster" as never }));
assert.ok(bad({ revenue_band: "4812.50" as never }));
assert.ok(bad({ name: "Acme" }));
assert.ok(bad({ actions: { "klaviyo.campaign_draft": { decided: 1, unedited: 2, rejected: 0 } } }));
assert.ok(bad({ actions: { "klaviyo.campaign_draft": { decided: 1, unedited: 1, rejected: 0, subject: "Hi Jane" } as never } }));
assert.ok(bad({ levels: ["klaviyo.campaign_draft:god_mode"] }));
assert.ok(bad({ on_duty: 1.5 }));

// the floor in code too
assert.equal(BRAIN_FLOOR, 5);
assert.deepEqual(overFloor([
  { cohort: "all", pattern: "tool:list:klaviyo", orgs: 5, hits: 5, num: null, den: null },
  { cohort: "all", pattern: "tool:store:etsy", orgs: 9, hits: 4, num: null, den: null },
  { cohort: "kind:agency", pattern: "tool:list:klaviyo", orgs: 4, hits: 4, num: null, den: null },
]).map((r) => r.pattern), ["tool:list:klaviyo"]);

// ---- 3. who reads across businesses (no database needed)
const files: string[] = [];
const walk = (dir: string) => {
  for (const f of readdirSync(dir)) {
    if (["node_modules", ".next", ".git"].includes(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|tsx|mjs|js)$/.test(f)) files.push(p);
  }
};
walk(process.cwd());
const rel = (p: string) => p.slice(process.cwd().length + 1);
const callers = files.filter((f) => /\bbrainPatterns\s*\(/.test(readFileSync(f, "utf8"))).map(rel).filter((f) => !["core/db.ts", "scripts/check-brain.ts"].includes(f));
assert.ok(callers.every((f) => f === "ee/brain.ts"), `only ee/brain.ts reads the totals across businesses, not ${callers.join(", ")}`);
const rpcs = files.filter((f) => /["']brain_patterns["']/.test(readFileSync(f, "utf8"))).map(rel).filter((f) => f !== "scripts/check-brain.ts");
assert.deepEqual(rpcs, ["core/db.ts"], "only core/db.ts calls brain_patterns()");

// ---- 2. the function on a real Postgres
const MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261226090000_shared_brain.sql"), "utf8");
assert.match(MIGRATION, new RegExp(`select ${BRAIN_FLOOR} as n`), "the floor in SQL is BRAIN_FLOOR");

async function sql() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table orgs (id uuid primary key default gen_random_uuid());
    create function public.jwt_org_id() returns uuid language sql stable as $$ select null::uuid $$;
  `);
  await pg.exec(MIGRATION);
  const org = async () => (await pg.query<{ id: string }>("insert into orgs default values returning id")).rows[0].id;
  const add = async (s: Partial<Record<string, unknown>>) => {
    const id = await org();
    const row = { taken_on: "2026-11-21", kind: "online_store", revenue_band: "under_10k", age_band: "90_plus", tools: [], departments: [], bespoke: 0, on_duty: 0, actions: {}, levels: [], ...s };
    await pg.query(
      "insert into brain_snapshots (org_id, taken_on, kind, revenue_band, age_band, tools, departments, bespoke, on_duty, actions, levels) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [id, row.taken_on, row.kind, row.revenue_band, row.age_band, row.tools, row.departments, row.bespoke, row.on_duty, JSON.stringify(row.actions), row.levels],
    );
    return id;
  };
  type Row = { cohort: string; pattern: string; orgs: number; hits: number; num: number | null; den: number | null };
  const patterns = async () => (await pg.query<Row>("select * from brain_patterns() order by cohort, pattern")).rows;
  const find = (rows: Row[], cohort: string, pattern: string) => rows.find((r) => r.cohort === cohort && r.pattern === pattern);

  // free text never fits in the table
  for (const s of [{ tools: ["store:Acme Coffee"] }, { departments: ["Acme Wholesale"] }, { kind: "coffee roaster" }, { revenue_band: "4812" }, { levels: ["x:god"] }, { bespoke: 99 }]) {
    await assert.rejects(add(s), `the table refuses ${JSON.stringify(s)}`);
  }

  // 4 businesses with Klaviyo: under the floor, nothing at all comes back
  for (let i = 0; i < 4; i++) await add({ tools: ["list:klaviyo"], actions: { "klaviyo.campaign_draft": { decided: 10, unedited: 9, rejected: 0 } } });
  assert.deepEqual(await patterns(), [], "4 businesses: nothing crosses");

  // the fifth: the pattern appears, with totals only
  const fifth = await add({ tools: ["list:klaviyo"], actions: { "klaviyo.campaign_draft": { decided: 10, unedited: 5, rejected: 2 } }, levels: ["klaviyo.campaign_draft:act_undo"] });
  let rows = await patterns();
  assert.deepEqual(find(rows, "all", "tool:list:klaviyo"), { cohort: "all", pattern: "tool:list:klaviyo", orgs: 5, hits: 5, num: null, den: null });
  assert.deepEqual(find(rows, "all", "action:klaviyo.campaign_draft"), { cohort: "all", pattern: "action:klaviyo.campaign_draft", orgs: 5, hits: 5, num: 41, den: 50 });
  assert.equal(find(rows, "all", "level:klaviyo.campaign_draft"), undefined, "one business promoted: under the floor");
  assert.ok(find(rows, "kind:online_store", "tool:list:klaviyo"));
  assert.ok(find(rows, "kind:online_store|rev:under_10k", "tool:list:klaviyo"));
  assert.ok(rows.every((r) => Object.keys(r).sort().join(",") === "cohort,den,hits,num,orgs,pattern"), "only totals come back");
  assert.ok(!JSON.stringify(rows).includes(fifth), "no business id comes back");

  // an agency with Klaviyo makes 6 in all, but its own cohorts stay under the floor
  await add({ kind: "agency", tools: ["list:klaviyo"] });
  rows = await patterns();
  assert.equal(find(rows, "all", "tool:list:klaviyo")?.hits, 6);
  assert.ok(!rows.some((r) => r.cohort.startsWith("kind:agency")), "a cohort of one never shows");

  // departments count only among businesses 60+ days in
  for (let i = 0; i < 5; i++) await add({ age_band: "0_30", departments: ["email_marketing"] });
  rows = await patterns();
  assert.equal(find(rows, "all", "dept:email_marketing"), undefined, "new businesses don't count for kept departments");
  for (let i = 0; i < 5; i++) await add({ age_band: "60_90", departments: ["email_marketing"] });
  rows = await patterns();
  assert.deepEqual(find(rows, "all", "dept:email_marketing"), { cohort: "all", pattern: "dept:email_marketing", orgs: 11, hits: 5, num: null, den: null });

  // a business that turns sharing off is deleted, and the pattern drops back under the floor
  await pg.query("delete from brain_snapshots where org_id = $1", [fifth]);
  rows = await patterns();
  assert.equal(find(rows, "all", "action:klaviyo.campaign_draft"), undefined, "after one leaves, 4 remain: nothing crosses");

  // only the service role may call it
  const grants = (await pg.query<{ grantee: string }>("select grantee from information_schema.routine_privileges where routine_name = 'brain_patterns'")).rows.map((r) => r.grantee);
  assert.ok(grants.includes("service_role") && !grants.includes("authenticated") && !grants.includes("anon") && !grants.includes("PUBLIC"), `grants: ${grants.join(", ")}`);
  await pg.close();
}

sql().then(() => console.log("check:brain ok"), (e) => { console.error(e); process.exit(1); });
