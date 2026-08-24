-- Meal type (2026-08-24): controlled classification for the planner.
-- 'main' = lunch/dinner. Backfilled from the free-text dish_type; null in
-- new rows is treated as 'main' by the app until the user says otherwise.

alter table recipes
  add column meal_type text
    check (meal_type in ('main', 'breakfast', 'dessert', 'side'));

update recipes set meal_type = case
  when dish_type ~* '(dessert|postre|cookie|galleta|cake|pastel|bizcocho|brownie|tarta|sweet|crepe|pancake|flan|helado)'
    then 'dessert'
  when dish_type ~* '(breakfast|desayuno|petit.?d[ée]jeuner|porridge|granola|esmorzar)'
    then 'breakfast'
  when dish_type ~* '(side|appetizer|dip|spread|entrante|entr[ée]e|acompa|guarni|tapas?|tapes|snack|l[ée]gume|starter|bebida|drink)'
    then 'side'
  else 'main'
end;
