// Copy a week's meals into another week (used by the week page and the
// Meal plans home's past-week sheet).

import type { PlanEntry } from '@/lib/plan';
import { supabase } from '@/lib/supabase';

export type CopyableEntry = Pick<
  PlanEntry,
  'day' | 'slot' | 'recipe_id' | 'custom_title' | 'person_ids' | 'guest_count' | 'assigned_cook' | 'position'
> & { cook_part?: boolean | null; instructions?: string | null };

/** The target week's plan id (if any) and how many meals it already holds. */
export async function weekEntryCount(
  householdId: string,
  week: string
): Promise<{ planId: string | null; count: number }> {
  const { data } = await supabase
    .from('meal_plans')
    .select('id, plan_entries(count)')
    .eq('household_id', householdId)
    .eq('week_start', week)
    .maybeSingle();
  const row = data as { id: string; plan_entries?: { count: number }[] } | null;
  return { planId: row?.id ?? null, count: row?.plan_entries?.[0]?.count ?? 0 };
}

/** Replace the target week's meals with `entries` (creating the plan if needed). */
export async function copyEntriesToWeek(
  householdId: string,
  entries: readonly CopyableEntry[],
  week: string,
  existingPlanId: string | null
): Promise<boolean> {
  let planId = existingPlanId;
  if (!planId) {
    const { data: created } = await supabase
      .from('meal_plans')
      .insert({ household_id: householdId, week_start: week })
      .select('id')
      .single();
    planId = (created?.id as string | undefined) ?? null;
  } else {
    await supabase.from('plan_entries').delete().eq('meal_plan_id', planId);
  }
  if (!planId) return false;
  const { error } = await supabase.from('plan_entries').insert(
    entries.map((e) => ({
      meal_plan_id: planId,
      day: e.day,
      slot: e.slot,
      recipe_id: e.recipe_id,
      custom_title: e.custom_title,
      person_ids: e.person_ids,
      guest_count: e.guest_count,
      assigned_cook: e.assigned_cook,
      position: e.position,
      cook_part: e.cook_part ?? false,
      instructions: e.instructions ?? null,
    }))
  );
  return !error;
}
