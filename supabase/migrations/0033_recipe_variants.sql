-- Recipe variants (2026-11-01): an AI-adapted version saved next to its
-- original instead of overwriting it. A variant is a full recipes row (so the
-- planner, groceries and FODMAP engine work unchanged) linked to its original.
-- Deleting the original deletes its variants. One variant per kind.

alter table recipes
  add column variant_of uuid references recipes on delete cascade,
  add column variant_kind text check (variant_kind in ('low_fodmap')),
  add constraint recipes_variant_pair
    check ((variant_of is null) = (variant_kind is null));

create unique index recipes_variant_unique on recipes (variant_of, variant_kind)
  where variant_of is not null;
