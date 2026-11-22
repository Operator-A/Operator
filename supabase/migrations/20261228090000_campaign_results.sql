-- The shared brain, slice 4b (docs/shared-brain.md, card 234): how campaign drafts turned out.
-- 1. campaign_results: one row per applied campaign draft, in the business's own tables. Only its shape
--    (lengths as bands, preview text or not) and, 7 days after the owner sent it, its result as bands.
--    Never the subject, body, list or any count or rate. Checked here and in code (core/result-rules.ts).
-- 2. brain_snapshots.results: per campaign type and shape, "good" (most of that business's campaigns of
--    that shape reached 35% opens or more) or "low".
-- 3. brain_patterns() counts businesses per result pattern ('result:<type>:<shape>'), same floor of 5.
-- 4. approvals.brain_note: the line on the approval card saying what the agent was shown, in code's words.
create table campaign_results (
  org_id uuid not null references orgs(id),
  action_id uuid not null,
  action_type text not null check (action_type in ('klaviyo.campaign_draft', 'mailchimp.campaign_draft')),
  -- the campaign's id in Klaviyo or Mailchimp, to find its report; an id, never words
  external_id text not null check (external_id ~ '^[A-Za-z0-9_-]{1,80}$'),
  subject_band text not null check (subject_band in ('short', 'medium', 'long')),
  has_preview boolean not null,
  body_band text not null check (body_band in ('short', 'medium', 'long')),
  status text not null default 'waiting' check (status in ('waiting', 'sent', 'not_sent', 'checked')),
  sent_at timestamptz,
  day_band text check (day_band in ('weekday', 'weekend')),
  time_band text check (time_band in ('morning', 'afternoon', 'evening')),
  open_band text check (open_band in ('under_20', '20_35', '35_50', '50_plus')),
  click_band text check (click_band in ('under_1', '1_3', '3_plus')),
  unsub_band text check (unsub_band in ('under_0_3', '0_3_plus')),
  created_at timestamptz not null default now(),
  checked_at timestamptz,
  primary key (org_id, action_id),
  constraint campaign_results_checked check ((status = 'checked') = (open_band is not null and checked_at is not null))
);
create index campaign_results_open on campaign_results (org_id, status) where status in ('waiting', 'sent');
alter table campaign_results enable row level security;
create policy org_rows on campaign_results for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));

alter table brain_snapshots add column results jsonb not null default '{}'
  check (jsonb_typeof(results) = 'object' and length(results::text) <= 4000 and results::text ~ '^[a-z0-9_.:{}", ]*$');

alter table approvals add column brain_note text check (brain_note is null or char_length(brain_note) <= 600);

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
  ),
  res as (
    select b.cohort, r.key as type, s.key as shape, s.value #>> '{}' as v, b.org_id
    from base b, jsonb_each(b.results) r, jsonb_each(r.value) s where jsonb_typeof(r.value) = 'object'
  ),
  result as (
    select cohort, 'result:' || type || ':' || shape, count(distinct org_id)::int,
      (count(distinct org_id) filter (where v = 'good'))::int, null::bigint, null::bigint
    from res group by cohort, type, shape
  )
  select * from (select * from dept union all select * from tool union all select * from action union all select * from level union all select * from result) p
  where p.orgs >= (select n from floor) and p.hits >= (select n from floor)
$$;
revoke all on function brain_patterns() from public;
revoke all on function brain_patterns() from anon, authenticated;
grant execute on function brain_patterns() to service_role;
