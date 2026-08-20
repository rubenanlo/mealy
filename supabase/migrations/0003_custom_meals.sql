-- Plan entries can be a free-text meal instead of a library recipe
alter table plan_entries alter column recipe_id drop not null;
alter table plan_entries add column custom_title text;
alter table plan_entries add constraint plan_entries_meal_present
  check (recipe_id is not null or (custom_title is not null and length(trim(custom_title)) > 0));
