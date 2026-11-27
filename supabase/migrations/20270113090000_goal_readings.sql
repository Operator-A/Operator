-- Goal readings (overview slice 4, docs/department-pages.md). One row per goal per day: where the goal's measure stood
-- when the scheduler's daily reading job read it, worked out in code (core/goals.ts progress), never by a model. Before
-- this only the latest reading was known, so a goal had no line over time. A reading taken again the same day replaces
-- the row. Readings go with their goal when the goal is deleted.
create table goal_readings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  goal_id uuid not null references goals(id) on delete cascade,
  day date not null,
  value numeric not null check (abs(value) <= 1e12),
  pct numeric check (pct is null or pct between 0 and 100),
  status text not null check (char_length(status) between 1 and 20),
  read_at timestamptz not null default now(),
  unique (org_id, goal_id, day)
);
create index goal_readings_line on goal_readings (org_id, goal_id, day desc);
alter table goal_readings enable row level security;
create policy org_rows on goal_readings for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));

-- the daily reading is a job like a report: one per business per day, queued by the scheduler
alter table jobs drop constraint jobs_kind_check;
alter table jobs add constraint jobs_kind_check check (kind in ('chain_step', 'report', 'goal_reading'));
