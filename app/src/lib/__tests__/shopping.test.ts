import { collectWeekIngredients } from '../shopping';
import type { IngredientRow } from '../worker';

const ing = (name: string, quantity: number | null, unit: string | null, raw?: string): IngredientRow => ({
  raw: raw ?? name,
  quantity,
  unit,
  name,
  group: null,
  fodmap: null,
});

const recipes = [
  { id: 'r1', title: 'Poulet rôti', ingredients: [ing('poulet', 1, 'kg'), ing('thym', null, null)] },
  { id: 'r2', title: 'Dahl de lentilles', ingredients: [ing('lentilles corail', 250, 'g')] },
];

describe('collectWeekIngredients', () => {
  it('returns nothing for an empty plan', () => {
    expect(collectWeekIngredients([], recipes)).toEqual([]);
  });

  it('groups ingredients by recipe, in entry order', () => {
    const groups = collectWeekIngredients([{ recipe_id: 'r2' }, { recipe_id: 'r1' }], recipes);
    expect(groups.map((g) => g.recipeTitle)).toEqual(['Dahl de lentilles', 'Poulet rôti']);
    expect(groups[1].items).toEqual([
      { name: 'poulet', quantity: 1, unit: 'kg', raw: 'poulet' },
      { name: 'thym', quantity: null, unit: null, raw: 'thym' },
    ]);
  });

  it('lists a recipe once per entry when planned twice (no merging in Phase 1)', () => {
    const groups = collectWeekIngredients([{ recipe_id: 'r1' }, { recipe_id: 'r1' }], recipes);
    expect(groups).toHaveLength(2);
    expect(groups[0].recipeId).toBe('r1');
    expect(groups[1].recipeId).toBe('r1');
  });

  it('skips entries whose recipe is unknown', () => {
    expect(collectWeekIngredients([{ recipe_id: 'missing' }], recipes)).toEqual([]);
  });
});
