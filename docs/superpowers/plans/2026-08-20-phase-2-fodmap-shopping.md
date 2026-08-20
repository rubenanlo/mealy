# Mealy Phase 2 — FODMAP + Shopping Aggregation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The curated, cited canonical-ingredient vocabulary with FODMAP tiers, seasons, and weights; ingredient→canonical matching; per-recipe FODMAP flags; and the real Groceries experience — merged quantities, grams-first, synced checkboxes, aisle groups, text export.

**Architecture:** A `canonical_ingredients` reference table (household-independent, readable by all users) seeded from published sources with per-row citations. Matching is layered: exact/alias match in a pure lib → worker LLM fallback for unmatched lines, cached per raw string in `ingredient_matches`. Aggregation is a pure lib over matched lines. Checkbox state moves from AsyncStorage to a `grocery_checks` table (realtime-synced). FODMAP flags computed per recipe from matched ingredients + the reference table — the LLM never assigns a tier (spec §4).

**Tech Stack:** unchanged (Supabase/Postgres, Python worker, Expo app).

**Spec:** `docs/spec.md` §4 (FODMAP), §9 (shopping list), §6 (seasonality curves — the `season` column feeds Phase 3).

## Global Constraints

- Every FODMAP row carries `source_url` + `source_note` (published Monash educational content or peer-reviewed literature only — never the Monash app's data). Unknown → tier `check`, never `low` (§4).
- FODMAP is dose-dependent: rows carry `low_serving_g` / `high_serving_g` thresholds where published; flags are per `(ingredient, quantity/servings)`.
- Aggregation never guesses: un-summable unit mixes are flagged, not forced (§9).
- Disclaimer copy ships with the first FODMAP-flag UI: best-effort, not medical advice.
- App work (Tasks 6–8) MUST NOT start until the v2 design agent has finished and committed; backend tasks (1–5) are independent.

## File Structure

```
supabase/migrations/0002_canonical_fodmap.sql   # Task 1
supabase/seed/canonical_ingredients.json        # Task 2 (curated, cited)
worker/src/mealy_worker/matching.py             # Task 4 — LLM fallback matcher
worker/tests/test_matching.py
app/src/lib/canonical.ts                        # Task 3 — exact/alias matcher (pure)
app/src/lib/aggregate.ts                        # Task 5 — merge + sum + grams (pure)
app/src/lib/fodmap.ts                           # Task 5 — per-recipe flag computation (pure)
app/src/app/(tabs)/groceries/index.tsx          # Task 6 — aggregated view, synced checks
app/src/app/(tabs)/library/[id].tsx             # Task 7 — FODMAP flags on detail
app/src/lib/export.ts                           # Task 8 — plain-text share
```

### Task 1: Schema — reference + matching + sync tables

`0002_canonical_fodmap.sql`:
- `canonical_ingredients(id uuid pk, slug text unique, name_en text, name_fr text, name_es text, aliases text[] default '{}', category text, aisle text, season real[] null /*12-month*/, fodmap_tier text check (fodmap_tier in ('low','moderate','high','check')) default 'check', fodmap_groups text[] default '{}', low_serving_g real, high_serving_g real, avg_unit_weight_g real, density_g_per_ml real, source_url text, source_note text, verified boolean default false)`. RLS: `select` for all authenticated users; writes service-only.
- `ingredient_matches(raw_normalized text pk, canonical_id uuid references canonical_ingredients, confidence real, matched_by text check (matched_by in ('exact','alias','llm','user')), created_at)`. RLS: authenticated read/insert; user corrections update `matched_by='user'`.
- `grocery_checks(household_id uuid references households, week_start date, item_key text, checked_by uuid references auth.users, checked_at timestamptz default now(), primary key (household_id, week_start, item_key))`. RLS household-scoped. Realtime enabled.
- Apply via MCP, commit file.

### Task 2: Curated seed — ~150 starter rows

Curation agent produces `supabase/seed/canonical_ingredients.json`: the ~150 most common French home-cooking ingredients (produce, proteins, dairy, pantry, herbs), each with FR/EN/ES names, aliases (incl. plural/prep variants), category, Mon Marché-style aisle, season curve for produce, FODMAP tier + groups + serving thresholds **with real citations** (Monash blog/public articles, peer-reviewed papers), avg unit weight / density where relevant. Rows without a findable citation get tier `check` and `source_note: 'no public source found'`. Insert via `execute_sql` batches; `verified=false` throughout (user validates over time, §4).

### Task 3: Pure matcher (app lib)

`canonical.ts`: `normalizeRaw(raw)` (lowercase, strip quantities/prep words/accents, singularize FR plurals) and `matchCanonical(normalized, table)` → exact slug/name → aliases → null. Jest: "200 g de carottes râpées"→carotte; "Oignons émincés"→oignon; unknown→null.

### Task 4: Worker LLM fallback matcher

`POST /match/ingredients {lines: [raw], candidates: [slug]}` → for lines the pure matcher missed, one Claude call maps each to a candidate slug or `null` (forced schema, may only answer from candidates — never invent). Tests mock the LLM; assert unknown stays null and prompt contains raw lines verbatim.

### Task 5: Aggregation + FODMAP libs (pure, heavily tested)

`aggregate.ts`: group matched lines by canonical id; sum only compatible units (g+kg→g, ml+cl+l→ml, count+count); convert count→g via `avg_unit_weight_g`, ml→g via `density_g_per_ml` when present; output per item: `{canonical, grams|null, displayQty, parts: [{recipeTitle, qty}], mixed: bool}`; unmatched lines pass through under "Other". `fodmap.ts`: per recipe, per person profile: portion_g = qty/servings; tier vs thresholds; collect `{ingredient, tier, groups, drivingServing}`; stacking = same group from ≥2 low-tier sources → 'check' warning.

### Task 6: Groceries v2 (after design agent lands)

Aggregated view grouped by aisle (fallback "Other"), grams-first display (`displayQty`), expandable per-item parts ("300 g from Bolognese…"), mixed-unit rows show both quantities with a badge, checkboxes backed by `grocery_checks` with realtime subscription (optimistic local update), FODMAP dot on high/check items for FODMAP-mode members, "Unmatched" section preserved verbatim.

### Task 7: Recipe FODMAP flags

Detail screen: per-ingredient tier dots + a summary line per FODMAP-mode person ("High for Ana: onion, garlic"); disclaimer footnote on first flag; tap a flag → which ingredient + assumed serving (spec §4 transparency). Ingredient edit can correct the canonical match (`matched_by='user'`).

### Task 8: Text export

`export.ts` builds the WhatsApp/Notes text (aisle-grouped, checked items omitted, "— Mealy" footer); share via `Share.share`. Button in Groceries header.

## Self-Review
- §4 coverage: citations (T2), dose-dependence (T2/T5), LLM-never-classifies (T4 candidates-only), unknown→check (T2/T5), disclaimer+transparency (T7), user override (T7). §9: merge (T5), grams-first (T5/T6), no guessing (T5 mixed flag), aisles (T2/T6), realtime checks (T1/T6), export (T8). Deferred: Mon Marché deep-links (Phase 4).
