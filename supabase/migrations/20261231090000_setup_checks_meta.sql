-- Setup check slice 3 (docs/setup-check.md, card 283): Meta Ads gets a check too. Nothing else changes.
alter table setup_checks drop constraint if exists setup_checks_tool_check;
alter table setup_checks add constraint setup_checks_tool_check check (tool in ('analytics', 'shopify', 'quickbooks', 'meta'));
