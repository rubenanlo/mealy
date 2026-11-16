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

type SlotRow = Pick<PlanEntry, 'day' | 'slot' | 'position'> & {
  leftover_of?: string | null;
  person_ids?: string[];
};

/** Do two eater lists share anyone? Empty means the whole household. */
export function eatersOverlap(a: readonly string[] = [], b: readonly string[] = []): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((id) => b.includes(id));
}

export interface Plate<T> {
  dish: T;
  sides: T[];
}

/**
 * Main dish of a slot (lowest position), its sides, the "plates" (a
 * different dish for some people, design D1) and leftover rows.
 *
 * An extra cooked row is a side of the main when it feeds any of the main's
 * eaters. A row whose eaters don't overlap the main's is its own plate (e.g.
 * pasta for Marc while the others have salmon); later rows that feed a
 * plate's eaters are that plate's sides. Rows with no person list (= the
 * whole household) always overlap, so existing plans read exactly as before.
 */
export function splitSlot<T extends SlotRow>(
  entries: T[],
  day: number,
  slot: MealSlot
): { main: T | null; sides: T[]; plates: Plate<T>[]; leftovers: T[] } {
  const rows = slotEntries(entries, day, slot);
  // Leftover rows (someone eating last night's dinner) are never the main or a side.
  const cooked = rows.filter((r) => !r.leftover_of);
  const main = cooked[0] ?? rows[0] ?? null;
  const sides: T[] = [];
  const plates: Plate<T>[] = [];
  for (const row of cooked.slice(1)) {
    if (main && eatersOverlap(row.person_ids, main.person_ids)) {
      sides.push(row);
      continue;
    }
    const plate = plates.find((p) => eatersOverlap(row.person_ids, p.dish.person_ids));
    if (plate) plate.sides.push(row);
    else plates.push({ dish: row, sides: [] });
  }
  return {
    main,
    sides,
    plates,
    leftovers: rows.filter((r) => r.leftover_of && r !== main),
  };
}

export type PersonMeal<T> =
  | { kind: 'away' }
  | { kind: 'empty' }
  | { kind: 'none'; main: T }
  | { kind: 'leftover'; entry: T }
  | { kind: 'dish'; entry: T; sides: T[]; isMain: boolean };

/** What one person eats at a meal: away, a leftover plate, their own plate, the main, or nothing. */
export function personMeal<T extends SlotRow>(
  entries: T[],
  absences: readonly PlanAbsence[],
  day: number,
  slot: MealSlot,
  personId: string
): PersonMeal<T> {
  if (awayIds(absences, day, slot).has(personId)) return { kind: 'away' };
  const { main, sides, plates, leftovers } = splitSlot(entries, day, slot);
  const leftover = leftovers.find((l) => (l.person_ids ?? []).includes(personId));
  if (leftover) return { kind: 'leftover', entry: leftover };
  const plate = plates.find((p) => (p.dish.person_ids ?? []).includes(personId));
  if (plate) return { kind: 'dish', entry: plate.dish, sides: plate.sides, isMain: false };
  if (!main) return { kind: 'empty' };
  const ids = main.person_ids ?? [];
  if (ids.length === 0 || ids.includes(personId)) return { kind: 'dish', entry: main, sides, isMain: true };
  return { kind: 'none', main };
}

export interface SlotChanges {
  /** Rows whose person_ids change. */
  update: { id: string; person_ids: string[] }[];
  /** Rows to delete (a plate or leftover row nobody eats any more, with its sides). */
  remove: string[];
}

/**
 * Take one person off whatever they eat at a meal, so a new plate (or an
 * absence) can take their place. "Everyone" lists on the main become the
 * concrete household minus that person, so the main and the new plate never
 * overlap. Empty plates and leftover rows are deleted with their sides.
 * `join` puts the person back on the main instead of removing them.
 */
export function detachPerson<T extends SlotRow & { id: string }>(
  entries: T[],
  day: number,
  slot: MealSlot,
  personId: string,
  householdIds: readonly string[],
  away: ReadonlySet<string>,
  opts: { join?: boolean } = {}
): SlotChanges {
  const { main, sides, plates, leftovers } = splitSlot(entries, day, slot);
  const update: SlotChanges['update'] = [];
  const remove: string[] = [];
  const everyone = householdIds.filter((id) => !away.has(id));
  if (main) {
    const ids = main.person_ids ?? [];
    let next: string[] | null = null;
    if (opts.join) {
      if (ids.length > 0 && !ids.includes(personId)) next = [...ids, personId];
    } else if (ids.length === 0) {
      next = everyone.filter((id) => id !== personId);
    } else if (ids.includes(personId)) {
      next = ids.filter((id) => id !== personId);
    }
    if (next) for (const row of [main, ...sides]) update.push({ id: row.id, person_ids: next });
  }
  for (const plate of plates) {
    const ids = plate.dish.person_ids ?? [];
    if (!ids.includes(personId)) continue;
    const next = ids.filter((id) => id !== personId);
    if (next.length === 0) remove.push(plate.dish.id, ...plate.sides.map((s) => s.id));
    else for (const row of [plate.dish, ...plate.sides]) update.push({ id: row.id, person_ids: next });
  }
  for (const row of leftovers) {
    const ids = row.person_ids ?? [];
    if (!ids.includes(personId)) continue;
    const next = ids.filter((id) => id !== personId);
    if (next.length === 0) remove.push(row.id);
    else update.push({ id: row.id, person_ids: next });
  }
  return { update, remove };
}
