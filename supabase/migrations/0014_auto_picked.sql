-- Choose-for-us provenance (2026-08-24): entries the auto-planner inserted,
-- so "Choose again" can replace them across sessions without touching
-- manual picks.

alter table plan_entries
  add column auto_picked boolean not null default false;
