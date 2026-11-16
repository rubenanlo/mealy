import { amountPerServing, checkRecipe, levelFor, type FodmapListEntry } from '@/lib/fodmap-list';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/worker', () => ({ fodmapListMatch: jest.fn() }));

const entry = (over: Partial<FodmapListEntry>): FodmapListEntry => ({
  id: over.name ?? 'x',
  name: 'x',
  category: null,
  overall: 'green',
  green_max: null,
  amber_qty: null,
  red_qty: null,
  unit: 'g',
  notes: null,
  ...over,
});

const garlic = entry({ name: 'Garlic, peeled, raw', overall: 'red', red_qty: 3 });
const onionWhite = entry({ name: 'Onion, spring (white bulb only), raw', overall: 'red', green_max: 32, amber_qty: 44, red_qty: 75 });
const pepper = entry({ name: 'Bell pepper, red, raw', overall: 'red', green_max: 43, amber_qty: 59, red_qty: 75 });
const rice = entry({ name: 'Rice, white, cooked', overall: 'green', green_max: 190 });
const sesameOil = entry({ name: 'Oil, sesame', overall: 'green', green_max: 20, unit: 'ml' });

describe('levelFor', () => {
  it('uses green / amber / red bands and treats "no green amount" as red', () => {
    expect(levelFor(onionWhite, 30)).toBe('green');
    expect(levelFor(onionWhite, 40)).toBe('amber');
    expect(levelFor(onionWhite, 80)).toBe('red');
    expect(levelFor(garlic, 1)).toBe('red');
    expect(levelFor(rice, 250)).toBe('red'); // single limit: above it is red
    expect(levelFor(rice, null)).toBeNull();
  });
});

describe('amountPerServing', () => {
  it('converts plain mass and volume units and divides by servings', () => {
    expect(amountPerServing({ quantity: 160, unit: 'g' }, 4, 'g')).toBe(40);
    expect(amountPerServing({ quantity: 2, unit: 'tbsp' }, 4, 'ml')).toBe(7.5);
    expect(amountPerServing({ quantity: 2, unit: null }, 4, 'g')).toBeNull();
    expect(amountPerServing({ quantity: 160, unit: 'g' }, null, 'g')).toBeNull();
  });

  it('uses the canonical piece weight for counted lines', () => {
    const canonical = { avg_unit_weight_g: 3, density_g_per_ml: null } as never;
    expect(amountPerServing({ quantity: 2, unit: null }, 4, 'g', canonical)).toBe(1.5);
  });
});

describe('checkRecipe', () => {
  it('flags amber/red entries, marks over vs OK, and green entries only when over', () => {
    const lines = [
      { raw: '2 garlic cloves', name: 'garlic', quantity: 6, unit: 'g' },
      { raw: '160 g spring onion white', name: 'spring onion', quantity: 160, unit: 'g' },
      { raw: '160 g red pepper', name: 'pepper', quantity: 160, unit: 'g' },
      { raw: '600 g rice', name: 'rice', quantity: 600, unit: 'g' },
      { raw: '2 tbsp sesame oil', name: 'sesame oil', quantity: 2, unit: 'tbsp' },
      { raw: '4 tbsp soy sauce', name: 'soy sauce', quantity: 4, unit: 'tbsp' },
    ];
    const byRaw: Record<string, FodmapListEntry | null> = {
      '2 garlic cloves': garlic,
      '160 g spring onion white': onionWhite,
      '160 g red pepper': pepper,
      '600 g rice': rice,
      '2 tbsp sesame oil': sesameOil,
      '4 tbsp soy sauce': null,
    };
    const result = checkRecipe(lines, 4, (raw) => byRaw[raw] ?? null);
    expect(result.over.map((i) => i.raw)).toEqual(['2 garlic cloves', '160 g spring onion white']);
    expect(result.flagged.map((i) => i.raw)).toEqual(['2 garlic cloves', '160 g spring onion white', '160 g red pepper']);
    expect(result.unknown.map((i) => i.raw)).toEqual(['4 tbsp soy sauce']);
    expect(result.fine.map((i) => i.raw)).toEqual(['600 g rice', '2 tbsp sesame oil']);

    const bigRice = checkRecipe([{ raw: '1 kg rice', name: 'rice', quantity: 1, unit: 'kg' }], 4, () => rice);
    expect(bigRice.over).toHaveLength(1); // 250 g > 190 g green limit
  });

  it('trusts the rating when the amount is unknown', () => {
    const result = checkRecipe([{ raw: 'garlic', name: 'garlic', quantity: null, unit: null }], 4, () => garlic);
    expect(result.over).toHaveLength(1);
  });
});
