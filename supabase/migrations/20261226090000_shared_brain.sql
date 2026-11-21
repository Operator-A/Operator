-- The shared brain, slice 2 (docs/shared-brain.md, Build Board card 231). Two things:
--
-- 1. brain_snapshots: what one business would add to the shared brain, one row per business, written
--    by code for that business through db(). Only values from fixed lists and counts fit: every column
--    is checked here, so no name, text, address or amount can be stored, whatever the code does. Same
--    rules as every table: org_id, row level security, org_rows.
-- 2. brain_patterns(): the one read across businesses beyond their ids. It returns totals only, and a
--    pattern only when at least 5 businesses share it (the floor is written here, not passed in, so no
--    caller can lower it). Only the service role may call it; db() refuses rpc anyway.
create table brain_snapshots (
  org_id uuid not null references orgs(id) primary key,
  taken_on date not null,
  kind text check (kind is null or kind in ('online_store', 'local_shop', 'food_drink', 'services', 'agency', 'software', 'b2b_goods', 'creator', 'other')),
  revenue_band text not null check (revenue_band in ('unknown', 'none', 'under_10k', '10k_50k', '50k_250k', 'over_250k')),
  age_band text not null check (age_band in ('0_30', '30_60', '60_90', '90_plus')),
  -- "part:tool", both from the lists in code (core/tools-step-rules.ts)
  tools text[] not null default '{}' check (cardinality(tools) <= 30 and array_to_string(tools, ',') ~ '^([a-z]{2,12}:[a-z0-9_]{2,30}(,[a-z]{2,12}:[a-z0-9_]{2,30})*)?$'),
  -- department ids of starting kits only (a department Avery designed counts in bespoke, never by name)
  departments text[] not null default '{}' check (cardinality(departments) <= 20 and array_to_string(departments, ',') ~ '^([a-z][a-z0-9_]{1,39}(,[a-z][a-z0-9_]{1,39})*)?$'),
  bespoke integer not null default 0 check (bespoke between 0 and 20),
  on_duty integer not null default 0 check (on_duty between 0 and 200),
  -- per action type, the last 30 days: {"klaviyo.campaign_draft": {"decided": 12, "unedited": 10, "rejected": 1}}
  actions jsonb not null default '{}' check (jsonb_typeof(actions) = 'object' and length(actions::text) <= 4000),
  -- "action_type:level" for action types above Draft
  levels text[] not null default '{}' check (cardinality(levels) <= 30 and array_to_string(levels, ',') ~ '^([a-z0-9_.]{2,60}:(act_undo|act)(,[a-z0-9_.]{2,60}:(act_undo|act))*)?$'),
  updated_at timestamptz not null default now()
);
alter table brain_snapshots enable row level security;
create policy org_rows on brain_snapshots for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));

-- cohort: 'all', 'kind:<kind>' or 'kind:<kind>|rev:<band>'. pattern: 'dept:<id>' (among businesses 60+
-- days in), 'tool:<part>:<tool>', 'action:<type>' (num = unedited, den = decided, summed) or
-- 'level:<type>' (promoted, among businesses that used the action type). orgs = businesses the
-- pattern is counted over, hits = businesses that have it. Both at least 5, or the row isn't returned.
create or replace function brain_patterns()
returns table (cohort text, pattern text, orgs integer, hits integer, num bigint, den bigint)
language sql stable security definer set search_path = public
as $$
  with floor as (select 5 as n),
  snap as (select * from brain_snapshots),
  cohorts as (
    select org_id, 'all'::text as cohort from snap
    union all select org_id, 'kind:' || kind from snap where kind is not null
    union all select org_id, 'kind:' || kind || '|rev:' || revenue_band from snap where kind is not null and revenue_band not in ('unknown')
  ),
  base as (select c.cohort, s.* from cohorts c join snap s using (org_id)),
  dept as (
    select b.cohort, 'dept:' || d as pattern,
      (select count(*) from base x where x.cohort = b.cohort and x.age_band in ('60_90', '90_plus'))::int as orgs,
      count(distinct b.org_id)::int as hits, null::bigint as num, null::bigint as den
    from base b, unnest(b.departments) d where b.age_band in ('60_90', '90_plus') group by b.cohort, d
  ),
  tool as (
    select b.cohort, 'tool:' || t as pattern,
      (select count(*) from base x where x.cohort = b.cohort)::int as orgs,
      count(distinct b.org_id)::int as hits, null::bigint, null::bigint
    from base b, unnest(b.tools) t group by b.cohort, t
  ),
  act as (
    select b.cohort, a.key as type, b.org_id, b.levels, (a.value->>'decided')::bigint as decided, (a.value->>'unedited')::bigint as unedited
    from base b, jsonb_each(b.actions) a where coalesce((a.value->>'decided')::bigint, 0) > 0
  ),
  action as (
    select cohort, 'action:' || type, count(distinct org_id)::int, count(distinct org_id)::int, sum(unedited), sum(decided)
    from act group by cohort, type
  ),
  level as (
    select cohort, 'level:' || type, count(distinct org_id)::int,
      (count(distinct org_id) filter (where exists (select 1 from unnest(levels) l where split_part(l, ':', 1) = type)))::int,
      null::bigint, null::bigint
    from act group by cohort, type
  )
  select * from (select * from dept union all select * from tool union all select * from action union all select * from level) p
  where p.orgs >= (select n from floor) and p.hits >= (select n from floor)
$$;
revoke all on function brain_patterns() from public;
revoke all on function brain_patterns() from anon, authenticated;
grant execute on function brain_patterns() to service_role;
