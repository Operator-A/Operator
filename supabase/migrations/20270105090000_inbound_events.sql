-- Live events (docs/live-events.md, slice 1): the event log. One row per signed event an outside service
-- sent to this business's hook address (a Shopify order, a paid Stripe invoice), kept 30 days. Only the
-- named fields a reader keeps (core/event-rules.ts) are stored, never an email or street address. The
-- service's own event id makes a retried delivery a duplicate, so it never starts a chain twice.
-- `held` lists the chains it waits for while they are at their event cap; the scheduler starts one
-- catch-up run per chain and empties it.
create table inbound_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  source text not null check (source in ('shopify', 'stripe')),
  event_type text not null check (char_length(event_type) between 1 and 60),
  provider_id text not null check (char_length(provider_id) between 1 and 80),
  facts jsonb not null default '{}'::jsonb check (pg_column_size(facts) <= 8192),
  outcome text check (outcome is null or char_length(outcome) <= 1000),
  held text[] not null default '{}',
  received_at timestamptz not null default now(),
  unique (org_id, source, provider_id)
);
create index inbound_events_at on inbound_events (org_id, received_at desc);
alter table inbound_events enable row level security;
create policy org_rows on inbound_events for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
