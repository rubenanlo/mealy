import {
  buildCanonicalIndex,
  matchCanonical,
  normalizeRaw,
  type CanonicalIngredient,
} from '../canonical';

const ing = (over: Partial<CanonicalIngredient> & { slug: string; name_fr: string }): CanonicalIngredient => ({
  id: `id-${over.slug}`,
  name_en: over.slug,
  name_es: over.slug,
  aliases: [],
  category: null,
  aisle: null,
  season: null,
  fodmap_tier: 'check',
  fodmap_groups: [],
  low_serving_g: null,
  high_serving_g: null,
  avg_unit_weight_g: null,
  density_g_per_ml: null,
  verified: false,
  ...over,
});

const table: CanonicalIngredient[] = [
  ing({ slug: 'carotte', name_fr: 'carotte', name_en: 'carrot', aliases: ['carottes', 'carottes râpées'] }),
  ing({ slug: 'oignon', name_fr: 'oignon', name_en: 'onion', aliases: ['oignons', 'oignon jaune'] }),
  ing({ slug: 'pomme-de-terre', name_fr: 'pomme de terre', aliases: ['patate', 'patates'] }),
  ing({ slug: 'ail', name_fr: 'ail', name_en: 'garlic', aliases: ["gousse d'ail", "gousses d'ail"] }),
];
const index = buildCanonicalIndex(table);

describe('normalizeRaw', () => {
  it('lowercases, strips accents, quantities and prep words, singularizes', () => {
    expect(normalizeRaw('200 g de carottes râpées')).toBe('carotte');
    expect(normalizeRaw('Oignons émincés')).toBe('oignon');
    expect(normalizeRaw('2 gousses d’ail')).toBe('ail');
    expect(normalizeRaw('1 kg de pommes de terre')).toBe('pomme terre');
  });

  it('keeps unknown ingredient words', () => {
    expect(normalizeRaw('3 c. à s. de sauce soja')).toBe('sauce soja');
  });

  it('handles empty and quantity-only lines', () => {
    expect(normalizeRaw('')).toBe('');
    expect(normalizeRaw('200 g')).toBe('');
  });
});

describe('matchCanonical', () => {
  it('matches "200 g de carottes râpées" to carotte', () => {
    const m = matchCanonical(normalizeRaw('200 g de carottes râpées'), index);
    expect(m?.ingredient.slug).toBe('carotte');
  });

  it('matches "Oignons émincés" to oignon', () => {
    const m = matchCanonical(normalizeRaw('Oignons émincés'), index);
    expect(m?.ingredient.slug).toBe('oignon');
  });

  it('matches multi-word slugs and their aliases', () => {
    expect(matchCanonical(normalizeRaw('500 g de patates'), index)?.ingredient.slug).toBe(
      'pomme-de-terre'
    );
    expect(matchCanonical(normalizeRaw('pommes de terre'), index)?.ingredient.slug).toBe(
      'pomme-de-terre'
    );
  });

  it('prefers exact name over alias and reports matchedBy', () => {
    expect(matchCanonical('carotte', index)?.matchedBy).toBe('exact');
    expect(matchCanonical(normalizeRaw('carottes râpées'), index)?.matchedBy).toBe('exact');
    expect(matchCanonical(normalizeRaw('oignon jaune'), index)?.matchedBy).toBe('alias');
  });

  it('returns null for unknown lines and empty input', () => {
    expect(matchCanonical(normalizeRaw('poudre de perlimpinpin'), index)).toBeNull();
    expect(matchCanonical('', index)).toBeNull();
  });
});
