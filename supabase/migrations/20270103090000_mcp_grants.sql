-- OPERATOR's own MCP server (docs/operator-mcp.md, slice 1): one row per app a member connected (Claude),
-- bound to that member and this business. Only hashes of the sign-in code and tokens are kept; the tokens
-- themselves name the org and the row, so a leaked row signs nobody in. Disconnect sets revoked_at.
create table mcp_grants (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  member_id uuid not null references members(id) on delete cascade,
  client_name text not null check (char_length(client_name) between 1 and 80),
  redirect_uri text not null check (char_length(redirect_uri) <= 500),
  code_hash text check (code_hash is null or char_length(code_hash) = 64),
  code_challenge text check (code_challenge is null or code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  code_expires_at timestamptz,
  access_hash text check (access_hash is null or char_length(access_hash) = 64),
  access_expires_at timestamptz,
  refresh_hash text check (refresh_hash is null or char_length(refresh_hash) = 64),
  refresh_expires_at timestamptz,
  window_start timestamptz,
  window_calls integer not null default 0 check (window_calls >= 0),
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index mcp_grants_org_member on mcp_grants (org_id, member_id);
alter table mcp_grants enable row level security;
create policy org_rows on mcp_grants for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
