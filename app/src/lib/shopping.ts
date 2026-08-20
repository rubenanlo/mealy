import type { IngredientRow } from '@/lib/worker';

export interface ShoppingItem {
  name: string;
  quantity: number | null;
  unit: string | null;
  raw: string;
}

export interface ShoppingGroup {
  recipeId: string;
  recipeTitle: string;
  items: ShoppingItem[];
}

interface EntryLike {
  /** Null for free-text meals — they contribute no ingredients. */
  recipe_id: string | null;
}

interface RecipeLike {
  id: string;
  title: string;
  ingredients: IngredientRow[];
}

/**
 * Phase-1 honest shopping list: ingredients grouped by recipe, one group per
 * plan entry (a recipe planned twice appears twice — no merging or totals;
 * canonical-ingredient aggregation is Phase 2).
 */
export function collectWeekIngredients(
  entries: EntryLike[],
  recipes: RecipeLike[]
): ShoppingGroup[] {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const groups: ShoppingGroup[] = [];
  for (const entry of entries) {
    if (entry.recipe_id === null) continue; // custom meal — no ingredients
    const recipe = byId.get(entry.recipe_id);
    if (!recipe) continue;
    groups.push({
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      items: recipe.ingredients.map((ing) => ({
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        raw: ing.raw,
      })),
    });
  }
  return groups;
}
