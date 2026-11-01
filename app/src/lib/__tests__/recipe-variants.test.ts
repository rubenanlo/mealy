import { supabase } from '@/lib/supabase';

import { applySwapSelection, lowFodmapTitle, saveLowFodmapVariant } from '../recipe-variants';

jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));
jest.mock('@/lib/list-refresh', () => ({ invalidateLists: jest.fn() }));

const mockFrom = supabase.from as jest.Mock;

const ing = (raw: string, name = raw) => ({ raw, name, quantity: null, unit: null, group: null, fodmap: null });

describe('lowFodmapTitle', () => {
  it('adds the suffix in the recipe language', () => {
    expect(lowFodmapTitle('Chili con carne', 'es')).toBe('Chili con carne (bajo en FODMAP)');
    expect(lowFodmapTitle('Soupe', 'fr')).toBe('Soupe (pauvre en FODMAP)');
  });

  it('falls back to English and never doubles the suffix', () => {
    expect(lowFodmapTitle('Chili', 'de')).toBe('Chili (low-FODMAP)');
    expect(lowFodmapTitle('Chili (low-FODMAP)', 'en')).toBe('Chili (low-FODMAP)');
  });
});

describe('applySwapSelection', () => {
  const swaps = [
    { raw: '1 onion', replacement: ing('4 spring onions, green parts', 'spring onion'), note: '' },
    { raw: '3 garlic cloves', replacement: ing('2 tbsp garlic-infused oil', 'garlic-infused oil'), note: '' },
  ];

  it('replaces only accepted lines and rebases raw onto the new name', () => {
    const out = applySwapSelection(
      [ing('1 onion'), ing('3 garlic cloves'), ing('500 g beef')],
      swaps,
      new Set(['1 onion'])
    );
    expect(out[0]).toMatchObject({ name: 'spring onion', raw: 'spring onion' });
    expect(out[1].raw).toBe('3 garlic cloves');
    expect(out[2].raw).toBe('500 g beef');
  });
});

describe('saveLowFodmapVariant', () => {
  const original = {
    id: 'orig',
    household_id: 'hh',
    title: 'Chili',
    language: 'en',
    servings: 4,
    prep_minutes: 10,
    cook_minutes: 60,
    dish_type: null,
    tags: [],
    meal_type: 'main',
    cover_image_path: 'hh/orig/cover.jpg',
    cover_focal: null,
  };

  function lookup(existing: { id: string } | null) {
    return {
      select: () => ({
        eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: existing }) }) }),
      }),
    };
  }

  beforeEach(() => mockFrom.mockReset());

  it('inserts a linked row and never touches the original', async () => {
    const insert = jest.fn(() => ({
      select: () => ({ single: () => Promise.resolve({ data: { id: 'v1' }, error: null }) }),
    }));
    mockFrom.mockReturnValueOnce(lookup(null)).mockReturnValueOnce({ insert });
    const id = await saveLowFodmapVariant({ original, ingredients: [], steps: ['Cook.'], userId: 'u' });
    expect(id).toBe('v1');
    const row = (insert.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      variant_of: 'orig',
      variant_kind: 'low_fodmap',
      title: 'Chili (low-FODMAP)',
      household_id: 'hh',
      cover_image_path: 'hh/orig/cover.jpg',
      steps: ['Cook.'],
    });
    expect(row).not.toHaveProperty('id');
  });

  it('updates the existing version instead of adding a second one', async () => {
    const eq = jest.fn(() => Promise.resolve({ error: null }));
    const update = jest.fn(() => ({ eq }));
    mockFrom.mockReturnValueOnce(lookup({ id: 'v1' })).mockReturnValueOnce({ update });
    const id = await saveLowFodmapVariant({ original, ingredients: [], steps: [], userId: null });
    expect(id).toBe('v1');
    expect(eq).toHaveBeenCalledWith('id', 'v1');
  });
});
