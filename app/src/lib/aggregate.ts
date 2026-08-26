import { normalizeRaw, type CanonicalIngredient } from '@/lib/canonical';

/**
 * Shopping-list aggregation (Phase 2 Task 5, spec §9): merge matched lines
 * per canonical ingredient, sum only compatible units, convert to grams when
 * the reference table allows it, and NEVER guess — un-summable mixes are
 * flagged instead of forced.
 */

export interface AggregateLine {
  raw: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  recipeTitle: string;
  /** Source recipe id, when known — lets part rows deep-link (v3.2). */
  recipeId?: string;
}

export interface AggregatedPart {
  recipeTitle: string;
  qty: string;
  /** Source recipe id, when known. */
  recipeId?: string;
}

export interface AggregatedItem {
  key: string; // canonical slug — grocery_checks item_key
  canonical: CanonicalIngredient;
  /** Total in grams when every quantified line converts; null otherwise. */
  grams: number | null;
  /** Grams-first display: "450 g", "1.2 kg", or "300 g + 2 gousses" when mixed. */
  displayQty: string;
  parts: AggregatedPart[];
  /** True when unit families could not be merged (shown as a badge, §9). */
  mixed: boolean;
}

export interface UnmatchedItem {
  key: string; // normalized raw — grocery_checks item_key
  raw: string;
  recipeTitle: string;
  /** Source recipe id, when known — lets the recipe card deep-link. */
  recipeId?: string;
}

export interface AggregateResult {
  items: AggregatedItem[];
  unmatched: UnmatchedItem[];
}

type UnitFamily =
  | { kind: 'mass'; grams: number }
  | { kind: 'volume'; ml: number }
  | { kind: 'count' }
  | { kind: 'other'; label: string };

const MASS_UNITS: Record<string, number> = {
  g: 1,
  gr: 1,
  gramme: 1,
  grammes: 1,
  gram: 1,
  grams: 1,
  gramo: 1,
  gramos: 1,
  grammo: 1,
  grammi: 1,
  kg: 1000,
  kilo: 1000,
  kilos: 1000,
  mg: 0.001,
  oz: 28.35,
  ounce: 28.35,
  ounces: 28.35,
  lb: 453.6,
  lbs: 453.6,
  pound: 453.6,
  pounds: 453.6,
};

// Spoons/cups are nominal ml (tbsp 15, tsp 5, cup 240) across EN/FR/ES/IT,
// including the misspellings recipes actually contain (tbps, tbs).
const VOLUME_UNITS: Record<string, number> = {
  ml: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  litre: 1000,
  litres: 1000,
  liter: 1000,
  liters: 1000,
  litro: 1000,
  litros: 1000,
  litri: 1000,
  'c. à s.': 15,
  'c. à s': 15,
  cas: 15,
  'càs': 15,
  'cuillère à soupe': 15,
  'cuillères à soupe': 15,
  'c. à c.': 5,
  'c. à c': 5,
  cac: 5,
  'càc': 5,
  'cuillère à café': 5,
  'cuillères à café': 5,
  tbsp: 15,
  tbs: 15,
  tbps: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  cup: 240,
  cups: 240,
  'fl oz': 29.6,
  cucharada: 15,
  cucharadas: 15,
  cda: 15,
  cucharadita: 5,
  cucharaditas: 5,
  cdta: 5,
  taza: 240,
  tazas: 240,
  cucchiaio: 15,
  cucchiai: 15,
  cucchiaino: 5,
  cucchiaini: 5,
  tazza: 240,
  tazze: 240,
  verre: 200,
  verres: 200,
};

const COUNT_UNITS = new Set([
  '',
  'pièce',
  'pièces',
  'piece',
  'pieces',
  'unité',
  'unités',
  'u',
  'unidad',
  'unidades',
  'pezzo',
  'pezzi',
  // Size adjectives extracted as "units" ("6 large eggs", "1 large onion").
  'whole',
  'large',
  'lg',
  'medium',
  'med',
  'small',
  'gros',
  'grosse',
  'grosses',
  'moyen',
  'moyenne',
  'petit',
  'petite',
  'petits',
  'petites',
  'grande',
  'grandes',
  'mediano',
  'medianos',
  'pequeño',
  'pequeños',
  'grandi',
  'medio',
  'piccolo',
  'piccoli',
]);

/**
 * Egg-style size letters ("4 huevos L"). Ambiguous with real measures
 * (litres!), so they only count as size marks on countable ingredients —
 * ones with a per-piece weight and no liquid density.
 */
const SIZE_LETTERS = new Set(['l', 'm', 's', 'xl', 'xxl']);

function isSizeMark(
  u: string,
  canonical: Pick<CanonicalIngredient, 'avg_unit_weight_g' | 'density_g_per_ml'>
): boolean {
  return (
    SIZE_LETTERS.has(u) &&
    canonical.avg_unit_weight_g !== null &&
    canonical.density_g_per_ml === null
  );
}

/**
 * Cached AI classifications for units the static tables don't know
 * (unit_conversions table, resolved via lib/units.ts). Key: trimmed
 * lowercase unit. factor = g per unit (mass) / ml per unit (volume).
 */
export interface UnitOverride {
  kind: 'mass' | 'volume' | 'count';
  factor: number | null;
}
export type UnitOverrides = Map<string, UnitOverride>;

/** Classify a unit string; unknown units become their own 'other' family. */
export function classifyUnit(unit: string | null, overrides?: UnitOverrides): UnitFamily {
  const u = (unit ?? '').trim().toLowerCase();
  if (COUNT_UNITS.has(u)) return { kind: 'count' };
  if (u in MASS_UNITS) return { kind: 'mass', grams: MASS_UNITS[u] };
  if (u in VOLUME_UNITS) return { kind: 'volume', ml: VOLUME_UNITS[u] };
  const override = overrides?.get(u);
  if (override) {
    if (override.kind === 'count') return { kind: 'count' };
    if (override.kind === 'mass' && override.factor) return { kind: 'mass', grams: override.factor };
    if (override.kind === 'volume' && override.factor) return { kind: 'volume', ml: override.factor };
  }
  return { kind: 'other', label: u };
}

/** classifyUnit with ingredient context: size letters on countables → count. */
export function classifyUnitFor(
  unit: string | null,
  canonical: Pick<CanonicalIngredient, 'avg_unit_weight_g' | 'density_g_per_ml'>,
  overrides?: UnitOverrides
): UnitFamily {
  const u = (unit ?? '').trim().toLowerCase();
  if (isSizeMark(u, canonical)) return { kind: 'count' };
  return classifyUnit(unit, overrides);
}

/** Round to a kitchen-sane precision. */
function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "450 g" / "1.2 kg" grams-first formatting. */
export function formatGrams(grams: number): string {
  if (grams >= 1000) return `${round(grams / 1000)} kg`;
  return `${round(grams)} g`;
}

function formatMl(ml: number): string {
  if (ml >= 1000) return `${round(ml / 1000)} l`;
  return `${round(ml)} ml`;
}

/**
 * Convert one quantified line to grams using the reference table:
 * mass directly; count via avg_unit_weight_g; volume via density_g_per_ml.
 * Returns null when the table has no conversion — never guesses.
 */
export function lineGrams(
  quantity: number,
  unit: string | null,
  canonical: Pick<CanonicalIngredient, 'avg_unit_weight_g' | 'density_g_per_ml'>,
  overrides?: UnitOverrides
): number | null {
  const family = classifyUnitFor(unit, canonical, overrides);
  switch (family.kind) {
    case 'mass':
      return quantity * family.grams;
    case 'count':
      return canonical.avg_unit_weight_g !== null ? quantity * canonical.avg_unit_weight_g : null;
    case 'volume':
      return canonical.density_g_per_ml !== null
        ? quantity * family.ml * canonical.density_g_per_ml
        : null;
    default:
      return null;
  }
}

/** Original-quantity display for a per-recipe part line. */
function partQty(line: AggregateLine): string {
  if (line.quantity === null) return '—';
  const unit = (line.unit ?? '').trim();
  return unit ? `${line.quantity} ${unit}` : `${line.quantity}`;
}

/**
 * Merge lines by canonical ingredient. `match` resolves a line to its
 * canonical row (or null → the verbatim "unmatched" section).
 */
export function aggregate(
  lines: AggregateLine[],
  match: (line: AggregateLine) => CanonicalIngredient | null,
  overrides?: UnitOverrides
): AggregateResult {
  const buckets = new Map<string, { canonical: CanonicalIngredient; lines: AggregateLine[] }>();
  const unmatched: UnmatchedItem[] = [];

  for (const line of lines) {
    const canonical = match(line);
    if (!canonical) {
      unmatched.push({
        key: normalizeRaw(line.raw || line.name),
        raw: line.raw || line.name,
        recipeTitle: line.recipeTitle,
        recipeId: line.recipeId,
      });
      continue;
    }
    const bucket = buckets.get(canonical.slug) ?? { canonical, lines: [] };
    bucket.lines.push(line);
    buckets.set(canonical.slug, bucket);
  }

  const items: AggregatedItem[] = [];
  for (const { canonical, lines: bucketLines } of buckets.values()) {
    let grams = 0;
    let hasGrams = false;
    let ml = 0;
    let count = 0;
    const others = new Map<string, number>();
    let unconverted = 0; // quantified lines that would not convert to grams

    for (const line of bucketLines) {
      if (line.quantity === null) continue; // presence-only line
      const asGrams = lineGrams(line.quantity, line.unit, canonical, overrides);
      if (asGrams !== null) {
        grams += asGrams;
        hasGrams = true;
        continue;
      }
      unconverted += 1;
      const family = classifyUnitFor(line.unit, canonical, overrides);
      if (family.kind === 'volume') ml += line.quantity * family.ml;
      else if (family.kind === 'count') count += line.quantity;
      else if (family.kind === 'other') {
        others.set(family.label, (others.get(family.label) ?? 0) + line.quantity);
      }
    }

    const displayParts: string[] = [];
    if (hasGrams) displayParts.push(formatGrams(grams));
    if (ml > 0) displayParts.push(formatMl(ml));
    if (count > 0) displayParts.push(`${round(count)}`);
    for (const [label, qty] of others) displayParts.push(`${round(qty)} ${label}`);

    const mixed = (hasGrams ? 1 : 0) + (ml > 0 ? 1 : 0) + (count > 0 ? 1 : 0) + others.size > 1;

    items.push({
      key: canonical.slug,
      canonical,
      grams: hasGrams && unconverted === 0 ? round(grams) : null,
      displayQty: displayParts.join(' + '),
      parts: bucketLines.map((line) => ({
        recipeTitle: line.recipeTitle,
        qty: partQty(line),
        recipeId: line.recipeId,
      })),
      mixed,
    });
  }

  items.sort((a, b) => a.canonical.name_fr.localeCompare(b.canonical.name_fr, 'fr'));
  return { items, unmatched };
}

/** Group aggregated items by aisle; unknown aisles land in "Other" last. */
export function groupByAisle(items: AggregatedItem[]): { aisle: string; items: AggregatedItem[] }[] {
  const groups = new Map<string, AggregatedItem[]>();
  for (const item of items) {
    const aisle = item.canonical.aisle ?? 'Other';
    const list = groups.get(aisle) ?? [];
    list.push(item);
    groups.set(aisle, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b, 'fr')))
    .map(([aisle, groupItems]) => ({ aisle, items: groupItems }));
}
