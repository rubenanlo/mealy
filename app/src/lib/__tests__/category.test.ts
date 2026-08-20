import { deriveCategory, spineColor } from '../category';
import { palettes } from '../theme';

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
