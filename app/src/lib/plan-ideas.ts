import { addWeeks, dayDate, weekStart } from '@/lib/plan';

/**
 * A meal parked for a week without a day yet (migration 0037). Keyed by
 * household + week_start, so it can exist before the week has a plan.
 */
export interface PlanIdea {
  id: string;
  household_id: string;
  week_start: string;
  recipe_id: string | null;
  custom_title: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
}

/** How many week chips the planning sheets offer (this week + 7 ahead). */
export const WEEK_CHOICES = 8;

/**
 * Week the "Add to plan" sheet opens on: this week, except on Sunday, when
 * only a day is left, so next week is the likelier target.
 */
export function defaultTargetWeek(now: Date = new Date()): string {
  const current = weekStart(now);
  return now.getDay() === 0 ? addWeeks(current, 1) : current;
}

/** The selectable weeks, starting with the current one. */
export function weekChoices(now: Date = new Date(), count = WEEK_CHOICES): string[] {
  const current = weekStart(now);
  return Array.from({ length: count }, (_, i) => addWeeks(current, i));
}

/** True when `day` of `weekIso` is before today (past meals can't be added). */
export function isPastDay(weekIso: string, day: number, now: Date = new Date()): boolean {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return dayDate(weekIso, day).getTime() < today.getTime();
}

export interface IdeaInput {
  householdId: string;
  weekStart: string;
  /** Exactly one of recipeId / customTitle (DB check plan_ideas_recipe_or_title). */
  recipeId?: string | null;
  customTitle?: string | null;
  note?: string | null;
}

/** Insert payload for a plan_ideas row. */
export function ideaPayload(input: IdeaInput) {
  const customTitle = input.customTitle?.trim();
  if (!input.recipeId && !customTitle) {
    throw new Error('An idea needs a recipe or a meal title.');
  }
  if (input.recipeId && customTitle) {
    throw new Error('An idea cannot have both a recipe and a custom title.');
  }
  return {
    household_id: input.householdId,
    week_start: input.weekStart,
    recipe_id: input.recipeId ?? null,
    custom_title: input.recipeId ? null : (customTitle as string),
    note: input.note?.trim() || null,
  };
}

/** Idea counts per week_start. */
export function ideaCounts(ideas: readonly Pick<PlanIdea, 'week_start'>[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const idea of ideas) counts.set(idea.week_start, (counts.get(idea.week_start) ?? 0) + 1);
  return counts;
}
