-- Chains drafted from Claude (card 435, docs/chains.md). OPERATOR's MCP server (draft_chain) keeps one draft per chain
-- here: the chain as Claude drafted it, the saved chain it was made from (base; null for a new chain), a note, who and
-- when. A draft changes nothing: the owner uses it in OPERATOR through the Chains tab's own Save, or discards it. A
-- newer draft of the same chain replaces the older one; the scheduler deletes drafts past expires_at (14 days).
create table chain_drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  chain_key text not null check (char_length(chain_key) between 1 and 40),
  chain jsonb not null check (jsonb_typeof(chain) = 'object' and pg_column_size(chain) <= 32768),
  base jsonb check (base is null or (jsonb_typeof(base) = 'object' and pg_column_size(base) <= 32768)),
  note text check (note is null or char_length(note) <= 300),
  created_by text not null check (char_length(created_by) between 1 and 200),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  unique (org_id, chain_key)
);
create index chain_drafts_expiry on chain_drafts (org_id, expires_at);
alter table chain_drafts enable row level security;
create policy org_rows on chain_drafts for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
