# The shared brain

Every business on OPERATOR teaches Avery and the crew what works, so the next interview, company design
and action are better for every business. Only patterns that at least **5 businesses** share ever cross
between businesses, and the numbers in them are counted in code. Cloud edition only.

Design (approved by the owner 2026-11-21, with all five recommendations): proposal
https://claude.ai/artifact/5MmRitAoTsA2foNB9g6Bhq. Build Board: epic 230, slices 231 to 235.

| Slice | Card | What |
| --- | --- | --- |
| 2 | 231 | The business snapshot, the Settings switch, the counting function with the floor (this file, below) |
| 3 | 232 | `ee/brain.ts` on Hindsight Cloud: a weekly job puts each pattern in the bank as its own document |
| 4 | 233 | Avery's "Businesses like yours" in the interview and chat; the kind of business set in the interview |
| 4b | 234 | Agents learn from other businesses' results while they work (each approved action's shape and result) |
| 5 | 235 | The OPERATOR playbook: lessons written or reviewed by OPERATOR staff, for day one |

## What crosses, and what never does

| Crosses (counted) | Never crosses |
| --- | --- |
| Kind of business, from a fixed list (`BUSINESS_KINDS`) | The business's name, the founder's name, any email, address or website |
| Revenue band (last 30 days) and time on OPERATOR, as bands | Any amount, price or product name |
| Tools by part, names from the lists in code only | A tool name the founder typed, or an export |
| Starting kits by department id, plus a count of designed departments | A designed department's name or purpose |
| Approvals per action type (decided, unedited, rejected) and promoted action types | Chat, facts, rules, drafts, reports, customers, leads |

A pattern reaches anything outside the business only when **at least 5 businesses that allow it share
it**. Below that, nothing comes back, so one unusual business can't be picked out.

## Slice 2: snapshot, switch, counting (card 231)

Nothing leaves a business in this slice. It builds what each business would add and the counting that
keeps any one business from being picked out. Slice 3 is the first to send totals anywhere.

### The snapshot

`buildSnapshot` (`core/brain-rules.ts`, pure) turns the business's own rows into one snapshot:

- `kind`: the owner's pick on Settings > Shared brain (slice 4: Avery sets it in the interview, from the same list).
- `revenue_band`: the sum of the last 30 days of `kpi_snapshots.revenue`, as a band; `unknown` with no daily numbers.
- `age_band`: days since the org was made: 0 to 30, 30 to 60, 60 to 90, 90+.
- `tools`: `part:tool` for each sign-in connected on Connections and each listed tool the founder said they use in setup (a setup plan of kind `uses`). Names come only from the parts' lists in `core/tools-step-rules.ts`.
- `departments`: the department ids of starting kits (`core/templates.ts`); every other department adds 1 to `bespoke`.
- `on_duty`: agents with `enabled`.
- `actions`: for each gateway action type in code (`TOOLS` in `core/gateway/policy.ts`), approvals decided in the last 30 days: decided, unedited (`approved`), rejected.
- `levels`: `type:level` for action types above Draft (`trust_levels`).

`snapshotProblem` checks every field against its list before anything is saved; a snapshot that fails is
never written. `brain_snapshots` checks every column again in the database (lists, patterns, ranges,
lengths), so free text can't be stored whatever the code does.

`takeSnapshot` (`core/brain.ts`) runs from the scheduler (`/api/dispatch`) on the cloud edition only, at
most once a day per business, and keeps one row per business (the latest). It never stops the scheduler.

### The switch

Settings > Shared brain (the cloud edition's Settings cards, `ee/brain-card.tsx`): "Add my business's
counts", **on by default** (decided 2026-11-21), and the kind of business. Owners only (`asRole`). Turning
it off deletes the business's snapshot at once, so it is in no count from then on. The card shows exactly
what the business adds. It is saved in `policies` under `brain` (`{ share, kind }`).

The one-line notice in setup ships with slice 3, before any total leaves OPERATOR's own database.

### The counting

`brain_patterns()` (migration `20261226090000_shared_brain.sql`) is the one read across businesses beyond
their ids. It returns rows of `cohort, pattern, orgs, hits, num, den`, where:

- `cohort` is `all`, `kind:<kind>` or `kind:<kind>|rev:<band>`;
- `pattern` is `dept:<id>` (counted among businesses 60+ days in), `tool:<part>:<tool>`,
  `action:<type>` (`num` unedited and `den` decided, summed) or `level:<type>` (promoted, among
  businesses that used the action type);
- `orgs` is how many businesses the pattern is counted over, `hits` how many have it.

A row comes back only when both `orgs` and `hits` are at least 5. The floor is written in the SQL, not
passed in, so no caller can lower it, and `overFloor` drops anything under it again in code. Only the
service role may execute the function (`db()` refuses `rpc` anyway). `brainPatterns()` in `core/db.ts`
is the only caller, and only `ee/brain.ts` (slice 3) may call that (`check:brain`).

### Tests (`npm run check:brain`)

- The snapshot rules: bands, the default switch, tools only from lists, a snapshot built from inputs full
  of private strings holds none of them, and `snapshotProblem` refuses anything off a list.
- The function on a real Postgres (PGlite, in memory): the table refuses free text; 4 businesses return
  nothing; the fifth makes the pattern appear with totals only (no business id); a cohort of one never
  shows; departments count only 60+ days in; when a business leaves, its pattern drops back under the
  floor; only the service role may call it.
- Who reads across businesses: only `core/db.ts` calls `brain_patterns`, and only `ee/brain.ts` calls `brainPatterns`.

### Rolling it out

Apply the migration, then merge. Before the migration, `takeSnapshot` fails softly (logged, the scheduler
goes on) and the Settings card shows nothing saved.

### Not in this slice

Hindsight and the weekly job (slice 3), anything Avery or an agent sees (slices 4 and 4b), the setup notice
(slice 3), goal measures' direction (later, with 4b's results loop).
