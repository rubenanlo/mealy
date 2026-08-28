-- Groceries v2: pantry awareness + user-added items.
--
-- pantry_marks: "we already have this" ('have') or "we have some" ('partial')
-- per shopping-list line, per week — same keying and realtime model as
-- grocery_checks. 'have' items drop out of the shared/exported list;
-- 'partial' items stay but carry a note.
--
-- grocery_items: free-text items the user types at the bottom of the list
-- ("Other" section). Their checkbox state reuses grocery_checks with
-- item_key 'custom:{id}'.

create table pantry_marks (
  household_id uuid not null references households on delete cascade,
  week_start date not null,
  item_key text not null,
  state text not null check (state in ('have', 'partial')),
  marked_by uuid references auth.users,
  marked_at timestamptz not null default now(),
  primary key (household_id, week_start, item_key)
);

alter table pantry_marks enable row level security;
create policy pantry_all on pantry_marks for all
  using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));
alter publication supabase_realtime add table pantry_marks;

create table grocery_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  week_start date not null,
  label text not null,
  created_by uuid references auth.users,
  created_at timestamptz not null default now()
);

alter table grocery_items enable row level security;
create policy grocery_items_all on grocery_items for all
  using (household_id in (select my_household_ids()))
  with check (household_id in (select my_household_ids()));
alter publication supabase_realtime add table grocery_items;
