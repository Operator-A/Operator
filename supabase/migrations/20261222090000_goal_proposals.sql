-- Card 158: a head or the chief of staff can propose a new department goal, a change to one, or
-- dropping one. The owner's yes applies it through the Goals page's own paths (core/proposals.ts).
alter table proposals drop constraint proposals_kind_check;
alter table proposals add constraint proposals_kind_check check (kind in ('hire', 'grant_tool', 'new_tool', 'retire', 'department', 'goal'));
