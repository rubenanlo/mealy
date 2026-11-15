-- Personal FODMAP list: the household's own ratings for ingredients, entered
-- by hand in Settings → My FODMAP list. Separate from canonical_ingredients
-- (the shared, cited reference table) so a personal call never overwrites a
-- sourced row. When an entry is linked to a canonical ingredient, the app's
-- FODMAP check uses the entry's rating instead of the reference tier.
-- Numbered 0035 because 0034 is taken by the open galette/water PR.

create table my_fodmap_ingredients (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  canonical_id uuid references canonical_ingredients on delete set null,
  rating text not null check (rating in ('low','moderate','high')),
  safe_portion text,                 -- free text as the user writes it: "75 g", "1/2 cup", "2 tbsp"
  notes text,
  checked boolean not null default false,
  checked_by uuid references auth.users on delete set null,
  checked_at timestamptz,
  created_by uuid references auth.users on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index my_fodmap_ingredients_name_uniq
  on my_fodmap_ingredients (household_id, lower(btrim(name)));
create index my_fodmap_ingredients_canonical_idx
  on my_fodmap_ingredients (household_id, canonical_id);

create or replace function my_fodmap_touch() returns trigger
language plpgsql as
$$
begin
  new.updated_at := now();
  if new.checked and not coalesce(old.checked, false) then
    new.checked_by := coalesce(new.checked_by, auth.uid());
    new.checked_at := coalesce(new.checked_at, now());
  elsif not new.checked then
    new.checked_by := null;
    new.checked_at := null;
  end if;
  return new;
end
$$;

create trigger my_fodmap_touch
  before insert or update on my_fodmap_ingredients
  for each row execute function my_fodmap_touch();

alter table my_fodmap_ingredients enable row level security;

create policy my_fodmap_all on my_fodmap_ingredients for all
  using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));
