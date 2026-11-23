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
  BRAIN_FLOOR, BRAIN_TOPICS, NO_BRAIN, NOTE_LINES, ageBand, isTopic, patternOnTopic, similarNote, topicWords, buildSnapshot, overFloor, readBrainSettings, revenueBand, snapshotProblem, toolSlug, toolsOf,
  type Snapshot, type SnapshotInput,
} from "../core/brain-rules";
import * as B from "../core/brain-rules";
import * as R from "../core/result-rules";

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
  campaigns: [],
  // card 285: checked tools and gap topic tags; anything that isn't tool:topic is dropped
  setup: { checked: ["analytics", "klaviyo", "Acme Coffee"], gaps: ["analytics:ga4.data_retention", "klaviyo:klaviyo.welcome_flow", "analytics:Acme Coffee Roasters", "analytics:ga4.data_retention"] },
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
  results: {},
  setup_checked: ["analytics", "klaviyo"],
  setup_gaps: ["analytics:ga4.data_retention", "klaviyo:klaviyo.welcome_flow"],
});
assert.equal(snapshotProblem(snap), null);
assert.ok(snapshotProblem({ ...snap, setup_gaps: ["analytics:Jane Doe"] }), "a setup gap is a tag, never words");
assert.ok(snapshotProblem({ ...snap, setup_checked: ["Acme"] }));
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
const RESULTS_MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261228090000_campaign_results.sql"), "utf8");
const PLAYBOOK_MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20261227090000_ee_playbook.sql"), "utf8");
const GAPS_MIGRATION = readFileSync(join(process.cwd(), "supabase/migrations/20270102090000_setup_howtos.sql"), "utf8");
assert.match(GAPS_MIGRATION, new RegExp(`select ${BRAIN_FLOOR} as n`), "the floor stays BRAIN_FLOOR in card 285's function");
assert.match(RESULTS_MIGRATION, new RegExp(`select ${BRAIN_FLOOR} as n`), "the floor stays BRAIN_FLOOR in slice 4b's function");
assert.match(MIGRATION, new RegExp(`select ${BRAIN_FLOOR} as n`), "the floor in SQL is BRAIN_FLOOR");

async function sql() {
  const pg = new PGlite();
  await pg.exec(`
    create role anon; create role authenticated; create role service_role;
    create table orgs (id uuid primary key default gen_random_uuid());
    create function public.jwt_org_id() returns uuid language sql stable as $$ select null::uuid $$;
    create table approvals (id uuid primary key default gen_random_uuid());
  `);
  await pg.exec(MIGRATION);
  await pg.exec(RESULTS_MIGRATION);
  await pg.exec(PLAYBOOK_MIGRATION);
  await pg.exec(GAPS_MIGRATION);
  const org = async () => (await pg.query<{ id: string }>("insert into orgs default values returning id")).rows[0].id;
  const add = async (s: Partial<Record<string, unknown>>) => {
    const id = await org();
    const row = { taken_on: "2026-11-21", kind: "online_store", revenue_band: "under_10k", age_band: "90_plus", tools: [], departments: [], bespoke: 0, on_duty: 0, actions: {}, levels: [], results: {}, setup_checked: [], setup_gaps: [], ...s };
    await pg.query(
      "insert into brain_snapshots (org_id, taken_on, kind, revenue_band, age_band, tools, departments, bespoke, on_duty, actions, levels, results, setup_checked, setup_gaps) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
      [id, row.taken_on, row.kind, row.revenue_band, row.age_band, row.tools, row.departments, row.bespoke, row.on_duty, JSON.stringify(row.actions), row.levels, JSON.stringify(row.results), row.setup_checked, row.setup_gaps],
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

  // slice 4b: result patterns count businesses, good ones as hits, with the same floor
  for (const r of [{ subject: "Hi Jane" }, { "klaviyo.campaign_draft": { subject_short: "Jane Doe" } }]) await assert.rejects(add({ results: r }), `results refuse ${JSON.stringify(r)}`);
  for (let i = 0; i < 4; i++) await add({ kind: "creator", results: { "klaviyo.campaign_draft": { subject_short: i < 3 ? "good" : "low" } } });
  rows = await patterns();
  assert.equal(find(rows, "kind:creator", "result:klaviyo.campaign_draft:subject_short"), undefined, "4 businesses: no result pattern");
  for (let i = 0; i < 3; i++) await add({ kind: "creator", results: { "klaviyo.campaign_draft": { subject_short: "good", preview_none: "low" } } });
  rows = await patterns();
  assert.deepEqual(find(rows, "kind:creator", "result:klaviyo.campaign_draft:subject_short"), { cohort: "kind:creator", pattern: "result:klaviyo.campaign_draft:subject_short", orgs: 7, hits: 6, num: null, den: null });
  assert.equal(find(rows, "kind:creator", "result:klaviyo.campaign_draft:preview_none"), undefined, "3 businesses with that shape: under the floor");
  // card 285: setup gaps count businesses that checked that tool, by topic tag only, with the same floor
  for (const g of [["analytics:Jane Doe"], ["analytics:ga4 data retention"], ["x".repeat(13) + ":ga4.y"]]) await assert.rejects(add({ setup_gaps: g }), `setup_gaps refuse ${g}`);
  await assert.rejects(add({ setup_checked: ["Acme Coffee"] }));
  for (let i = 0; i < 4; i++) await add({ kind: "services", setup_checked: ["analytics"], setup_gaps: ["analytics:ga4.data_retention"] });
  rows = await patterns();
  assert.equal(find(rows, "kind:services", "gap:analytics:ga4.data_retention"), undefined, "4 businesses: no gap pattern");
  await add({ kind: "services", setup_checked: ["analytics", "klaviyo"], setup_gaps: ["analytics:ga4.data_retention", "klaviyo:klaviyo.welcome_flow"] });
  await add({ kind: "services", setup_checked: ["analytics"] });
  rows = await patterns();
  assert.deepEqual(find(rows, "kind:services", "gap:analytics:ga4.data_retention"), { cohort: "kind:services", pattern: "gap:analytics:ga4.data_retention", orgs: 6, hits: 5, num: null, den: null }, "counted among businesses that checked Analytics");
  assert.equal(find(rows, "kind:services", "gap:klaviyo:klaviyo.welcome_flow"), undefined, "one business with that gap: under the floor");
  // the playbook's how-to fields come all together or not at all
  const admin = await org();
  const lesson = (o: Record<string, unknown>) => pg.query("insert into ee_playbook_lessons (org_id, title, body, written_by, setup_tile, setup_topic, steps, help_url) values ($1, 'Keep data longer', 'Analytics keeps two months unless you change it.', 'staff@operator', $2, $3, $4, $5)", [admin, o.tile ?? null, o.topic ?? null, o.steps ?? [], o.url ?? null]);
  await lesson({ tile: "analytics", topic: "ga4.data_retention", steps: ["Open Admin"], url: "https://support.google.com/analytics/answer/7667196" });
  await lesson({});
  for (const o of [{ tile: "analytics", topic: "ga4.data_retention", steps: [], url: "https://support.google.com/x" }, { tile: "analytics" }, { tile: "stripe", topic: "a.b", steps: ["x"], url: "https://x.com" }, { tile: "analytics", topic: "Data Retention", steps: ["x"], url: "https://support.google.com/x" }])
    await assert.rejects(lesson(o), `a how-to refuses ${JSON.stringify(o)}`);

  // campaign_results holds bands and an id, never words
  const org1 = await org();
  const cr = (o: Record<string, unknown>) => pg.query("insert into campaign_results (org_id, action_id, action_type, external_id, subject_band, has_preview, body_band, status, open_band, checked_at) values ($1, gen_random_uuid(), $2, $3, $4, true, 'short', $5, $6, $7)",
    [org1, o.type ?? "klaviyo.campaign_draft", o.ext ?? "01HXYZ", o.subject ?? "short", o.status ?? "waiting", o.open ?? null, o.checked ?? null]);
  await cr({});
  await cr({ status: "checked", open: "35_50", checked: "2026-11-22T00:00:00Z" });
  for (const o of [{ type: "gmail.create_draft" }, { ext: "New roast is here!" }, { subject: "Hi Jane, new roast" }, { status: "checked" }, { open: "48.2" }]) await assert.rejects(cr(o), `campaign_results refuses ${JSON.stringify(o)}`);

  // only the service role may call it
  const grants = (await pg.query<{ grantee: string }>("select grantee from information_schema.routine_privileges where routine_name = 'brain_patterns'")).rows.map((r) => r.grantee);
  assert.ok(grants.includes("service_role") && !grants.includes("authenticated") && !grants.includes("anon") && !grants.includes("PUBLIC"), `grants: ${grants.join(", ")}`);
  await pg.close();
}

// ---- 4. slice 4 (card 233): Avery asks with a topic from a list, and code writes the note
assert.ok(BRAIN_TOPICS.includes("starting") && BRAIN_TOPICS.includes("approvals") && BRAIN_TOPICS.includes("list"));
assert.ok(isTopic("books") && !isTopic("my secret plans") && !isTopic(""));
for (const t of BRAIN_TOPICS) assert.match(topicWords(t), /^[A-Za-z0-9 ,.:()'&-]+$/, `${t}: words from lists only`);
assert.match(topicWords("list"), /^Email marketing: .*Klaviyo/);
assert.ok(patternOnTopic("tool:list:klaviyo", "list") && !patternOnTopic("tool:books:xero", "list"));
assert.ok(patternOnTopic("dept:finance", "starting") && patternOnTopic("tool:store:shopify", "starting") && !patternOnTopic("action:x", "starting"));
assert.ok(patternOnTopic("action:gmail.create_draft", "approvals") && patternOnTopic("level:calendar.hold", "approvals") && !patternOnTopic("dept:finance", "approvals"));
assert.equal(similarNote(null), null);
assert.equal(similarNote({ counts: [], playbook: [] }), null, "nothing came back: no note");
const many = { counts: Array.from({ length: 5 }, (_, i) => ({ statement: `Count ${i}.`, cohort: "all", pattern: `dept:x${i}`, orgs: 9, hits: 6 })), playbook: [{ title: "Lesson", lesson: "Body", for: "every business" }] };
assert.equal(similarNote(many), "Businesses like yours: Count 0. Count 1. Count 2.", `at most ${NOTE_LINES} lines`);
assert.equal(similarNote({ counts: [], playbook: [{ title: "Connect the bank first", lesson: "x", for: "every business" }] }), "Businesses like yours: OPERATOR's playbook: Connect the bank first.");
// the tools: offered only on the cloud edition, a topic is the only input, and the note is code's
{
  const t = readFileSync("core/brain-tools.ts", "utf8");
  assert.match(t, /if \(edition\(\) !== "cloud"\) return null;[\s\S]*if \(edition\(\) !== "cloud"\) return null;/, "both tools are cloud only");
  assert.match(t, /params: \[\{\s*name: "topic", type: "enum", options: \[\.\.\.BRAIN_TOPICS\]/, "the only input is a topic from the list");
  assert.match(t, /if \(s\.kind\) return `kept the kind already picked/, "the owner's pick wins");
  for (const f of ["core/setup.ts", "core/avery-chat.ts"]) {
    const src = readFileSync(f, "utf8");
    assert.match(src, /similarTool\(heldSimilar\)/, `${f} offers Businesses like yours`);
    assert.match(src, /similarNote\(heldSimilar\.got\.at\(-1\) \?\? null\)/, `${f}: the note is code's`);
  }
}

// ---- 5. slice 4b (card 234): campaign results as bands, and what an agent is shown
{
  assert.deepEqual(R.shapeOf({ subject: "New roast", preview: "", body: "x".repeat(700) }), { subject_band: "short", has_preview: false, body_band: "medium" });
  assert.equal(R.subjectBand("x".repeat(61)), "long");
  assert.deepEqual(R.resultBands({ delivered: 200, opens: 90, clicks: 4, unsubscribes: 1 }), { open_band: "35_50", click_band: "1_3", unsub_band: "0_3_plus" });
  assert.equal(R.resultBands({ delivered: 0, opens: 0, clicks: 0, unsubscribes: 0 }), null, "nothing delivered: no bands");
  assert.equal(R.resultBands({ delivered: 100, opens: 19.9, clicks: 0, unsubscribes: 0 })?.open_band, "under_20");
  // Klaviyo's time as written; an ISO time in the business's time zone
  assert.deepEqual(({ ...R.sentParts("November 15, 2025, 17:08", "America/Chicago"), at: undefined }), { at: undefined, day: "weekend", time: "evening" });
  assert.deepEqual(({ ...R.sentParts("2026-11-02T15:00:00+00:00", "America/Chicago"), at: undefined }), { at: undefined, day: "weekday", time: "morning" });
  assert.equal(R.sentParts("soon", "UTC"), null);
  const d = (n: number) => new Date(Date.UTC(2026, 10, 1) + n * 864e5);
  assert.equal(R.nextStep({ createdAt: d(0), sentAt: null, now: d(3), found: false }), "wait");
  assert.equal(R.nextStep({ createdAt: d(0), sentAt: null, now: d(14), found: false }), "not_sent");
  assert.equal(R.nextStep({ createdAt: d(0), sentAt: d(2), now: d(5), found: true }), "sent");
  assert.equal(R.nextStep({ createdAt: d(0), sentAt: d(2), now: d(9), found: true }), "check");
  const row = (open: string | null, status: "checked" | "sent" = "checked", subject = "short") => ({ action_type: "klaviyo.campaign_draft", status, subject_band: subject, has_preview: true, body_band: "short", day_band: "weekday", time_band: "morning", open_band: open });
  const res = R.snapshotResults([row("50_plus"), row("35_50"), row("20_35"), row("under_20", "checked", "long"), row(null, "sent", "long"), { ...row("50_plus"), action_type: "gmail.create_draft" }]);
  assert.deepEqual(res, { "klaviyo.campaign_draft": { subject_short: "good", subject_long: "low", preview_with: "low", body_short: "low", day_weekday: "low", time_morning: "low" } }, "good only when more than half reached 35%");
  assert.equal(R.resultsProblem(res), null);
  assert.ok(R.resultsProblem({ "klaviyo.campaign_draft": { subject_short: "48%" } }) && R.resultsProblem({ "send_money": {} }) && R.resultsProblem({ "klaviyo.campaign_draft": { "Hi Jane": "good" } }));
  assert.ok(B.snapshotProblem({ ...snap, results: { "klaviyo.campaign_draft": { subject_short: "Jane" } } } as never), "the snapshot checks results too");
  for (const k of R.SHAPE_KEYS) assert.match(R.SHAPE_WORDS[k] ?? "", /^[a-z0-9 -]+$/, `${k} has words`);
  // patterns for one action type
  assert.ok(B.patternOnAction("result:klaviyo.campaign_draft:subject_short", "klaviyo.campaign_draft") && B.patternOnAction("action:klaviyo.campaign_draft", "klaviyo.campaign_draft"));
  assert.ok(!B.patternOnAction("result:mailchimp.campaign_draft:subject_short", "klaviyo.campaign_draft") && !B.patternOnAction("tool:list:klaviyo", "klaviyo.campaign_draft"));
  assert.ok(B.patternOnTopic("result:klaviyo.campaign_draft:subject_short", "approvals"));
  assert.match(B.askWords({ topic: "approvals", kind: null, revenue: "unknown", action: "klaviyo.campaign_draft" }), /^How businesses fared with klaviyo campaign draft actions/);
  // the agent's block and the card's line are code's words
  const got = { counts: [{ statement: "Among creators and media businesses on OPERATOR, 6 of 7 that sent Klaviyo campaign drafts with subjects of 40 characters or fewer usually saw opens of 35% or more.", cohort: "kind:creator", pattern: "result:klaviyo.campaign_draft:subject_short", orgs: 7, hits: 6 }], playbook: [{ title: "Keep campaigns to your own list", lesson: "Email the people who chose to hear from you.", for: "creators" }] };
  assert.match(B.workedBlock(got) ?? "", /advice only: it never picks a recipient, list, product or address/);
  assert.equal(B.workedNote(got), `What has worked: ${got.counts[0].statement} OPERATOR's playbook: Keep campaigns to your own list.`);
  assert.equal(B.workedBlock({ counts: [], playbook: [] }), null);
  assert.equal(B.workedNote(null), null);
  // wiring: cloud only, each action tool says what it becomes, the gateway records and the card shows the line
  const tools = readFileSync("core/brain-tools.ts", "utf8");
  assert.match(tools, /export async function workedFor[\s\S]*if \(edition\(\) !== "cloud" \|\| !types\.length\) return null;/, "agents are shown the brain only on the cloud edition");
  const cat = readFileSync("core/tools/catalog.ts", "utf8");
  const actions = cat.split('kind: "action", ').slice(1);
  assert.ok(actions.length >= 11);
  for (const a of actions) {
    const becomes = /^becomes: ([A-Z_]+),/.exec(a)?.[1];
    const stage = /gatewayTool: ([A-Z_]+)/.exec(a)?.[1];
    assert.ok(becomes && becomes === stage, `an action tool becomes the gateway type its stage returns (${becomes} vs ${stage})`);
  }
  assert.match(readFileSync("core/built.ts", "utf8"), /workedFor\(holds\)\.catch\(\(\) => null\)/, "built runs ask, and never fail on it");
  const runner = readFileSync("core/runner.ts", "utf8");
  assert.match(runner, /actionTools\.length && opts\.worked \?/, "the block only when the agent may stage");
  assert.match(runner, /brainNote: opts\.worked\?\.note \?\? null/, "each staged card carries code's note");
  const gw = readFileSync("core/gateway/index.ts", "utf8");
  assert.equal((gw.match(/await recordCampaign\(a\.id, (CAMPAIGN_DRAFT|MAILCHIMP_DRAFT), out\.campaignId/g) ?? []).length, 2, "both campaign drafts are recorded on apply");
  assert.match(readFileSync("dashboard/components/approvalBits.tsx", "utf8"), /i\.brain_note && /); // the card both approvals views draw
}

// ---- 6. the company reveal: one "why" line per department, a kit's own count first, each line once
{
  assert.equal(B.patternToolName("tool:list:klaviyo"), "Klaviyo");
  assert.equal(B.patternToolName("tool:list:acme"), null);
  assert.equal(B.patternToolName("dept:finance"), null);
  const c = (pattern: string, statement: string) => ({ statement, cohort: "kind:online_store", pattern, orgs: 20, hits: 12 });
  const counts = [c("tool:list:klaviyo", "K."), c("dept:finance", "F."), c("tool:store:shopify", "S."), c("dept:email_marketing", "E.")];
  const why = B.whyFor([
    { id: "finance", words: ["Mercury transactions"] },
    { id: "email_marketing", words: ["Klaviyo lists"] },
    { id: "store_care", words: ["Shopify orders", "Klaviyo campaign results"] },
    { id: "wholesale", words: ["Klaviyo lists"] },
    { id: "ops", words: ["Shopifyish things"] },
  ], counts);
  assert.deepEqual(why, { finance: "F.", email_marketing: "E.", store_care: "K." }, "a kit's own count first, then a tool by its whole name, each line once");
  assert.deepEqual(B.whyFor([], counts), {});
  const tools = readFileSync("core/brain-tools.ts", "utf8");
  assert.match(tools, /export async function revealWhy[\s\S]*if \(edition\(\) !== "cloud" \|\| !depts\.length\) return \{\};/, "the reveal line is cloud only");
  assert.match(readFileSync("app/start/page.tsx", "utf8"), /revealWhy\(chart\.depts\)\.catch\(\(\) => \(\{\}\)\)/, "the page never fails on it");
  assert.match(readFileSync("dashboard/components/setup.tsx", "utf8"), /\{why\[d\.id\] && /);
}

sql().then(() => console.log("check:brain ok"), (e) => { console.error(e); process.exit(1); });
