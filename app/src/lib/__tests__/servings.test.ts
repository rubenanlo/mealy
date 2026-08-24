import { entryServings, rescaleIngredients, servingsFactor } from '../servings';

const ing = (quantity: number | null, unit: string | null = 'g') => ({
  raw: 'x', quantity, unit, name: 'x', group: null, fodmap: null,
});

describe('rescaleIngredients', () => {
  it('scales large quantities to integers', () => {
    expect(rescaleIngredients([ing(200)], 1.5)[0].quantity).toBe(300);
    expect(rescaleIngredients([ing(250)], 1 / 3)[0].quantity).toBe(83);
  });
  it('keeps 1 decimal for small amounts', () => {
    expect(rescaleIngredients([ing(0.5, 'tsp')], 1.5)[0].quantity).toBe(0.8);
    expect(rescaleIngredients([ing(2)], 1.25)[0].quantity).toBe(2.5);
  });
  it('leaves null quantities untouched', () => {
    const row = ing(null, null);
    expect(rescaleIngredients([row], 2)[0]).toEqual(row);
  });
  it('does not mutate the input', () => {
    const rows = [ing(100)];
    rescaleIngredients(rows, 2);
    expect(rows[0].quantity).toBe(100);
  });
});

describe('entryServings', () => {
  it('counts the whole household when nobody is picked', () => {
    expect(entryServings([], 0, 4)).toBe(4);
  });
  it('counts only the picked eaters', () => {
    expect(entryServings(['a', 'b'], 0, 4)).toBe(2);
  });
  it('adds guests on top of the household', () => {
    expect(entryServings([], 3, 4)).toBe(7);
  });
  it('adds guests on top of picked eaters', () => {
    expect(entryServings(['a'], 2, 4)).toBe(3);
  });
  it('ignores negative guest counts', () => {
    expect(entryServings(['a', 'b'], -1, 4)).toBe(2);
  });
});

describe('servingsFactor', () => {
  it('scales target over base', () => {
    expect(servingsFactor(6, 4)).toBe(1.5);
  });
  it('is null without a usable base yield', () => {
    expect(servingsFactor(6, null)).toBeNull();
    expect(servingsFactor(6, 0)).toBeNull();
  });
  it('is null for a non-positive target', () => {
    expect(servingsFactor(0, 4)).toBeNull();
  });
});
