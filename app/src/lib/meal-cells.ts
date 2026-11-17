// Shared shaping of a week's plan entries into per-meal cells, used by the
// weeks overview (plan/index) and the Next meals page (plan/upcoming).

import { entryServings } from '@/lib/servings';
import type { MealSlot } from '@/lib/plan';
import { splitSlot } from '@/lib/week-page';

export interface EntryRow {
  meal_plan_id: string;
  day: number;
  slot: MealSlot;
  recipe_id: string | null;
  custom_title: string | null;
  assigned_cook: 'family' | 'employee';
  /** Empty ⇒ whole household eats it. */
  person_ids: string[];
  /** Non-family guests eating this meal (migration 0017). */
  guest_count: number;
  /** Order in the slot; the lowest is the main dish. */
  position?: number;
  /** Set on a leftover row (someone eating an earlier meal again). */
  leftover_of?: string | null;
}

/** One dish of a meal for some (or all) of the household, with its sides (design G1). */
export interface CellDish {
  title: string;
  cover: string | null;
  recipeId: string | null;
  servings: number | null;
  /** Eater names; empty ⇒ whole household. */
  eaters: string[];
  sides: string[];
}

export interface RecipeLite {
  id: string;
  title: string;
  cover_image_path: string | null;
}

/** One planned meal cell (day + slot) with everything scheduled in it. */
export interface MealCell {
  day: number;
  slot: MealSlot;
  titles: string[];
  covers: (string | null)[];
  recipeIds: string[];
  /** Servings (covered eaters + guests) per recipe, parallel to recipeIds. */
  servings: number[];
  /** Eater names per dish, parallel to titles; empty ⇒ whole household. */
  eaters: string[][];
  /** Per dish, parallel to titles: recipe id, or null for custom meals. */
  dishRecipeIds: (string | null)[];
  /** Per dish, parallel to titles: servings, or null for custom meals. */
  dishServings: (number | null)[];
  /**
   * The meal's dishes at the same level: the main dish, then a dish per
   * group of people eating something else, then leftover plates. Sides
   * ride with their dish. One entry for an ordinary meal.
   */
  dishes: CellDish[];
}

/** Group a week's entries into ordered meal cells (day asc, lunch first). */
export function buildCells(
  entries: EntryRow[],
  recipesById: Map<string, RecipeLite>,
  eaterCount: number,
  recipeFallback: string,
  personNameById: Map<string, string>
): MealCell[] {
  const byKey = new Map<string, MealCell>();
  for (const entry of entries) {
    const key = `${entry.day}-${entry.slot}`;
    const cell =
      byKey.get(key) ??
      {
        day: entry.day,
        slot: entry.slot,
        titles: [],
        covers: [],
        recipeIds: [],
        servings: [],
        eaters: [],
        dishRecipeIds: [],
        dishServings: [],
        dishes: [],
      };
    const names = entry.person_ids
      .map((pid) => personNameById.get(pid))
      .filter((n): n is string => !!n);
    if (entry.recipe_id) {
      const recipe = recipesById.get(entry.recipe_id);
      cell.titles.push(recipe?.title ?? recipeFallback);
      cell.covers.push(recipe?.cover_image_path ?? null);
      cell.recipeIds.push(entry.recipe_id);
      const servings = entryServings(entry.person_ids, entry.guest_count, eaterCount);
      cell.servings.push(servings);
      cell.eaters.push(names);
      cell.dishRecipeIds.push(entry.recipe_id);
      cell.dishServings.push(servings);
    } else if (entry.custom_title) {
      cell.titles.push(entry.custom_title);
      cell.covers.push(null);
      cell.eaters.push(names);
      cell.dishRecipeIds.push(null);
      cell.dishServings.push(null);
    }
    byKey.set(key, cell);
  }
  // Group each meal into dishes (main, plates for other people, leftovers).
  const titleOf = (e: EntryRow) =>
    e.recipe_id ? (recipesById.get(e.recipe_id)?.title ?? recipeFallback) : (e.custom_title ?? recipeFallback);
  const rows = entries
    .filter((e) => e.recipe_id || e.custom_title)
    .map((e) => ({ ...e, position: e.position ?? 0 }));
  for (const cell of byKey.values()) {
    const { main, sides, plates, leftovers } = splitSlot(rows, cell.day, cell.slot);
    const groups = [
      ...(main ? [{ dish: main, sides: main.leftover_of ? [] : sides }] : []),
      ...plates,
      ...leftovers.filter((l) => l !== main).map((l) => ({ dish: l, sides: [] as typeof rows })),
    ];
    cell.dishes = groups.map(({ dish, sides: extra }) => ({
      title: titleOf(dish),
      cover: dish.recipe_id ? (recipesById.get(dish.recipe_id)?.cover_image_path ?? null) : null,
      recipeId: dish.recipe_id,
      servings: dish.recipe_id ? entryServings(dish.person_ids, dish.guest_count, eaterCount) : null,
      eaters: dish.person_ids.map((pid) => personNameById.get(pid)).filter((n): n is string => !!n),
      sides: extra.map(titleOf),
    }));
  }
  return [...byKey.values()].sort(
    (a, b) => a.day - b.day || (a.slot === b.slot ? 0 : a.slot === 'lunch' ? -1 : 1)
  );
}
