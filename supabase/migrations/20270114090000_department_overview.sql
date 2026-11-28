-- A department's Overview as a grid of widgets (packs slice 2, docs/packs.md). `overview` holds rows of core's widgets
-- (core/widget-rules.ts) a department pack set at install; null keeps the default Overview, as before. `pack` says
-- which pack and version the department came from ("store-analytics@1"), so its header can say so and a later
-- version can be offered (card 503). The app reads the layout through readLayout, which falls back to the default
-- Overview for anything that doesn't pass its checks; before this migration, installs leave both out.
alter table departments
  add column if not exists overview jsonb check (overview is null or (jsonb_typeof(overview) = 'array' and pg_column_size(overview) <= 8192)),
  add column if not exists pack text check (pack is null or pack ~ '^[a-z][a-z0-9-]{1,30}@[0-9]{1,4}$');
