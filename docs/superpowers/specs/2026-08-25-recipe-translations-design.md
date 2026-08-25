# Multilingual recipes (sub project B of the language initiative)

Status: approved (design), implementing
Date: 2026-08-25
Sequence: A app language (done) → B (this) → C employee link language.

## Problem

Recipes store content in exactly one language (`recipes.language`, set by ingestion;
live data holds ca/en/es/fr across 171 recipes). The user wants every recipe available
in EN/ES/FR/IT, displayed in the app's active language, with existing recipes backfilled.
Translations must be faithful and complete: nothing added, dropped, summarized, or
reworded beyond the language change. The verbatim captured source is never translated
(immutable by design and DB trigger); translations are a derived layer, regenerable at
any time, like canonical is derived from verbatim.

## Decisions

- **Storage:** new table `recipe_translations(recipe_id, locale, title, ingredients
  jsonb, steps jsonb, translated_at)`, PK `(recipe_id, locale)`. Rows exist for the four
  supported locales minus the recipe's own (normalized) language; a recipe whose source
  language is outside the four (e.g. Catalan) gets all four. Display picks the active
  locale's row and falls back to the original content when the row is absent (not yet
  translated, or the active locale is the original). RLS mirrors recipe_sources: rows
  visible when the recipe's household is the caller's.
- **Translator:** a new worker endpoint `POST /translate` cloning the fodmap.py forced
  tool-use pattern. Input: title, ingredients, steps, stated language. Output: detected
  `source_language` (2-letter, lowercased) plus per-target `{title, ingredients, steps}`.
  One Claude call translates all targets, enforcing: same number of ingredients and
  steps, same order; translate `raw`, `name`, `unit`, `group`; copy `quantity` and
  `fodmap` unchanged; no additions or omissions.
- **When translation happens:** fire-and-forget from the app, never blocking UX.
  Triggers: after capture persists a recipe; when a manual recipe is finished (Done or
  assigned to a slot); after any edit that touches title/ingredients/steps (saveRecipe),
  which replaces all translation rows so they never go stale. Until rows arrive the app
  shows the original. If the detected source language differs from `recipes.language`,
  the app updates that column.
- **Display:** `localizeRecipe`/`localizedTitle` helpers pick translation vs original.
  The recipe detail screen fetches the active locale's translation row alongside
  sources/images. List surfaces (library, search, folder, plan, add-to-week/save-sheet)
  embed `recipe_translations(locale, title)` in their recipe selects and localize titles.
  Groceries keeps original ingredient names for aggregation/FODMAP matching (canonical
  matching is name-based); a localized shopping list is an explicit follow-up, not B.
- **Backfill:** one-time, in-session: for each of the 171 recipes lacking rows, generate
  the same-fidelity translations and upsert via the Supabase MCP, batched by subagents
  using the identical instruction the worker prompt encodes. Repeatable later via the
  worker endpoint if ever needed.

## Testing

Worker: pytest for the translate module (request text building, response validation)
mirroring the fodmap tests with a mocked Anthropic client. App: unit tests for the
localization helpers and the upsert payload; screens verified by typecheck plus the
existing suites; live flows verified on device. Backfill verified by SQL counts
(rows per locale) and spot reads.

## Out of scope

Employee page language (C). Localized grocery aggregation. Translating verbatim
sources. UI to hand-edit a translation (edit the original; translations regenerate).
