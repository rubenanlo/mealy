-- Suggestion cool-down (2026-08-24): a recipe reappears in "Suggested for
-- you" after this many weeks without being planned. 0 = only the current
-- week's picks are hidden.

alter table households
  add column suggested_rest_weeks int not null default 3
    check (suggested_rest_weeks between 0 and 12);
