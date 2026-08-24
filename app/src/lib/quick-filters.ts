import type { ProteinCategory } from '@/lib/category';

/** Home-feed quick filters (spec Part 2). Stackable; protein chips OR
 *  within their group, everything else ANDs across groups. */
export type QuickFilter = 'under30' | 'fodmapFriendly' | 'meat' | 'fish' | 'vegetarian' | 'needsReview';

export const QUICK_FILTER_LABELS: Record<QuickFilter, string> = {
  under30: 'Under 30 min',
  fodmapFriendly: 'FODMAP-friendly',
  meat: 'Meat',
  fish: 'Fish',
  vegetarian: 'Vegetarian',
  needsReview: 'Needs review',
};

export const QUICK_FILTERS: readonly QuickFilter[] = [
  'under30',
  'fodmapFriendly',
  'meat',
  'fish',
  'vegetarian',
  'needsReview',
];

const PROTEIN_FILTERS: readonly QuickFilter[] = ['meat', 'fish', 'vegetarian'];

export interface QuickFilterInput {
  prep_minutes: number | null;
  cook_minutes: number | null;
  needs_review: boolean;
  category: ProteinCategory | null;
  /** null = not computable yet (no ingredients / index not loaded). */
  fodmapFriendly: boolean | null;
}

export function matchesQuickFilters(
  input: QuickFilterInput,
  active: ReadonlySet<QuickFilter>
): boolean {
  if (active.has('under30')) {
    // Total time, matching what the recipe card displays; a recipe with no
    // time data at all can't claim to be under 30.
    const known = input.prep_minutes !== null || input.cook_minutes !== null;
    const total = (input.prep_minutes ?? 0) + (input.cook_minutes ?? 0);
    if (!known || total > 30) return false;
  }
  if (active.has('fodmapFriendly') && input.fodmapFriendly !== true) return false;
  if (active.has('needsReview') && !input.needs_review) return false;
  const proteins = PROTEIN_FILTERS.filter((f) => active.has(f));
  if (proteins.length > 0) {
    // Vegan recipes satisfy the Vegetarian chip (vegan ⊂ vegetarian).
    const effective = input.category === 'vegan' ? 'vegetarian' : input.category;
    if (!proteins.includes(effective as QuickFilter)) return false;
  }
  return true;
}
