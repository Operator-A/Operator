-- Setup check slice 4 (docs/setup-check.md, card 284): Klaviyo and Mailchimp get a check, and a skipped
-- finding comes back once as a department head's proposal (kind 'setup_finding'). Nothing else changes.
alter table setup_checks drop constraint if exists setup_checks_tool_check;
alter table setup_checks add constraint setup_checks_tool_check check (tool in ('analytics', 'shopify', 'quickbooks', 'meta', 'klaviyo', 'mailchimp'));
alter table proposals drop constraint if exists proposals_kind_check;
alter table proposals add constraint proposals_kind_check check (kind in ('hire', 'grant_tool', 'new_tool', 'retire', 'department', 'goal', 'setup_finding'));
