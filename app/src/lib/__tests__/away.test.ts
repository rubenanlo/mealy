import { cellsFor, copyLastWeek, mealsOut, patternOn, thinnerMeals, togglePattern } from '@/lib/away';
import type { PlanAbsence } from '@/lib/plan';

const a = (day: number, slot: 'lunch' | 'dinner', person_id: string): PlanAbsence => ({ day, slot, person_id });

describe('eating out helpers (design F3)', () => {
  it('turns a pattern on for the meals still at home, then off when all are out', () => {
    const lunches = cellsFor([0, 1, 2, 3, 4], ['lunch']);
    const abs = [a(1, 'lunch', 'r')];
    const on = togglePattern(abs, 'r', lunches);
    expect(on).toHaveLength(4);
    expect(on.every((c) => c.away && c.slot === 'lunch')).toBe(true);
    const all = [0, 1, 2, 3, 4].map((d) => a(d, 'lunch', 'r'));
    expect(patternOn(all, 'r', lunches)).toBe(true);
    expect(togglePattern(all, 'r', lunches).every((c) => !c.away)).toBe(true);
    expect(togglePattern(all, 'm', lunches)).toHaveLength(5);
  });

  it('copies last week for one person on the given days only', () => {
    const now = [a(0, 'lunch', 'r'), a(3, 'dinner', 'r')];
    const last = [a(0, 'lunch', 'r'), a(5, 'dinner', 'r'), a(5, 'dinner', 'p')];
    expect(copyLastWeek(now, last, 'r', [2, 3, 4, 5, 6])).toEqual([
      { day: 3, slot: 'dinner', personId: 'r', away: false },
      { day: 5, slot: 'dinner', personId: 'r', away: true },
    ]);
  });

  it('lists meals out and the meals with fewer people', () => {
    const abs = [a(2, 'lunch', 'r'), a(5, 'dinner', 'r'), a(5, 'dinner', 'p')];
    expect(mealsOut(abs, 'r')).toEqual([
      { day: 2, slot: 'lunch' },
      { day: 5, slot: 'dinner' },
    ]);
    expect(thinnerMeals(abs, ['r', 'p', 'm'])).toEqual([
      { day: 2, slot: 'lunch', home: ['p', 'm'] },
      { day: 5, slot: 'dinner', home: ['m'] },
    ]);
  });
});
