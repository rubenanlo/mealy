-- The household's FODMAP list with serving limits (imported from a sheet:
-- Ingredient, Category, Overall, Green up to, Amber, Red, Notes, Unit).
-- Household-scoped and loaded straight into the database: the rows are not
-- committed to this (public) repository.
--
-- The ✦ "Is this recipe FODMAP friendly?" check matches each recipe line to
-- one entry, flags entries whose `overall` is amber or red, and compares the
-- line's amount per serving with green_max / red_qty.

create table fodmap_list (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  category text,
  overall text not null check (overall in ('green','amber','red')),
  green_max numeric check (green_max is null or green_max >= 0),   -- "Green up to"; null = no green amount
  amber_qty numeric check (amber_qty is null or amber_qty >= 0),
  red_qty numeric check (red_qty is null or red_qty >= 0),         -- red from this amount
  unit text not null default 'g' check (unit in ('g','ml')),
  notes text,
  created_at timestamptz not null default now()
);

create index fodmap_list_household_idx on fodmap_list (household_id);

alter table fodmap_list enable row level security;

create policy fodmap_list_all on fodmap_list for all
  using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));

-- Which list entry a recipe line was matched to (AI pick, or the user's
-- correction). entry_id null = "not in the list", cached so the AI is asked
-- once per line. Keyed by the normalised line text.
create table fodmap_list_matches (
  household_id uuid not null references households on delete cascade,
  line_key text not null,
  entry_id uuid references fodmap_list on delete cascade,
  source text not null default 'ai' check (source in ('ai','user')),
  created_at timestamptz not null default now(),
  primary key (household_id, line_key)
);

alter table fodmap_list_matches enable row level security;

create policy fodmap_list_matches_all on fodmap_list_matches for all
  using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));
