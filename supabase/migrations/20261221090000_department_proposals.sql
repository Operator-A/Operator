-- A new department as a proposal (card 156, docs/company-mode.md "New department"): the owner's
-- Propose on Avery's department draft files a proposal of kind 'department'. Only an owner files
-- one, and the owner's yes creates it through the app's own paths (core/departments.ts).
alter table proposals drop constraint proposals_kind_check;
alter table proposals add constraint proposals_kind_check check (kind in ('hire', 'grant_tool', 'new_tool', 'retire', 'department'));
