import type { Locale } from '@/lib/i18n';
import { supabase } from '@/lib/supabase';
import type { IngredientRow } from '@/lib/worker';

/**
 * Derived translation layer (spec 2026-08-25-recipe-translations-design.md).
 * Rows live in recipe_translations per supported locale except the recipe's
 * own language; display falls back to the original when a row is absent.
 * Translations regenerate wholesale on any content edit, so they never go stale.
 */

export interface TranslationRow {
  locale: string;
  title: string;
  ingredients: IngredientRow[];
  steps: string[];
}

export interface RecipeContent {
  title: string;
  language: string | null;
  ingredients: IngredientRow[];
  steps: string[];
}

/** Title for the active locale from an embedded recipe_translations select. */
export function localizedTitle(
  row: { title: string; recipe_translations?: { locale: string; title: string }[] | null },
  locale: Locale
): string {
  return row.recipe_translations?.find((t) => t.locale === locale)?.title ?? row.title;
}

/** Full content for the active locale, falling back to the original. */
export function localizeContent(
  recipe: RecipeContent,
  translation: TranslationRow | null
): { title: string; ingredients: IngredientRow[]; steps: string[] } {
  if (!translation) {
    return { title: recipe.title, ingredients: recipe.ingredients, steps: recipe.steps };
  }
  return {
    title: translation.title,
    ingredients: translation.ingredients,
    steps: translation.steps,
  };
}

interface WorkerTranslateReply {
  source_language: string;
  translations: Record<string, { title: string; ingredients: IngredientRow[]; steps: string[] }>;
}

/**
 * Translate a recipe's canonical content via the worker and replace its
 * translation rows. Returns false (writing nothing) on any worker failure —
 * the app keeps showing the original until a later attempt succeeds.
 */
export async function translateAndStore(recipeId: string, content: RecipeContent): Promise<boolean> {
  const workerUrl = process.env.EXPO_PUBLIC_WORKER_URL;
  if (!workerUrl) return false;
  let reply: WorkerTranslateReply;
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    const response = await fetch(`${workerUrl}/translate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: content.title,
        language: content.language,
        ingredients: content.ingredients,
        steps: content.steps,
      }),
    });
    if (!response.ok) return false;
    reply = (await response.json()) as WorkerTranslateReply;
  } catch {
    return false;
  }

  const rows = Object.entries(reply.translations).map(([locale, t]) => ({
    recipe_id: recipeId,
    locale,
    title: t.title,
    ingredients: t.ingredients,
    steps: t.steps,
    translated_at: new Date().toISOString(),
  }));
  // Replace wholesale: drop rows for locales no longer produced (e.g. the
  // detected source language), then upsert the fresh set.
  await supabase.from('recipe_translations').delete().eq('recipe_id', recipeId);
  const { error } = await supabase
    .from('recipe_translations')
    .upsert(rows, { onConflict: 'recipe_id,locale' });
  if (error) return false;

  const detected = reply.source_language;
  if (detected && detected !== content.language) {
    await supabase.from('recipes').update({ language: detected }).eq('id', recipeId);
  }
  return true;
}

/** Fire-and-forget: never blocks UX; failures leave the original displayed. */
export function queueRecipeTranslation(recipeId: string, content: RecipeContent): void {
  void translateAndStore(recipeId, content).catch(() => {});
}
