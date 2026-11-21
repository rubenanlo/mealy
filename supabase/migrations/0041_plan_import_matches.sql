-- Remembered matches for imported week plans ("Import a plan").
-- When the family saves an imported plan, each dish phrase as the sender
-- wrote it (folded: lower case, no accents, single spaces) is stored with
-- what it became: a library recipe or a quick-meal title. The next import
-- uses these first, so "arros chaufa" lands on the same recipe every week.

create table plan_import_matches (
  household_id uuid not null references households on delete cascade,
  phrase text not null check (char_length(phrase) between 1 and 200),
  recipe_id uuid references recipes on delete cascade,
  custom_title text,
  updated_at timestamptz not null default now(),
  primary key (household_id, phrase),
  constraint plan_import_matches_recipe_or_title check ((recipe_id is null) <> (custom_title is null))
);

alter table plan_import_matches enable row level security;
create policy plan_import_matches_all on plan_import_matches for all
  using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));
