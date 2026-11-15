-- Meal ideas parked for a week, not yet given a day ("No day yet").
-- Keyed by household + week_start so an idea can exist before the week has
-- a meal_plans row; the plan is created when the first meal gets a day.
-- Planning an idea inserts a plan_entries row and deletes the idea.

create table plan_ideas (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  -- Monday of the target week (same convention as meal_plans.week_start).
  week_start date not null,
  recipe_id uuid references recipes on delete cascade,
  custom_title text,
  note text,
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  -- Exactly one of a library recipe or a free-text meal, like plan_entries.
  constraint plan_ideas_recipe_or_title check ((recipe_id is null) <> (custom_title is null))
);

create index plan_ideas_household_week on plan_ideas (household_id, week_start);

alter table plan_ideas enable row level security;
create policy plan_ideas_all on plan_ideas for all
  using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));
