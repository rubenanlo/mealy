import type { Palette } from '@/lib/theme';
import { matchCanonical, normalizeRaw, type CanonicalIndex } from '@/lib/canonical';

/**
 * Protein category behind the signature "category spine" (design.md).
 * Derived from recipe.tags — same Phase 1 convention as quotaProgress.
 */
export type ProteinCategory = 'fish' | 'meat' | 'vegan' | 'vegetarian' | 'legume';

/** Priority order: the first tag present wins (vegan outranks vegetarian). */
export const PROTEIN_CATEGORIES: readonly ProteinCategory[] = [
  'fish',
  'meat',
  'vegan',
  'vegetarian',
  'legume',
] as const;

export const CATEGORY_LABELS: Record<ProteinCategory, string> = {
  fish: 'Fish',
  meat: 'Meat',
  vegan: 'Vegan',
  vegetarian: 'Vegetarian',
  legume: 'Legumes',
};

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

/** Spine color for a category; transparent when unknown (no spine). */
export function spineColor(category: ProteinCategory | null, colors: Palette): string {
  switch (category) {
    case 'fish':
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
  for (const category of PROTEIN_CATEGORIES) {
    if (found.has(category)) return category;
  }
  return null;
}

/** Ingredient-derived category wins; tags are the fallback (nothing regresses). */
export function resolveProteinCategory(
  tags: readonly string[],
  ingredients: readonly NamedIngredient[] | null | undefined,
  index: CanonicalIndex | null
): ProteinCategory | null {
  if (index && ingredients && ingredients.length > 0) {
    const derived = proteinCategoryFromIngredients(ingredients, index);
    if (derived) return derived;
  }
  return deriveCategory(tags);
}
