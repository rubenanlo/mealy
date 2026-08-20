-- Phase 2: canonical ingredient vocabulary, FODMAP reference, match cache, synced grocery checks
create table canonical_ingredients (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text not null,
  name_fr text not null,
  name_es text not null,
  aliases text[] not null default '{}',
  category text,                       -- fish|meat|vegetarian|legume|dairy|pantry|herb|fruit|vegetable|...
  aisle text,                          -- Mon Marché-style aisle grouping
  season real[],                       -- 12-month suitability curve, null = year-round/n-a
  fodmap_tier text not null default 'check' check (fodmap_tier in ('low','moderate','high','check')),
  fodmap_groups text[] not null default '{}',   -- fructan|gos|lactose|excess_fructose|polyol
  low_serving_g real,                  -- serving at/below which published sources call it low
  high_serving_g real,                 -- serving at/above which it is high
  avg_unit_weight_g real,              -- "1 carotte" ≈ g
  density_g_per_ml real,               -- ml → g conversion
  source_url text,
  source_note text,
  verified boolean not null default false
);

create table ingredient_matches (
  raw_normalized text primary key,
  canonical_id uuid references canonical_ingredients,
  confidence real not null default 1.0,
  matched_by text not null check (matched_by in ('exact','alias','llm','user')),
  created_at timestamptz not null default now()
);

create table grocery_checks (
  household_id uuid not null references households on delete cascade,
  week_start date not null,
  item_key text not null,
  checked_by uuid references auth.users,
  checked_at timestamptz not null default now(),
  primary key (household_id, week_start, item_key)
);

alter table canonical_ingredients enable row level security;
alter table ingredient_matches enable row level security;
alter table grocery_checks enable row level security;

-- reference data: readable by any signed-in user; writes via service role only
create policy canonical_read on canonical_ingredients for select
  using (auth.uid() is not null);
create policy matches_read on ingredient_matches for select
  using (auth.uid() is not null);
create policy matches_insert on ingredient_matches for insert
  with check (auth.uid() is not null);
create policy matches_correct on ingredient_matches for update
  using (auth.uid() is not null)
  with check (matched_by = 'user');
create policy checks_all on grocery_checks for all
  using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));

alter publication supabase_realtime add table grocery_checks;
