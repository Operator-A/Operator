-- Agents that run in Claude (docs/live-events.md, slice 2). A linked agent is an ordinary agent row whose
-- runs happen in one of the owner's Claude routines: `runs_on` says where it runs, `claude_tools` names the
-- Claude connectors it uses (labels only, never granted in OPERATOR). Its routine id and token are sealed in
-- mcp_connections like every other key. A run that fired the routine keeps the session it started and, once
-- the session calls finish_run, what it said, in `claude_session`.
alter table agents add column runs_on text not null default 'operator' check (runs_on in ('operator', 'claude'));
alter table agents add column claude_tools text[] not null default '{}' check (cardinality(claude_tools) <= 8);
alter table agent_runs add column claude_session jsonb check (claude_session is null or pg_column_size(claude_session) <= 8192);
