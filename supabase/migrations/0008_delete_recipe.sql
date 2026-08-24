-- Recipe deletion (2026-08-24): deleting a recipe must not be blocked by
-- plan history or analytics. Plan entries go with the recipe; events keep
-- the row but lose the reference.

alter table plan_entries
  drop constraint plan_entries_recipe_id_fkey,
  add constraint plan_entries_recipe_id_fkey
    foreign key (recipe_id) references recipes on delete cascade;

alter table events
  drop constraint events_recipe_id_fkey,
  add constraint events_recipe_id_fkey
    foreign key (recipe_id) references recipes on delete set null;
