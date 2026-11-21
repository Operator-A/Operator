-- The shared brain, slice 5 (docs/shared-brain.md, card 235): the OPERATOR playbook. Lessons written by
-- the owners of the admin business (OPERATOR staff, ee/admin.ts), never by another business and never by
-- a model. A published lesson goes into the Hindsight bank as OPERATOR's advice; a draft goes nowhere.
-- Same rules as every table: org_id, row level security and org_rows. Lengths and the kind list are
-- checked here as well as in code (ee/playbook-rules.ts).
create table ee_playbook_lessons (
  org_id uuid not null references orgs(id),
  id uuid not null default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 80),
  body text not null check (char_length(body) between 20 and 600),
  kind text check (kind in ('online_store', 'local_shop', 'food_drink', 'services', 'agency', 'software', 'b2b_goods', 'creator', 'other')),
  status text not null default 'draft' check (status in ('draft', 'published')),
  written_by text not null check (char_length(written_by) between 3 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  primary key (org_id, id),
  check ((status = 'published') = (published_at is not null))
);
create index ee_playbook_lessons_org on ee_playbook_lessons (org_id, status, updated_at desc);
alter table ee_playbook_lessons enable row level security;
create policy org_rows on ee_playbook_lessons for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
