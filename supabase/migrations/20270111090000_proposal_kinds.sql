-- Proposal kinds (card 450): change_agent and move_agent were added in code (cards 37x, 371) but never to the
-- database check, so filing either one failed with proposals_kind_check. The list now matches every kind code
-- files (KIND_WORDS in core/proposal-rules.ts); check:proposals fails if the two drift apart again.
alter table proposals drop constraint if exists proposals_kind_check;
alter table proposals add constraint proposals_kind_check check (kind in ('hire', 'grant_tool', 'new_tool', 'retire', 'department', 'goal', 'setup_finding', 'change_agent', 'move_agent'));
