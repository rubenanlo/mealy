-- AI week planning (2026-11-15): the employee may prepare only part of a
-- dish ("roast the vegetables, we bake the salmon"). The part she does is the
-- entry's `instructions` (0031); this flag says the note is a partial job, so
-- the app and her page can label it "Part of it" instead of the whole dish.

alter table plan_entries add column cook_part boolean not null default false;
