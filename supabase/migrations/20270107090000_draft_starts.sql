-- When an agent starts, as a draft (docs/operator-mcp.md, slice 4 part 2). A version Claude saved through
-- OPERATOR's MCP server may carry the schedule, by hand, live event or "run after" it asks for. Nothing reads
-- it until the owner's Go live of that version, which applies it to the crew flow after a confirm that lists
-- each change. Other versions leave it null, so a later draft never re-applies an old schedule.
alter table agent_defs add column starts jsonb check (starts is null or (jsonb_typeof(starts) = 'object' and pg_column_size(starts) <= 2048));
