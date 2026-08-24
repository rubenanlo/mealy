import { entryServings, rescaleIngredients, servingsFactor } from '@/lib/servings';
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
  /** Empty ⇒ whole household. Optional so older callers stay unscaled. */
  person_ids?: string[];
  /** Non-family guests eating this meal (migration 0017). */
  guest_count?: number;
}

interface RecipeLike {
  id: string;
  title: string;
  ingredients: IngredientRow[];
  /** Recipe yield; needed to scale quantities to a meal's servings. */
  servings?: number | null;
}

/**
 * Honest shopping list: ingredients grouped by recipe, one group per plan
 * entry (a recipe planned twice appears twice). When `totalEaterCount` is
 * given, each entry's quantities are scaled to its servings (covered eaters +
 * guests) so the list matches who actually eats it; omit it to keep amounts
 * verbatim.
 */
export function collectWeekIngredients(
  entries: EntryLike[],
  recipes: RecipeLike[],
  totalEaterCount?: number
): ShoppingGroup[] {
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const groups: ShoppingGroup[] = [];
  for (const entry of entries) {
    if (entry.recipe_id === null) continue; // custom meal — no ingredients
    const recipe = byId.get(entry.recipe_id);
    if (!recipe) continue;
    const target =
      totalEaterCount === undefined
        ? 0
        : entryServings(entry.person_ids ?? [], entry.guest_count ?? 0, totalEaterCount);
    const factor = servingsFactor(target, recipe.servings);
    const ingredients =
      factor === null || factor === 1
        ? recipe.ingredients
        : rescaleIngredients(recipe.ingredients, factor);
    groups.push({
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      items: ingredients.map((ing) => ({
        name: ing.name,
        quantity: ing.quantity,
        unit: ing.unit,
        raw: ing.raw,
      })),
    });
  }
  return groups;
}
