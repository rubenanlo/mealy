-- 0022: per-person cooking-link language (sub project C of the language
-- initiative). The employee page serves recipe content translated to this
-- locale (falling back to the original) with chrome localized to match.
-- Default 'es': the page exists for the household's Spanish-speaking employee.

alter table persons add column link_language text not null default 'es'
  check (link_language in ('en','es','fr','it'));
