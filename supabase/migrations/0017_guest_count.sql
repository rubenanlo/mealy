-- Guests per meal (2026-08-24): non-family people eating a specific meal.
-- Servings for an entry = covered eaters (whole household when person_ids is
-- empty) + guest_count; used to scale the recipe's ingredients in the planner,
-- "what's next", and the shopping list only — the library recipe is untouched.

alter table plan_entries
  add column guest_count int not null default 0 check (guest_count >= 0);
