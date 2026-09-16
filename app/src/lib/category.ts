import type { Palette } from '@/lib/theme';
import { matchCanonical, normalizeRaw, type CanonicalIndex } from '@/lib/canonical';

/**
 * Protein category behind the signature "category spine" (design.md).
 * Derived from recipe.tags — same Phase 1 convention as quotaProgress.
 */
export type ProteinCategory = 'fish & meat' | 'fish' | 'meat' | 'vegan' | 'vegetarian' | 'legume';

/** Priority order: the first tag present wins (vegan outranks vegetarian). */
export const PROTEIN_CATEGORIES: readonly ProteinCategory[] = [
  'fish & meat',
  'fish',
  'meat',
  'vegan',
  'vegetarian',
  'legume',
] as const;

export const CATEGORY_LABELS: Record<ProteinCategory, string> = {
  'fish & meat': 'Fish & meat',
  fish: 'Fish',
  meat: 'Meat',
  vegan: 'Vegan',
  vegetarian: 'Vegetarian',
  legume: 'Legumes',
};

/**
 * The core proteins a category stands for — 'fish & meat' is both at once,
 * so quotas and the planner treat such a meal as fish AND meat. Accepts the
 * plain strings quotas/auto-plan carry.
 */
export function coreProteins(category: string): string[] {
  return category === 'fish & meat' ? ['fish', 'meat'] : [category];
}

/**
 * First matching category tag wins (fish > meat > vegetarian > legume);
 * `null` when the recipe carries no category tag — absence is information,
 * so callers render no spine.
 */
export function deriveCategory(tags: readonly string[]): ProteinCategory | null {
  for (const category of PROTEIN_CATEGORIES) {
    if (tags.includes(category)) return category;
  }
  return null;
}

// Conservative on purpose: only unambiguous dessert words, so "sweet potato"
// or "crab cakes" never match. Safety net for recipes whose meal_type was
// never set but whose extracted dish_type says dessert.
const DESSERT_RE = /\b(desserts?|postres?|dolci|dolce|sobremesas?|goûters?)\b|sweets?$/i;

/** True when the dish type or tags mark this recipe as a dessert. */
export function looksLikeDessert(dishType: string | null | undefined, tags: readonly string[]): boolean {
  if (dishType && DESSERT_RE.test(dishType)) return true;
  return tags.some((t) => DESSERT_RE.test(t));
}

/** Spine color for a category; transparent when unknown (no spine). */
export function spineColor(category: ProteinCategory | null, colors: Palette): string {
  switch (category) {
    case 'fish':
    case 'fish & meat': // single-color fallback; CategoryDot splits the two tones
      return colors.spineFish;
    case 'meat':
      return colors.spineMeat;
    case 'vegan':
    case 'vegetarian':
      return colors.spineVeg;
    case 'legume':
      return colors.spineLegume;
    default:
      return 'transparent';
  }
}

export interface NamedIngredient {
  raw?: string | null;
  name: string;
}

const PROTEIN_SET: ReadonlySet<string> = new Set(PROTEIN_CATEGORIES);

/**
 * Derive the protein category from the ingredients themselves via the
 * canonical table (spec Part 1) — the tags-based path stays as fallback.
 */
export function proteinCategoryFromIngredients(
  ingredients: readonly NamedIngredient[],
  index: CanonicalIndex
): ProteinCategory | null {
  const found = new Set<string>();
  for (const item of ingredients) {
    const match =
      matchCanonical(normalizeRaw(item.raw || item.name), index) ??
      matchCanonical(normalizeRaw(item.name), index);
    const category = match?.ingredient.category;
    if (category && PROTEIN_SET.has(category)) found.add(category);
  }
  if (found.has('fish') && found.has('meat')) return 'fish & meat';
  for (const category of PROTEIN_CATEGORIES) {
    if (found.has(category)) return category;
  }
  return null;
}

/**
 * An explicit category tag is a manual override and wins; ingredient
 * derivation covers the untagged (Auto) case — matching the byline picker,
 * where "Auto" removes the tag.
 */
export function resolveProteinCategory(
  tags: readonly string[],
  ingredients: readonly NamedIngredient[] | null | undefined,
  index: CanonicalIndex | null
): ProteinCategory | null {
  const tagged = deriveCategory(tags);
  if (tagged) return tagged;
  if (index && ingredients && ingredients.length > 0) {
    return proteinCategoryFromIngredients(ingredients, index);
  }
  return null;
}
