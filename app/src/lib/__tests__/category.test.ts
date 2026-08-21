import { deriveCategory, spineColor, proteinCategoryFromIngredients, resolveProteinCategory } from '../category';
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
});

describe('spineColor', () => {
  it.each(['light', 'dark'] as const)('maps every category to a %s palette token', (scheme) => {
    const colors = palettes[scheme];
    expect(spineColor('fish', colors)).toBe(colors.spineFish);
    expect(spineColor('meat', colors)).toBe(colors.spineMeat);
    expect(spineColor('vegetarian', colors)).toBe(colors.spineVeg);
    expect(spineColor('legume', colors)).toBe(colors.spineLegume);
  });

  it('is transparent for unknown categories — absence is information', () => {
    expect(spineColor(null, palettes.light)).toBe('transparent');
  });
});

function ing(slug: string, category: string | null, name_fr = slug): CanonicalIngredient {
  return {
    id: slug, slug, name_en: slug, name_fr, name_es: slug, aliases: [],
    category, aisle: null, season: null, fodmap_tier: 'low', fodmap_groups: [],
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
  it('fish outranks meat (priority order)', () => {
    expect(
      proteinCategoryFromIngredients(
        [{ raw: '200 g de boeuf', name: 'boeuf' }, { raw: '1 pavé de saumon', name: 'saumon' }],
        INDEX
      )
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
  it('ingredient-derived category wins over tags', () => {
    expect(resolveProteinCategory(['vegetarian'], [{ raw: '1 saumon', name: 'saumon' }], INDEX)).toBe('fish');
  });
  it('falls back to tags when no ingredient is a protein', () => {
    expect(resolveProteinCategory(['meat'], [{ raw: '2 carottes', name: 'carotte' }], INDEX)).toBe('meat');
  });
  it('falls back to tags when index is null', () => {
    expect(resolveProteinCategory(['fish'], [{ raw: '1 saumon', name: 'saumon' }], null)).toBe('fish');
  });
});
