-- Setup check slice 5 (docs/setup-check.md, card 285): reuse setup how-tos OPERATOR staff reviewed.
-- 1. brain_snapshots.setup_checked and setup_gaps: the tools a business ran a setup check on, and each gap's
--    topic tag (tool:topic). Never a title, step or word. Checked here and in code (core/brain-rules.ts).
-- 2. brain_patterns() counts businesses per gap ('gap:<tool>:<topic>', among businesses that checked that
--    tool), with the same floor of 5. Only the admin business's staff see these, on Settings > Playbook.
-- 3. ee_playbook_lessons: a lesson may be a setup how-to for one tool's topic, with steps and a help page.
alter table brain_snapshots add column setup_checked text[] not null default '{}'
  check (cardinality(setup_checked) <= 12 and array_to_string(setup_checked, ',') ~ '^([a-z]{2,12}(,[a-z]{2,12})*)?$');
alter table brain_snapshots add column setup_gaps text[] not null default '{}'
  check (cardinality(setup_gaps) <= 40 and array_to_string(setup_gaps, ',') ~ '^([a-z]{2,12}:[a-z0-9]{1,20}(\.[a-z0-9_]{1,30}){1,2}(,[a-z]{2,12}:[a-z0-9]{1,20}(\.[a-z0-9_]{1,30}){1,2})*)?$');

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
  ),
  gap as (
    select b.cohort, 'gap:' || g as pattern,
      (select count(*) from base x where x.cohort = b.cohort and split_part(g, ':', 1) = any(x.setup_checked))::int as orgs,
      count(distinct b.org_id)::int as hits, null::bigint, null::bigint
    from base b, unnest(b.setup_gaps) g group by b.cohort, g
  )
  select * from (select * from dept union all select * from tool union all select * from action union all select * from level union all select * from result union all select * from gap) p
  where p.orgs >= (select n from floor) and p.hits >= (select n from floor)
$$;
revoke all on function brain_patterns() from public;
revoke all on function brain_patterns() from anon, authenticated;
grant execute on function brain_patterns() to service_role;

alter table ee_playbook_lessons add column setup_tile text check (setup_tile in ('analytics', 'shopify', 'meta', 'klaviyo', 'mailchimp', 'quickbooks'));
alter table ee_playbook_lessons add column setup_topic text check (setup_topic ~ '^[a-z0-9]+(\.[a-z0-9_]+){1,2}$' and char_length(setup_topic) <= 48);
alter table ee_playbook_lessons add column steps text[] not null default '{}' check (cardinality(steps) <= 8 and char_length(array_to_string(steps, '')) <= 2000);
alter table ee_playbook_lessons add column help_url text check (help_url ~ '^https://' and char_length(help_url) <= 400);
alter table ee_playbook_lessons add constraint ee_playbook_howto check (
  (setup_tile is null and setup_topic is null and help_url is null and cardinality(steps) = 0)
  or (setup_tile is not null and setup_topic is not null and help_url is not null and cardinality(steps) between 1 and 8)
);
