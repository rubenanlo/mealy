import { invalidateLists } from '@/lib/list-refresh';
import { supabase } from '@/lib/supabase';
import type { FodmapSwapResult, IngredientRow } from '@/lib/worker';

/**
 * Recipe variants (migration 0033): an AI-adapted copy saved next to its
 * original instead of overwriting it. A variant is a full `recipes` row linked
 * by `variant_of`, so plan entries, groceries and FODMAP flags work unchanged.
 */
export type VariantKind = 'low_fodmap';

export interface VariantFamily {
  /** Id of the original recipe (the row with variant_of = null). */
  originalId: string;
  /** Id of its low-FODMAP version, when one exists. */
  lowFodmapId: string | null;
}

/** Title suffix in the recipe's own language; translations carry it onward. */
const LOW_FODMAP_SUFFIX: Record<string, string> = {
  en: 'low-FODMAP',
  es: 'bajo en FODMAP',
  fr: 'pauvre en FODMAP',
  it: 'basso FODMAP',
};

export function lowFodmapTitle(title: string, language: string): string {
  const suffix = LOW_FODMAP_SUFFIX[language] ?? LOW_FODMAP_SUFFIX.en;
  const base = title.trim();
  return base.endsWith(`(${suffix})`) ? base : `${base} (${suffix})`;
}

/**
 * Apply the accepted swaps to the ingredient list. `raw` is rebased onto the
 * replacement's name so the FODMAP engine matches the new ingredient instead
 * of re-flagging the original line.
 */
export function applySwapSelection(
  ingredients: IngredientRow[],
  swaps: FodmapSwapResult['swaps'],
  accepted: ReadonlySet<string>
): IngredientRow[] {
  const byRaw = new Map(swaps.filter((s) => accepted.has(s.raw)).map((s) => [s.raw, s.replacement]));
  return ingredients.map((ing) => {
    const rep = byRaw.get(ing.raw || ing.name);
    return rep ? { ...rep, raw: rep.name } : ing;
  });
}

/** Resolve the original + low-FODMAP ids for whichever member of the family is open. */
export async function loadVariantFamily(recipe: {
  id: string;
  variant_of: string | null;
}): Promise<VariantFamily> {
  const originalId = recipe.variant_of ?? recipe.id;
  const { data } = await supabase
    .from('recipes')
    .select('id')
    .eq('variant_of', originalId)
    .eq('variant_kind', 'low_fodmap')
    .maybeSingle();
  return { originalId, lowFodmapId: (data as { id: string } | null)?.id ?? null };
}

/** Columns copied from the original onto a new variant row. */
export interface VariantSourceRecipe {
  id: string;
  household_id: string;
  title: string;
  language: string;
  servings: number | null;
  prep_minutes: number | null;
  cook_minutes: number | null;
  dish_type: string | null;
  tags: string[];
  meal_type: string | null;
  cover_image_path: string | null;
  cover_focal: { x: number; y: number } | null;
}

/**
 * Save (or refresh) the low-FODMAP version of `original`. One per original:
 * a second run updates the existing row rather than adding another. Returns
 * the variant's id. The original row is never written.
 */
export async function saveLowFodmapVariant(input: {
  original: VariantSourceRecipe;
  ingredients: IngredientRow[];
  steps: string[];
  userId: string | null;
}): Promise<string> {
  const { original } = input;
  const content = {
    title: lowFodmapTitle(original.title, original.language),
    ingredients: input.ingredients,
    steps: input.steps,
    // The user accepted the swaps for this version; the engine still shows
    // per-line flags, the override only sets the byline badge.
    fodmap_override: null,
    updated_at: new Date().toISOString(),
  };
  const { data: existing } = await supabase
    .from('recipes')
    .select('id')
    .eq('variant_of', original.id)
    .eq('variant_kind', 'low_fodmap')
    .maybeSingle();
  if (existing) {
    const id = (existing as { id: string }).id;
    const { error } = await supabase.from('recipes').update(content).eq('id', id);
    if (error) throw new Error(error.message);
    invalidateLists('library', 'plan', 'groceries');
    return id;
  }
  const { data, error } = await supabase
    .from('recipes')
    .insert({
      ...content,
      household_id: original.household_id,
      language: original.language,
      servings: original.servings,
      prep_minutes: original.prep_minutes,
      cook_minutes: original.cook_minutes,
      dish_type: original.dish_type,
      tags: original.tags,
      meal_type: original.meal_type,
      cover_image_path: original.cover_image_path,
      cover_focal: original.cover_focal,
      created_by: input.userId,
      variant_of: original.id,
      variant_kind: 'low_fodmap' satisfies VariantKind,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not save the version');
  invalidateLists('library', 'plan', 'groceries');
  return (data as { id: string }).id;
}
