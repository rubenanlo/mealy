-- Meal time windows (2026-08-24): per-household lunch/dinner ranges,
-- e.g. {"lunch":{"start":"12:00","end":"15:00"}}. Empty = app defaults.

alter table households
  add column meal_times jsonb not null default '{}';
