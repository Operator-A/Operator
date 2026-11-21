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

## Slice 3: the Hindsight bank (card 232)

The counted patterns go into one Hindsight bank so agents can find the right ones by meaning (slice 4).
Still nothing private: only rows `brain_patterns()` returned, all over the floor.

### What it does

- **`ee/brain.ts`** is the only file that talks to Hindsight (`@vectorize-io/hindsight-client`), on the
  cloud edition only, with `HINDSIGHT_API_URL` and `HINDSIGHT_API_KEY` (Vercel settings). Without both,
  nothing runs and nothing fails.
- **One bank, `operator-patterns`**, set from code each sync: retain mode `verbatim` (each statement kept
  word for word, so no model rewrites a number), observations off, a mission and one directive (never
  name a business, never state a number that isn't in a memory).
- **The weekly sync** (`syncBrain`): reads `brainPatterns()`, turns each row into one plain statement in
  code (`ee/brain-rules.ts`), and retains it as its own document, id `cohort|pattern`, so a re-retain
  replaces it. Documents in the bank that are no longer in the count (fell under the floor, or the
  businesses left) are deleted for good. Every statement is checked before it is sent: only words from
  the lists in code and numbers from the count.
- **When**: a new slot, `afterSchedule(now)`, told once per scheduler round after every business's turn.
  The cloud edition syncs when the last sync is 7 days old, recorded in the admin business's `policies`
  under `brain_sync` (`OPERATOR_ADMIN_ORG_ID`); with no admin business set, it doesn't sync. It never
  stops the scheduler.
- **Setup says so once**: under the company chart, one line on the cloud edition that the business adds
  counts, never names or amounts, and where to turn it off.

### A statement

`Among online stores under $10k a month on OPERATOR, 18 of 26 use Klaviyo for email marketing.` Words
come from `KIND_WORDS`, the revenue bands, the parts' lists and the kits' names; numbers from `orgs`,
`hits`, `num` and `den`. Avery and agents never quote a figure from Hindsight's text: slice 4 re-counts
each cited document's key in code.

### Tests (`npm run check:ee`)

Statements and document ids for each kind of pattern; a row under the floor never becomes a statement;
statements hold only list words and the counted numbers; the sync with a fake bank retains every pattern
over the floor, deletes the documents no longer counted, sets the bank first, and does nothing without
both settings; the weekly gate.

## Slice 5: the OPERATOR playbook (card 235)

Lessons written by OPERATOR staff, so Avery and agents have useful advice on day one, before 5 businesses
share any pattern. Avery reads them in slice 4, together with the counts.

### What it does

- **Where lessons live**: `ee_playbook_lessons` (migration `20261227090000_ee_playbook.sql`), rows of the
  admin business (`OPERATOR_ADMIN_ORG_ID`), read and written only as that business (`ee/playbook.ts`). No
  other business reads them from the database.
- **Who writes them**: owners of the admin business, on Settings > Playbook (`ee/playbook-card.tsx`; the card
  shows nowhere else). A lesson has a title, a few sentences and who it is for (every business, or one kind
  from `BUSINESS_KINDS`). It starts as a draft. Every change is audited.
- **What a lesson may say** (`lessonProblem`, `ee/playbook-rules.ts`): advice in words, small numbers in advice
  ("under 1,000 subscribers"). Never a percentage, a count like "18 of 26", an address or a link, because
  figures founders see come from counts done in code. The table checks lengths and the kind list again.
- **Into the bank**: publishing, changing, taking back or deleting a lesson pushes the published playbook to
  the bank at once (`pushPlaybook`). Each published lesson is its own document, id `play-<lesson id>`, tags
  `source:playbook` and `kind:<kind>` or `kind:all`, written "OPERATOR's playbook, for online stores: …", so it
  is never mixed up with a count. Playbook documents no longer published are deleted. The weekly sync does the
  same again, so a push that fails is put right within a week. The pattern sync never touches `play-`
  documents, and the playbook never touches `pat-` ones.
- **The weekly sync's result is logged** (`[dispatch] shared brain: …`) when it runs or fails, not when it is
  off or not due.

### Tests (`npm run check:ee`)

Lesson rules (percentages, counts, addresses, links, lengths refused; small numbers allowed); the document
and its tags; the plan sends only lessons that pass and deletes only stale `play-` documents; the pattern sync
leaves `play-` documents alone; the playbook sync against a fake bank; the actions are owners of the admin
business only and audited; only the admin business's owners see the card.
