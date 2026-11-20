-- Managed Claude credits (card 128 slice 4, docs/extensions.md): the paid layer's ledger. A pack bought
-- on Stripe adds a row (once per Checkout session); a run on the hosted key takes one away (once per
-- run): its cost from the price list plus the margin, worked out in code. The balance is the sum. Rows
-- are never changed or deleted. Same rules as every table: org_id, row level security and org_rows.
create table ee_credit_ledger (
  org_id uuid not null references orgs(id),
  id uuid not null default gen_random_uuid(),
  kind text not null check (kind in ('pack', 'run')),
  amount_usd numeric(12, 6) not null check ((kind = 'pack' and amount_usd > 0) or (kind = 'run' and amount_usd <= 0)),
  stripe_session_id text unique check (stripe_session_id ~ '^cs_(test|live)_[A-Za-z0-9]{6,200}$'),
  run_id uuid unique,
  cost_usd numeric(12, 6),
  created_at timestamptz not null default now(),
  primary key (org_id, id),
  check ((kind = 'pack' and stripe_session_id is not null and run_id is null) or (kind = 'run' and run_id is not null and stripe_session_id is null))
);
create index ee_credit_ledger_org on ee_credit_ledger (org_id, created_at desc);
alter table ee_credit_ledger enable row level security;
create policy org_rows on ee_credit_ledger for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
revoke update, delete, truncate on ee_credit_ledger from authenticated, anon;
