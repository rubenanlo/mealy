-- Per-meal absences ("eats away", set before dishes are picked) and a
-- per-entry free-text instruction for whoever cooks the meal.

create table plan_absences (
  id uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null references meal_plans on delete cascade,
  day int not null check (day between 0 and 6),
  slot text not null check (slot in ('lunch', 'dinner')),
  person_id uuid not null references persons on delete cascade,
  created_at timestamptz not null default now(),
  unique (meal_plan_id, day, slot, person_id)
);

alter table plan_absences enable row level security;
create policy absences_all on plan_absences for all
  using (meal_plan_id in (select id from meal_plans where household_id in (select my_household_ids())));

alter table plan_entries add column instructions text;
