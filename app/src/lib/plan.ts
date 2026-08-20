export type MealSlot = 'lunch' | 'dinner';
export type CookType = 'family' | 'employee';

export interface PlanEntry {
  id: string;
  meal_plan_id: string;
  /** 0 = Monday … 6 = Sunday. */
  day: number;
  slot: MealSlot;
  /** Null for free-text meals (migration 0003). */
  recipe_id: string | null;
  /** Free-text meal title; null for library-recipe entries. */
  custom_title: string | null;
  /** Empty array ⇒ the whole household eats this entry. */
  person_ids: string[];
  assigned_cook: CookType;
  position: number;
}

export const DAY_LABELS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

export const SLOT_LABELS: Record<MealSlot, string> = {
  lunch: 'Lunch',
  dinner: 'Dinner',
};

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const d = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Monday of the week containing `date`, as a local ISO date (YYYY-MM-DD). */
export function weekStart(date: Date): string {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (monday.getDay() + 6) % 7; // Monday=0 … Sunday=6
  monday.setDate(monday.getDate() - offset);
  return toIsoDate(monday);
}

/** Shift a week-start ISO date by `delta` weeks. */
export function addWeeks(weekStartIso: string, delta: number): string {
  const [y, m, d] = weekStartIso.split('-').map(Number);
  const date = new Date(y, m - 1, d + delta * 7);
  return toIsoDate(date);
}

/** The date (local) of `day` within the week starting at `weekStartIso`. */
export function dayDate(weekStartIso: string, day: number): Date {
  const [y, m, d] = weekStartIso.split('-').map(Number);
  return new Date(y, m - 1, d + day);
}

/** Entries for one (day, slot) cell, ordered by position. */
export function slotEntries<T extends { day: number; slot: MealSlot; position: number }>(
  entries: T[],
  day: number,
  slot: MealSlot
): T[] {
  return entries
    .filter((e) => e.day === day && e.slot === slot)
    .sort((a, b) => a.position - b.position);
}

export interface SlotCoverage {
  covered: string[];
  uncovered: string[];
}

/**
 * Who is covered in a slot. An entry with empty `person_ids` covers everyone.
 * Order follows the `persons` argument.
 */
export function slotCoverage(
  entries: Pick<PlanEntry, 'day' | 'slot' | 'position' | 'person_ids'>[],
  day: number,
  slot: MealSlot,
  persons: string[]
): SlotCoverage {
  const cell = entries.filter((e) => e.day === day && e.slot === slot);
  if (cell.length === 0) return { covered: [], uncovered: [...persons] };
  if (cell.some((e) => e.person_ids.length === 0)) {
    return { covered: [...persons], uncovered: [] };
  }
  const coveredSet = new Set(cell.flatMap((e) => e.person_ids));
  return {
    covered: persons.filter((p) => coveredSet.has(p)),
    uncovered: persons.filter((p) => !coveredSet.has(p)),
  };
}

export interface UpsertEntryInput {
  mealPlanId: string;
  day: number;
  slot: MealSlot;
  /** Exactly one of recipeId / customTitle must be provided (DB check 0003). */
  recipeId?: string;
  /** Free-text meal ("write down a specific meal"). */
  customTitle?: string;
  personIds?: string[];
  assignedCook?: CookType;
  position?: number;
}

/** Insert payload for a plan_entries row: a library recipe or a free-text meal. */
export function upsertEntryPayload(input: UpsertEntryInput) {
  const customTitle = input.customTitle?.trim();
  if (!input.recipeId && !customTitle) {
    throw new Error('A plan entry needs a recipe or a meal title.');
  }
  if (input.recipeId && customTitle) {
    throw new Error('A plan entry cannot have both a recipe and a custom title.');
  }
  return {
    meal_plan_id: input.mealPlanId,
    day: input.day,
    slot: input.slot,
    recipe_id: input.recipeId ?? null,
    custom_title: input.recipeId ? null : (customTitle as string),
    person_ids: input.personIds ?? [],
    assigned_cook: input.assignedCook ?? ('family' as CookType),
    position: input.position ?? 0,
  };
}

/** Delete filter for a plan_entries row. */
export function removeEntryPayload(entryId: string) {
  return { id: entryId };
}

/**
 * events rows logged when a week is approved: one 'planned' event per
 * (entry, covered person). Empty person_ids ⇒ every household person.
 * Custom meals log recipe_id null with meta.custom_title so history keeps
 * them (consistent with the companion's historical_meal imports).
 */
export function plannedEvents(
  entries: Pick<PlanEntry, 'recipe_id' | 'custom_title' | 'person_ids' | 'day' | 'slot'>[],
  householdId: string,
  persons: string[],
  weekStartIso: string
) {
  return entries.flatMap((entry) => {
    const eaters = entry.person_ids.length === 0 ? persons : entry.person_ids;
    return eaters.map((personId) => ({
      household_id: householdId,
      person_id: personId,
      recipe_id: entry.recipe_id,
      type: 'planned' as const,
      meta: {
        week_start: weekStartIso,
        day: entry.day,
        slot: entry.slot,
        ...(entry.custom_title ? { custom_title: entry.custom_title } : {}),
      },
    }));
  });
}
