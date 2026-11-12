/**
 * Cross-language search: recipes carry their original title and ingredients
 * plus one set per translated locale, and a query should hit any of them
 * regardless of accents or case ("calabacin" finds "Calabacín", and finds a
 * French recipe whose Spanish ingredient list has calabacín in it).
 */

export function foldForSearch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function titleMatches(titles: readonly string[], query: string): boolean {
  const q = foldForSearch(query.trim());
  if (!q) return true;
  return titles.some((title) => foldForSearch(title).includes(q));
}

interface SearchableVariant {
  title: string;
  ingredients?: readonly { name?: string | null }[] | null;
}

/**
 * Every string a query may match for one recipe: the title and ingredient
 * names of the original plus each translation. Ingredient names rather than
 * raw lines, so "200" never matches a quantity.
 */
export function searchTerms(variants: readonly SearchableVariant[]): string[] {
  const terms: string[] = [];
  for (const v of variants) {
    terms.push(v.title);
    for (const ing of v.ingredients ?? []) {
      if (ing.name) terms.push(ing.name);
    }
  }
  return terms;
}
