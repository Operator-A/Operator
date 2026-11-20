-- Uploaded exports (card 160, docs/exports.md): when a tool the business uses has no connection, the
-- owner uploads a CSV export of it and agents read it through Uploaded export. One row per tool, holding
-- the latest upload. "switched" means the tool got a real connection: uploads stop. Same rules as every
-- table: org_id, row level security, org_rows.
create table file_sources (
  org_id uuid not null references orgs(id),
  id uuid not null default gen_random_uuid(),
  service_key text not null check (service_key ~ '^[a-z0-9]{1,60}$'),
  name text not null check (length(name) between 1 and 60),
  columns jsonb not null default '[]'::jsonb,
  rows jsonb not null default '[]'::jsonb,
  row_count integer not null default 0 check (row_count between 0 and 5000),
  bytes integer not null default 0 check (bytes between 0 and 1000000),
  fresh_days integer not null default 7 check (fresh_days between 1 and 90),
  state text not null default 'active' check (state in ('active', 'switched')),
  uploaded_at timestamptz not null default now(),
  uploaded_by text,
  switched_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (org_id, id),
  unique (org_id, service_key)
);
alter table file_sources enable row level security;
create policy org_rows on file_sources for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
