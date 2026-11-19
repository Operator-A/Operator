-- Business facts (card 151, docs/setup.md): what the founder told Avery in setup, one short line each,
-- that the founder can correct. "suggested" facts came from a run that read a web page and count only
-- after the founder confirms them. Same rules as every table: org_id, row level security, org_rows.
create table business_facts (
  org_id uuid not null references orgs(id),
  id uuid not null default gen_random_uuid(),
  topic text not null check (topic in ('business', 'sells', 'customers', 'channels', 'goals', 'hand_off', 'other')),
  text text not null check (length(text) between 1 and 160),
  state text not null default 'known' check (state in ('known', 'suggested')),
  source text not null default 'chat' check (source in ('chat', 'site', 'owner')),
  run_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (org_id, id)
);
create index business_facts_org_created on business_facts (org_id, created_at);
alter table business_facts enable row level security;
create policy org_rows on business_facts for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
