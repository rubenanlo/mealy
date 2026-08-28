import { type MealSlot, upsertEntryPayload } from '@/lib/plan';
import { invalidateLists } from '@/lib/list-refresh';
import { supabase } from '@/lib/supabase';

/** Placeholder title for a manually created recipe before the user names it. */
export const BLANK_RECIPE_TITLE = 'New recipe';

interface TouchableRecipe {
  ingredients: unknown[];
  steps: unknown[];
  cover_image_path: string | null;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
}

/**
 * A manually created recipe is "untouched" when it holds no real content:
 * no ingredients, no steps, no cover, no servings or times. The title alone
 * does not count — a blank we can safely delete if the user backs out.
 */
export function isRecipeUntouched(r: TouchableRecipe): boolean {
  return (
    r.ingredients.length === 0 &&
    r.steps.length === 0 &&
    !r.cover_image_path &&
    r.servings == null &&
    r.prep_minutes == null &&
    r.cook_minutes == null
  );
}

/** Inserts a minimal recipe row (the only content is an optional title) and returns its id. */
export async function createBlankRecipe(input: {
  householdId: string;
  title?: string;
  userId?: string | null;
}): Promise<string> {
  const { data, error } = await supabase
    .from('recipes')
    .insert({
      household_id: input.householdId,
      title: input.title?.trim() || BLANK_RECIPE_TITLE,
      created_by: input.userId ?? null,
    })
    .select('id')
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

/**
 * Place a recipe into a specific planner slot, creating the week's meal_plan if
 * needed. Defaults to the whole household, no guests, family cook — the user
 * tweaks the entry afterward. Mirrors AddToWeekSheet's insert path.
 */
export async function assignRecipeToSlot(input: {
  householdId: string;
  recipeId: string;
  weekIso: string;
  day: number;
  slot: MealSlot;
}): Promise<void> {
  let { data: plan } = await supabase
    .from('meal_plans')
    .select('id')
    .eq('household_id', input.householdId)
    .eq('week_start', input.weekIso)
    .maybeSingle();
  if (!plan) {
    const { data: created, error: createErr } = await supabase
      .from('meal_plans')
      .insert({ household_id: input.householdId, week_start: input.weekIso })
      .select('id')
      .single();
    if (createErr || !created) throw new Error(createErr?.message ?? 'Could not create the week');
    plan = created;
  }
  const { count } = await supabase
    .from('plan_entries')
    .select('id', { count: 'exact', head: true })
    .eq('meal_plan_id', plan.id)
    .eq('day', input.day)
    .eq('slot', input.slot);
  const payload = upsertEntryPayload({
    mealPlanId: plan.id as string,
    day: input.day,
    slot: input.slot,
    recipeId: input.recipeId,
    position: count ?? 0,
  });
  const { error: insertErr } = await supabase.from('plan_entries').insert(payload);
  invalidateLists('plan', 'groceries');
  if (insertErr) throw new Error(insertErr.message);
}
