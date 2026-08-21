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
