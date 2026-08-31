/**
 * Cross-language title search: recipes carry their original title plus one
 * per translated locale, and a query should hit any of them regardless of
 * accents or case ("calabacin" finds "Calabacín").
 */

export function foldForSearch(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function titleMatches(titles: readonly string[], query: string): boolean {
  const q = foldForSearch(query.trim());
  if (!q) return true;
  return titles.some((title) => foldForSearch(title).includes(q));
}
