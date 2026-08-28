-- "Groceries and errands": a custom list item can name the person
-- responsible for getting it. Optional; unassigned items belong to everyone.

alter table grocery_items
  add column person_id uuid references persons(id) on delete set null;
