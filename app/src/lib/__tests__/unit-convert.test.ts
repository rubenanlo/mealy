import { convertIngredient, convertIngredients, convertStepText } from '../unit-convert';
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

describe('convertStepText', () => {
  it('original passes through untouched', () => {
    const text = 'Heat the oven to 400 degrees.';
    expect(convertStepText(text, 'original')).toBe(text);
  });

  it('metric: converts oven Fahrenheit (bare "degrees" read as F at oven range)', () => {
    expect(convertStepText('Heat the oven to 400 degrees.', 'metric')).toBe(
      'Heat the oven to 205°C.'
    );
    expect(convertStepText('bake at 350°F until golden', 'metric')).toBe(
      'bake at 175°C until golden'
    );
  });

  it('metric: leaves Celsius alone, converts cups and ounces', () => {
    expect(convertStepText('Cuire 30 min à 180°C', 'metric')).toBe('Cuire 30 min à 180°C');
    expect(convertStepText('stir in ½ cup water', 'metric')).toBe('stir in 120 ml water');
    expect(convertStepText('add 8 ounces feta', 'metric')).toBe('add 227 g feta');
    expect(convertStepText('add 1 pound shrimp', 'metric')).toBe('add 454 g shrimp');
  });

  it('metric: spoons and times stay untouched', () => {
    const text = 'heat 2 tablespoons olive oil, cook about 4 minutes';
    expect(convertStepText(text, 'metric')).toBe(text);
  });

  it('us: converts metric mass/volume and Celsius', () => {
    expect(convertStepText('préchauffer le four à 180 degrés C', 'us')).toBe(
      'préchauffer le four à 180 degrés C' // "degrés" is not matched — French keeps its own text
    );
    expect(convertStepText('bake at 200°C', 'us')).toBe('bake at 390°F');
    expect(convertStepText('add 240 ml stock', 'us')).toBe('add 1 cup stock');
    expect(convertStepText('add 450 g potatoes', 'us')).toBe('add 15.9 oz potatoes');
  });

  it('handles mixed fractions in prose', () => {
    expect(convertStepText('pour in 1½ cups broth', 'metric')).toBe('pour in 360 ml broth');
    expect(convertStepText('pour in 1 1/2 cups broth', 'metric')).toBe('pour in 360 ml broth');
  });
});
