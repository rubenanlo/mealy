import type { CanonicalIngredient } from '../canonical';
import { flagIngredient } from '../fodmap';
import {
  applyPersonalRatings,
  EMPTY_DRAFT,
  filterEntries,
  searchCanonical,
  suggestCanonical,
  validateDraft,
  type PersonalFodmapEntry,
} from '../my-fodmap';

jest.mock('@/lib/supabase', () => ({ supabase: { from: jest.fn() } }));

const canonical = (over: Partial<CanonicalIngredient> & { slug: string }): CanonicalIngredient => ({
  id: `id-${over.slug}`,
  name_en: over.slug,
  name_fr: over.slug,
  name_es: over.slug,
  name_it: null,
  aliases: [],
  category: null,
  aisle: null,
  season: null,
  fodmap_tier: 'check',
  fodmap_groups: [],
  fodmap_swaps: [],
  low_serving_g: null,
  high_serving_g: null,
  avg_unit_weight_g: null,
  density_g_per_ml: null,
  verified: false,
  ...over,
});

const entry = (over: Partial<PersonalFodmapEntry> & { name: string }): PersonalFodmapEntry => ({
  id: `e-${over.name}`,
  household_id: 'h1',
  canonical_id: null,
  rating: 'low',
  safe_portion: null,
  notes: null,
  checked: false,
  checked_by: null,
  checked_at: null,
  created_at: '2026-11-13T00:00:00Z',
  updated_at: '2026-11-13T00:00:00Z',
  ...over,
});

const leek = canonical({ slug: 'poireau', name_en: 'leek', name_fr: 'poireau', fodmap_tier: 'high', low_serving_g: 10, high_serving_g: 50 });
const carrot = canonical({ slug: 'carotte', name_en: 'carrot', name_fr: 'carotte', aliases: ['carottes nouvelles'] });

describe('validateDraft', () => {
  it('requires a name and a rating', () => {
    expect(validateDraft({ ...EMPTY_DRAFT, name: '  ' }, [], null)).toBe('nameRequired');
    expect(validateDraft({ ...EMPTY_DRAFT, name: 'Leek' }, [], null)).toBe('ratingRequired');
    expect(validateDraft({ ...EMPTY_DRAFT, name: 'Leek', rating: 'low' }, [], null)).toBeNull();
  });

  it('rejects a duplicate name but not the entry being edited', () => {
    const existing = [entry({ name: 'Leek' })];
    const draft = { ...EMPTY_DRAFT, name: ' leek ', rating: 'low' as const };
    expect(validateDraft(draft, existing, null)).toBe('duplicateName');
    expect(validateDraft(draft, existing, 'e-Leek')).toBeNull();
  });
});

describe('suggestCanonical / searchCanonical', () => {
  it('suggests the exact match for a typed name', () => {
    expect(suggestCanonical('Leek', [leek, carrot])?.slug).toBe('poireau');
    expect(suggestCanonical('dragon fruit', [leek, carrot])).toBeNull();
  });

  it('finds candidates by prefix and alias', () => {
    expect(searchCanonical('car', [leek, carrot]).map((i) => i.slug)).toEqual(['carotte']);
    expect(searchCanonical('nouvelle', [leek, carrot]).map((i) => i.slug)).toEqual(['carotte']);
    expect(searchCanonical('', [leek, carrot])).toEqual([]);
  });
});

describe('filterEntries', () => {
  const list = [
    entry({ name: 'zucchini', rating: 'moderate', checked: true }),
    entry({ name: 'Garlic', rating: 'high', notes: 'oil is fine' }),
    entry({ name: 'carrot', rating: 'low', checked: true }),
  ];
  it('sorts alphabetically ignoring case', () => {
    expect(filterEntries(list, 'all', '').map((e) => e.name)).toEqual(['carrot', 'Garlic', 'zucchini']);
  });
  it('filters by rating, unchecked and search text (incl. notes)', () => {
    expect(filterEntries(list, 'high', '').map((e) => e.name)).toEqual(['Garlic']);
    expect(filterEntries(list, 'unchecked', '').map((e) => e.name)).toEqual(['Garlic']);
    expect(filterEntries(list, 'all', 'OIL').map((e) => e.name)).toEqual(['Garlic']);
  });
});

describe('personal ratings in the FODMAP check', () => {
  it('attaches linked entries only and overrides tier and thresholds', () => {
    const [leekRow, carrotRow] = applyPersonalRatings(
      [leek, carrot],
      [
        entry({ name: 'Leek, green part', canonical_id: leek.id, rating: 'low', safe_portion: '75 g', checked: true }),
        entry({ name: 'Unlinked thing', rating: 'high' }),
      ]
    );
    expect(carrotRow).toBe(carrot);
    expect(leekRow.personal).toEqual({ rating: 'low', safe_portion: '75 g', checked: true });

    // 80 g would be high per the reference thresholds; the personal call wins.
    const flag = flagIngredient(leekRow, 80);
    expect(flag.tier).toBe('low');
    expect(flag.explanation).toBe('Low per your list, checked. Safe portion: 75 g.');
  });

  it('says when the entry is not checked yet', () => {
    const [row] = applyPersonalRatings([carrot], [entry({ name: 'carrot', canonical_id: carrot.id, rating: 'moderate' })]);
    expect(flagIngredient(row, null).explanation).toBe('Moderate per your list, not checked yet.');
  });
});
