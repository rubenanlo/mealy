import { coreProteins, deriveCategory, looksLikeDessert, spineColor, proteinCategoryFromIngredients, resolveProteinCategory } from '../category';
import { palettes } from '../theme';
import { buildCanonicalIndex, type CanonicalIngredient } from '../canonical';

describe('deriveCategory', () => {
  it('finds the category among other tags', () => {
    expect(deriveCategory(['rapide', 'fish', 'four'])).toBe('fish');
    expect(deriveCategory(['meat'])).toBe('meat');
    expect(deriveCategory(['vegetarian', 'soupe'])).toBe('vegetarian');
    expect(deriveCategory(['legume'])).toBe('legume');
  });

  it('returns null when no category tag is present', () => {
    expect(deriveCategory([])).toBeNull();
    expect(deriveCategory(['dessert', 'rapide'])).toBeNull();
  });

  it('prefers fish > meat > vegetarian > legume when several are tagged', () => {
    expect(deriveCategory(['legume', 'fish'])).toBe('fish');
    expect(deriveCategory(['vegetarian', 'meat'])).toBe('meat');
  });

  it('fish & meat outranks its two halves', () => {
    expect(deriveCategory(['fish & meat'])).toBe('fish & meat');
    expect(deriveCategory(['fish', 'fish & meat', 'rapide'])).toBe('fish & meat');
  });
});

describe('coreProteins', () => {
  it('expands the combined category into its halves', () => {
    expect(coreProteins('fish & meat')).toEqual(['fish', 'meat']);
  });
  it('is the identity for plain categories', () => {
    expect(coreProteins('fish')).toEqual(['fish']);
    expect(coreProteins('legume')).toEqual(['legume']);
  });
});

describe('spineColor', () => {
  it.each(['light', 'dark'] as const)('maps every category to a %s palette token', (scheme) => {
    const colors = palettes[scheme];
    expect(spineColor('fish', colors)).toBe(colors.spineFish);
    expect(spineColor('meat', colors)).toBe(colors.spineMeat);
    expect(spineColor('vegetarian', colors)).toBe(colors.spineVeg);
    expect(spineColor('legume', colors)).toBe(colors.spineLegume);
    expect(spineColor('fish & meat', colors)).toBe(colors.spineFish);
  });

  it('is transparent for unknown categories — absence is information', () => {
    expect(spineColor(null, palettes.light)).toBe('transparent');
  });
});

function ing(slug: string, category: string | null, name_fr = slug): CanonicalIngredient {
  return {
    id: slug, slug, name_en: slug, name_fr, name_es: slug, name_it: null, aliases: [],
    category, aisle: null, season: null, fodmap_tier: 'low', fodmap_groups: [], fodmap_swaps: [],
    low_serving_g: null, high_serving_g: null, avg_unit_weight_g: null,
    density_g_per_ml: null, verified: true,
  };
}

const INDEX = buildCanonicalIndex([
  ing('boeuf', 'meat'), ing('saumon', 'fish'), ing('lentille', 'legume'),
  ing('tofu', 'vegetarian'), ing('carotte', 'vegetable'),
]);

describe('proteinCategoryFromIngredients', () => {
  it('detects meat from a French raw line', () => {
    expect(
      proteinCategoryFromIngredients([{ raw: '400 g de boeuf haché', name: 'boeuf' }], INDEX)
    ).toBe('meat');
  });
  it('fish plus meat in the same recipe derives the combined category', () => {
    expect(
      proteinCategoryFromIngredients(
        [{ raw: '200 g de boeuf', name: 'boeuf' }, { raw: '1 pavé de saumon', name: 'saumon' }],
        INDEX
      )
    ).toBe('fish & meat');
  });
  it('fish alone stays plain fish', () => {
    expect(
      proteinCategoryFromIngredients([{ raw: '1 pavé de saumon', name: 'saumon' }], INDEX)
    ).toBe('fish');
  });
  it('returns null when only non-protein ingredients match', () => {
    expect(proteinCategoryFromIngredients([{ raw: '2 carottes', name: 'carotte' }], INDEX)).toBeNull();
  });
  it('falls back to the name when raw does not match', () => {
    expect(proteinCategoryFromIngredients([{ raw: 'un beau morceau', name: 'boeuf' }], INDEX)).toBe('meat');
  });
});

describe('resolveProteinCategory', () => {
  it('an explicit category tag wins over ingredient derivation (manual override)', () => {
    expect(resolveProteinCategory(['vegetarian'], [{ raw: '1 saumon', name: 'saumon' }], INDEX)).toBe('vegetarian');
  });
  it('derives from ingredients when no tag is set (Auto)', () => {
    expect(resolveProteinCategory([], [{ raw: '1 saumon', name: 'saumon' }], INDEX)).toBe('fish');
    expect(
      resolveProteinCategory(
        [],
        [{ raw: '200 g de boeuf', name: 'boeuf' }, { raw: '1 saumon', name: 'saumon' }],
        INDEX
      )
    ).toBe('fish & meat');
  });
  it('falls back to tags when no ingredient is a protein', () => {
    expect(resolveProteinCategory(['meat'], [{ raw: '2 carottes', name: 'carotte' }], INDEX)).toBe('meat');
  });
  it('falls back to tags when index is null', () => {
    expect(resolveProteinCategory(['fish'], [{ raw: '1 saumon', name: 'saumon' }], null)).toBe('fish');
  });
});

describe('looksLikeDessert', () => {
  it('flags dessert dish types in the four app languages', () => {
    expect(looksLikeDessert('Dessert', [])).toBe(true);
    expect(looksLikeDessert('Desserts', [])).toBe(true);
    expect(looksLikeDessert('Postre', [])).toBe(true);
    expect(looksLikeDessert('Dolci', [])).toBe(true);
    expect(looksLikeDessert(null, ['dessert'])).toBe(true);
  });
  it('never flags savory dishes with sweet-sounding ingredients', () => {
    expect(looksLikeDessert('Main course', ['sweet potato'])).toBe(false);
    expect(looksLikeDessert('Crab Cakes', [])).toBe(false);
    expect(looksLikeDessert(null, [])).toBe(false);
  });
});
