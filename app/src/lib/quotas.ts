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
  recipe_id: string;
  /** Empty array ⇒ the whole household eats this entry. */
  person_ids: string[];
}

export interface QuotaRecipe {
  id: string;
  tags: string[];
}

/** Does this plan entry cover this person? Empty person_ids covers everyone. */
export function entryCoversPerson(entry: QuotaEntry, personId: string): boolean {
  return entry.person_ids.length === 0 || entry.person_ids.includes(personId);
}

/**
 * Per-person protein quota progress for one week's entries.
 * A recipe counts toward a category when its tags include that category.
 * Only entries that cover the person are counted (spec §2 proteinQuotas).
 */
export function quotaProgress(
  entries: QuotaEntry[],
  personId: string,
  recipes: QuotaRecipe[],
  targets: QuotaTarget[]
): QuotaProgress[] {
  const tagsById = new Map(recipes.map((r) => [r.id, r.tags]));
  const eaten = entries.filter((e) => entryCoversPerson(e, personId));
  return targets.map((target) => ({
    category: target.category,
    planned: eaten.filter((e) => (tagsById.get(e.recipe_id) ?? []).includes(target.category))
      .length,
    min: target.min,
    max: target.max,
  }));
}
