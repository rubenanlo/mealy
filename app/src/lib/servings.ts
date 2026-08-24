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

/**
 * How many servings a plan entry needs: the eaters it covers plus its guests.
 * An empty `personIds` means the whole household eats it, so it covers every
 * family eater (`totalEaterCount`). Guests (non-family) always add on top.
 */
export function entryServings(
  personIds: string[],
  guestCount: number,
  totalEaterCount: number
): number {
  const eaters = personIds.length === 0 ? totalEaterCount : personIds.length;
  return eaters + Math.max(0, guestCount);
}

/**
 * Factor to scale a recipe from its own yield (`baseServings`) to a plan
 * entry's `targetServings`. Null when we can't scale — no base yield, or a
 * non-positive target — so callers leave quantities untouched.
 */
export function servingsFactor(
  targetServings: number,
  baseServings: number | null | undefined
): number | null {
  if (!baseServings || baseServings <= 0) return null;
  if (targetServings <= 0) return null;
  return targetServings / baseServings;
}
