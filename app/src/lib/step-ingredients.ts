/**
 * Which ingredients each step uses, worked out on the device from the text.
 *
 * Used by the recipe page (amount chips under every step) and cook mode
 * ("You need" on each step card). Ingredients and steps must be in the same
 * language (the page passes the displayed ones), so a plain word match works
 * for every locale the app supports.
 *
 * An ingredient matches a step when one of its distinctive words shows up in
 * the step ("pork chops" ← "brown the pork"). Generic words such as "oil" or
 * "sauce" only count when no other ingredient shares them, so "the oil" finds
 * the olive oil, but "the sauce" stays silent when there are two sauces.
 */
import { foldForSearch } from '@/lib/search-text';

export interface StepIngredientMap {
  /** For each step, the indexes of the ingredients it mentions, in list order. */
  byStep: number[][];
  /** For each ingredient, the first step (0-based) that uses it, or null. */
  firstStep: (number | null)[];
}

/** Words that never identify an ingredient on their own (en/es/fr/it). */
const STOP = new Set([
  // en
  'a', 'an', 'and', 'or', 'of', 'the', 'to', 'for', 'with', 'in', 'into', 'on',
  'fresh', 'freshly', 'large', 'small', 'medium', 'big', 'chopped', 'sliced', 'diced', 'minced',
  'ground', 'whole', 'extra', 'virgin', 'finely', 'roughly', 'about', 'some', 'optional', 'taste',
  // cuts and shapes: "pork chops" is pork, and "chopped" must not hit it
  'chop', 'chops', 'strip', 'strips', 'cube', 'cubes', 'slice', 'slices', 'fillet', 'fillets',
  'breast', 'breasts', 'thigh', 'thighs',
  'cup', 'cups', 'tbsp', 'tsp', 'pinch', 'piece', 'pieces', 'handful', 'bunch', 'can', 'tin',
  // es
  'de', 'del', 'la', 'las', 'el', 'los', 'y', 'o', 'con', 'en', 'al', 'un', 'una', 'fresco', 'fresca',
  'frescos', 'frescas', 'picado', 'picada', 'grande', 'grandes', 'pequeno', 'pequena', 'molido', 'molida',
  'gusto', 'cucharada', 'cucharadas', 'cucharadita', 'pizca', 'diente', 'dientes',
  // fr
  'd', 'l', 'du', 'des', 'le', 'les', 'et', 'ou', 'avec', 'au', 'aux', 'une', 'frais', 'fraiche',
  'fraiches', 'hache', 'hachee', 'gros', 'grosse', 'petit', 'petite', 'moulu', 'moulue', 'cuillere',
  'cuilleres', 'cas', 'cac', 'pincee', 'gousse', 'gousses', 'botte',
  // it
  'di', 'del', 'della', 'dei', 'delle', 'il', 'lo', 'gli', 'e', 'con', 'fresca', 'freschi', 'fresche',
  'tritato', 'tritata', 'macinato', 'macinata', 'cucchiaio', 'cucchiai', 'cucchiaino', 'pizzico',
  'spicchio', 'spicchi', 'mazzetto', 'q', 'b', 'qb',
]);

/** Words shared by many ingredients: they count only when unambiguous. */
const GENERIC = new Set([
  'oil', 'sauce', 'powder', 'paste', 'juice', 'leaves', 'leaf', 'stock', 'broth', 'vinegar', 'flakes',
  'aceite', 'salsa', 'polvo', 'zumo', 'jugo', 'hojas', 'caldo', 'vinagre',
  'huile', 'sauce', 'poudre', 'pate', 'jus', 'feuilles', 'bouillon', 'vinaigre',
  'olio', 'salsa', 'polvere', 'succo', 'foglie', 'brodo', 'aceto',
]);

function words(s: string): string[] {
  return foldForSearch(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Crude plural folding: "chops" → "chop", "tomatoes" → "tomato", "noix" stays. */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('es')) return w.slice(0, -2);
  if (w.length > 3 && (w.endsWith('s') || w.endsWith('x'))) return w.slice(0, -1);
  return w;
}

/** True when a step word is the ingredient word (or a form of it). */
function hits(key: string, stepWord: string): boolean {
  if (stepWord === key) return true;
  const s = stem(stepWord);
  if (s === key) return true;
  // Prefix only from 4 letters ("salt" → "salted"; "pea" must not hit "peanut").
  return key.length >= 4 && stepWord.startsWith(key);
}

function keyWords(name: string): string[] {
  const out: string[] = [];
  for (const w of words(name)) {
    if (w.length < 3 || STOP.has(w) || /^\d/.test(w)) continue;
    const k = stem(w);
    if (!out.includes(k)) out.push(k);
  }
  return out;
}

export function mapStepIngredients(
  steps: readonly string[],
  ingredients: readonly { name: string }[]
): StepIngredientMap {
  const keys = ingredients.map((ing) => keyWords(ing.name));
  // How many ingredients carry each generic word: shared ones are ambiguous.
  const genericCount = new Map<string, number>();
  for (const ks of keys) {
    for (const k of ks) if (GENERIC.has(k)) genericCount.set(k, (genericCount.get(k) ?? 0) + 1);
  }
  const stepWords = steps.map((s) => words(s));
  const byStep: number[][] = steps.map(() => []);
  const firstStep: (number | null)[] = ingredients.map(() => null);

  keys.forEach((ks, ingIdx) => {
    if (ks.length === 0) return;
    const distinct = ks.filter((k) => !GENERIC.has(k));
    const usable = [...distinct, ...ks.filter((k) => GENERIC.has(k) && genericCount.get(k) === 1)];
    if (usable.length === 0) return;
    stepWords.forEach((sw, stepIdx) => {
      if (usable.some((k) => sw.some((w) => hits(k, w)))) {
        byStep[stepIdx].push(ingIdx);
        if (firstStep[ingIdx] === null) firstStep[ingIdx] = stepIdx;
      }
    });
  });
  return { byStep, firstStep };
}

/** "300 g", "2 tbsp", "4" — or "" when the line has no amount. */
export function amountLabel(ing: { quantity: number | null; unit: string | null }): string {
  return [ing.quantity, ing.unit].filter((v) => v != null && v !== '').join(' ');
}
