-- "My version" (2026-11-15): a household's own AI-adapted copy of a recipe,
-- shown behind an Original | My version toggle. Same mechanism as the
-- low-FODMAP variant (0033): a full recipes row linked by variant_of, one per
-- kind per original, shared by the whole household.
-- variant_note keeps the one-line summary of what was changed ("Added chorizo").

alter table recipes drop constraint if exists recipes_variant_kind_check;
alter table recipes
  add constraint recipes_variant_kind_check
    check (variant_kind in ('low_fodmap', 'custom'));

alter table recipes add column if not exists variant_note text;
