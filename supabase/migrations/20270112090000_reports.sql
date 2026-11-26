-- Department reports (overview slice 2, docs/department-pages.md). One row per department, period and day: the lines a
-- model wrote from that window's runs, kept only where code checked that every run a line cites is one of the
-- department's runs in the window (core/report-rules.ts). period 'day' covers the org's calendar day up to written_at;
-- 'week' covers the 7 days ending on that day. Writing it again (Write it now) replaces the row. writer_run is the
-- quick run (trigger 'report') that paid for the model call, so every writing is logged and budgeted.
create table reports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  scope text not null check (char_length(scope) between 1 and 80),
  period text not null check (period in ('day', 'week')),
  day date not null,
  from_at timestamptz not null,
  to_at timestamptz not null,
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array' and pg_column_size(lines) <= 32768),
  run_count int not null default 0 check (run_count between 0 and 1000),
  dropped int not null default 0 check (dropped between 0 and 100),
  cost_usd numeric not null default 0 check (cost_usd >= 0),
  writer_run uuid,
  written_at timestamptz not null default now(),
  unique (org_id, scope, period, day)
);
create index reports_latest on reports (org_id, scope, period, day desc);
alter table reports enable row level security;
create policy org_rows on reports for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));

-- the report writer is a job like a chain step: one per department per day, queued by the scheduler
alter table jobs drop constraint jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in ('chain_step', 'report'));
