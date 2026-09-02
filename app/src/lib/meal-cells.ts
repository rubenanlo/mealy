// Shared shaping of a week's plan entries into per-meal cells, used by the
// weeks overview (plan/index) and the Next meals page (plan/upcoming).

import { entryServings } from '@/lib/servings';
import type { MealSlot } from '@/lib/plan';

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
  return [...byKey.values()].sort(
    (a, b) => a.day - b.day || (a.slot === b.slot ? 0 : a.slot === 'lunch' ? -1 : 1)
  );
}
