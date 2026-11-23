-- Setup check slice 2 (docs/setup-check.md, card 282): Shopify and QuickBooks get a check too. A finding may
-- now carry Fix it for me (an existing gateway action type) and its last fix run, inside the same findings
-- jsonb; nothing else changes.
alter table setup_checks drop constraint if exists setup_checks_tool_check;
alter table setup_checks add constraint setup_checks_tool_check check (tool in ('analytics', 'shopify', 'quickbooks'));
