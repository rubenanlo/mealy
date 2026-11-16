import {
  addSuggestions,
  chipWeeks,
  detachPerson,
  everyoneAway,
  openMeals,
  personMeal,
  splitSlot,
  weekProgress,
  type SuggestRecipe,
} from '@/lib/week-page';
import type { MealSlot, PlanAbsence } from '@/lib/plan';

const e = (day: number, slot: MealSlot, position = 0) => ({ day, slot, position });

describe('week page helpers', () => {
  it('counts progress over meals someone is home for', () => {
    const absences: PlanAbsence[] = [
      { day: 4, slot: 'dinner', person_id: 'r' },
      { day: 4, slot: 'dinner', person_id: 'm' },
      { day: 0, slot: 'lunch', person_id: 'm' },
    ];
    expect(everyoneAway(absences, 4, 'dinner', ['r', 'm'])).toBe(true);
    expect(everyoneAway(absences, 0, 'lunch', ['r', 'm'])).toBe(false);
    const progress = weekProgress([e(0, 'lunch'), e(0, 'lunch', 1), e(1, 'dinner')], absences, ['r', 'm']);
    expect(progress).toEqual({ planned: 2, total: 13 });
  });

  it('a planned going-out meal still counts as planned', () => {
    const absences: PlanAbsence[] = [{ day: 4, slot: 'dinner', person_id: 'r' }];
    expect(weekProgress([e(4, 'dinner')], absences, ['r'])).toEqual({ planned: 1, total: 14 });
  });

  it('open meals skip past days, filled and going-out meals', () => {
    const now = new Date(2026, 10, 18, 9); // Wednesday of the week of Nov 16
    const absences: PlanAbsence[] = [{ day: 6, slot: 'lunch', person_id: 'r' }];
    const cells = openMeals([e(2, 'lunch')], absences, ['r'], '2026-11-16', now);
    expect(cells[0]).toEqual({ day: 2, slot: 'dinner' });
    expect(cells.some((c) => c.day < 2)).toBe(false);
    expect(cells.some((c) => c.day === 6 && c.slot === 'lunch')).toBe(false);
    expect(cells).toHaveLength(8);
  });

  it('chip weeks: last, this, next three, then later weeks with content', () => {
    expect(chipWeeks('2026-11-16', ['2026-11-23', '2027-01-04'])).toEqual([
      '2026-11-09',
      '2026-11-16',
      '2026-11-23',
      '2026-11-30',
      '2026-12-07',
      '2027-01-04',
    ]);
  });

  it('suggestions: ideas first, then gap fillers stale-first, then recent', () => {
    const r = (id: string, category: string | null, weeksSince: number | null, isSalad = false): SuggestRecipe => ({
      id,
      category,
      isSalad,
      weeksSince,
      totalMinutes: 30,
    });
    const recipes = [
      r('hake', 'fish', 8),
      r('cod', 'fish', 4),
      r('bass', 'fish', null),
      r('greek', 'vegetarian', 3, true),
      r('tikka', 'meat', 2),
      r('bolo', 'meat', 1),
      r('salmon', 'fish', 1),
    ];
    const out = addSuggestions({
      recipes,
      ideaRecipeIds: ['hake', 'unknown'],
      plannedRecipeIds: new Set(['salmon']),
      missing: ['fish', 'salad'],
    });
    expect(out.ideas).toEqual(['hake']);
    expect(out.gaps).toEqual(['bass', 'cod', 'greek']);
    expect(out.recent).toEqual(['bolo', 'tikka']);
  });

  it('splits a slot into main dish and sides', () => {
    const rows = [
      { id: 'b', ...e(0, 'dinner', 1) },
      { id: 'a', ...e(0, 'dinner', 0) },
      { id: 'x', ...e(1, 'dinner', 0) },
    ];
    const { main, sides } = splitSlot(rows, 0, 'dinner');
    expect(main?.id).toBe('a');
    expect(sides.map((s) => s.id)).toEqual(['b']);
    expect(splitSlot(rows, 2, 'lunch')).toEqual({ main: null, sides: [], plates: [], leftovers: [] });
  });

  it('keeps leftover rows out of the main dish and sides', () => {
    const rows = [
      { id: 'l', leftover_of: 'z', ...e(1, 'dinner', 50) },
      { id: 'a', ...e(1, 'dinner', 0) },
      { id: 'only', leftover_of: 'z', ...e(2, 'dinner', 50) },
    ];
    const one = splitSlot(rows, 1, 'dinner');
    expect(one.main?.id).toBe('a');
    expect(one.sides).toEqual([]);
    expect(one.leftovers.map((r) => r.id)).toEqual(['l']);
    const two = splitSlot(rows, 2, 'dinner');
    expect(two.main?.id).toBe('only');
    expect(two.leftovers).toEqual([]);
  });

  describe('different dishes per person (D1)', () => {
    const household = ['r', 'p', 'm'];
    const row = (id: string, position: number, person_ids: string[], extra: { leftover_of?: string } = {}) => ({
      id,
      ...e(0, 'dinner', position),
      person_ids,
      ...extra,
    });

    it('treats a row for people the main does not feed as its own plate', () => {
      const rows = [row('salmon', 0, ['r', 'p']), row('greens', 1, ['r', 'p']), row('pasta', 2, ['m']), row('salad', 3, ['m'])];
      const { main, sides, plates } = splitSlot(rows, 0, 'dinner');
      expect(main?.id).toBe('salmon');
      expect(sides.map((s) => s.id)).toEqual(['greens']);
      expect(plates.map((p) => [p.dish.id, p.sides.map((s) => s.id)])).toEqual([['pasta', ['salad']]]);
    });

    it('keeps everyone-lists as sides, so old plans read the same', () => {
      const rows = [row('rice', 0, []), row('pasta', 1, ['m'])];
      expect(splitSlot(rows, 0, 'dinner').plates).toEqual([]);
    });

    it('says what one person eats', () => {
      const rows = [row('salmon', 0, ['r', 'p']), row('pasta', 1, ['m'])];
      const away = [{ day: 0, slot: 'dinner' as MealSlot, person_id: 'p' }];
      expect(personMeal(rows, [], 0, 'dinner', 'm')).toMatchObject({ kind: 'dish', isMain: false, entry: { id: 'pasta' } });
      expect(personMeal(rows, [], 0, 'dinner', 'r')).toMatchObject({ kind: 'dish', isMain: true, entry: { id: 'salmon' } });
      expect(personMeal(rows, away, 0, 'dinner', 'p')).toEqual({ kind: 'away' });
      expect(personMeal([row('salmon', 0, ['r'])], [], 0, 'dinner', 'p')).toMatchObject({ kind: 'none' });
      expect(personMeal([], [], 0, 'dinner', 'p')).toEqual({ kind: 'empty' });
      const left = [row('soup', 0, ['r', 'p']), row('salmon-left', 50, ['m'], { leftover_of: 'salmon' })];
      expect(personMeal(left, [], 0, 'dinner', 'm')).toMatchObject({ kind: 'leftover', entry: { id: 'salmon-left' } });
    });

    it('takes a person off an everyone-main and its sides', () => {
      const rows = [row('rice', 0, []), row('egg', 1, [])];
      expect(detachPerson(rows, 0, 'dinner', 'm', household, new Set(['p']))).toEqual({
        update: [
          { id: 'rice', person_ids: ['r'] },
          { id: 'egg', person_ids: ['r'] },
        ],
        remove: [],
      });
    });

    it('deletes a plate and leftovers nobody eats any more', () => {
      const rows = [
        row('salmon', 0, ['r', 'p']),
        row('pasta', 1, ['m']),
        row('salad', 2, ['m']),
        row('left', 50, ['m'], { leftover_of: 'x' }),
      ];
      expect(detachPerson(rows, 0, 'dinner', 'm', household, new Set())).toEqual({
        update: [],
        remove: ['pasta', 'salad', 'left'],
      });
    });

    it('puts a person back on the main when joining', () => {
      const rows = [row('salmon', 0, ['r', 'p']), row('pasta', 1, ['m'])];
      expect(detachPerson(rows, 0, 'dinner', 'm', household, new Set(), { join: true })).toEqual({
        update: [{ id: 'salmon', person_ids: ['r', 'p', 'm'] }],
        remove: ['pasta'],
      });
    });
  });
});
