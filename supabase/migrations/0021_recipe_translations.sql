-- 0021: derived translation layer for recipe content (spec:
-- docs/superpowers/specs/2026-08-25-recipe-translations-design.md).
-- Rows exist per supported locale except the recipe's own language; display
-- falls back to the original when a row is absent. Verbatim is never translated.

create table recipe_translations (
  recipe_id     uuid not null references recipes on delete cascade,
  locale        text not null check (locale in ('en','es','fr','it')),
  title         text not null,
  ingredients   jsonb not null default '[]',
  steps         jsonb not null default '[]',
  translated_at timestamptz not null default now(),
  primary key (recipe_id, locale)
);

alter table recipe_translations enable row level security;

create policy translations_all on recipe_translations for all
  using (recipe_id in (select id from recipes where household_id in (select my_household_ids())));
