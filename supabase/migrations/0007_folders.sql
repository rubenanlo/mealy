-- Recipe folders (spec 2026-08-24): per-user folders, household-readable.

create table folders (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (owner_id, name)
);

create table folder_recipes (
  folder_id uuid not null references folders on delete cascade,
  recipe_id uuid not null references recipes on delete cascade,
  added_at timestamptz not null default now(),
  primary key (folder_id, recipe_id)
);

alter table folders enable row level security;
alter table folder_recipes enable row level security;

-- Household members read; only the owner writes.
create policy folders_read on folders for select
  using (household_id in (select my_household_ids()));
create policy folders_insert on folders for insert
  with check (owner_id = auth.uid() and household_id in (select my_household_ids()));
create policy folders_update on folders for update
  using (owner_id = auth.uid());
create policy folders_delete on folders for delete
  using (owner_id = auth.uid());

create policy folder_recipes_read on folder_recipes for select
  using (folder_id in (select id from folders where household_id in (select my_household_ids())));
create policy folder_recipes_insert on folder_recipes for insert
  with check (folder_id in (select id from folders where owner_id = auth.uid()));
create policy folder_recipes_delete on folder_recipes for delete
  using (folder_id in (select id from folders where owner_id = auth.uid()));
