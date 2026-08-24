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

  it('custom meals (recipe_id null) contribute no ingredient group', () => {
    const groups = collectWeekIngredients(
      [{ recipe_id: null }, { recipe_id: 'r1' }],
      recipes
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].recipeId).toBe('r1');
  });

  describe('servings scaling', () => {
    const scaled = [
      { id: 'r3', title: 'Curry', servings: 4, ingredients: [ing('riz', 200, 'g'), ing('sel', null, null)] },
    ];

    it('scales quantities to eaters + guests (empty person_ids = whole household)', () => {
      const groups = collectWeekIngredients(
        [{ recipe_id: 'r3', person_ids: [], guest_count: 2 }],
        scaled,
        4 // household of 4 + 2 guests = 6 → ×1.5
      );
      expect(groups[0].items[0]).toEqual({ name: 'riz', quantity: 300, unit: 'g', raw: 'riz' });
      expect(groups[0].items[1].quantity).toBeNull(); // presence-only line untouched
    });

    it('scales down to the picked eaters', () => {
      const groups = collectWeekIngredients(
        [{ recipe_id: 'r3', person_ids: ['a', 'b'], guest_count: 0 }],
        scaled,
        4 // 2 eaters / 4 base = ×0.5
      );
      expect(groups[0].items[0].quantity).toBe(100);
    });

    it('leaves quantities verbatim when no eater count is supplied', () => {
      const groups = collectWeekIngredients(
        [{ recipe_id: 'r3', person_ids: [], guest_count: 2 }],
        scaled
      );
      expect(groups[0].items[0].quantity).toBe(200);
    });

    it('leaves quantities verbatim when the recipe has no base yield', () => {
      const noYield = [{ id: 'r4', title: 'Soupe', ingredients: [ing('eau', 500, 'ml')] }];
      const groups = collectWeekIngredients(
        [{ recipe_id: 'r4', person_ids: [], guest_count: 3 }],
        noYield,
        2
      );
      expect(groups[0].items[0].quantity).toBe(500);
    });
  });
});
