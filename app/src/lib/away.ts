import { awayIds, type MealSlot, type PlanAbsence } from '@/lib/plan';

/** One person home or away at one meal (same shape as HomeSheet's AwayChange). */
export interface AwayToggle {
  day: number;
  slot: MealSlot;
  personId: string;
  away: boolean;
}

export interface MealCell {
  day: number;
  slot: MealSlot;
}

const SLOTS: MealSlot[] = ['lunch', 'dinner'];

export const isAway = (absences: readonly PlanAbsence[], day: number, slot: MealSlot, personId: string) =>
  absences.some((a) => a.day === day && a.slot === slot && a.person_id === personId);

/**
 * A pattern chip ("Every weekday lunch", "The weekend") for one person
 * (design F3): if they're already out at every one of those meals, bring them
 * home; otherwise mark them out at the ones they're still home for.
 */
export function togglePattern(
  absences: readonly PlanAbsence[],
  personId: string,
  cells: readonly MealCell[]
): AwayToggle[] {
  if (cells.length === 0) return [];
  const allOut = cells.every((c) => isAway(absences, c.day, c.slot, personId));
  return cells
    .filter((c) => isAway(absences, c.day, c.slot, personId) === allOut)
    .map((c) => ({ ...c, personId, away: !allOut }));
}

/** Is a pattern fully on for this person? (chip shows as selected) */
export function patternOn(absences: readonly PlanAbsence[], personId: string, cells: readonly MealCell[]): boolean {
  return cells.length > 0 && cells.every((c) => isAway(absences, c.day, c.slot, personId));
}

/** Meals of the given days, lunch and dinner. */
export function cellsFor(days: readonly number[], slots: readonly MealSlot[] = SLOTS): MealCell[] {
  return days.flatMap((day) => slots.map((slot) => ({ day, slot })));
}

/** "Same as last week" for one person, over the given days only (past days stay as they are). */
export function copyLastWeek(
  absences: readonly PlanAbsence[],
  lastWeek: readonly PlanAbsence[],
  personId: string,
  days: readonly number[]
): AwayToggle[] {
  return cellsFor(days)
    .filter((c) => isAway(absences, c.day, c.slot, personId) !== isAway(lastWeek, c.day, c.slot, personId))
    .map((c) => ({ ...c, personId, away: isAway(lastWeek, c.day, c.slot, personId) }));
}

/** The meals one person is out for this week, in week order. */
export function mealsOut(absences: readonly PlanAbsence[], personId: string): MealCell[] {
  return cellsFor([0, 1, 2, 3, 4, 5, 6]).filter((c) => isAway(absences, c.day, c.slot, personId));
}

/** Meals where someone is out, with who's still home (design F3 summary). */
export function thinnerMeals(
  absences: readonly PlanAbsence[],
  eaterIds: readonly string[]
): (MealCell & { home: string[] })[] {
  return cellsFor([0, 1, 2, 3, 4, 5, 6])
    .map((c) => {
      const away = awayIds(absences, c.day, c.slot);
      return { ...c, home: eaterIds.filter((id) => !away.has(id)) };
    })
    .filter((c) => c.home.length < eaterIds.length);
}
