-- Manual FODMAP level (2026-08-24): a user-set tier that overrides the
-- ingredient-derived classification. Null = automatic.

alter table recipes
  add column fodmap_override text
    check (fodmap_override in ('low', 'moderate', 'high'));
