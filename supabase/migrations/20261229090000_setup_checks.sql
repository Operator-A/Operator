-- The setup check (docs/setup-check.md, card 281): one row per business and tool, the latest check of how
-- that tool is set up. Findings are what the setup agent filed and code kept (core/setup-check-rules.ts):
-- severity, a topic tag, a title, why, evidence keys, Show me how steps and the help page they came from.
-- Saved only after a run that finished. Nothing here is ever sent anywhere or changes the tool.
create table setup_checks (
  org_id uuid not null references orgs(id),
  tool text not null check (tool in ('analytics')),
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  findings jsonb not null default '[]' check (jsonb_typeof(findings) = 'array' and jsonb_array_length(findings) <= 8 and length(findings::text) <= 24000),
  summary text check (summary is null or char_length(summary) <= 300),
  run_id uuid,
  cost_usd numeric(10, 4) not null default 0 check (cost_usd >= 0),
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, tool)
);
alter table setup_checks enable row level security;
create policy org_rows on setup_checks for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
