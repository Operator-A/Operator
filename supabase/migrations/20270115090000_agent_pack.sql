-- Which pack an agent came from (packs slice 3, docs/packs.md): "store-analytics@1" for an agent a department pack
-- installed into a running business, "conversion-analyst@1" for one an agent pack put in an open seat. Null for an
-- agent built by hand or at first-run setup. Nothing reads it to decide what an agent may do; it says where the agent
-- came from, so a later version of its pack can be offered. Before this migration, installs leave it out.
alter table agents
  add column if not exists pack text check (pack is null or pack ~ '^[a-z][a-z0-9-]{1,30}@[0-9]{1,4}$');
