import {
  aggregate,
  classifyUnit,
  classifyUnitFor,
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
  name_it: null,
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

  it('merges spoon/cup spellings across languages, typos included', () => {
    // The screenshot case: 1.3 tbps + 1 tablespoon + 1.5 tablespoons + 6 tsp
    for (const spoon of ['tbsp', 'tbps', 'tablespoon', 'tablespoons', 'cucharada', 'cucchiai']) {
      expect(classifyUnit(spoon)).toEqual({ kind: 'volume', ml: 15 });
    }
    for (const tea of ['tsp', 'teaspoons', 'cucharadita', 'cucchiaino']) {
      expect(classifyUnit(tea)).toEqual({ kind: 'volume', ml: 5 });
    }
    expect(classifyUnit('Cups')).toEqual({ kind: 'volume', ml: 240 });
    expect(classifyUnit('oz')).toEqual({ kind: 'mass', grams: 28.35 });
  });

  it("reads size letters as count on countables, litres on liquids ('4 huevos L')", () => {
    // carotte has avg_unit_weight_g (countable), creme has density (liquid)
    expect(classifyUnitFor('L', carotte)).toEqual({ kind: 'count' });
    expect(classifyUnitFor('large', carotte)).toEqual({ kind: 'count' });
    expect(classifyUnitFor('l', creme)).toEqual({ kind: 'volume', ml: 1000 });
    expect(lineGrams(4, 'L', carotte)).toBe(500); // 4 pieces × 125 g
  });

  it('applies AI overrides for unknown units, but never over the static table', () => {
    const overrides = new Map([
      ['knob', { kind: 'mass' as const, factor: 15 }],
      ['vasetto', { kind: 'volume' as const, factor: 125 }],
      ['sprig', { kind: 'count' as const, factor: null }],
      ['tbsp', { kind: 'mass' as const, factor: 999 }], // must lose to the table
    ]);
    expect(classifyUnit('knob', overrides)).toEqual({ kind: 'mass', grams: 15 });
    expect(classifyUnit('vasetto', overrides)).toEqual({ kind: 'volume', ml: 125 });
    expect(classifyUnit('sprig', overrides)).toEqual({ kind: 'count' });
    expect(classifyUnit('tbsp', overrides)).toEqual({ kind: 'volume', ml: 15 });
    expect(classifyUnit('mystery', overrides)).toEqual({ kind: 'other', label: 'mystery' });
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

  it('collapses mixed spoon spellings into one volume line (screenshot case)', () => {
    const result = aggregate(
      [
        line({ raw: 'a', quantity: 1.3, unit: 'tbps', recipeTitle: 'R1' }),
        line({ raw: 'a', quantity: 1, unit: 'tablespoon', recipeTitle: 'R2' }),
        line({ raw: 'a', quantity: 1.5, unit: 'tablespoons', recipeTitle: 'R3' }),
        line({ raw: 'a', quantity: 6, unit: 'tsp', recipeTitle: 'R4' }),
      ],
      matcher({ a: farine })
    );
    // 3.8 tbsp × 15 ml + 6 tsp × 5 ml = 87 ml, one part per recipe kept
    expect(result.items[0].displayQty).toBe('87 ml');
    expect(result.items[0].mixed).toBe(false);
    expect(result.items[0].parts).toHaveLength(4);
  });

  it('uses AI overrides to merge units the table does not know', () => {
    const overrides = new Map([['knob', { kind: 'mass' as const, factor: 15 }]]);
    const result = aggregate(
      [
        line({ raw: 'a', quantity: 2, unit: 'knob' }),
        line({ raw: 'a', quantity: 100, unit: 'g' }),
      ],
      matcher({ a: farine }),
      overrides
    );
    expect(result.items[0].displayQty).toBe('130 g');
    expect(result.items[0].grams).toBe(130);
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
