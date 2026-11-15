/**
 * Recipe search that forgives typos and ignores the app language.
 *
 * Each recipe is indexed with its original title and ingredient names plus
 * every translated variant (en/es/fr/it), so "cerdo", "porc", "maiale" and
 * "pork" all find the same recipes whatever locale the app is set to.
 *
 * Matching is per word: every query word must hit some word of the recipe.
 * A word hits exactly when it is a substring of a recipe word (prefix only for
 * one- and two-letter words). Only when a query word has no exact hit anywhere
 * in the library do we fall back to fuzzy matching (the closest words within
 * 1 typo for 4-7 letters, 2 from 8), so "chiken" finds chicken but "pasta" never drags in
 * "tomato paste".
 *
 * Results are ranked: whole-query title hits, then title word hits, then
 * ingredient hits, with fuzzy hits below exact ones.
 */

export function foldForSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function words(s: string): string[] {
  return foldForSearch(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Kept for simple pickers: accent/case-insensitive substring over any variant. */
export function titleMatches(titles: readonly string[], query: string): boolean {
  const q = foldForSearch(query.trim());
  if (!q) return true;
  return titles.some((title) => foldForSearch(title).includes(q));
}

export interface SearchDoc {
  /** Original title plus every translated title. */
  titles: readonly string[];
  /** Ingredient names, original plus every translation. */
  ingredients: readonly string[];
}

interface IndexedDoc {
  fullTitles: string[];
  titleWords: Set<string>;
  ingredientWords: Set<string>;
}

export interface SearchIndex {
  docs: IndexedDoc[];
  vocabulary: string[];
}

export function buildSearchIndex(docs: readonly SearchDoc[]): SearchIndex {
  const vocab = new Set<string>();
  const indexed = docs.map((doc) => {
    const titleWords = new Set(doc.titles.flatMap(words));
    const ingredientWords = new Set(doc.ingredients.flatMap(words));
    titleWords.forEach((w) => vocab.add(w));
    ingredientWords.forEach((w) => vocab.add(w));
    return {
      fullTitles: doc.titles.map(foldForSearch),
      titleWords,
      ingredientWords,
    };
  });
  return { docs: indexed, vocabulary: [...vocab] };
}

function exactHit(token: string, word: string): boolean {
  return token.length < 3 ? word.startsWith(token) : word.includes(token);
}

export function maxTypos(token: string): number {
  if (token.length < 4) return 0;
  return token.length < 8 ? 1 : 2;
}

/**
 * Optimal-string-alignment distance between `token` and `word`, capped at
 * `max` + 1. With `prefix`, compares against the closest prefix of `word`
 * instead, so a half-typed word still matches.
 */
export function editDistance(token: string, word: string, max: number, prefix = false): number {
  const m = token.length;
  if (word.length < m - max || (!prefix && word.length > m + max)) return max + 1;
  const n = prefix ? Math.min(word.length, m + max) : word.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = token[i - 1] === word[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && token[i - 1] === word[j - 2] && token[i - 2] === word[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  if (!prefix) return Math.min(prev[n], max + 1);
  let best = max + 1;
  for (let j = Math.max(0, m - max); j <= n; j++) best = Math.min(best, prev[j]);
  return best;
}

/**
 * Vocabulary words that look like a typo of `token`: closest whole words
 * first, half-typed prefixes only when no whole word is close. The first
 * letter must match (people rarely mistype it, and it keeps "polo" from
 * pulling in "solo").
 */
function fuzzyWords(token: string, vocabulary: readonly string[]): Set<string> {
  const max = maxTypos(token);
  if (max === 0) return new Set();
  const candidates = vocabulary.filter((w) => w[0] === token[0]);
  for (const prefix of [false, true]) {
    let best = max + 1;
    let found: string[] = [];
    for (const w of candidates) {
      const d = editDistance(token, w, max, prefix);
      if (d < best) {
        best = d;
        found = [w];
      } else if (d === best && d <= max) {
        found.push(w);
      }
    }
    if (found.length > 0) return new Set(found);
  }
  return new Set();
}

const SCORE = {
  wholeTitle: 100,
  titleExact: 10,
  titleFuzzy: 6,
  ingredientExact: 3,
  ingredientFuzzy: 2,
} as const;

/**
 * Score every recipe for `query`. Returns null for an empty query (show
 * everything); otherwise a score per doc index, 0 meaning "no match".
 */
export function scoreRecipes(index: SearchIndex, query: string): number[] | null {
  const tokens = words(query);
  if (tokens.length === 0) return null;
  const folded = foldForSearch(query.trim());

  // Per token: which vocabulary words it hits, and whether those hits are fuzzy.
  const hits = tokens.map((token) => {
    const exact = new Set(index.vocabulary.filter((w) => exactHit(token, w)));
    if (exact.size > 0) return { words: exact, fuzzy: false };
    return { words: fuzzyWords(token, index.vocabulary), fuzzy: true };
  });

  return index.docs.map((doc) => {
    let score = doc.fullTitles.some((t) => t.includes(folded)) ? SCORE.wholeTitle : 0;
    for (const hit of hits) {
      let inTitle = false;
      let inIngredients = false;
      for (const w of hit.words) {
        if (doc.titleWords.has(w)) {
          inTitle = true;
          break;
        }
        if (doc.ingredientWords.has(w)) inIngredients = true;
      }
      if (inTitle) score += hit.fuzzy ? SCORE.titleFuzzy : SCORE.titleExact;
      else if (inIngredients) score += hit.fuzzy ? SCORE.ingredientFuzzy : SCORE.ingredientExact;
      else return 0; // every query word must match somewhere
    }
    return score;
  });
}
