/**
 * Canonical ingredient vocabulary: types + pure exact/alias matcher
 * (Phase 2 Task 3). The LLM fallback lives in the worker; this file never
 * touches the network so it is trivially unit-testable.
 */

export type FodmapTier = 'low' | 'moderate' | 'high' | 'check';

export interface CanonicalIngredient {
  id: string;
  slug: string;
  name_en: string;
  name_fr: string;
  name_es: string;
  aliases: string[];
  category: string | null;
  aisle: string | null;
  season: number[] | null;
  fodmap_tier: FodmapTier;
  fodmap_groups: string[];
  /** Slugs of low-FODMAP alternates (Monash public list, migration 0009). */
  fodmap_swaps: string[];
  low_serving_g: number | null;
  high_serving_g: number | null;
  avg_unit_weight_g: number | null;
  density_g_per_ml: number | null;
  verified: boolean;
}

export type MatchedBy = 'exact' | 'alias' | 'llm' | 'user';

export interface CanonicalMatch {
  ingredient: CanonicalIngredient;
  matchedBy: 'exact' | 'alias';
}

/** Units and count-words that may precede the ingredient name. */
const UNIT_WORDS = [
  'kg',
  'g',
  'gr',
  'grammes?',
  'mg',
  'l',
  'litres?',
  'dl',
  'cl',
  'ml',
  // NB: patterns match ACCENT-STRIPPED text ("à" → "a", "pincée" → "pincee").
  'c\\.?\\s*a\\.?\\s*s\\.?',
  'c\\.?\\s*a\\.?\\s*c\\.?',
  'cas',
  'cac',
  'cuilleres?(?:\\s+a\\s+(?:soupe|cafe))?',
  'sachets?',
  'pincees?',
  'tranches?',
  'gousses?',
  'branches?',
  'bottes?',
  'brins?',
  'feuilles?',
  'boites?',
  'pots?',
  'verres?',
  'tasses?',
  'pieces?',
  'unites?',
];

/** Preparation words that describe, not identify, the ingredient. */
const PREP_WORDS = new Set(
  [
    'rape',
    'rapee',
    'rapees',
    'rapes',
    'emince',
    'emincee',
    'emincees',
    'eminces',
    'hache',
    'hachee',
    'hachees',
    'haches',
    'cisele',
    'ciselee',
    'ciselees',
    'ciseles',
    'coupe',
    'coupee',
    'coupees',
    'coupes',
    'pele',
    'pelee',
    'pelees',
    'peles',
    'epluche',
    'epluchee',
    'epluchees',
    'epluches',
    'cuit',
    'cuite',
    'cuites',
    'cuits',
    'frais',
    'fraiche',
    'fraiches',
    'surgele',
    'surgelee',
    'surgelees',
    'surgeles',
    'entier',
    'entiere',
    'entieres',
    'entiers',
    'moulu',
    'moulue',
    'moulues',
    'moulus',
    'concasse',
    'concassee',
    'concassees',
    'concasses',
    'des', // "en dés" after stopword removal
    'rondelles',
    'rondelle',
    'morceaux',
    'morceau',
    'lamelles',
    'lamelle',
    'facultatif',
    'facultative',
    'optionnel',
    'optionnelle',
    'environ',
    'grosse',
    'grosses',
    'gros',
    'petite',
    'petites',
    'petit',
    'petits',
    'belle',
    'beau',
    'bio',
  ].map((w) => w)
);

/** Articles/prepositions that carry no meaning for matching. */
const STOP_WORDS = new Set(['de', 'du', 'la', 'le', 'les', 'un', 'une', 'en', 'a', 'au', 'aux', 'et', 'ou']);

/** Strip diacritics: "râpées" → "rapees". */
function stripAccents(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Naive FR singularization: trailing s/x dropped on words > 3 chars. */
function singularize(word: string): string {
  if (word.length > 3 && (word.endsWith('s') || word.endsWith('x')) && !word.endsWith('ss')) {
    return word.slice(0, -1);
  }
  return word;
}

const QUANTITY_RE = new RegExp(
  `^\\s*(?:environ\\s+)?(?:\\d+(?:[.,/]\\d+)?(?:\\s*(?:-|–|a|à)\\s*\\d+(?:[.,/]\\d+)?)?|½|¼|¾)\\s*(?:(?:${UNIT_WORDS.join('|')})\\b\\.?)?\\s*`,
  'i'
);

/**
 * Normalize a raw ingredient line for matching: lowercase, strip accents,
 * leading quantities/units, parentheticals, prep words and articles;
 * singularize FR plurals. "200 g de Carottes râpées" → "carotte".
 */
export function normalizeRaw(raw: string): string {
  let s = stripAccents(raw.toLowerCase().trim());
  s = s.replace(/\([^)]*\)/g, ' '); // parentheticals
  s = s.replace(QUANTITY_RE, ''); // leading "200 g de", "2 - 3", "½"
  s = s.replace(/[’']/g, ' '); // "d'ail" → "d ail"
  s = s.replace(/[.,;:!?*]/g, ' ');
  const words = s
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => w !== 'd' && w !== 'l' && !STOP_WORDS.has(w))
    .map(singularize)
    .filter((w) => !PREP_WORDS.has(w) && !PREP_WORDS.has(`${w}s`));
  return words.join(' ');
}

/** Slug "pomme-de-terre" compared as "pomme de terre" (post-normalization). */
function slugAsPhrase(slug: string): string {
  return normalizeRaw(slug.replace(/-/g, ' '));
}

export interface CanonicalIndex {
  /** normalized phrase → ingredient, from slug/names ("exact"). */
  exact: Map<string, CanonicalIngredient>;
  /** normalized phrase → ingredient, from aliases. */
  alias: Map<string, CanonicalIngredient>;
  /** slug → ingredient (resolves fodmap_swaps references). */
  bySlug: Map<string, CanonicalIngredient>;
}

/** Build the lookup index once per table load. */
export function buildCanonicalIndex(table: CanonicalIngredient[]): CanonicalIndex {
  const exact = new Map<string, CanonicalIngredient>();
  const alias = new Map<string, CanonicalIngredient>();
  const bySlug = new Map<string, CanonicalIngredient>();
  for (const ing of table) {
    bySlug.set(ing.slug, ing);
    for (const phrase of [slugAsPhrase(ing.slug), normalizeRaw(ing.name_fr), normalizeRaw(ing.name_en), normalizeRaw(ing.name_es)]) {
      if (phrase && !exact.has(phrase)) exact.set(phrase, ing);
    }
    for (const a of ing.aliases) {
      const phrase = normalizeRaw(a);
      if (phrase && !alias.has(phrase)) alias.set(phrase, ing);
    }
  }
  return { exact, alias, bySlug };
}

/**
 * Layered pure match: exact slug/name → aliases → null (the caller may then
 * try the worker LLM fallback — which only ever picks from candidates, §4).
 */
export function matchCanonical(
  normalized: string,
  index: CanonicalIndex
): CanonicalMatch | null {
  if (!normalized) return null;
  const exact = index.exact.get(normalized);
  if (exact) return { ingredient: exact, matchedBy: 'exact' };
  const alias = index.alias.get(normalized);
  if (alias) return { ingredient: alias, matchedBy: 'alias' };
  return null;
}
