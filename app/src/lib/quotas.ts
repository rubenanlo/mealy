import { coreProteins } from '@/lib/category';

export interface QuotaTarget {
  category: string;
  min: number;
  max: number | null;
}

export interface QuotaProgress {
  category: string;
  planned: number;
  min: number;
  max: number | null;
}

export interface QuotaEntry {
  /** Null for free-text meals — they carry no tags, so no category counts. */
  recipe_id: string | null;
  /** Empty array ⇒ the whole household eats this entry. */
  person_ids: string[];
}

export interface QuotaRecipe {
  id: string;
  tags: string[];
  category?: string | null;
}

/** Does this plan entry cover this person? Empty person_ids covers everyone. */
export function entryCoversPerson(entry: QuotaEntry, personId: string): boolean {
  return entry.person_ids.length === 0 || entry.person_ids.includes(personId);
}

/**
 * Per-person protein quota progress for one week's entries.
 * A recipe counts toward a category when its tags include that category.
 * A 'fish & meat' recipe advances both the fish and the meat quota.
 * Only entries that cover the person are counted (spec §2 proteinQuotas).
 */
export function quotaProgress(
  entries: QuotaEntry[],
  personId: string,
  recipes: QuotaRecipe[],
  targets: QuotaTarget[]
): QuotaProgress[] {
  const categoriesById = new Map(
    recipes.map((r) => {
      const sources = [...(r.category ? [r.category] : []), ...r.tags];
      return [r.id, new Set(sources.flatMap(coreProteins))];
    })
  );
  const eaten = entries.filter((e) => entryCoversPerson(e, personId));
  return targets.map((target) => ({
    category: target.category,
    planned: eaten.filter(
      (e) => e.recipe_id !== null && categoriesById.get(e.recipe_id)?.has(target.category)
    ).length,
    min: target.min,
    max: target.max,
  }));
}
