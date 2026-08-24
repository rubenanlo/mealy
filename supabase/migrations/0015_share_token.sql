-- Employee web access (2026-08-24, spec §10 sub-project 2 v1): each person
-- carries an unguessable token; the employee-menu edge function serves the
-- household's employee-assigned meals to whoever holds an employee's token.

alter table persons
  add column share_token uuid not null default gen_random_uuid();

create unique index persons_share_token_idx on persons (share_token);
