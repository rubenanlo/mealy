import type { CanonicalIngredient } from '../canonical';
import {
  computeRecipeFodmap,
  FODMAP_DISCLAIMER,
  flagIngredient,
  recipeFodmapTier,
  type FodmapLine,
} from '../fodmap';

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

// Onion-style row: fructans, low ≤ 12 g, high ≥ 75 g.
const oignon = canonical({
  slug: 'oignon',
  name_fr: 'oignon',
  fodmap_tier: 'high',
  fodmap_groups: ['fructan'],
  low_serving_g: 12,
  high_serving_g: 75,
  avg_unit_weight_g: 110,
});
const carotte = canonical({ slug: 'carotte', name_fr: 'carotte', fodmap_tier: 'low' });
const mystere = canonical({ slug: 'mystere', name_fr: 'mystère', fodmap_tier: 'check' });
const poireau = canonical({
  slug: 'poireau',
  name_fr: 'poireau',
  fodmap_tier: 'moderate',
  fodmap_groups: ['fructan'],
});

const line = (over: Partial<FodmapLine>): FodmapLine => ({
  raw: over.raw ?? 'x',
  name: over.name ?? 'x',
  quantity: null,
  unit: null,
  ...over,
});

describe('flagIngredient', () => {
  it('is dose-dependent when thresholds and portion are known', () => {
    expect(flagIngredient(oignon, 100).tier).toBe('high');
    expect(flagIngredient(oignon, 10).tier).toBe('low');
    expect(flagIngredient(oignon, 40).tier).toBe('moderate');
  });

  it('shows which serving/threshold drove the flag (spec §4 transparency)', () => {
    const flag = flagIngredient(oignon, 100);
    expect(flag.explanation).toContain('100 g per serving');
    expect(flag.explanation).toContain('75 g');
  });

  it('falls back to the published tier when the portion is unknown', () => {
    const flag = flagIngredient(oignon, null);
    expect(flag.tier).toBe('high');
    expect(flag.explanation).toContain('quantity unknown');
  });

  it('unknown ingredient or check-tier row → check, never low', () => {
    expect(flagIngredient(null, 50).tier).toBe('check');
    expect(flagIngredient(mystere, 50).tier).toBe('check');
  });
});

describe('computeRecipeFodmap', () => {
  it('computes per-serving portions from quantity ÷ servings', () => {
    const { flags } = computeRecipeFodmap(
      [line({ raw: 'o', quantity: 300, unit: 'g' })],
      4,
      () => oignon
    );
    expect(flags[0].portionG).toBe(75);
    expect(flags[0].tier).toBe('high');
    expect(flags[0].name).toBe('oignon');
  });

  it('converts counts via avg_unit_weight_g before dividing', () => {
    const { flags } = computeRecipeFodmap(
      [line({ raw: 'o', quantity: 1, unit: null })],
      10,
      () => oignon
    );
    expect(flags[0].portionG).toBe(11); // 110 g / 10 servings
    expect(flags[0].tier).toBe('low');
  });

  it('warns on stacking: same group from ≥2 low-tier ingredients', () => {
    const small = canonical({
      slug: 'echalote',
      name_fr: 'échalote',
      fodmap_tier: 'high',
      fodmap_groups: ['fructan'],
      low_serving_g: 12,
      high_serving_g: 40,
    });
    const byRaw: Record<string, CanonicalIngredient> = { a: oignon, b: small };
    const { stacking, hasWarnings } = computeRecipeFodmap(
      [
        line({ raw: 'a', quantity: 20, unit: 'g' }), // 10 g/serving → low
        line({ raw: 'b', quantity: 16, unit: 'g' }), // 8 g/serving → low
      ],
      2,
      (l) => byRaw[l.raw]
    );
    expect(stacking).toEqual([{ group: 'fructan', ingredients: ['oignon', 'échalote'] }]);
    expect(hasWarnings).toBe(true);
  });

  it('does not stack groups from a single source or group-less lows', () => {
    const { stacking } = computeRecipeFodmap(
      [line({ raw: 'a', quantity: 20, unit: 'g' }), line({ raw: 'c', quantity: 100, unit: 'g' })],
      2,
      (l) => (l.raw === 'a' ? oignon : carotte)
    );
    expect(stacking).toEqual([]);
  });

  it('hasWarnings is false for an all-low recipe, true with moderate/check', () => {
    expect(computeRecipeFodmap([line({ raw: 'c' })], 2, () => carotte).hasWarnings).toBe(false);
    expect(computeRecipeFodmap([line({ raw: 'p' })], 2, () => poireau).hasWarnings).toBe(true);
    expect(computeRecipeFodmap([line({ raw: 'x' })], 2, () => null).hasWarnings).toBe(true);
  });

  it('ships the disclaimer copy', () => {
    expect(FODMAP_DISCLAIMER).toBe('Best-effort guidance, not medical advice.');
  });
});

describe('swap suggestions', () => {
  const chives = canonical({ slug: 'ciboulette', name_fr: 'ciboulette' });
  const onion = canonical({
    slug: 'oignon',
    name_fr: 'oignon',
    fodmap_tier: 'high',
    fodmap_groups: ['fructan'],
    fodmap_swaps: ['ciboulette', 'inconnu'],
  });
  const line: FodmapLine = { raw: 'oignon', name: 'oignon', quantity: null, unit: null };
  const resolve = (slug: string) => (slug === 'ciboulette' ? chives : null);

  it('resolves swap slugs to display names, dropping unknown slugs', () => {
    const result = computeRecipeFodmap([line], 4, () => onion, resolve);
    expect(result.flags[0].swaps).toEqual(['ciboulette']);
  });

  it('low-tier flags carry no swaps even when the table lists some', () => {
    const lowOnion = canonical({ ...onion, slug: 'oignon-low', fodmap_tier: 'low' });
    const result = computeRecipeFodmap([line], 4, () => lowOnion, resolve);
    expect(result.flags[0].swaps).toEqual([]);
  });

  it('without a resolver, swaps stay empty', () => {
    const result = computeRecipeFodmap([line], 4, () => onion);
    expect(result.flags[0].swaps).toEqual([]);
  });
});

describe('recipeFodmapTier', () => {
  const make = (tiers: ('low' | 'moderate' | 'high' | 'check')[]) => ({
    flags: tiers.map((tier, i) => ({
      name: `ing-${i}`,
      raw: `ing-${i}`,
      tier,
      groups: [],
      portionG: null,
      explanation: '',
      swaps: [],
    })),
    stacking: [],
    hasWarnings: tiers.some((t) => t !== 'low'),
  });

  it('takes the worst flag: high > moderate > check > low', () => {
    expect(recipeFodmapTier(make(['low', 'check', 'moderate', 'high']))).toBe('high');
    expect(recipeFodmapTier(make(['low', 'check', 'moderate']))).toBe('moderate');
    expect(recipeFodmapTier(make(['low', 'check']))).toBe('check');
    expect(recipeFodmapTier(make(['low', 'low']))).toBe('low');
  });

  it('no ingredient lines is unknowable, not low', () => {
    expect(recipeFodmapTier(make([]))).toBe('check');
  });
});
