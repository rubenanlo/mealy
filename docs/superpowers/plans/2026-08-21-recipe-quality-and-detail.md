# Recipe Quality & Detail-Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix protein classification, add Library quick-filters, make the recipe detail screen fully editable in place (servings rescale, inline ingredient/step editing, hero reposition/replace), add re-extraction, capture-time image quality, and FODMAP swap suggestions.

**Architecture:** The Expo app (`app/`) owns all Supabase persistence; the Python FastAPI worker (`worker/`) stays a stateless service (extraction, image validation, FODMAP swaps). Classification is computed client-side from ingredients via the canonical table — no new DB columns except one (`recipes.cover_focal`).

**Tech Stack:** Expo SDK 54 / React Native 0.81 / TypeScript (jest-expo tests) · FastAPI + Pydantic + Anthropic SDK + Pillow (pytest) · Supabase (Postgres + Storage).

**Spec:** `docs/superpowers/specs/2026-08-21-recipe-quality-and-detail-design.md`

## Global Constraints

- Expo SDK 54 pinned (Expo Go compatible). **No new native modules.** Docs: https://docs.expo.dev/versions/v54.0.0/
- `recipe_sources` is immutable (DB trigger) — never UPDATE it. Only the `recipes` row is edited.
- Worker model id is exactly `claude-haiku-4-5` (match `structure.py`).
- App tests: `cd app && npx jest <file>` · typecheck: `cd app && npx tsc --noEmit` (run from `app/`).
- Worker tests: `cd worker && uv run pytest tests/ -q`.
- App test files live in `__tests__/` folders next to the code; worker tests in `worker/tests/`.
- Protein priority order everywhere: **fish > meat > vegetarian > legume**.
- Scaled quantities: **≥ 10 → integer; < 10 → 1 decimal** (user decision).
- Hero reposition is **free X/Y** (user decision). FODMAP swaps **rewrite affected steps** (user decision).
- Commit after every task; small commits; messages `feat(app): …` / `feat(worker): …` / `test: …` per repo convention. Do not push.
- The working tree may carry uncommitted session work — Task 0 commits it first.

---

### Task 0: Commit the in-flight lightbox / source-section work

The working tree already contains: `app/src/components/image-lightbox.tsx`, edits to `app/src/app/recipe/[id].tsx` (inline Original source, tappable hero/gallery, removed chevron + view toggle), `app/jest.setup.js` (gesture-handler/reanimated mocks), `app/src/components/__tests__/image-lightbox.test.tsx`, and the spec/plan docs.

- [ ] **Step 1: Verify clean state of the work**

Run: `cd app && npx tsc --noEmit && npx jest 2>&1 | tail -3`
Expected: TSC exit 0; all suites pass.

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat(app): source-image lightbox + inline Original source section

Tap any recipe image (hero or gallery) to open a full-screen pager with
pinch-zoom and swipe; Original source becomes an inline titled section
(link for url/reel captures, images otherwise); verbatim text blocks and
the separate source view/toggle are removed. Recipe scroll hides its bar."
```

---

### Task 1: `proteinCategoryFromIngredients` + `resolveProteinCategory` (pure)

**Files:**
- Modify: `app/src/lib/category.ts`
- Test: `app/src/lib/__tests__/category.test.ts`

**Interfaces:**
- Consumes: `normalizeRaw`, `matchCanonical`, `CanonicalIndex`, `CanonicalIngredient` from `@/lib/canonical` (existing).
- Produces: `proteinCategoryFromIngredients(ingredients: readonly NamedIngredient[], index: CanonicalIndex): ProteinCategory | null` and `resolveProteinCategory(tags: readonly string[], ingredients: readonly NamedIngredient[] | null | undefined, index: CanonicalIndex | null): ProteinCategory | null`, plus `export interface NamedIngredient { raw?: string | null; name: string }`. Later tasks (2–4) call `resolveProteinCategory`.

- [ ] **Step 1: Write the failing tests** — append to `app/src/lib/__tests__/category.test.ts`:

```ts
import { buildCanonicalIndex, type CanonicalIngredient } from '../canonical';
import { proteinCategoryFromIngredients, resolveProteinCategory } from '../category';

function ing(slug: string, category: string | null, name_fr = slug): CanonicalIngredient {
  return {
    id: slug, slug, name_en: slug, name_fr, name_es: slug, aliases: [],
    category, aisle: null, season: null, fodmap_tier: 'low', fodmap_groups: [],
    low_serving_g: null, high_serving_g: null, avg_unit_weight_g: null,
    density_g_per_ml: null, verified: true,
  };
}

const INDEX = buildCanonicalIndex([
  ing('boeuf', 'meat'), ing('saumon', 'fish'), ing('lentille', 'legume'),
  ing('tofu', 'vegetarian'), ing('carotte', 'vegetable'),
]);

describe('proteinCategoryFromIngredients', () => {
  it('detects meat from a French raw line', () => {
    expect(
      proteinCategoryFromIngredients([{ raw: '400 g de boeuf haché', name: 'boeuf' }], INDEX)
    ).toBe('meat');
  });
  it('fish outranks meat (priority order)', () => {
    expect(
      proteinCategoryFromIngredients(
        [{ raw: '200 g de boeuf', name: 'boeuf' }, { raw: '1 pavé de saumon', name: 'saumon' }],
        INDEX
      )
    ).toBe('fish');
  });
  it('returns null when only non-protein ingredients match', () => {
    expect(proteinCategoryFromIngredients([{ raw: '2 carottes', name: 'carotte' }], INDEX)).toBeNull();
  });
  it('falls back to the name when raw does not match', () => {
    expect(proteinCategoryFromIngredients([{ raw: 'un beau morceau', name: 'boeuf' }], INDEX)).toBe('meat');
  });
});

describe('resolveProteinCategory', () => {
  it('ingredient-derived category wins over tags', () => {
    expect(resolveProteinCategory(['vegetarian'], [{ raw: '1 saumon', name: 'saumon' }], INDEX)).toBe('fish');
  });
  it('falls back to tags when no ingredient is a protein', () => {
    expect(resolveProteinCategory(['meat'], [{ raw: '2 carottes', name: 'carotte' }], INDEX)).toBe('meat');
  });
  it('falls back to tags when index is null', () => {
    expect(resolveProteinCategory(['fish'], [{ raw: '1 saumon', name: 'saumon' }], null)).toBe('fish');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd app && npx jest src/lib/__tests__/category.test.ts`
Expected: FAIL — `proteinCategoryFromIngredients` is not exported.

- [ ] **Step 3: Implement** — append to `app/src/lib/category.ts` (add the import at the top):

```ts
import { matchCanonical, normalizeRaw, type CanonicalIndex } from '@/lib/canonical';
```

```ts
export interface NamedIngredient {
  raw?: string | null;
  name: string;
}

const PROTEIN_SET: ReadonlySet<string> = new Set(PROTEIN_CATEGORIES);

/**
 * Derive the protein category from the ingredients themselves via the
 * canonical table (spec Part 1) — the tags-based path stays as fallback.
 */
export function proteinCategoryFromIngredients(
  ingredients: readonly NamedIngredient[],
  index: CanonicalIndex
): ProteinCategory | null {
  const found = new Set<string>();
  for (const item of ingredients) {
    const match =
      matchCanonical(normalizeRaw(item.raw || item.name), index) ??
      matchCanonical(normalizeRaw(item.name), index);
    const category = match?.ingredient.category;
    if (category && PROTEIN_SET.has(category)) found.add(category);
  }
  for (const category of PROTEIN_CATEGORIES) {
    if (found.has(category)) return category;
  }
  return null;
}

/** Ingredient-derived category wins; tags are the fallback (nothing regresses). */
export function resolveProteinCategory(
  tags: readonly string[],
  ingredients: readonly NamedIngredient[] | null | undefined,
  index: CanonicalIndex | null
): ProteinCategory | null {
  if (index && ingredients && ingredients.length > 0) {
    const derived = proteinCategoryFromIngredients(ingredients, index);
    if (derived) return derived;
  }
  return deriveCategory(tags);
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd app && npx jest src/lib/__tests__/category.test.ts && npx tsc --noEmit`
Expected: PASS, TSC exit 0.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(app): derive protein category from ingredients via canonical table"`

---

### Task 2: `useCanonicalIndex` hook + switch all category consumers

**Files:**
- Create: `app/src/lib/use-canonical.ts`
- Modify: `app/src/components/recipe-cards.tsx` (MetaLine + RecipeListItem), `app/src/app/recipe/[id].tsx:455`, `app/src/app/(tabs)/search/index.tsx` (query + filter), `app/src/app/(tabs)/plan/index.tsx` (query + two `deriveCategory` call sites + quota call), `app/src/app/(tabs)/library/index.tsx` (query), `app/src/lib/quotas.ts`
- Test: `app/src/lib/__tests__/quotas.test.ts` (extend)

**Interfaces:**
- Produces: `useCanonicalIndex(): CanonicalIndex | null` (module-level cache; resolves `loadCanonicalIngredients()` once). `QuotaRecipe` gains optional `category?: string | null`; counting rule becomes `category === target.category || tags.includes(target.category)`.
- Consumes: Task 1's `resolveProteinCategory`.

- [ ] **Step 1: Create `app/src/lib/use-canonical.ts`:**

```ts
import { useEffect, useState } from 'react';

import { buildCanonicalIndex, type CanonicalIndex } from '@/lib/canonical';
import { loadCanonicalIngredients } from '@/lib/matching';

let cachedIndex: CanonicalIndex | null = null;

/**
 * The canonical lookup index as React state. Resolves the session-cached
 * table once; returns null until loaded (callers fall back to tags).
 */
export function useCanonicalIndex(): CanonicalIndex | null {
  const [index, setIndex] = useState<CanonicalIndex | null>(cachedIndex);
  useEffect(() => {
    if (index) return;
    let cancelled = false;
    loadCanonicalIngredients()
      .then((table) => {
        cachedIndex = buildCanonicalIndex(table);
        if (!cancelled) setIndex(cachedIndex);
      })
      .catch(() => {
        // Table unreachable — tags-based fallback stays in effect.
      });
    return () => {
      cancelled = true;
    };
  }, [index]);
  return index;
}
```

- [ ] **Step 2: Extend the failing quotas test** — in `app/src/lib/__tests__/quotas.test.ts` add:

```ts
it('counts a recipe by derived category even when tags are empty', () => {
  const progress = quotaProgress(
    [{ recipe_id: 'r1', person_ids: [] }],
    'p1',
    [{ id: 'r1', tags: [], category: 'meat' }],
    [{ category: 'meat', min: 1, max: null }]
  );
  expect(progress[0].planned).toBe(1);
});
```

Run: `cd app && npx jest src/lib/__tests__/quotas.test.ts` → FAIL (TS: `category` not in `QuotaRecipe` / planned 0).

- [ ] **Step 3: Update `quotas.ts`:** add `category?: string | null;` to `QuotaRecipe`; build `const catById = new Map(recipes.map((r) => [r.id, r.category ?? null]));` and change the `planned` filter line to:

```ts
    planned: eaten.filter(
      (e) =>
        e.recipe_id !== null &&
        (catById.get(e.recipe_id) === target.category ||
          (tagsById.get(e.recipe_id) ?? []).includes(target.category))
    ).length,
```

Run the quotas test → PASS.

- [ ] **Step 4: Wire the consumers.** In each file:

1. **`recipe-cards.tsx`** — add to imports: `resolveProteinCategory` from `@/lib/category`, `useCanonicalIndex` from `@/lib/use-canonical`, `import type { IngredientRow as IngredientData } from '@/lib/worker';`. Add `ingredients?: IngredientData[];` to `RecipeListItem`. In `MetaLine`, replace `const category = deriveCategory(recipe.tags);` with:

```ts
  const index = useCanonicalIndex();
  const category = resolveProteinCategory(recipe.tags, recipe.ingredients, index);
```

(Keep the `deriveCategory` import only if still referenced; remove if unused.)

2. **`recipe/[id].tsx`** — add the same two imports; add `const canonicalIndex = useCanonicalIndex();` with the other hooks (top of `RecipeSheetScreen`); replace `const category = deriveCategory(recipe.tags);` with `const category = resolveProteinCategory(recipe.tags, recipe.ingredients, canonicalIndex);`.

3. **`search/index.tsx`** — add `ingredients` to the `.select(...)` column list; add `const index = useCanonicalIndex();` in the component; in the `filtered` memo replace `return deriveCategory(recipe.tags) === filter;` with `return resolveProteinCategory(recipe.tags, recipe.ingredients, index) === filter;` and add `index` to the memo deps.

4. **`plan/index.tsx`** — add `ingredients` to the recipes `.select('id, title, tags, cover_image_path')` list; add `const index = useCanonicalIndex();`; replace both `deriveCategory(...)` call sites (~lines 452, 607 — grep `deriveCategory`) with `resolveProteinCategory(<same>.tags ?? [], <same>.ingredients, index)` keeping surrounding logic identical. Where `quotaProgress` is called (~line 224), enrich the recipes array first:

```ts
  const quotaRecipes = recipes.map((r) => ({
    ...r,
    category: resolveProteinCategory(r.tags, r.ingredients, index),
  }));
```

and pass `quotaRecipes`. (The local recipe type in this file — grep `tags: string[]` near line 61 — needs `ingredients?: IngredientData[];` too.)

5. **`library/index.tsx`** — add `ingredients` to the `.select(...)` list (Task 4 consumes it).

- [ ] **Step 5: Full check**

Run: `cd app && npx tsc --noEmit && npx jest`
Expected: 0 TS errors, all suites pass.

- [ ] **Step 6: Commit** — `git commit -am "feat(app): ingredient-derived protein category across cards, detail, plan, search, quotas"`

---

### Task 3: `matchesQuickFilters` predicate (pure)

**Files:**
- Create: `app/src/lib/quick-filters.ts`
- Test: `app/src/lib/__tests__/quick-filters.test.ts`

**Interfaces:**
- Produces:

```ts
export type QuickFilter = 'under30' | 'fodmapFriendly' | 'meat' | 'fish' | 'vegetarian' | 'needsReview';
export interface QuickFilterInput {
  prep_minutes: number | null;
  needs_review: boolean;
  category: ProteinCategory | null;     // resolved by the caller (Task 2)
  fodmapFriendly: boolean | null;       // null = unknown → excluded by that chip
}
export function matchesQuickFilters(input: QuickFilterInput, active: ReadonlySet<QuickFilter>): boolean;
export const QUICK_FILTER_LABELS: Record<QuickFilter, string>;
```

- [ ] **Step 1: Failing test** — `app/src/lib/__tests__/quick-filters.test.ts`:

```ts
import { matchesQuickFilters, type QuickFilter } from '../quick-filters';

const base = { prep_minutes: 20, needs_review: false, category: 'meat' as const, fodmapFriendly: true };
const set = (...f: QuickFilter[]) => new Set<QuickFilter>(f);

describe('matchesQuickFilters', () => {
  it('empty set matches everything', () => {
    expect(matchesQuickFilters(base, set())).toBe(true);
  });
  it('under30 requires prep_minutes <= 30 and known', () => {
    expect(matchesQuickFilters(base, set('under30'))).toBe(true);
    expect(matchesQuickFilters({ ...base, prep_minutes: 45 }, set('under30'))).toBe(false);
    expect(matchesQuickFilters({ ...base, prep_minutes: null }, set('under30'))).toBe(false);
  });
  it('protein chips OR within the group', () => {
    expect(matchesQuickFilters(base, set('meat', 'fish'))).toBe(true);
    expect(matchesQuickFilters({ ...base, category: 'fish' }, set('meat', 'fish'))).toBe(true);
    expect(matchesQuickFilters({ ...base, category: null }, set('meat', 'fish'))).toBe(false);
  });
  it('groups AND across: under30 + vegetarian excludes a meat recipe', () => {
    expect(matchesQuickFilters(base, set('under30', 'vegetarian'))).toBe(false);
  });
  it('fodmapFriendly: unknown (null) is excluded', () => {
    expect(matchesQuickFilters({ ...base, fodmapFriendly: null }, set('fodmapFriendly'))).toBe(false);
    expect(matchesQuickFilters(base, set('fodmapFriendly'))).toBe(true);
  });
  it('needsReview matches the flag', () => {
    expect(matchesQuickFilters({ ...base, needs_review: true }, set('needsReview'))).toBe(true);
    expect(matchesQuickFilters(base, set('needsReview'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run** → FAIL (module missing).

- [ ] **Step 3: Implement `app/src/lib/quick-filters.ts`:**

```ts
import type { ProteinCategory } from '@/lib/category';

/** Home-feed quick filters (spec Part 2). Stackable; protein chips OR
 *  within their group, everything else ANDs across groups. */
export type QuickFilter = 'under30' | 'fodmapFriendly' | 'meat' | 'fish' | 'vegetarian' | 'needsReview';

export const QUICK_FILTER_LABELS: Record<QuickFilter, string> = {
  under30: 'Under 30 min',
  fodmapFriendly: 'FODMAP-friendly',
  meat: 'Meat',
  fish: 'Fish',
  vegetarian: 'Vegetarian',
  needsReview: 'Needs review',
};

export const QUICK_FILTERS: readonly QuickFilter[] = [
  'under30',
  'fodmapFriendly',
  'meat',
  'fish',
  'vegetarian',
  'needsReview',
];

const PROTEIN_FILTERS: readonly QuickFilter[] = ['meat', 'fish', 'vegetarian'];

export interface QuickFilterInput {
  prep_minutes: number | null;
  needs_review: boolean;
  category: ProteinCategory | null;
  /** null = not computable yet (no ingredients / index not loaded). */
  fodmapFriendly: boolean | null;
}

export function matchesQuickFilters(
  input: QuickFilterInput,
  active: ReadonlySet<QuickFilter>
): boolean {
  if (active.has('under30') && !(input.prep_minutes !== null && input.prep_minutes <= 30)) {
    return false;
  }
  if (active.has('fodmapFriendly') && input.fodmapFriendly !== true) return false;
  if (active.has('needsReview') && !input.needs_review) return false;
  const proteins = PROTEIN_FILTERS.filter((f) => active.has(f));
  if (proteins.length > 0 && !proteins.includes(input.category as QuickFilter)) return false;
  return true;
}
```

- [ ] **Step 4: Run tests + typecheck** → PASS / exit 0.
- [ ] **Step 5: Commit** — `git commit -am "feat(app): quick-filter predicate (stackable, protein OR-group)"`

---

### Task 4: QuickFilters chip row on the Home feed

**Files:**
- Create: `app/src/components/quick-filters.tsx`
- Modify: `app/src/app/(tabs)/library/index.tsx`

**Interfaces:**
- Consumes: Task 3's predicate/labels, Task 2's `useCanonicalIndex` + `resolveProteinCategory`, existing `computeRecipeFodmap` (`@/lib/fodmap`), `matchCanonical`/`normalizeRaw` (`@/lib/canonical`), `RecipeRow` (`@/components/recipe-cards`), `EmptyState`.
- Produces: `<QuickFilters active onToggle />` component.

- [ ] **Step 1: Create `app/src/components/quick-filters.tsx`:**

```tsx
import { Pressable, ScrollView, Text } from 'react-native';

import { QUICK_FILTERS, QUICK_FILTER_LABELS, type QuickFilter } from '@/lib/quick-filters';
import { fonts, fontSize, screenPadding, useTheme } from '@/lib/theme';

/** Horizontal stackable filter chips for the Home feed (spec Part 2). */
export function QuickFilters({
  active,
  onToggle,
}: {
  active: ReadonlySet<QuickFilter>;
  onToggle: (filter: QuickFilter) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: screenPadding }}
      style={{ marginHorizontal: -screenPadding }}
    >
      {QUICK_FILTERS.map((filter) => {
        const selected = active.has(filter);
        return (
          <Pressable
            key={filter}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            onPress={() => onToggle(filter)}
            style={({ pressed }) => ({
              minHeight: 36,
              justifyContent: 'center',
              borderRadius: 999,
              paddingHorizontal: 14,
              borderWidth: selected ? 0 : 1,
              borderColor: colors.border,
              backgroundColor: selected ? colors.accent : pressed ? colors.cardPressed : 'transparent',
            })}
          >
            <Text
              style={{
                color: selected ? colors.accentText : colors.text,
                fontSize: fontSize.meta,
                fontFamily: fonts.uiMedium,
              }}
            >
              {QUICK_FILTER_LABELS[filter]}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
```

- [ ] **Step 2: Integrate into `library/index.tsx`** (the Home feed):

Add imports (`QuickFilters`, `matchesQuickFilters` + `QuickFilter` type, `useCanonicalIndex`, `resolveProteinCategory`, `computeRecipeFodmap`, `matchCanonical`/`normalizeRaw`, `RecipeRow`). Add state + derivations inside `HomeScreen`:

```tsx
  const [activeFilters, setActiveFilters] = useState<Set<QuickFilter>>(new Set());
  const index = useCanonicalIndex();

  const toggleFilter = (f: QuickFilter) =>
    setActiveFilters((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });

  /** Chip inputs per recipe — pure local matching only (no LLM/cache). */
  const filterInputs = useMemo(() => {
    const map = new Map<string, { category: ProteinCategory | null; fodmapFriendly: boolean | null }>();
    for (const r of recipes) {
      const category = resolveProteinCategory(r.tags, r.ingredients, index);
      let fodmapFriendly: boolean | null = null;
      if (index && r.ingredients && r.ingredients.length > 0) {
        const result = computeRecipeFodmap(
          r.ingredients.map((ing) => ({
            raw: ing.raw || ing.name,
            name: ing.name,
            quantity: ing.quantity,
            unit: ing.unit,
          })),
          r.servings,
          (line) => matchCanonical(normalizeRaw(line.raw), index)?.ingredient ?? null
        );
        fodmapFriendly = !result.flags.some((f) => f.tier === 'high');
      }
      map.set(r.id, { category, fodmapFriendly });
    }
    return map;
  }, [recipes, index]);

  const filteredRecipes = useMemo(() => {
    if (activeFilters.size === 0) return recipes;
    return recipes.filter((r) => {
      const input = filterInputs.get(r.id);
      return matchesQuickFilters(
        {
          prep_minutes: r.prep_minutes,
          needs_review: r.needs_review,
          category: input?.category ?? null,
          fodmapFriendly: input?.fodmapFriendly ?? null,
        },
        activeFilters
      );
    });
  }, [recipes, activeFilters, filterInputs]);
```

Render: place `<QuickFilters active={activeFilters} onToggle={toggleFilter} />` directly below the brand-lockup header `View` (inside the ScrollView, before the `recipes.length === 0` check). Then wrap the sectioned feed: when `activeFilters.size > 0`, render instead

```tsx
  <View style={{ paddingTop: 8 }}>
    {filteredRecipes.map((recipe, i) => (
      <View key={recipe.id}>
        {i > 0 ? <Hairline /> : null}
        <RecipeRow recipe={recipe} onPress={() => openRecipe(recipe.id)} />
      </View>
    ))}
    {filteredRecipes.length === 0 ? (
      <EmptyState message="No recipes match these filters." actionLabel="Clear filters" onAction={() => setActiveFilters(new Set())} />
    ) : null}
  </View>
```

(keep the existing `<View>` with hero/carousels as the `activeFilters.size === 0` branch of a ternary).

- [ ] **Step 3: Check** — `cd app && npx tsc --noEmit && npx jest` → clean.
- [ ] **Step 4: Commit** — `git commit -am "feat(app): stackable quick-filter chips on the home feed"`

---

### Task 5: `rescaleIngredients` (pure)

**Files:**
- Create: `app/src/lib/servings.ts`
- Test: `app/src/lib/__tests__/servings.test.ts`

**Interfaces:**
- Produces: `rescaleIngredients(ingredients: IngredientRow[], factor: number): IngredientRow[]` (`IngredientRow` from `@/lib/worker`). Task 6 consumes it.

- [ ] **Step 1: Failing test** — `app/src/lib/__tests__/servings.test.ts`:

```ts
import { rescaleIngredients } from '../servings';

const ing = (quantity: number | null, unit: string | null = 'g') => ({
  raw: 'x', quantity, unit, name: 'x', group: null, fodmap: null,
});

describe('rescaleIngredients', () => {
  it('scales large quantities to integers', () => {
    expect(rescaleIngredients([ing(200)], 1.5)[0].quantity).toBe(300);
    expect(rescaleIngredients([ing(250)], 1 / 3)[0].quantity).toBe(83);
  });
  it('keeps 1 decimal for small amounts', () => {
    expect(rescaleIngredients([ing(0.5, 'tsp')], 1.5)[0].quantity).toBe(0.8);
    expect(rescaleIngredients([ing(2)], 1.25)[0].quantity).toBe(2.5);
  });
  it('leaves null quantities untouched', () => {
    const row = ing(null, null);
    expect(rescaleIngredients([row], 2)[0]).toEqual(row);
  });
  it('does not mutate the input', () => {
    const rows = [ing(100)];
    rescaleIngredients(rows, 2);
    expect(rows[0].quantity).toBe(100);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement `app/src/lib/servings.ts`:**

```ts
import type { IngredientRow } from '@/lib/worker';

/**
 * Scale parsed quantities by `factor` (spec Part 3). The verbatim `raw`
 * line is intentionally untouched — it records what was captured.
 * Rounding: scaled >= 10 → integer; < 10 → 1 decimal (user decision).
 */
export function rescaleIngredients(ingredients: IngredientRow[], factor: number): IngredientRow[] {
  return ingredients.map((ing) => {
    if (ing.quantity === null) return ing;
    const scaled = ing.quantity * factor;
    const quantity = scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
    return { ...ing, quantity };
  });
}
```

- [ ] **Step 4: Run + typecheck** → PASS. **Step 5: Commit** — `git commit -am "feat(app): rescaleIngredients — servings-proportional quantities"`

---

### Task 6: `saveRecipe` helper + tappable meta line → Details sheet (servings/prep/cook)

**Files:**
- Modify: `app/src/app/recipe/[id].tsx`

**Interfaces:**
- Produces (inside the screen): `saveRecipe(patch: Record<string, unknown>): Promise<void>` — the single write path Tasks 7–9, 10–11, 13, 17 reuse (`update recipes set ...patch, updated_at where id`; then `void load()`).
- Consumes: Task 5's `rescaleIngredients`.

- [ ] **Step 1: Add `saveRecipe`** near `saveEdits`:

```ts
  /** Single write path for the structured layer (recipe_sources never touched). */
  const saveRecipe = useCallback(
    async (patch: Record<string, unknown>) => {
      if (!recipe) return;
      await supabase
        .from('recipes')
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq('id', recipe.id);
      void load();
    },
    [recipe, load]
  );
```

- [ ] **Step 2: Details sheet.** Add state `const [detailsOpen, setDetailsOpen] = useState(false);` and `const [details, setDetails] = useState({ servings: '', prep: '', cook: '' });`. Make the meta line tappable: wrap the existing `{metaParts.length > 0 ? <Muted>…</Muted> : null}` fragment in a `Pressable` with `accessibilityRole="button"`, `accessibilityLabel="Edit servings and times"`, `onPress={() => { setDetails({ servings: recipe.servings?.toString() ?? '', prep: recipe.prep_minutes?.toString() ?? '', cook: recipe.cook_minutes?.toString() ?? '' }); setDetailsOpen(true); }}`. When `metaParts.length === 0` render a `<Muted>Add servings & time</Muted>` inside the same Pressable so it is always reachable.

Render a transparent bottom-card `Modal` (same pattern as `ImageLightbox`'s Modal — `transparent`, `animationType="fade"`, `onRequestClose`), containing three labeled `Field`s (Servings / Prep (min) / Cook (min), all `keyboardType="number-pad"`) and Save / Cancel `Button`s:

```tsx
  const saveDetails = async () => {
    const toInt = (v: string) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    };
    const newServings = toInt(details.servings);
    const patch: Record<string, unknown> = {
      servings: newServings,
      prep_minutes: toInt(details.prep),
      cook_minutes: toInt(details.cook),
    };
    // Servings change rescales parsed quantities (spec Part 3).
    if (newServings && recipe.servings && newServings !== recipe.servings) {
      patch.ingredients = rescaleIngredients(recipe.ingredients, newServings / recipe.servings);
    }
    setDetailsOpen(false);
    await saveRecipe(patch);
  };
```

Sheet JSX (place next to `AddToWeekSheet` at the bottom):

```tsx
      <Modal visible={detailsOpen} transparent animationType="fade" onRequestClose={() => setDetailsOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={() => setDetailsOpen(false)} />
        <View style={{ backgroundColor: colors.bg, padding: screenPadding, paddingBottom: insets.bottom + 16, gap: 12, borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <Eyebrow>Servings</Eyebrow>
          <Field value={details.servings} onChangeText={(v) => setDetails({ ...details, servings: v })} keyboardType="number-pad" />
          <Eyebrow>Prep (min)</Eyebrow>
          <Field value={details.prep} onChangeText={(v) => setDetails({ ...details, prep: v })} keyboardType="number-pad" />
          <Eyebrow>Cook (min)</Eyebrow>
          <Field value={details.cook} onChangeText={(v) => setDetails({ ...details, cook: v })} keyboardType="number-pad" />
          <Button label="Save" onPress={() => void saveDetails()} />
          <Button label="Cancel" kind="secondary" onPress={() => setDetailsOpen(false)} />
        </View>
      </Modal>
```

(Import `Modal` from `react-native`.)

- [ ] **Step 3: Check + manual sanity** — `npx tsc --noEmit && npx jest`; then in the running app: tap the meta line, change servings 4→6, confirm ingredient quantities rescale ×1.5.
- [ ] **Step 4: Commit** — `git commit -am "feat(app): tappable meta line — servings/prep/cook sheet with quantity rescale"`

---

### Task 7: `edit-list` helpers (pure)

**Files:**
- Create: `app/src/lib/edit-list.ts`
- Test: `app/src/lib/__tests__/edit-list.test.ts`

**Interfaces:**
- Produces: `updateItem<T>(list: readonly T[], index: number, value: T): T[]`, `removeItem<T>(list: readonly T[], index: number): T[]`, `moveItem<T>(list: readonly T[], from: number, to: number): T[]` (out-of-range `to` clamps; all non-mutating). Tasks 8–9 consume.

- [ ] **Step 1: Failing test:**

```ts
import { moveItem, removeItem, updateItem } from '../edit-list';

describe('edit-list', () => {
  it('updateItem replaces one element', () => {
    expect(updateItem(['a', 'b'], 1, 'c')).toEqual(['a', 'c']);
  });
  it('removeItem drops the index', () => {
    expect(removeItem(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
  it('moveItem shifts and clamps', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 5)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
  });
  it('never mutates the input', () => {
    const input = ['a', 'b'];
    moveItem(input, 0, 1);
    removeItem(input, 0);
    updateItem(input, 0, 'z');
    expect(input).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement:**

```ts
/** Non-mutating list edit helpers for the inline editors (spec Part 5). */

export function updateItem<T>(list: readonly T[], index: number, value: T): T[] {
  const next = [...list];
  next[index] = value;
  return next;
}

export function removeItem<T>(list: readonly T[], index: number): T[] {
  return list.filter((_, i) => i !== index);
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length || from === to) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
```

- [ ] **Step 4: Run + typecheck** → PASS. **Step 5: Commit** — `git commit -am "feat(app): non-mutating edit-list helpers"`

---

### Task 8: Pencil-edit for Ingredients

**Files:**
- Create: `app/src/components/editable-list.tsx` (row chrome shared with Task 9)
- Modify: `app/src/app/recipe/[id].tsx`

**Interfaces:**
- Consumes: Task 7 helpers, Task 6 `saveRecipe`.
- Produces: `EditRowControls({ index, count, onMove, onRemove })` — up/down/trash icon buttons; `SectionTitle({ title, editing, onToggle })` — a `Title` with a pencil (`create-outline`) / close (`close-outline`) icon button.

- [ ] **Step 1: Create `app/src/components/editable-list.tsx`:**

```tsx
import { Ionicons } from '@expo/vector-icons';
import { Pressable, View } from 'react-native';

import { Title } from '@/components/ui';
import { minTapTarget, useTheme } from '@/lib/theme';

/** Section title with a pencil toggle (spec Part 5). */
export function SectionTitle({
  title,
  editing,
  onToggle,
}: {
  title: string;
  editing: boolean;
  onToggle: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
      <Title>{title}</Title>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={editing ? `Stop editing ${title}` : `Edit ${title}`}
        onPress={onToggle}
        hitSlop={8}
        style={({ pressed }) => ({
          width: minTapTarget - 8,
          height: minTapTarget - 8,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: (minTapTarget - 8) / 2,
          backgroundColor: pressed ? colors.cardPressed : 'transparent',
        })}
      >
        <Ionicons name={editing ? 'close-outline' : 'create-outline'} size={20} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

/** Reorder/remove controls for one editable row. */
export function EditRowControls({
  index,
  count,
  onMove,
  onRemove,
}: {
  index: number;
  count: number;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
}) {
  const { colors } = useTheme();
  const iconButton = (
    label: string,
    icon: keyof typeof Ionicons.glyphMap,
    onPress: () => void,
    disabled = false
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={{ padding: 6, opacity: disabled ? 0.3 : 1 }}
    >
      <Ionicons name={icon} size={18} color={colors.textMuted} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {iconButton('Move up', 'chevron-up', () => onMove(index, index - 1), index === 0)}
      {iconButton('Move down', 'chevron-down', () => onMove(index, index + 1), index === count - 1)}
      {iconButton('Remove', 'trash-outline', () => onRemove(index))}
    </View>
  );
}
```

- [ ] **Step 2: Ingredients editor in `recipe/[id].tsx`.** Add state `const [ingredientsDraft, setIngredientsDraft] = useState<IngredientData[] | null>(null);` (null = viewing). Replace the plain `<Title>Ingredients</Title>` with:

```tsx
  <SectionTitle
    title="Ingredients"
    editing={ingredientsDraft !== null}
    onToggle={() =>
      setIngredientsDraft(ingredientsDraft === null ? recipe.ingredients.map((i) => ({ ...i })) : null)
    }
  />
```

When `ingredientsDraft !== null`, render the editor **instead of** the read-only ingredient list (keep the FODMAP summary block visible in both modes):

```tsx
  <View style={{ gap: 10 }}>
    {ingredientsDraft.map((ing, i) => (
      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Field
          value={ing.quantity?.toString() ?? ''}
          onChangeText={(v) => {
            const n = parseFloat(v.replace(',', '.'));
            setIngredientsDraft(updateItem(ingredientsDraft, i, { ...ing, quantity: Number.isFinite(n) ? n : null }));
          }}
          keyboardType="decimal-pad"
          placeholder="qty"
          style={{ width: 64 }}
        />
        <Field
          value={ing.unit ?? ''}
          onChangeText={(v) => setIngredientsDraft(updateItem(ingredientsDraft, i, { ...ing, unit: v || null }))}
          placeholder="unit"
          style={{ width: 64 }}
        />
        <View style={{ flex: 1 }}>
          <Field
            value={ing.name}
            onChangeText={(v) => setIngredientsDraft(updateItem(ingredientsDraft, i, { ...ing, name: v }))}
            placeholder="ingredient"
          />
        </View>
        <EditRowControls
          index={i}
          count={ingredientsDraft.length}
          onMove={(from, to) => setIngredientsDraft(moveItem(ingredientsDraft, from, to))}
          onRemove={(idx) => setIngredientsDraft(removeItem(ingredientsDraft, idx))}
        />
      </View>
    ))}
    <Button
      label="Add ingredient"
      kind="secondary"
      onPress={() =>
        setIngredientsDraft([
          ...ingredientsDraft,
          { raw: '', quantity: null, unit: null, name: '', group: null, fodmap: null },
        ])
      }
    />
    <Button
      label="Save ingredients"
      onPress={() =>
        void saveRecipe({
          ingredients: ingredientsDraft
            .filter((ing) => ing.name.trim())
            .map((ing) => ({ ...ing, raw: ing.raw || ing.name.trim(), name: ing.name.trim() })),
        }).then(() => setIngredientsDraft(null))
      }
    />
  </View>
```

Imports to add: `SectionTitle`, `EditRowControls` from `@/components/editable-list`; `moveItem`, `removeItem`, `updateItem` from `@/lib/edit-list`. Note: an edited row keeps its original `raw` (verbatim provenance); brand-new rows get `raw = name`.

- [ ] **Step 3: Check** — `npx tsc --noEmit && npx jest`; manual: edit a quantity, reorder, delete, add, save → list persists after reload.
- [ ] **Step 4: Commit** — `git commit -am "feat(app): inline pencil editing for ingredients"`

---

### Task 9: Pencil-edit for Steps + title pencil; delete the bottom Edit flow

**Files:**
- Modify: `app/src/app/recipe/[id].tsx`

**Interfaces:**
- Consumes: Tasks 6–8 (`saveRecipe`, `SectionTitle`, `EditRowControls`, edit-list helpers).

- [ ] **Step 1: Steps editor.** State `const [stepsDraft, setStepsDraft] = useState<string[] | null>(null);`. Replace `<Title>Steps</Title>` with `<SectionTitle title="Steps" editing={stepsDraft !== null} onToggle={() => setStepsDraft(stepsDraft === null ? [...recipe.steps] : null)} />`. When editing, replace the steps list with:

```tsx
  <View style={{ gap: 10 }}>
    {stepsDraft.map((step, i) => (
      <View key={i} style={{ gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Eyebrow>Step {i + 1}</Eyebrow>
          <EditRowControls
            index={i}
            count={stepsDraft.length}
            onMove={(from, to) => setStepsDraft(moveItem(stepsDraft, from, to))}
            onRemove={(idx) => setStepsDraft(removeItem(stepsDraft, idx))}
          />
        </View>
        <Field value={step} onChangeText={(v) => setStepsDraft(updateItem(stepsDraft, i, v))} multiline />
      </View>
    ))}
    <Button label="Add step" kind="secondary" onPress={() => setStepsDraft([...stepsDraft, ''])} />
    <Button
      label="Save steps"
      onPress={() =>
        void saveRecipe({ steps: stepsDraft.map((s) => s.trim()).filter(Boolean) }).then(() => setStepsDraft(null))
      }
    />
  </View>
```

(`Field` must accept `multiline` — check `ui.tsx`; if it does not forward TextInput props, add `multiline?: boolean` pass-through to `Field`.)

- [ ] **Step 2: Title pencil.** State `const [titleDraft, setTitleDraft] = useState<string | null>(null);`. Wrap the title `Text` and a pencil icon in a row (pencil mirrors `SectionTitle`'s button, `create-outline`, label "Edit the title"). When `titleDraft !== null` render instead a `Field value={titleDraft} onChangeText={setTitleDraft}` plus Save (`void saveRecipe({ title: titleDraft.trim() || recipe.title }).then(() => setTitleDraft(null))`) and Cancel buttons.

- [ ] **Step 3: Delete the old global edit flow.** Remove: `editing`/`draft`/`saving` state, `startEditing`, `saveEdits`, the whole `editing ? (…form…) : (…)` ternary (keep the non-editing branch content), the bottom `<Button label="Edit" …/>`, and simplify `showAction` to `true`-equivalent (`const showAction = true;` then inline-remove it: keep `showPinnedBar = pinnedVisible` and the floating action always rendered; keep the `contentContainerStyle` paddingBottom at 140).

- [ ] **Step 4: Check** — `npx tsc --noEmit && npx jest` (grep the file for `editing` — zero hits). Manual: edit steps + title; confirm the bottom Edit button is gone.
- [ ] **Step 5: Commit** — `git commit -am "feat(app): inline step & title editing; retire the global edit form"`

---

### Task 10: Cover focal migration + hero reposition editor (free X/Y)

**Files:**
- Create: `supabase/migrations/0003_cover_focal.sql`, `app/src/components/cover-editor.tsx`
- Modify: `app/src/app/recipe/[id].tsx` (`Hero`, `RecipeDetail`, hero derivation)
- Test: `app/src/lib/__tests__/cover-focal.test.ts` + Create: `app/src/lib/cover-focal.ts`

**Interfaces:**
- Produces: `recipes.cover_focal jsonb` (`{x: number, y: number}` in 0..1, null = center); `clampFocal(f: {x: number; y: number}): {x: number; y: number}` and `focalToContentPosition(f: {x:number;y:number} | null): ImageContentPosition-ish` in `app/src/lib/cover-focal.ts`; `<CoverRepositionModal visible path focal onSave onClose />`.

- [ ] **Step 1: Migration `supabase/migrations/0003_cover_focal.sql`:**

```sql
-- Part 4: free X/Y focal point for the hero cover (null = centered).
alter table recipes add column if not exists cover_focal jsonb;
```

Apply with the project's usual flow (`supabase db push` or the Supabase MCP `apply_migration` with the same SQL — name `0003_cover_focal`).

- [ ] **Step 2: Failing test** `app/src/lib/__tests__/cover-focal.test.ts`:

```ts
import { clampFocal, focalToContentPosition } from '../cover-focal';

describe('cover focal', () => {
  it('clamps into 0..1', () => {
    expect(clampFocal({ x: -0.2, y: 1.4 })).toEqual({ x: 0, y: 1 });
    expect(clampFocal({ x: 0.3, y: 0.7 })).toEqual({ x: 0.3, y: 0.7 });
  });
  it('maps to percent contentPosition; null = center', () => {
    expect(focalToContentPosition({ x: 0.25, y: 0.5 })).toEqual({ left: '25%', top: '50%' });
    expect(focalToContentPosition(null)).toBe('center');
  });
});
```

Run → FAIL. Implement `app/src/lib/cover-focal.ts`:

```ts
export interface CoverFocal {
  x: number;
  y: number;
}

export function clampFocal(f: CoverFocal): CoverFocal {
  const clamp = (v: number) => Math.min(1, Math.max(0, Math.round(v * 100) / 100));
  return { x: clamp(f.x), y: clamp(f.y) };
}

/** expo-image contentPosition value for a stored focal ({left,top} percents). */
export function focalToContentPosition(
  f: CoverFocal | null
): { left: `${number}%`; top: `${number}%` } | 'center' {
  if (!f) return 'center';
  return { left: `${Math.round(f.x * 100)}%` as `${number}%`, top: `${Math.round(f.y * 100)}%` as `${number}%` };
}
```

Run → PASS.

- [ ] **Step 3: Render the focal.** In `recipe/[id].tsx`: add `cover_focal: { x: number; y: number } | null;` to `RecipeDetail`; pass `focal={recipe.cover_focal}` into `Hero`; in `Hero` add the prop and set `contentPosition={focalToContentPosition(focal)}` on the `Image`. **Also fix hero selection** (cover must win): replace the `heroPath`/`restPaths` derivation with:

```ts
  const heroPath = recipe.cover_image_path ?? galleryPaths[0] ?? null;
  const restPaths = galleryPaths.filter((p) => p !== heroPath);
```

- [ ] **Step 4: Reposition editor `app/src/components/cover-editor.tsx`** — a transparent `Modal` with a 4:3 frame; a core-RN `PanResponder` drags the focal (no gesture-handler needed inside Modals):

```tsx
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import { Modal, PanResponder, useWindowDimensions, View } from 'react-native';

import { Button } from '@/components/ui';
import { clampFocal, focalToContentPosition, type CoverFocal } from '@/lib/cover-focal';
import { useImageUrl } from '@/lib/media';
import { screenPadding, useTheme } from '@/lib/theme';

/** Notion-style free X/Y cover reposition (spec Part 4). Drag moves the
 *  visible window; Save persists {x,y} in 0..1. */
export function CoverRepositionModal({
  visible,
  path,
  focal,
  onSave,
  onClose,
}: {
  visible: boolean;
  path: string;
  focal: CoverFocal | null;
  onSave: (focal: CoverFocal) => void;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const frameW = width - screenPadding * 2;
  const frameH = (frameW * 3) / 4;
  const url = useImageUrl(path);
  const [current, setCurrent] = useState<CoverFocal>(focal ?? { x: 0.5, y: 0.5 });
  const startRef = useRef<CoverFocal>(current);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startRef.current = current;
      },
      onPanResponderMove: (_evt, g) => {
        // Dragging the image right shows more of its left side → focal decreases.
        setCurrent(
          clampFocal({
            x: startRef.current.x - g.dx / frameW,
            y: startRef.current.y - g.dy / frameH,
          })
        );
      },
    })
  ).current;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: screenPadding, gap: 16 }}>
        <View
          {...pan.panHandlers}
          style={{ width: frameW, height: frameH, borderRadius: 8, overflow: 'hidden', backgroundColor: colors.cardPressed }}
        >
          {url ? (
            <Image
              source={{ uri: url }}
              style={{ width: '100%', height: '100%' }}
              contentFit="cover"
              contentPosition={focalToContentPosition(current)}
            />
          ) : null}
        </View>
        <Button label="Save position" onPress={() => onSave(current)} />
        <Button label="Cancel" kind="secondary" onPress={onClose} />
      </View>
    </Modal>
  );
}
```

- [ ] **Step 5: Hero edit button + action sheet stub.** In `Hero`, add an edit chip mirroring `BookmarkChip` placement at **bottom-right** (`position: 'absolute', bottom: 12, right: 12`, 36×36 circle, `colors.card` bg, `camera-outline` icon, label "Edit the cover image", prop `onEdit?: () => void`). In the screen: state `const [coverMenuOpen, setCoverMenuOpen] = useState(false);` and `const [repositionOpen, setRepositionOpen] = useState(false);`. `onEdit={() => setCoverMenuOpen(true)}`. The menu is a small bottom-card Modal (same chrome as Task 6's sheet) listing options as `Button kind="secondary"`: **Reposition** (→ `setRepositionOpen(true)`), **Choose from captured** (Task 11), **Choose from library** (Task 11) — plus Cancel. Render:

```tsx
  {heroPath && repositionOpen ? (
    <CoverRepositionModal
      visible
      path={heroPath}
      focal={recipe.cover_focal}
      onClose={() => setRepositionOpen(false)}
      onSave={(f) => {
        setRepositionOpen(false);
        void saveRecipe({ cover_focal: f, cover_image_path: heroPath });
      }}
    />
  ) : null}
```

- [ ] **Step 6: Check** — `npx tsc --noEmit && npx jest`; manual: drag the cover, save, reload → framing persists.
- [ ] **Step 7: Commit** — `git commit -am "feat(app): cover focal migration + free X/Y hero reposition"`

---

### Task 11: Replace cover from captured images / photo library

**Files:**
- Modify: `app/src/app/recipe/[id].tsx`

**Interfaces:**
- Consumes: Task 10's cover menu, Task 6 `saveRecipe`, `expo-image-picker` (already a dependency), `supabase.storage` upload pattern from `worker.ts:275-282`.

- [ ] **Step 1: Choose-from-captured.** New state `const [pickCapturedOpen, setPickCapturedOpen] = useState(false);`. Menu option opens a bottom-card Modal with a horizontal `ScrollView` of `GalleryImage` thumbs over `galleryPaths`; tapping one runs `void saveRecipe({ cover_image_path: path, cover_focal: null })` and closes.

- [ ] **Step 2: Choose-from-library.**

```ts
  const pickCoverFromLibrary = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    const asset = picked.assets?.[0];
    if (!asset) return;
    const path = `${householdId}/${recipe.id}/cover-custom.jpg`;
    const data = await fetch(asset.uri).then((r) => r.arrayBuffer());
    const { error } = await supabase.storage
      .from('recipe-media')
      .upload(path, data, { contentType: asset.mimeType ?? 'image/jpeg', upsert: true });
    if (error) return;
    await saveRecipe({ cover_image_path: path, cover_focal: null });
  };
```

Import `* as ImagePicker from 'expo-image-picker'` (pattern already used in `capture.tsx` — match its import style). Wire to the menu option.

- [ ] **Step 3: Check** — `npx tsc --noEmit && npx jest`; manual: replace cover from captured + from library.
- [ ] **Step 4: Commit** — `git commit -am "feat(app): replace hero cover from captured images or photo library"`

---

### Task 12: Worker `/structure` route + honest confidence on direct-map paths

**Files:**
- Modify: `worker/src/mealy_worker/structure.py`, `worker/src/mealy_worker/main.py`, `worker/src/mealy_worker/ingest/url.py`
- Test: `worker/tests/test_structure.py`, `worker/tests/test_main.py`

**Interfaces:**
- Produces: `structure_text(verbatim: Verbatim, force_llm: bool = False)` (json_ld shortcut skipped when `force_llm`); `POST /structure` body `{"verbatim": {...}, "force_llm": true}` → `CanonicalRecipe` JSON; url.py direct-map branches set `needs_review = len(ingredients) < 2 or len(steps) < 1` instead of blanket `False`.

- [ ] **Step 1: Failing tests.** In `test_structure.py`:

```python
async def test_force_llm_skips_json_ld_shortcut(monkeypatch):
    fake = make_fake(monkeypatch, TOOL_REPLY)
    json_ld = {
        "@type": "Recipe", "name": "X",
        "recipeIngredient": ["1 oignon"], "recipeInstructions": "Cuire.",
    }
    recipe = await structure.structure_text(
        Verbatim(kind="url", url="https://x", json_ld=json_ld), force_llm=True
    )
    assert len(fake.calls) == 1, "force_llm must reach the model"
    assert recipe.title == "Tarte aux poireaux"
```

In `test_main.py` (uses existing `client`/`auth` fixtures; monkeypatch `main.structure_text`):

```python
def test_structure_route_requires_token(client):
    body = {"verbatim": {"kind": "paste", "pasted": "x"}}
    assert client.post("/structure", json=body).status_code == 401


def test_structure_route_returns_canonical(client, monkeypatch):
    async def fake_structure(verbatim, force_llm=False):
        assert force_llm is True
        return RESULT.canonical

    monkeypatch.setattr(main, "structure_text", fake_structure)
    body = {"verbatim": {"kind": "paste", "pasted": "recette"}, "force_llm": True}
    response = client.post("/structure", json=body, headers=auth())
    assert response.status_code == 200
    assert response.json()["title"] == "Soupe"
```

Run: `cd worker && uv run pytest tests/ -q` → FAIL (unknown kwarg / 404).

- [ ] **Step 2: Implement.** `structure.py` — change the signature and shortcut:

```python
async def structure_text(verbatim: Verbatim, force_llm: bool = False) -> CanonicalRecipe:
    """Turn a verbatim capture into a canonical recipe.

    Complete schema.org JSON-LD is mapped directly without an LLM call —
    unless ``force_llm`` (re-extraction) demands a fresh model pass.
    """
    if not force_llm:
        direct = recipe_from_json_ld(verbatim.json_ld)
        if direct is not None:
            return direct
    ...  # rest unchanged
```

`main.py` — add:

```python
class StructureBody(BaseModel):
    verbatim: Verbatim
    force_llm: bool = False


@app.post("/structure", response_model=CanonicalRecipe)
async def structure_route(
    body: StructureBody, _claims: dict = Depends(verify_token)
) -> CanonicalRecipe:
    """Re-run extraction on a stored verbatim (spec Part 6)."""
    return await structure_text(body.verbatim, force_llm=body.force_llm)
```

(`CanonicalRecipe` joins the models import in `main.py`.)

`ingest/url.py` — in both direct-map success returns (json-ld branch and scraper branch) replace `needs_review=False` with:

```python
            needs_review=len(canonical.ingredients) < 2 or len(canonical.steps) < 1,
```

(scraper branch: `scraped.ingredients` / `scraped.steps`).

- [ ] **Step 3: Run all worker tests** — `uv run pytest tests/ -q` → all pass (fix any existing url tests that asserted `needs_review is False` on <2-ingredient fixtures by using 2+ ingredients).
- [ ] **Step 4: Commit** — `git commit -am "feat(worker): /structure re-extraction route; honest needs_review on direct-map paths"`

---

### Task 13: App re-extract flow (confirm before replacing)

**Files:**
- Modify: `app/src/lib/worker.ts`, `app/src/app/recipe/[id].tsx`
- Test: `app/src/lib/__tests__/worker.test.ts` (extend)

**Interfaces:**
- Produces: `reExtract(verbatim: Verbatim): Promise<CanonicalRecipe | null>` in `worker.ts` (null on any failure — same degradation style as `matchIngredients`).
- Consumes: Task 12's `/structure`, Task 6's `saveRecipe`.

- [ ] **Step 1: Failing test** — in `worker.test.ts` add (mirroring the file's existing fetch-mock conventions — read them first):

```ts
describe('reExtract', () => {
  it('POSTs the verbatim with force_llm and returns the canonical', async () => {
    const canonical = { title: 'Neuf', language: 'fr', servings: 2, prep_minutes: null, cook_minutes: null, dish_type: null, tags: [], ingredients: [], steps: ['Cuire.'], nutrition: null, confidence: 0.9 };
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => canonical }) as jest.Mock;
    const result = await reExtract({ kind: 'paste', url: null, json_ld: null, page_text: null, caption: null, transcript: null, overlay_text: null, ocr_text: null, pasted: 'x' });
    expect(result?.title).toBe('Neuf');
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('/structure');
    expect(JSON.parse(init.body).force_llm).toBe(true);
  });
  it('returns null on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false }) as jest.Mock;
    expect(await reExtract({ kind: 'paste', url: null, json_ld: null, page_text: null, caption: null, transcript: null, overlay_text: null, ocr_text: null, pasted: 'x' })).toBeNull();
  });
});
```

(The suite already mocks `supabase.auth.getSession` for other worker tests — reuse that setup; if not, mock `@/lib/supabase` the way the existing tests in this file do.)

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement in `worker.ts`:**

```ts
/**
 * Re-run extraction on a stored verbatim (spec Part 6). force_llm skips the
 * JSON-LD shortcut so a bad direct-map gets a fresh model pass. Returns null
 * on any failure — the caller shows "could not re-extract".
 */
export async function reExtract(verbatim: Verbatim): Promise<CanonicalRecipe | null> {
  if (!WORKER_URL) return null;
  try {
    const token = await accessToken();
    const response = await fetch(`${WORKER_URL}/structure`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ verbatim, force_llm: true }),
    });
    if (!response.ok) return null;
    return (await response.json()) as CanonicalRecipe;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: UI.** In `recipe/[id].tsx`: state `const [reExtracting, setReExtracting] = useState(false);` and `const [reExtractResult, setReExtractResult] = useState<CanonicalRecipe | null>(null);`. Add a `LinkButton label="Re-extract from source"` under the "Mark as reviewed" area (rendered when `sources.length > 0`):

```ts
  const runReExtract = async () => {
    if (sources.length === 0) return;
    setReExtracting(true);
    const result = await reExtract(sources[0].verbatim);
    setReExtracting(false);
    setReExtractResult(result); // null → sheet shows the failure message
  };
```

Confirm sheet (bottom-card Modal, Task 6 chrome): when `reExtractResult` is set show title, `X ingredients · Y steps`, servings/time line, and **Apply** / **Cancel**; when the run returned null show "Could not re-extract — try again later." Apply:

```ts
  const applyReExtract = async () => {
    const r = reExtractResult;
    if (!r) return;
    setReExtractResult(null);
    await saveRecipe({
      title: r.title, language: r.language, servings: r.servings,
      prep_minutes: r.prep_minutes, cook_minutes: r.cook_minutes,
      dish_type: r.dish_type, tags: r.tags, ingredients: r.ingredients,
      steps: r.steps, nutrition: r.nutrition, needs_review: r.confidence < 0.6,
    });
  };
```

(Track a separate `reExtractFailed` boolean alongside so "null result" and "sheet closed" are distinguishable.)

- [ ] **Step 5: Check** — `npx tsc --noEmit && npx jest` → clean.
- [ ] **Step 6: Commit** — `git commit -am "feat(app): re-extract from stored source with confirm-before-replace"`

---

### Task 14: Worker image validation + og:image candidates + `/image/fetch`

**Files:**
- Create: `worker/src/mealy_worker/images.py`
- Modify: `worker/src/mealy_worker/ingest/url.py`, `worker/src/mealy_worker/main.py`
- Test: Create `worker/tests/test_images.py`; extend `worker/tests/ingest/` url tests

**Interfaces:**
- Produces: `validate_image_bytes(data: bytes) -> bytes | None` (decode, ≥500×350, ≤1600 edge, JPEG q85); `fetch_validated_image(url: str) -> bytes | None`; `pick_cover(urls: list[str], limit: int = 3) -> str | None`; `_meta_image_urls(html: str) -> list[str]` in url.py; `POST /image/fetch {"url": …}` → `image/jpeg` bytes or 422.

- [ ] **Step 1: Failing tests** — `worker/tests/test_images.py`:

```python
"""Part 7 — image validation. Pillow generates fixtures in-memory."""

import io

from PIL import Image

from mealy_worker.images import validate_image_bytes


def png_bytes(w: int, h: int) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (w, h), (200, 120, 40)).save(buf, "PNG")
    return buf.getvalue()


def test_rejects_garbage_and_small_images():
    assert validate_image_bytes(b"not an image") is None
    assert validate_image_bytes(png_bytes(200, 200)) is None  # < 500x350


def test_accepts_and_normalizes_to_jpeg():
    out = validate_image_bytes(png_bytes(800, 600))
    assert out is not None
    img = Image.open(io.BytesIO(out))
    assert img.format == "JPEG"


def test_downscales_oversized_images():
    out = validate_image_bytes(png_bytes(3200, 2400))
    img = Image.open(io.BytesIO(out))
    assert max(img.width, img.height) <= 1600
```

And in the url ingest tests, a meta-tag extraction test:

```python
def test_meta_image_urls_extracts_og_and_twitter():
    from mealy_worker.ingest.url import _meta_image_urls
    html = (
        '<html><head>'
        '<meta property="og:image" content="https://x.com/a.jpg">'
        '<meta name="twitter:image" content="https://x.com/b.jpg">'
        '</head><body></body></html>'
    )
    assert _meta_image_urls(html) == ["https://x.com/a.jpg", "https://x.com/b.jpg"]
```

Run → FAIL.

- [ ] **Step 2: Implement `worker/src/mealy_worker/images.py`:**

```python
"""Image candidate validation (spec Part 7) — ported from companion/set_cover.py.

An image qualifies as a cover when it decodes and is at least food-photo
sized; oversized images are downscaled and everything is normalized to JPEG.
"""

from __future__ import annotations

import io

import httpx
from PIL import Image

MIN_W, MIN_H, MAX_EDGE = 500, 350, 1600
_UA = "Mozilla/5.0 (Macintosh) Mealy/1.0"


def validate_image_bytes(data: bytes) -> bytes | None:
    """Normalized JPEG bytes when data is a usable cover image, else None."""
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except Exception:
        return None
    if img.width < MIN_W or img.height < MIN_H:
        return None
    if img.width > MAX_EDGE or img.height > MAX_EDGE:
        img.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=85)
    return buf.getvalue()


async def fetch_validated_image(url: str) -> bytes | None:
    """Download + validate one candidate; None on any failure."""
    try:
        async with httpx.AsyncClient(
            follow_redirects=True, timeout=10.0, headers={"User-Agent": _UA}
        ) as client:
            response = await client.get(url)
        if response.status_code >= 400:
            return None
    except Exception:
        return None
    return validate_image_bytes(response.content)


async def pick_cover(urls: list[str], limit: int = 3) -> str | None:
    """First candidate URL (of at most `limit`) that passes validation."""
    for url in urls[:limit]:
        if await fetch_validated_image(url) is not None:
            return url
    return None
```

- [ ] **Step 3: og:image extraction + validated cover in `url.py`.** Add:

```python
def _meta_image_urls(html: str) -> list[str]:
    """og:image / twitter:image candidates — currently never scraped."""
    try:
        doc = lxml.html.fromstring(html)
    except Exception:
        return []
    urls: list[str] = []
    for xp in (
        '//meta[@property="og:image"]/@content',
        '//meta[@name="twitter:image"]/@content',
    ):
        urls.extend(u for u in doc.xpath(xp) if isinstance(u, str) and u.startswith("http"))
    return urls
```

Add a small helper and use it in all three success branches:

```python
async def _ordered_image_urls(primary: list[str], html: str) -> list[str]:
    """Primary source images + meta candidates, deduped, validated cover first."""
    candidates = list(dict.fromkeys([*primary, *_meta_image_urls(html)]))
    cover = await pick_cover(candidates)
    if cover is None:
        return candidates
    return [cover, *[u for u in candidates if u != cover]]
```

(import `pick_cover` from `..images`). Replace `image_urls=_json_ld_image_urls(json_ld)` with `image_urls=await _ordered_image_urls(_json_ld_image_urls(json_ld), html)`; `image_urls=scraped_images` with `image_urls=await _ordered_image_urls(scraped_images, html)`; and give the LLM branch (`# 3`) `image_urls=await _ordered_image_urls([], html)` on its success return.

- [ ] **Step 4: `/image/fetch` route in `main.py`:**

```python
from fastapi import HTTPException
from fastapi.responses import Response

from .images import fetch_validated_image


class ImageUrlBody(BaseModel):
    url: str


@app.post("/image/fetch")
async def image_fetch_route(
    body: ImageUrlBody, _claims: dict = Depends(verify_token)
) -> Response:
    """Download + validate a web image for the cover-replace flow (Part 4/7)."""
    data = await fetch_validated_image(body.url)
    if data is None:
        raise HTTPException(status_code=422, detail="image failed validation")
    return Response(content=data, media_type="image/jpeg")
```

Route test in `test_main.py` (monkeypatch `main.fetch_validated_image` with an async fake returning `b"jpeg"` / `None`; assert 200 + content-type and 422).

- [ ] **Step 5: Run** — `uv run pytest tests/ -q` → all pass. Note in the commit message that `pick_cover` network calls are exercised only via mocks (no live HTTP in tests).
- [ ] **Step 6: Commit** — `git commit -am "feat(worker): og:image candidates, image validation, validated cover ordering, /image/fetch"`

---

### Task 15: App cover-replace "From the web"

**Files:**
- Modify: `app/src/lib/worker.ts`, `app/src/app/recipe/[id].tsx`

**Interfaces:**
- Produces: `fetchWebImage(url: string): Promise<ArrayBuffer | null>` in `worker.ts`.
- Consumes: Task 14's `/image/fetch`, Task 10/11's cover menu + `saveRecipe`.

- [ ] **Step 1: Implement `fetchWebImage` in `worker.ts`:**

```ts
/** Download + validate a web image via the worker (spec Part 4/7). */
export async function fetchWebImage(url: string): Promise<ArrayBuffer | null> {
  if (!WORKER_URL) return null;
  try {
    const token = await accessToken();
    const response = await fetch(`${WORKER_URL}/image/fetch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Menu option "From the web".** Cover menu gains the option → opens a small Modal with a `Field` (paste an image URL) + Fetch button:

```ts
  const replaceCoverFromWeb = async (imageUrl: string) => {
    const data = await fetchWebImage(imageUrl.trim());
    if (!data) {
      setWebCoverError('That image could not be used (too small or unreachable).');
      return;
    }
    const path = `${householdId}/${recipe.id}/cover-web.jpg`;
    const { error } = await supabase.storage
      .from('recipe-media')
      .upload(path, data, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      setWebCoverError('Upload failed — try again.');
      return;
    }
    setWebCoverOpen(false);
    await saveRecipe({ cover_image_path: path, cover_focal: null });
  };
```

(states: `webCoverOpen`, `webCoverUrl`, `webCoverError`.)

- [ ] **Step 3: Check** — `npx tsc --noEmit && npx jest`; manual with the worker running: paste an image URL → cover replaced; paste a tiny/bad URL → inline error.
- [ ] **Step 4: Commit** — `git commit -am "feat(app): replace cover from a web image via worker validation"`

---

### Task 16: Worker `/fodmap/swaps`

**Files:**
- Create: `worker/src/mealy_worker/fodmap.py`
- Modify: `worker/src/mealy_worker/main.py`
- Test: Create `worker/tests/test_fodmap.py`

**Interfaces:**
- Produces: `POST /fodmap/swaps` with body `SwapRequest {title, language, servings, ingredients: [Ingredient], steps: [str], flagged: [str]}` → `SwapResponse {swaps: [{raw, replacement: Ingredient, note}], steps: [str]}`. Model `claude-haiku-4-5`, forced tool-use `emit_swaps`, client via `structure.get_anthropic_client` (so tests share the fake).

- [ ] **Step 1: Failing test** — `worker/tests/test_fodmap.py`:

```python
"""Part 8 — FODMAP swap suggestions. The Anthropic client is always mocked."""

from types import SimpleNamespace

from mealy_worker import fodmap, structure
from mealy_worker.models import Ingredient


class FakeClient:
    def __init__(self, tool_input: dict):
        self.calls: list[dict] = []
        self._tool_input = tool_input
        self.messages = SimpleNamespace(create=self._create)

    async def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(content=[SimpleNamespace(type="tool_use", input=self._tool_input)])


SWAP_REPLY = {
    "swaps": [
        {
            "raw": "1 oignon",
            "replacement": {"raw": "1 oignon", "quantity": 2.0, "unit": None,
                            "name": "vert de poireau", "group": None, "fodmap": "low"},
            "note": "Le vert de poireau est pauvre en FODMAP.",
        }
    ],
    "steps": ["Émincer le vert de poireau.", "Cuire 30 min."],
}


async def test_swaps_reach_the_model_and_validate(monkeypatch):
    fake = FakeClient(SWAP_REPLY)
    monkeypatch.setattr(structure, "get_anthropic_client", lambda: fake)
    request = fodmap.SwapRequest(
        title="Soupe",
        servings=4,
        ingredients=[Ingredient(raw="1 oignon", name="oignon")],
        steps=["Émincer l'oignon.", "Cuire 30 min."],
        flagged=["1 oignon"],
    )
    response = await fodmap.suggest_swaps(request)
    assert len(fake.calls) == 1
    assert fake.calls[0]["model"] == "claude-haiku-4-5"
    assert response.swaps[0].replacement.name == "vert de poireau"
    assert "1 oignon" in fake.calls[0]["messages"][0]["content"][0]["text"]
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement `worker/src/mealy_worker/fodmap.py`:**

```python
"""Low-FODMAP swap suggestions (spec Part 8).

One forced tool-use call proposes substitutions for flagged ingredient lines
and rewrites the affected steps to reference the replacements (user decision).
Only the structured layer is touched; the app decides whether to apply.
"""

from __future__ import annotations

from pydantic import BaseModel, Field

from . import structure
from .models import Ingredient
from .structure import MODEL, _tool_input

SWAP_SYSTEM = (
    "You adapt recipes to be low-FODMAP. For each flagged ingredient line, "
    "propose ONE widely available low-FODMAP substitute with a sensible "
    "quantity for the stated servings, in the recipe's language. Rewrite only "
    "the steps that mention a swapped ingredient so they reference the "
    "replacement; copy every other step verbatim. Never drop a step, never "
    "invent new ingredients beyond the replacements, and keep each "
    "replacement's `raw` equal to the original flagged line."
)


class SwapRequest(BaseModel):
    title: str
    language: str = "fr"
    servings: int | None = None
    ingredients: list[Ingredient]
    steps: list[str]
    flagged: list[str] = Field(description="raw ingredient lines flagged high/moderate FODMAP")


class IngredientSwap(BaseModel):
    raw: str
    replacement: Ingredient
    note: str


class SwapResponse(BaseModel):
    swaps: list[IngredientSwap]
    steps: list[str]


_SWAP_TOOL = {
    "name": "emit_swaps",
    "description": "Emit low-FODMAP substitutions and the rewritten steps.",
    "input_schema": SwapResponse.model_json_schema(),
}


def _request_text(request: SwapRequest) -> str:
    lines = [f"Recipe: {request.title} (language: {request.language}, servings: {request.servings})"]
    lines.append("Ingredients:")
    lines.extend(f"- {ing.raw or ing.name}" for ing in request.ingredients)
    lines.append("Steps:")
    lines.extend(f"{i + 1}. {step}" for i, step in enumerate(request.steps))
    lines.append("Flagged (high/moderate FODMAP) lines to swap:")
    lines.extend(f"- {raw}" for raw in request.flagged)
    return "\n".join(lines)


async def suggest_swaps(request: SwapRequest) -> SwapResponse:
    # Looked up through the module so tests can monkeypatch structure.get_anthropic_client.
    client = structure.get_anthropic_client()
    response = await client.messages.create(
        model=MODEL,
        max_tokens=4096,
        system=SWAP_SYSTEM,
        tools=[_SWAP_TOOL],
        tool_choice={"type": "tool", "name": "emit_swaps"},
        messages=[{"role": "user", "content": [{"type": "text", "text": _request_text(request)}]}],
    )
    return SwapResponse.model_validate(_tool_input(response))
```

`main.py` — add the route:

```python
from .fodmap import SwapRequest, SwapResponse, suggest_swaps


@app.post("/fodmap/swaps", response_model=SwapResponse)
async def fodmap_swaps_route(
    body: SwapRequest, _claims: dict = Depends(verify_token)
) -> SwapResponse:
    """Low-FODMAP substitution suggestions (spec Part 8)."""
    return await suggest_swaps(body)
```

Plus a `test_main.py` auth test (`/fodmap/swaps` without token → 401; with token + monkeypatched `main.suggest_swaps` → 200).

- [ ] **Step 3: Run** — `uv run pytest tests/ -q` → all pass.
- [ ] **Step 4: Commit** — `git commit -am "feat(worker): /fodmap/swaps — low-FODMAP substitutions with step rewrite"`

---

### Task 17: App "Low-FODMAP" button + swap sheet + apply

**Files:**
- Modify: `app/src/lib/worker.ts`, `app/src/app/recipe/[id].tsx`

**Interfaces:**
- Produces: `fodmapSwaps(request: {title: string; language: string; servings: number | null; ingredients: IngredientRow[]; steps: string[]; flagged: string[]}): Promise<{swaps: {raw: string; replacement: IngredientRow; note: string}[]; steps: string[]} | null>` in `worker.ts` (null on failure).
- Consumes: Task 16's route, Task 6's `saveRecipe`, existing `fodmap` memo + `flagByRaw`.

- [ ] **Step 1: Implement `fodmapSwaps` in `worker.ts`** (same shape as `reExtract` — POST JSON, return parsed body or null; type the response inline as above).

- [ ] **Step 2: Button + sheet in `recipe/[id].tsx`.** Derive the flagged lines:

```ts
  const swappableRaws = useMemo(
    () =>
      (fodmap?.flags ?? [])
        .filter((f) => f.tier === 'high' || f.tier === 'moderate')
        .map((f) => f.raw),
    [fodmap]
  );
```

Next to the meta-line Pressable (same row, after it), when `swappableRaws.length > 0` render a compact pill button (accent border, `leaf-outline` icon + "Low-FODMAP", accessibility label "Suggest low-FODMAP swaps") that runs:

```ts
  const runSwaps = async () => {
    setSwapsLoading(true);
    const response = await fodmapSwaps({
      title: recipe.title,
      language: recipe.language,
      servings: recipe.servings,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      flagged: swappableRaws,
    });
    setSwapsLoading(false);
    setSwapsResult(response);
    setSwapsOpen(true);
  };
```

Sheet (bottom-card Modal): for each swap show `flag → replacement.name` with its `note` as `Muted`; failure state shows "Could not fetch suggestions — try again later."; **Apply all** / **Cancel**. Apply (all-or-nothing v1 — the rewritten steps assume every swap):

```ts
  const applySwaps = async () => {
    const r = swapsResult;
    if (!r) return;
    const byRaw = new Map(r.swaps.map((s) => [s.raw, s.replacement]));
    const ingredients = recipe.ingredients.map((ing) => byRaw.get(ing.raw || ing.name) ?? ing);
    setSwapsOpen(false);
    await saveRecipe({ ingredients, steps: r.steps });
  };
```

- [ ] **Step 3: Check** — `npx tsc --noEmit && npx jest`; manual with the worker running on a recipe with a high-FODMAP ingredient (e.g. onion/garlic): button appears → suggestions → apply → ingredients and steps update.
- [ ] **Step 4: Commit** — `git commit -am "feat(app): low-FODMAP swap suggestions with apply"`

---

## Final verification (after Task 17)

- [ ] `cd app && npx tsc --noEmit && npx jest` — all green.
- [ ] `cd worker && uv run pytest tests/ -q` — all green.
- [ ] Manual pass in the app (Expo): category spines now colored on ingredient-only recipes; Home chips filter and stack; servings rescale; pencils edit ingredients/steps/title; hero reposition + replace (3 sources); re-extract confirm flow; FODMAP swaps.
- [ ] Use the superpowers:verification-before-completion skill before declaring done.
