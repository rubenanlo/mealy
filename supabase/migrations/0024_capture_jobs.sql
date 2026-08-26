-- Background capture (spec: true background capture). The app inserts a job
-- row and pings the worker; the worker (service role) runs the ingestion
-- pipeline and writes the recipe rows itself, so a capture survives the app
-- closing mid-import. Photos/PDF keep the synchronous path (files cannot
-- ride a text job).

create table capture_jobs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references households(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('url', 'social', 'text')),
  input text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  -- machine-readable code ('no_recipe') or a truncated exception message
  error text,
  recipe_id uuid references recipes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table capture_jobs enable row level security;

create policy capture_jobs_all on capture_jobs for all
  using (household_id in (select my_household_ids()));
