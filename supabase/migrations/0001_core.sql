-- Mealy core schema — Phase 1 spine (plan Task 2)
create type meal_slot as enum ('lunch','dinner');
create type cook_type as enum ('family','employee');
create type source_kind as enum ('url','reel','photo','pdf','paste');
create type plan_status as enum ('draft','approved');

create table households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  other_requirements text not null default '',
  created_at timestamptz not null default now()
);

create table persons (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  name text not null,
  is_employee boolean not null default false,
  diet_profile jsonb not null default '{}',
  other_requirements text not null default '',
  created_at timestamptz not null default now()
);

create table household_members (
  user_id uuid primary key references auth.users on delete cascade,
  household_id uuid not null references households on delete cascade,
  person_id uuid references persons on delete set null,
  role text not null default 'member' check (role in ('owner','member'))
);

create table invites (
  email text primary key,
  household_id uuid not null references households on delete cascade,
  person_id uuid references persons on delete set null,
  role text not null default 'member' check (role in ('owner','member')),
  created_at timestamptz not null default now()
);

-- invite-only: on signup, attach the user to their invited household
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare inv invites%rowtype;
begin
  select * into inv from invites where email = new.email;
  if found then
    insert into household_members(user_id, household_id, person_id, role)
    values (new.id, inv.household_id, inv.person_id, inv.role);
  end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

create table recipes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  title text not null,
  language text not null default 'fr',
  servings int,
  prep_minutes int,
  cook_minutes int,
  dish_type text,
  tags text[] not null default '{}',
  ingredients jsonb not null default '[]',
  steps jsonb not null default '[]',
  nutrition jsonb,
  seasonality real[],
  cover_image_path text,
  needs_review boolean not null default false,
  created_by uuid references auth.users,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- VERBATIM LAYER — immutable by trigger
create table recipe_sources (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes on delete cascade,
  kind source_kind not null,
  url text,
  verbatim jsonb not null,
  media_paths text[] not null default '{}',
  captured_at timestamptz not null default now()
);
create or replace function forbid_source_mutation() returns trigger
language plpgsql as $$ begin raise exception 'recipe_sources is immutable'; end $$;
create trigger recipe_sources_immutable before update on recipe_sources
  for each row execute function forbid_source_mutation();

create table recipe_images (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes on delete cascade,
  storage_path text not null,
  position int not null default 0,
  is_cover boolean not null default false
);

create table meal_plans (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households on delete cascade,
  week_start date not null,
  status plan_status not null default 'draft',
  created_at timestamptz not null default now(),
  unique (household_id, week_start)
);

create table plan_entries (
  id uuid primary key default gen_random_uuid(),
  meal_plan_id uuid not null references meal_plans on delete cascade,
  day smallint not null check (day between 0 and 6),
  slot meal_slot not null,
  recipe_id uuid not null references recipes,
  person_ids uuid[] not null default '{}',
  assigned_cook cook_type not null default 'family',
  position int not null default 0
);

create table events (
  id bigint generated always as identity primary key,
  household_id uuid not null references households on delete cascade,
  person_id uuid references persons,
  recipe_id uuid references recipes,
  type text not null,
  meta jsonb not null default '{}',
  at timestamptz not null default now()
);

create or replace function my_household_ids() returns setof uuid
language sql security definer stable set search_path = public as
$$ select household_id from household_members where user_id = auth.uid() $$;

alter table households enable row level security;
alter table persons enable row level security;
alter table household_members enable row level security;
alter table invites enable row level security;
alter table recipes enable row level security;
alter table recipe_sources enable row level security;
alter table recipe_images enable row level security;
alter table meal_plans enable row level security;
alter table plan_entries enable row level security;
alter table events enable row level security;

create policy hh_all on households for all
  using (id in (select my_household_ids()));
create policy persons_all on persons for all
  using (household_id in (select my_household_ids()));
create policy members_self on household_members for select
  using (user_id = auth.uid() or household_id in (select my_household_ids()));
create policy invites_owner on invites for all
  using (household_id in (select my_household_ids()));
create policy recipes_all on recipes for all
  using (household_id in (select my_household_ids()));
create policy sources_all on recipe_sources for all
  using (recipe_id in (select id from recipes where household_id in (select my_household_ids())));
create policy images_all on recipe_images for all
  using (recipe_id in (select id from recipes where household_id in (select my_household_ids())));
create policy plans_all on meal_plans for all
  using (household_id in (select my_household_ids()));
create policy entries_all on plan_entries for all
  using (meal_plan_id in (select id from meal_plans where household_id in (select my_household_ids())));
create policy events_all on events for all
  using (household_id in (select my_household_ids()));

insert into storage.buckets (id, name, public) values ('recipe-media','recipe-media', false);
create policy media_rw on storage.objects for all
  using (bucket_id = 'recipe-media' and auth.uid() is not null)
  with check (bucket_id = 'recipe-media' and auth.uid() is not null);
