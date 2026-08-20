import type { Palette } from '@/lib/theme';

/**
 * Protein category behind the signature "category spine" (design.md).
 * Derived from recipe.tags — same Phase 1 convention as quotaProgress.
 */
export type ProteinCategory = 'fish' | 'meat' | 'vegetarian' | 'legume';

export const PROTEIN_CATEGORIES: readonly ProteinCategory[] = [
  'fish',
  'meat',
  'vegetarian',
  'legume',
] as const;

export const CATEGORY_LABELS: Record<ProteinCategory, string> = {
  fish: 'Fish',
  meat: 'Meat',
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
    case 'vegetarian':
      return colors.spineVeg;
    case 'legume':
      return colors.spineLegume;
    default:
      return 'transparent';
  }
}
