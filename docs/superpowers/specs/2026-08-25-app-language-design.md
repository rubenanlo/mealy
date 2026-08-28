# App interface language (sub project A of the language initiative)

Status: approved (design), implementing
Date: 2026-08-25
Sequence: A (this) → B multilingual recipes → C employee link language.

## Problem

The app has no i18n at all: every user facing string is hardcoded English across ~41
files (~250 strings). The user wants a language setting under Settings → Manage your
account, choosing between English, Spanish, French, and Italian, changing the whole
app's interface language.

## Decisions (locked)

- **Mechanism:** a small typed dictionary module of our own (`app/src/lib/i18n.tsx`),
  no i18n library. Typed keys: `en` is the source of truth, `es`/`fr`/`it` are typed as
  `typeof en`, so a missing translation is a compile error. A tiny `{name}` interpolation
  helper. A `LanguageProvider` at the root re renders the app on change.
- **Storage:** Supabase auth user metadata (`updateUser({ data: { locale } })`) so the
  choice follows the account, plus an AsyncStorage cache so the app boots in the right
  language before the session restores. No DB migration. First default: device language
  via expo-localization when it is one of the four, else English.
- **Translations:** Claude generates ES/FR/IT; corrections are later edits to one file.
- **Scope:** UI chrome only. Recipe content stays in its stored language (sub project B).
  The employee web page is untouched (sub project C).

## Architecture

- `app/src/lib/i18n/` — one strings module per namespace (e.g. `common.ts`, `plan.ts`,
  `recipe.ts`, `settings.ts`, …), each exporting `{ en, es, fr, it }` where the non
  English languages are typed against `en`. `app/src/lib/i18n.tsx` merges them, holds
  the provider (`LanguageProvider`), the hook (`useI18n()` → `{ locale, setLocale, t }`),
  and `translate(dict, key, params)` used by `t`.
- Day and slot names: the dictionaries carry `days` (7 strings) and slot labels; screens
  read them via the hook instead of `DAY_LABELS`/`SLOT_LABELS` (which stay for logic and
  non app consumers).
- Without a provider (tests), the hook falls back to English, so existing component tests
  keep passing unchanged.
- Selector UI: a Language section in `settings/account.tsx` with four rows (English,
  Español, Français, Italiano); tapping applies immediately and persists.

## Testing

Unit tests for lookup per language, `{param}` interpolation, English fallback for a
missing key, and locale persistence (AsyncStorage mocked by jest setup). Existing
component tests stay green because tests default to English. Typecheck enforces
dictionary completeness.

## Out of scope

Recipe content translation, backfill, employee page language (B and C). RTL. Plural
rules beyond simple templates.
