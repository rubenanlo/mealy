// Pure helpers for the one-page week planner (plan/index.tsx, design A).

import { addWeeks, awayIds, slotEntries, type MealSlot, type PlanAbsence, type PlanEntry } from '@/lib/plan';
import { isPastDay } from '@/lib/plan-ideas';

export const WEEK_SLOTS: MealSlot[] = ['lunch', 'dinner'];

/** True when every eater is marked away for the meal (going out). */
export function everyoneAway(
  absences: readonly PlanAbsence[],
  day: number,
  slot: MealSlot,
  eaterIds: readonly string[]
): boolean {
  if (eaterIds.length === 0) return false;
  const away = awayIds(absences, day, slot);
  return eaterIds.every((id) => away.has(id));
}

/**
 * "9 of 14 meals planned": meals somebody is home for, and how many of them
 * already have a dish. Going-out meals don't count either way.
 */
export function weekProgress(
  entries: Pick<PlanEntry, 'day' | 'slot' | 'position'>[],
  absences: readonly PlanAbsence[],
  eaterIds: readonly string[]
): { planned: number; total: number } {
  let planned = 0;
  let total = 0;
  for (let day = 0; day < 7; day += 1) {
    for (const slot of WEEK_SLOTS) {
      const filled = slotEntries(entries, day, slot).length > 0;
      if (!filled && everyoneAway(absences, day, slot, eaterIds)) continue;
      total += 1;
      if (filled) planned += 1;
    }
  }
  return { planned, total };
}

/** Future meals with no dish yet and someone home: what "Fill with AI" would fill. */
export function openMeals(
  entries: Pick<PlanEntry, 'day' | 'slot' | 'position'>[],
  absences: readonly PlanAbsence[],
  eaterIds: readonly string[],
  weekIso: string,
  now: Date = new Date()
): { day: number; slot: MealSlot }[] {
  const cells: { day: number; slot: MealSlot }[] = [];
  for (let day = 0; day < 7; day += 1) {
    if (isPastDay(weekIso, day, now)) continue;
    for (const slot of WEEK_SLOTS) {
      if (slotEntries(entries, day, slot).length > 0) continue;
      if (everyoneAway(absences, day, slot, eaterIds)) continue;
      cells.push({ day, slot });
    }
  }
  return cells;
}

/**
 * Weeks offered as chips: last week, this week, the next three, then any
 * later week that already holds meals or ideas. Sorted, no duplicates.
 */
export function chipWeeks(currentWeek: string, laterWeeks: readonly string[]): string[] {
  const base = [-1, 0, 1, 2, 3].map((delta) => addWeeks(currentWeek, delta));
  const extra = laterWeeks.filter((w) => w > base[base.length - 1]!);
  return [...new Set([...base, ...extra])].sort();
}

export interface SuggestRecipe {
  id: string;
  /** Protein bucket (fish, meat, vegetarian, legume) or null. */
  category: string | null;
  isSalad: boolean;
  /** Weeks since it was last planned; null = never. */
  weeksSince: number | null;
  totalMinutes: number | null;
}

export interface AddSuggestions {
  /** Recipe ids parked as ideas for this week, not yet planned. */
  ideas: string[];
  /** Recipes that fill a category the week is still short of. */
  gaps: string[];
  /** Recently cooked favourites (planned in the last few weeks). */
  recent: string[];
}

/**
 * What the add sheet shows before you type: the week's ideas, then dishes
 * that fill a missing category (longest-not-had first), then recent ones.
 * Recipes already on this week are left out everywhere.
 */
export function addSuggestions(input: {
  recipes: readonly SuggestRecipe[];
  ideaRecipeIds: readonly string[];
  plannedRecipeIds: ReadonlySet<string>;
  /** Categories still below their weekly minimum, e.g. ['fish', 'salad']. */
  missing: readonly string[];
  limit?: number;
}): AddSuggestions {
  const limit = input.limit ?? 3;
  const byId = new Map(input.recipes.map((r) => [r.id, r]));
  const used = new Set<string>(input.plannedRecipeIds);
  const ideas = [...new Set(input.ideaRecipeIds)].filter((id) => byId.has(id) && !used.has(id));
  ideas.forEach((id) => used.add(id));

  const staleFirst = (a: SuggestRecipe, b: SuggestRecipe) =>
    (b.weeksSince ?? 999) - (a.weeksSince ?? 999) || (a.totalMinutes ?? 999) - (b.totalMinutes ?? 999);

  const fits = (r: SuggestRecipe) =>
    input.missing.some((m) => (m === 'salad' ? r.isSalad : r.category === m));
  const gaps = input.recipes
    .filter((r) => !used.has(r.id) && fits(r))
    .sort(staleFirst)
    .slice(0, limit)
    .map((r) => r.id);
  gaps.forEach((id) => used.add(id));

  const recent = input.recipes
    .filter((r) => !used.has(r.id) && r.weeksSince !== null && r.weeksSince >= 1 && r.weeksSince <= 6)
    .sort((a, b) => (a.weeksSince ?? 0) - (b.weeksSince ?? 0))
    .slice(0, 6)
    .map((r) => r.id);

  return { ideas, gaps, recent };
}

/** Main dish of a slot (lowest position) and the rest as sides. */
export function splitSlot<T extends Pick<PlanEntry, 'day' | 'slot' | 'position'>>(
  entries: T[],
  day: number,
  slot: MealSlot
): { main: T | null; sides: T[] } {
  const rows = slotEntries(entries, day, slot);
  return { main: rows[0] ?? null, sides: rows.slice(1) };
}
