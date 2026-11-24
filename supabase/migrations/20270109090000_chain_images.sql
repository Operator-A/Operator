-- Make an image, a quick chain step (docs/chains.md, slice 4; decided 2026-11-24: kept in OPERATOR, private per
-- business). One row per picture: the run that made it, where it is kept in the private chain-images bucket (under
-- the business's id, named by the run), what was asked, and when the scheduler deletes it (90 days on). Pictures are
-- read only through short signed links made on the server; the bucket is never public.
insert into storage.buckets (id, name, public) values ('chain-images', 'chain-images', false) on conflict (id) do nothing;
create table chain_images (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  run_id uuid not null,
  chain_key text not null check (char_length(chain_key) between 1 and 40),
  path text not null check (char_length(path) between 1 and 200),
  model text not null check (char_length(model) between 1 and 60),
  prompt text not null check (char_length(prompt) <= 3000),
  size text not null check (size in ('1024x1024', '1536x1024', '1024x1536')),
  quality text not null check (quality in ('low', 'medium', 'high')),
  cost_usd numeric(10, 4) not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (org_id, run_id)
);
create index chain_images_expiry on chain_images (org_id, expires_at);
alter table chain_images enable row level security;
create policy org_rows on chain_images for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
