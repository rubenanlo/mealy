-- Household weekly routine for the ✦ AI week planner (2026-11-15).
--
-- households.plan_routine: the routine the planner follows every week (quick
-- weekday meals, weekday favourites with "made the day before", the
-- next-night leftovers chain, special weekend lunch) plus the household's own
-- rules written in plain words. Shape: app/src/lib/plan-routine.ts. Empty
-- object = defaults.
--
-- plan_entries.leftover_of: a row eaten from another meal's leftovers (Marc
-- has last night's dinner). Groceries skip these rows and add one portion to
-- the meal they point at instead.

alter table households
  add column plan_routine jsonb not null default '{}';

alter table plan_entries
  add column leftover_of uuid references plan_entries(id) on delete set null;
