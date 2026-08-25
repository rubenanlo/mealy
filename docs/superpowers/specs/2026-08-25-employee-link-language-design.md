# Employee link language (sub project C of the language initiative)

Status: implemented
Date: 2026-08-25
Sequence: A app language (done) → B multilingual recipes (done) → C (this).

## Problem

The employee cooking page (edge function `employee-menu`, served via the Cloudflare
proxy) rendered stored recipe content verbatim under hardcoded English chrome. The
family owner should choose, per person, which language the cooking link serves.

## Design

- **Schema (migration 0022, deployed):** `persons.link_language text not null
  default 'es' check (in en/es/fr/it)`. Default Spanish: the page exists for the
  household's Spanish speaking employee.
- **Picker:** in the person editor (`settings/person/[id].tsx`), inside the Web access
  section next to Share cooking link, a four chip row (English/Español/Français/
  Italiano) persisting immediately, since the shared page reads it live. Only visible
  for employees with a share token, like the rest of the section.
- **Edge function (v5, deployed, verify_jwt off as before):** selects `link_language`,
  overlays each recipe's `recipe_translations` row for that locale (title, ingredients,
  steps; fallback to original when absent), and renders all chrome (days, slots,
  headings, meta, empty states, not found page) from an in function four language
  dictionary. `<html lang>` follows the choice. Free text `custom_title` meals and
  family authored employee notes render verbatim (user data).

## Testing

Deploy smoke tested through the proxy (invalid token renders the Spanish not found
page). Full content check follows the backfill: open the link, confirm recipes render
in the chosen language, switch the chip and reload.
