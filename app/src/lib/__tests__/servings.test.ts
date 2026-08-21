import { rescaleIngredients } from '../servings';

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
