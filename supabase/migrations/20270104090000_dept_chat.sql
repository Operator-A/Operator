-- Department pages (docs/department-pages.md, slice 2): the chat with each department's head. One row per
-- message: the person's (role owner) or the head's reply (role head), with the run that answered it and
-- the lines code added under the reply (what it saved). Read back newest first per department.
create table dept_chat (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  department_id text not null check (char_length(department_id) between 1 and 60),
  role text not null check (role in ('owner', 'head')),
  text text not null check (char_length(text) <= 4000),
  run_id uuid,
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index dept_chat_at on dept_chat (org_id, department_id, created_at desc);
alter table dept_chat enable row level security;
create policy org_rows on dept_chat for all to authenticated using (org_id = (select public.jwt_org_id())) with check (org_id = (select public.jwt_org_id()));
