// What deleting a week's plan removes, for the delete sheet on the week page.
// Deleting the meal_plans row cascades its plan_entries and plan_absences
// (0001, 0031) and takes employee_notes with it; plan_ideas are keyed by
// week_start, so they stay unless removed on purpose.

import type { MealSlot, PlanAbsence, PlanEntry } from '@/lib/plan';

export interface WeekDeleteSummary {
  /** Lunches and dinners holding at least one dish. */
  meals: number;
  /** Meals at which at least one household member eats out. */
  eatingOut: number;
  /** Household members eating out at least once (the "N out" badge). */
  eatingOutPeople: number;
  /** Meals the employee cooks (whole dish or part of it). */
  employeeMeals: number;
  /** The employee's other tasks that week (ironing, sewing…). */
  tasks: number;
  /** Approved and the employee has a link: her page empties after this. */
  warnEmployee: boolean;
  /** Ideas parked for this week; kept unless the user ticks them too. */
  ideas: number;
}

const slotKey = (day: number, slot: MealSlot) => `${day}:${slot}`;

export function weekDeleteSummary(input: {
  entries: readonly Pick<PlanEntry, 'day' | 'slot' | 'assigned_cook'>[];
  absences: readonly PlanAbsence[];
  eaterIds: readonly string[];
  employeeNotes: readonly string[] | null | undefined;
  approved: boolean;
  employeeHasLink: boolean;
  ideas: number;
}): WeekDeleteSummary {
  const meals = new Set(input.entries.map((e) => slotKey(e.day, e.slot)));
  const employeeMeals = new Set(
    input.entries.filter((e) => e.assigned_cook === 'employee').map((e) => slotKey(e.day, e.slot))
  );
  const eaters = new Set(input.eaterIds);
  const away = input.absences.filter((a) => eaters.has(a.person_id));
  const eatingOut = new Set(away.map((a) => slotKey(a.day, a.slot)));
  const eatingOutPeople = new Set(away.map((a) => a.person_id));
  const tasks = (input.employeeNotes ?? []).filter((n) => n.trim().length > 0).length;
  return {
    meals: meals.size,
    eatingOut: eatingOut.size,
    eatingOutPeople: eatingOutPeople.size,
    employeeMeals: employeeMeals.size,
    tasks,
    warnEmployee: input.approved && input.employeeHasLink && (employeeMeals.size > 0 || tasks > 0),
    ideas: input.ideas,
  };
}
