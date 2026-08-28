import { convertIngredient, convertIngredients } from '../unit-convert';
import type { IngredientRow } from '../worker';

const ing = (quantity: number | null, unit: string | null): IngredientRow => ({
  raw: 'x',
  quantity,
  unit,
  name: 'x',
  group: null,
  fodmap: null,
});

describe('convertIngredient', () => {
  it('US → metric: pounds and cups become grams/ml', () => {
    expect(convertIngredient(ing(1, 'pound'), 'metric')).toMatchObject({
      quantity: 454,
      unit: 'g',
    });
    expect(convertIngredient(ing(3, 'lb'), 'metric')).toMatchObject({ quantity: 1.36, unit: 'kg' });
    expect(convertIngredient(ing(2, 'cups'), 'metric')).toMatchObject({ quantity: 480, unit: 'ml' });
  });

  it('metric → US: grams and ml become oz/lb/cups', () => {
    expect(convertIngredient(ing(200, 'g'), 'us')).toMatchObject({ quantity: 7.1, unit: 'oz' });
    expect(convertIngredient(ing(1, 'kg'), 'us')).toMatchObject({ quantity: 2.2, unit: 'lb' });
    expect(convertIngredient(ing(240, 'ml'), 'us')).toMatchObject({ quantity: 1, unit: 'cup' });
    expect(convertIngredient(ing(30, 'ml'), 'us')).toMatchObject({ quantity: 1, unit: 'fl oz' });
  });

  it('spoons, counts, and unknown units pass through untouched', () => {
    expect(convertIngredient(ing(2, 'tbsp'), 'metric')).toEqual(ing(2, 'tbsp'));
    expect(convertIngredient(ing(3, null), 'metric')).toEqual(ing(3, null));
    expect(convertIngredient(ing(1, 'pinch'), 'us')).toEqual(ing(1, 'pinch'));
    expect(convertIngredient(ing(null, 'g'), 'us')).toEqual(ing(null, 'g'));
  });

  it('original returns the same list unchanged', () => {
    const list = [ing(1, 'lb'), ing(2, 'g')];
    expect(convertIngredients(list, 'original')).toBe(list);
  });
});
