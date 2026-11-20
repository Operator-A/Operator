-- Trust levels (card 7, docs/trust.md): the level each agent has earned for each write tool. No row
-- means Draft, so every action type starts at Draft. Only an approver's tap on a promotion card moves a
-- level up; a "wrong" or "against the rules" rejection or cancel, or a cap breach, drops it back to
-- Draft. offer_level is an open promotion card. Same rules as every table: org_id, row level security,
-- org_rows.
create table trust_levels (
  org_id uuid not null references orgs(id),
  agent_id text not null check (agent_id ~ '^[a-z0-9_]{1,60}$'),
  tool text not null check (tool ~ '^[a-z0-9_.]{1,60}$'),
  level text not null default 'draft' check (level in ('draft', 'act_undo', 'act')),
  changed_at timestamptz not null default now(),
  changed_by text not null default 'system',
  reason text check (reason is null or length(reason) <= 300),
  offer_level text check (offer_level is null or offer_level in ('act_undo', 'act')),
  offer_at timestamptz,
  declined_at timestamptz,
  primary key (org_id, agent_id, tool)
);
alter table trust_levels enable row level security;
create policy org_rows on trust_levels for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));

-- An action at "Act with undo" waits as scheduled until execute_after, then the scheduler approves and
-- applies it; an approver can cancel it before then (cancel_kind, the same kinds as a rejection).
alter table agent_actions drop constraint agent_actions_status_check;
alter table agent_actions add constraint agent_actions_status_check check (status in ('proposed', 'approved', 'executing', 'applied', 'partial', 'failed', 'rejected', 'expired', 'refused', 'sent_back', 'scheduled', 'cancelled'));
alter table agent_actions add column execute_after timestamptz;
alter table agent_actions add column cancel_kind text check (cancel_kind is null or cancel_kind in ('wrong', 'policy', 'not_now', 'other'));
alter table agent_actions add column level text check (level is null or level in ('draft', 'act_undo', 'act'));
create index agent_actions_scheduled on agent_actions (org_id, execute_after) where status = 'scheduled';

-- Why an approver rejected an approval: wrong and policy drop that action type back to Draft.
alter table approvals add column reject_kind text check (reject_kind is null or reject_kind in ('wrong', 'policy', 'not_now', 'other'));
