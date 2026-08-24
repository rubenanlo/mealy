-- Employee instructions (2026-08-24): free-form checklist items for the
-- employee, per week, shown under "Assigned to …" and on her web link.

alter table meal_plans
  add column employee_notes jsonb not null default '[]';
