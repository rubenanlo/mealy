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
  kg: 1000,
  mg: 0.001,
};

const VOLUME_UNITS: Record<string, number> = {
  ml: 1,
  cl: 10,
  dl: 100,
  l: 1000,
  litre: 1000,
  litres: 1000,
  'c. à s.': 15,
  cas: 15,
  'cuillère à soupe': 15,
  'cuillères à soupe': 15,
  'c. à c.': 5,
  cac: 5,
  'cuillère à café': 5,
  'cuillères à café': 5,
};

const COUNT_UNITS = new Set(['', 'pièce', 'pièces', 'piece', 'pieces', 'unité', 'unités', 'u']);

/** Classify a unit string; unknown units become their own 'other' family. */
export function classifyUnit(unit: string | null): UnitFamily {
  const u = (unit ?? '').trim().toLowerCase();
  if (COUNT_UNITS.has(u)) return { kind: 'count' };
  if (u in MASS_UNITS) return { kind: 'mass', grams: MASS_UNITS[u] };
  if (u in VOLUME_UNITS) return { kind: 'volume', ml: VOLUME_UNITS[u] };
  return { kind: 'other', label: u };
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
  canonical: Pick<CanonicalIngredient, 'avg_unit_weight_g' | 'density_g_per_ml'>
): number | null {
  const family = classifyUnit(unit);
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
  match: (line: AggregateLine) => CanonicalIngredient | null
): AggregateResult {
  const buckets = new Map<string, { canonical: CanonicalIngredient; lines: AggregateLine[] }>();
  const unmatched: UnmatchedItem[] = [];

  for (const line of lines) {
    const canonical = match(line);
    if (!canonical) {
      unmatched.push({ key: normalizeRaw(line.raw || line.name), raw: line.raw || line.name, recipeTitle: line.recipeTitle });
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
      const asGrams = lineGrams(line.quantity, line.unit, canonical);
      if (asGrams !== null) {
        grams += asGrams;
        hasGrams = true;
        continue;
      }
      unconverted += 1;
      const family = classifyUnit(line.unit);
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
