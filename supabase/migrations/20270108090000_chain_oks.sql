-- Wait for my OK, a quick chain step (docs/chains.md, slice 3). When a chain reaches the step, code keeps one row:
-- the chain and step it holds, how the chain was started (ctx), the step before's run and what it said (facts,
-- data shown on the card), and the department it shows in. An approver approves (the chain goes on to the next
-- step) or rejects (it stops); a row still pending at due_at is marked expired by the scheduler and the chain stops.
-- Decided once: every update is guarded by status = 'pending'.
create table chain_oks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  chain_key text not null check (char_length(chain_key) between 1 and 40),
  chain_id uuid not null,
  step int not null check (step between 0 and 7),
  ctx jsonb not null check (jsonb_typeof(ctx) = 'object' and pg_column_size(ctx) <= 2048),
  parent_run uuid not null,
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object' and pg_column_size(facts) <= 8192),
  department_id text check (department_id is null or char_length(department_id) between 1 and 80),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  due_at timestamptz not null,
  decided_by text,
  decided_at timestamptz,
  unique (org_id, chain_id, step)
);
create index chain_oks_pending on chain_oks (org_id, status, due_at);
alter table chain_oks enable row level security;
create policy org_rows on chain_oks for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
