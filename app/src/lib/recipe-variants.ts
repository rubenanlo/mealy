import { invalidateLists } from '@/lib/list-refresh';
import { supabase } from '@/lib/supabase';
import type { FodmapSwapResult, IngredientRow } from '@/lib/worker';

/**
 * Recipe variants (migration 0033): an AI-adapted copy saved next to its
 * original instead of overwriting it. A variant is a full `recipes` row linked
 * by `variant_of`, so plan entries, groceries and FODMAP flags work unchanged.
 */
export type VariantKind = 'low_fodmap' | 'custom';

export interface VariantFamily {
  /** Id of the original recipe (the row with variant_of = null). */
  originalId: string;
  /** Id of its low-FODMAP version, when one exists. */
  lowFodmapId: string | null;
  /** Id of the household's own "My version" (migration 0036), when one exists. */
  customId: string | null;
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

/** Resolve the original + version ids for whichever member of the family is open. */
export async function loadVariantFamily(recipe: {
  id: string;
  variant_of: string | null;
}): Promise<VariantFamily> {
  const originalId = recipe.variant_of ?? recipe.id;
  const { data } = await supabase
    .from('recipes')
    .select('id, variant_kind')
    .eq('variant_of', originalId);
  const rows = (data as { id: string; variant_kind: VariantKind }[] | null) ?? [];
  const idOf = (kind: VariantKind) => rows.find((r) => r.variant_kind === kind)?.id ?? null;
  return { originalId, lowFodmapId: idOf('low_fodmap'), customId: idOf('custom') };
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
  return saveVariant({
    kind: 'low_fodmap',
    original: input.original,
    userId: input.userId,
    content: {
      title: lowFodmapTitle(input.original.title, input.original.language),
      ingredients: input.ingredients,
      steps: input.steps,
      // The user accepted the swaps for this version; the engine still shows
      // per-line flags, the override only sets the byline badge.
      fodmap_override: null,
    },
  });
}

/**
 * Save (or replace) the household's "My version" of `original` (migration
 * 0036). One per original, shared by the household; the original row is
 * never written. `note` is the one-line summary shown under the toggle.
 */
export async function saveCustomVariant(input: {
  original: VariantSourceRecipe;
  ingredients: IngredientRow[];
  steps: string[];
  note: string | null;
  userId: string | null;
}): Promise<string> {
  return saveVariant({
    kind: 'custom',
    original: input.original,
    userId: input.userId,
    content: {
      title: input.original.title,
      ingredients: input.ingredients,
      steps: input.steps,
      variant_note: input.note,
    },
  });
}

/** Delete a version row (never an original: guarded by variant_of). */
export async function deleteVariant(id: string): Promise<void> {
  const { error } = await supabase.from('recipes').delete().eq('id', id).not('variant_of', 'is', null);
  if (error) throw new Error(error.message);
  invalidateLists('library', 'plan', 'groceries');
}

async function saveVariant(input: {
  kind: VariantKind;
  original: VariantSourceRecipe;
  userId: string | null;
  content: Record<string, unknown>;
}): Promise<string> {
  const { original, kind } = input;
  const content = { ...input.content, updated_at: new Date().toISOString() };
  const { data: existing } = await supabase
    .from('recipes')
    .select('id')
    .eq('variant_of', original.id)
    .eq('variant_kind', kind)
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
      variant_kind: kind,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Could not save the version');
  invalidateLists('library', 'plan', 'groceries');
  return (data as { id: string }).id;
}

/** Per-line markers for a version compared with its original (display only). */
export type LineChange = 'added' | 'changed' | null;

/**
 * Which ingredient lines and steps of a version differ from the original.
 * Ingredients pair by name: a name the original lacks is "added", a known
 * name with a different line is "changed". Steps are "changed" when their
 * text is not in the original.
 */
export function diffVersion(
  original: { ingredients: IngredientRow[]; steps: string[] },
  version: { ingredients: IngredientRow[]; steps: string[] }
): { ingredients: LineChange[]; steps: boolean[] } {
  const key = (s: string) => s.trim().toLowerCase();
  const raws = new Set(original.ingredients.map((i) => key(i.raw || i.name)));
  const names = new Set(original.ingredients.map((i) => key(i.name)));
  const steps = new Set(original.steps.map(key));
  return {
    ingredients: version.ingredients.map((i) =>
      raws.has(key(i.raw || i.name)) ? null : names.has(key(i.name)) ? 'changed' : 'added'
    ),
    steps: version.steps.map((s) => !steps.has(key(s))),
  };
}
