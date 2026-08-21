# Recipe quality & detail-screen design

**Date:** 2026-08-21
**Status:** Draft for review
**Scope:** Recipe extraction/classification quality, the recipe detail screen editing UX, the Library quick-filter chips, and two backend-touching features (web image replace, FODMAP swaps).

---

## 0. Context & principles

- The app is Expo SDK 54 (Expo Go compatible — no new native modules without checking).
- The Python worker (`worker/`) is a stateless capture service; the Expo app (`app/`) owns all Supabase persistence.
- `recipe_sources.verbatim` is **immutable** (DB trigger) and re-generatable; the structured `recipes` row (title, ingredients, steps, servings, tags, cover) is the editable layer.
- Every capture today is a single recipe. All current recipes are `photo` captures where `recipe_sources.media_paths` == `recipe_images` (verified via DB).
- Build order is chosen so shared surfaces (the `recipes.ingredients` JSONB, the image pipeline) are touched in a coherent sequence.

Two features are **backend-touching** and larger: **Part 7 (web image replace)** and **Part 9 (FODMAP swaps)**. Everything else is app-only.

---

## Part 1 · Protein classification from ingredients

**Root cause.** Category is a naive string check `tags.includes('meat')` (`app/src/lib/category.ts:28`) against free-form `tags`. The extraction model is never asked to emit `"meat"` (`worker/.../models.py:33`), and the URL path hardcodes `tags=[]`. The canonical table already knows `boeuf→meat`, `saumon→fish` (`canonical_ingredients.category`) but that field is read nowhere.

**Approach (compute at render, no DB column).**

- New pure helper `proteinCategoryFromIngredients(ingredients, canonicalIndex): ProteinCategory | null` — maps each ingredient name → canonical row via existing `normalizeRaw` + `matchCanonical` (local exact/alias, no LLM), reads `.category`, returns the highest-priority protein (fish > meat > vegetarian > legume).
- New hook `useCanonicalIndex()` resolves the already-cached `loadCanonicalIngredients()` promise into state; returns `null` until loaded.
- Shared resolver: `useProteinCategory(recipe)` → uses the ingredient-derived category when the index is ready, falls back to tag-based `deriveCategory(recipe.tags)` otherwise (nothing regresses).
- Consumers switched: `recipe/[id]`, `recipe-cards`, `plan`, `search`, `quotas`.
- **Data-flow change:** add `ingredients` to the `search` and `plan` (and `library`) `.select(...)` — those queries only fetch `tags` today.

**Files:** `app/src/lib/category.ts` (helper), a new `app/src/lib/use-canonical.ts` (hook), the 5 consumers, the 3 list queries.
**DB:** none.
**Testing:** extend `category.test.ts` — French ingredient names → correct protein, priority order, tag fallback; a `quotas` counting test.

---

## Part 2 · Library quick-filter chips

**Goal.** A horizontal chip row at the top of Library (`app/src/app/(tabs)/library/index.tsx`); scrollbar hidden. Chips: **Under 30 min · FODMAP-friendly · Meat · Fish · Vegetarian · Needs review**. Stackable (multi-select), filter in place.

**Approach.**

- New `QuickFilters` component (chip row, accent fill when active).
- When any chip is active, the sectioned feed collapses into one filtered list; clear all → sections return.
- Pure predicate `matchesQuickFilters(recipe, active, derived)`:
  - `under30` → `prep_minutes <= 30`; `needsReview` → `needs_review`; protein → `useProteinCategory` result; `fodmapFriendly` → no high-FODMAP ingredient (reuses Part 1 data + `computeRecipeFodmap`).
  - **Protein chips combine as OR within their group; all other chips AND across groups** (else Meat+Fish is always empty).
- Empty result → `EmptyState`.

**Files:** new `app/src/components/quick-filters.tsx`, new `app/src/lib/quick-filters.ts` (predicate), `library/index.tsx`.
**DB:** none (needs `ingredients` in the library query — shared with Part 1).
**Testing:** unit-test the predicate (compose logic + protein-OR rule).

---

## Part 3 · Servings: tap to edit, rescale ingredients

**Goal.** The servings in the meta line becomes tappable → edit servings → ingredient quantities rescale by `new/old`.

**Approach.**

- Wrap the servings meta text in a `Pressable` → small inline number editor (or a compact prompt).
- On save: `factor = newServings / oldServings`; for each ingredient with a numeric `quantity`, `quantity = round(quantity * factor)` (sensible rounding per unit). Persist `recipes.servings` and `recipes.ingredients`.
- **Decision:** the parsed `quantity` rescales and shows as the primary amount; the original `raw` line (verbatim source text) is left unchanged — it is the source of truth for what was captured. Ingredients with no numeric quantity (e.g. "sel") are untouched.

**Files:** `recipe/[id].tsx` (meta line + a small servings editor), reuse the existing save path.
**DB:** none.
**Testing:** a pure `rescaleIngredients(ingredients, factor)` unit test (numeric scaling, null-quantity passthrough, rounding).

---

## Part 4 · Hero image: enlarge + reposition + replace

**Decisions.** Tap = enlarge (already shipped). Add a small **edit button overlaid on the hero** for reposition & replace. Replace sources: captured images, photo library, **and** web (og:image / paste URL).

**Approach.**

- Small circular edit/camera button on the hero (top-right area, clear of the bookmark chip) → an action sheet: **Reposition · Choose from captured · Choose from library · From the web**.
- **Reposition (Notion-style):** a full-width editor where the image can be panned vertically within the 4:3 frame; save a focal offset. Requires storing the offset.
- **Replace:**
  - _Captured_ → set an existing `recipe_images` path as cover.
  - _Library_ → `expo-image-picker`, upload to storage, set as cover (+ add to `recipe_images`).
  - _Web_ → fetch the source page's `og:image` (Part 7) or paste an image URL; validate; upload; set as cover.
- All replace paths update `recipes.cover_image_path` and validate the image loads (Part 7 util).

**Files:** `recipe/[id].tsx` (`Hero`), new `app/src/components/cover-editor.tsx` (reposition), an image-replace action module.
**DB:** **migration** — add a cover focal offset, e.g. `recipes.cover_focal_y real default 0.5` (or a `cover_crop jsonb`). Hero rendering applies the offset via `expo-image` `contentPosition`.
**Testing:** unit-test the offset clamp/serialize; the replace-from-captured path (mock storage).

---

## Part 5 · Inline editing: pencil on Ingredients & Steps; remove bottom Edit button

**Goal.** A pencil icon on the **Ingredients** header and the **Steps** header toggles inline edit for that section (edit text, add/remove/reorder rows). The single bottom **Edit** button is removed. The existing title/servings/prep/cook edit fields move into the relevant inline editors (title → header, servings → Part 3).

**Approach.**

- `Ingredients` header row: title + pencil `Pressable`. In edit mode, each ingredient becomes an editable `Field` with add/delete; save writes `recipes.ingredients`.
- `Steps` header row: same for `recipes.steps` (string array).
- Remove the `Edit`/`Save`/`Cancel` block at the bottom and the `editing`-gated form; per-section edit state replaces the global `editing` flag.
- **Interaction note:** Part 3 (servings), Part 5 (ingredients), and Part 6 (re-extract) all write `recipes.ingredients`/`servings` — they share one `saveRecipe(patch)` helper to avoid divergent writes.

**Files:** `recipe/[id].tsx` (restructure the edit flow), possibly a small `EditableList` helper.
**DB:** none.
**Testing:** editor add/remove/reorder reducer unit test; save-patch shape test.

---

## Part 6 · Re-extract a recipe (confirm before replacing)

**Root cause.** JSON-LD/scraper paths hardcode `confidence=1.0` and bypass review; there's no way to re-run extraction on a saved recipe.

**Approach.**

- Worker: expose `POST /structure` taking a stored `Verbatim` → returns a fresh `CanonicalRecipe` (reuses `structure_text`). Stop hardcoding `confidence=1.0` — validate ingredients+steps exist first.
- App: a **Re-extract** action → calls the worker with the recipe's immutable `verbatim` → shows the new result in a confirm sheet → on confirm, `saveRecipe(...)` the structured layer (sources untouched). Cancel discards.

**Files:** `worker/.../main.py` + `structure.py`; `app/src/lib/worker.ts`; `recipe/[id].tsx` (action + confirm sheet).
**DB:** none.
**Testing:** worker test for `/structure`; app test for confirm-then-replace (mock worker).

---

## Part 7 · Image quality at capture (og:image + validation)

**Root cause.** `og:image`/`twitter:image` are never scraped; extracted images have no validation; cover = "first https URL".

**Approach.**

- Worker: add `og:image`/`twitter:image` extraction in `ingest/url.py` as a candidate source; add an image-validation util (decodes + min 500×350, downscale to 1600) ported from `companion/set_cover.py`; cover = first **validated** image.
- Shared with Part 4's web-replace (same fetch + validate util).
- **Explicitly out of scope:** auto-splitting multi-dish captures. Curation + manual replace (Part 4) is the fix for "multiple pics / bad pics".

**Files:** `worker/.../ingest/url.py`, a new `worker/.../images.py` util; `app/src/lib/worker.ts` cover selection.
**DB:** none.
**Testing:** worker tests for og:image extraction + validation reject/accept.

---

## Part 8 · "Make FODMAP" button (suggest low-FODMAP swaps)

**Decision.** A small button next to the servings/time meta line → **suggests low-FODMAP substitutions** for the recipe's problem ingredients (adapt-the-recipe).

**Approach.**

- Identify high/moderate-FODMAP ingredients via `computeRecipeFodmap` + canonical `fodmap_tier`.
- Worker: a `POST /fodmap-swaps` route (model call) that, given the flagged ingredients + recipe context, proposes low-FODMAP substitutes with amounts.
- App: button → calls worker → shows suggested swaps in a sheet → user can apply (writes edited ingredients via `saveRecipe`) or dismiss. Applying is an edit, not a new recipe.
- **This is the largest/most speculative feature** — recommend building it last, after the deterministic parts land.

**Files:** `worker/.../main.py` + a new `fodmap.py` (worker); `app/src/lib/worker.ts`; `recipe/[id].tsx` (button + sheet).
**DB:** none (suggestions are ephemeral; applying reuses the edit path).
**Testing:** worker test for `/fodmap-swaps` (mock model); app test for apply flow.

---

## Build order

1. **Part 1** — protein classification (keystone; de-risks 2 & 8)
2. **Part 2** — quick-filter chips (visible payoff on Part 1)
3. **Part 3** — servings rescale
4. **Part 5** — inline pencil editing + remove Edit button (establishes shared `saveRecipe`)
5. **Part 4** — hero reposition/replace (app parts) — web-replace waits on Part 7
6. **Part 6** — re-extract
7. **Part 7** — image quality + og:image (unblocks Part 4 web-replace)
8. **Part 8** — FODMAP swaps (last; largest, model-dependent)

Each part lands as its own commit with green `tsc` + tests.

---

## Migrations summary

- **Part 4:** add `recipes.cover_focal_y real default 0.5` (or `cover_crop jsonb`). All other parts: none.

---

## Open questions for review

1. **Part 3 rounding:** round scaled quantities to whole numbers, or keep 1 decimal for small amounts (e.g. 0.5 tsp)? - keep 1 decimal for small amounts
2. **Part 4 reposition:** vertical-only pan (simplest for a 4:3 frame) — acceptable, or do you want free X/Y like Notion? free x/y
3. **Part 8 apply:** when applying a FODMAP swap, replace the ingredient in place — should it also adjust the affected step text, or leave steps untouched? change the affected steps to reflect the new ingredients
