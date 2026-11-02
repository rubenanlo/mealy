import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';

import { notify } from '@/lib/confirm';
import type { IngredientRow } from '@/lib/worker';

/**
 * Sharing one recipe from its page. Recipes are household-private (RLS), so
 * the app link only opens for members; the message therefore carries the
 * whole recipe as plain text so anyone it is sent to can cook from it.
 */

/** Web app origin (Cloudflare worker `mealy-app`). */
export const APP_ORIGIN = 'https://app.rawdev.link';

export function recipeUrl(recipeId: string): string {
  return `${APP_ORIGIN}/recipe/${encodeURIComponent(recipeId)}`;
}

export interface ShareableRecipe {
  id: string;
  title: string;
  /** Pre-formatted, localized meta bits, e.g. ["4 servings", "Prep 10 min"]. */
  meta: string[];
  ingredients: IngredientRow[];
  steps: string[];
}

export interface RecipeShareLabels {
  ingredients: string;
  steps: string;
  /** Line shown before the app link, e.g. "Open in Mealy". */
  openInMealy: string;
}

function ingredientLine(ing: IngredientRow): string {
  const raw = ing.raw?.trim();
  if (raw) return raw;
  return [ing.quantity, ing.unit, ing.name].filter((v) => v != null && v !== '').join(' ');
}

export function buildRecipeShareText(recipe: ShareableRecipe, labels: RecipeShareLabels): string {
  const blocks: string[] = [];
  const head = [recipe.title.trim()];
  if (recipe.meta.length > 0) head.push(recipe.meta.join(' · '));
  blocks.push(head.join('\n'));

  const ingredientLines: string[] = [];
  let group: string | null = null;
  for (const ing of recipe.ingredients) {
    const line = ingredientLine(ing);
    if (!line) continue;
    if (ing.group && ing.group !== group) {
      if (ingredientLines.length > 0) ingredientLines.push('');
      ingredientLines.push(`${ing.group}:`);
    }
    group = ing.group;
    ingredientLines.push(`- ${line}`);
  }
  if (ingredientLines.length > 0) blocks.push([labels.ingredients, ...ingredientLines].join('\n'));

  const steps = recipe.steps.map((s) => s.trim()).filter(Boolean);
  if (steps.length > 0) {
    blocks.push([labels.steps, ...steps.map((s, i) => `${i + 1}. ${s}`)].join('\n'));
  }

  blocks.push(`${labels.openInMealy}: ${recipeUrl(recipe.id)}`);
  return blocks.join('\n\n');
}

function isUserCancel(err: unknown): boolean {
  // Web Share API rejects with AbortError when the person closes the sheet.
  return err instanceof Error && err.name === 'AbortError';
}

/**
 * Open the system share sheet with the recipe text + link. Where no sheet
 * exists (desktop web), copy the text and say so via `copiedTitle`.
 */
export async function shareRecipe(
  recipe: ShareableRecipe,
  labels: RecipeShareLabels,
  copiedTitle: string
): Promise<void> {
  const message = buildRecipeShareText(recipe, labels);
  try {
    // The link already ends the message; passing `url` too makes iOS apps
    // (WhatsApp, Messages) show it twice. Web maps `message` to `text`.
    await Share.share({ title: recipe.title, message }, { subject: recipe.title });
  } catch (err) {
    if (isUserCancel(err)) return;
    await Clipboard.setStringAsync(message);
    notify(copiedTitle);
  }
}
