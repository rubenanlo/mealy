import {
  aggregate,
  classifyUnit,
  formatGrams,
  groupByAisle,
  lineGrams,
  type AggregateLine,
} from '../aggregate';
import type { CanonicalIngredient } from '../canonical';

const canonical = (
  over: Partial<CanonicalIngredient> & { slug: string }
): CanonicalIngredient => ({
  id: `id-${over.slug}`,
  name_en: over.slug,
  name_fr: over.slug,
  name_es: over.slug,
  aliases: [],
  category: null,
  aisle: null,
  season: null,
  fodmap_tier: 'low',
  fodmap_groups: [],
  fodmap_swaps: [],
  low_serving_g: null,
  high_serving_g: null,
  avg_unit_weight_g: null,
  density_g_per_ml: null,
  verified: false,
  ...over,
});

const carotte = canonical({ slug: 'carotte', name_fr: 'carotte', aisle: 'Fruits & Légumes', avg_unit_weight_g: 125 });
const creme = canonical({ slug: 'creme', name_fr: 'crème', aisle: 'Crèmerie', density_g_per_ml: 1.0 });
const farine = canonical({ slug: 'farine', name_fr: 'farine', aisle: 'Épicerie salée' });
const ail = canonical({ slug: 'ail', name_fr: 'ail', aisle: 'Fruits & Légumes' });

const line = (over: Partial<AggregateLine>): AggregateLine => ({
  raw: over.raw ?? over.name ?? 'x',
  name: 'x',
  quantity: null,
  unit: null,
  recipeTitle: 'R',
  ...over,
});

const matcher =
  (map: Record<string, CanonicalIngredient | null>) => (l: AggregateLine) =>
    map[l.raw] ?? null;

describe('classifyUnit / lineGrams', () => {
  it('classifies mass, volume, count and unknown units', () => {
    expect(classifyUnit('kg')).toEqual({ kind: 'mass', grams: 1000 });
    expect(classifyUnit('cl')).toEqual({ kind: 'volume', ml: 10 });
    expect(classifyUnit(null)).toEqual({ kind: 'count' });
    expect(classifyUnit('gousses')).toEqual({ kind: 'other', label: 'gousses' });
  });

  it('converts count→g via avg_unit_weight_g and ml→g via density', () => {
    expect(lineGrams(2, null, carotte)).toBe(250);
    expect(lineGrams(200, 'ml', creme)).toBe(200);
    expect(lineGrams(1.5, 'kg', farine)).toBe(1500);
  });

  it('never guesses: no conversion data → null', () => {
    expect(lineGrams(2, null, farine)).toBeNull(); // no unit weight
    expect(lineGrams(100, 'ml', farine)).toBeNull(); // no density
    expect(lineGrams(2, 'gousses', ail)).toBeNull(); // unknown unit
  });
});

describe('aggregate', () => {
  it('sums compatible units across recipes into grams with per-recipe parts', () => {
    const result = aggregate(
      [
        line({ raw: 'a', quantity: 200, unit: 'g', recipeTitle: 'Bolognese' }),
        line({ raw: 'b', quantity: 0.5, unit: 'kg', recipeTitle: 'Salade' }),
        line({ raw: 'c', quantity: 2, unit: null, recipeTitle: 'Soupe' }), // 2×125 g
      ],
      matcher({ a: carotte, b: carotte, c: carotte })
    );
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.grams).toBe(950);
    expect(item.displayQty).toBe('950 g');
    expect(item.mixed).toBe(false);
    expect(item.parts).toEqual([
      { recipeTitle: 'Bolognese', qty: '200 g' },
      { recipeTitle: 'Salade', qty: '0.5 kg' },
      { recipeTitle: 'Soupe', qty: '2' },
    ]);
  });

  it('flags un-summable unit mixes instead of forcing them', () => {
    const result = aggregate(
      [
        line({ raw: 'a', quantity: 300, unit: 'g' }),
        line({ raw: 'b', quantity: 2, unit: 'gousses' }),
      ],
      matcher({ a: ail, b: ail })
    );
    const item = result.items[0];
    expect(item.mixed).toBe(true);
    expect(item.grams).toBeNull(); // not fully convertible
    expect(item.displayQty).toBe('300 g + 2 gousses');
  });

  it('keeps counts without unit weight as a plain count, not grams', () => {
    const result = aggregate(
      [line({ raw: 'a', quantity: 3, unit: null })],
      matcher({ a: farine })
    );
    expect(result.items[0].grams).toBeNull();
    expect(result.items[0].displayQty).toBe('3');
    expect(result.items[0].mixed).toBe(false);
  });

  it('passes unmatched lines through verbatim with a stable key', () => {
    const result = aggregate(
      [line({ raw: '1 pincée de poudre magique', recipeTitle: 'Potion' })],
      () => null
    );
    expect(result.items).toHaveLength(0);
    expect(result.unmatched).toEqual([
      { key: 'poudre magique', raw: '1 pincée de poudre magique', recipeTitle: 'Potion' },
    ]);
  });

  it('handles presence-only lines (no quantity)', () => {
    const result = aggregate([line({ raw: 'a', quantity: null })], matcher({ a: farine }));
    expect(result.items[0].grams).toBeNull();
    expect(result.items[0].displayQty).toBe('');
    expect(result.items[0].parts[0].qty).toBe('—');
  });
});

describe('formatGrams / groupByAisle', () => {
  it('is grams-first with kg above 1000', () => {
    expect(formatGrams(950)).toBe('950 g');
    expect(formatGrams(1200)).toBe('1.2 kg');
  });

  it('groups by aisle with Other last', () => {
    const noAisle = canonical({ slug: 'x', name_fr: 'x', aisle: null });
    const { items } = aggregate(
      [
        line({ raw: 'a', quantity: 1, unit: 'g' }),
        line({ raw: 'b', quantity: 1, unit: 'g' }),
        line({ raw: 'c', quantity: 1, unit: 'g' }),
      ],
      matcher({ a: carotte, b: creme, c: noAisle })
    );
    const groups = groupByAisle(items);
    expect(groups.map((g) => g.aisle)).toEqual(['Crèmerie', 'Fruits & Légumes', 'Other']);
  });
});
