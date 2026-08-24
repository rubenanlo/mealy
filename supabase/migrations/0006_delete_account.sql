-- Account deletion (2026-08-24): auth.users FKs must not block
-- auth.admin.deleteUser. Authorship/audit columns keep the row, lose the user.

alter table recipes
  drop constraint recipes_created_by_fkey,
  add constraint recipes_created_by_fkey
    foreign key (created_by) references auth.users on delete set null;

alter table grocery_checks
  drop constraint grocery_checks_checked_by_fkey,
  add constraint grocery_checks_checked_by_fkey
    foreign key (checked_by) references auth.users on delete set null;
