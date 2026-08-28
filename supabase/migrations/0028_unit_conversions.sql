-- AI unit-classification cache (groceries aggregation). Units the static
-- tables in app/src/lib/aggregate.ts don't know are classified once by the
-- worker LLM (/units/classify) and cached here for everyone — same shape of
-- reasoning as ingredient_matches. kind null = the model could not classify
-- it (cached negative, so we never re-ask).

create table unit_conversions (
  unit text primary key,  -- trimmed, lowercased unit string
  kind text check (kind in ('mass', 'volume', 'count')),
  -- g per unit (mass) or ml per unit (volume); null for count/unknown
  factor numeric,
  matched_by text not null default 'llm',
  created_at timestamptz not null default now()
);

alter table unit_conversions enable row level security;

-- reference data: readable/insertable by any signed-in user (like matches)
create policy units_read on unit_conversions for select
  using (auth.uid() is not null);
create policy units_insert on unit_conversions for insert
  with check (auth.uid() is not null);
