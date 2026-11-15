import type { AutoCandidate } from '../auto-plan';
import {
  absencesFrom,
  awayMapFrom,
  cellKey,
  findSchoolChild,
  isGoingOut,
  isSalad,
  presetPicks,
  proposeWeek,
  sideSuggestions,
  swapMeal,
  tally,
  toggleGoingOut,
  withSchoolLunches,
  type ProposalInput,
} from '../ai-week';

const cand = (id: string, over: Partial<AutoCandidate> = {}): AutoCandidate => ({
  id,
  category: null,
  fodmapTier: 'low',
  weeksSincePlanned: null,
  totalMinutes: null,
  ...over,
});

const week = () =>
  Array.from({ length: 7 }, (_, day) => [
    { day, slot: 'lunch' as const },
    { day, slot: 'dinner' as const },
  ]).flat();

const base = (over: Partial<ProposalInput> = {}): ProposalInput => ({
  cells: week(),
  candidates: [
    cand('salad1', { kinds: ['salad'], category: 'vegetarian' }),
    cand('salad2', { kinds: ['salad'], category: 'vegetarian' }),
    cand('salad3', { kinds: ['salad'], category: 'fish' }),
    cand('meat1', { category: 'meat' }),
    cand('meat2', { category: 'meat' }),
    cand('meat3', { category: 'meat' }),
    cand('fish1', { category: 'fish' }),
    cand('fish2', { category: 'fish' }),
    cand('veg1', { category: 'vegetarian' }),
    cand('veg2', { category: 'vegetarian' }),
    cand('veg3', { category: 'legume' }),
    cand('veg4', { category: 'vegetarian' }),
    cand('veg5', { category: 'vegetarian' }),
    cand('veg6', { category: 'vegan' }),
  ],
  counts: { salad: 2, meat: 3, fish: 2 },
  styles: new Set(),
  away: new Map(),
  ...over,
});

describe('isSalad', () => {
  it('reads titles, dish types and tags in the app languages', () => {
    expect(isSalad({ title: 'Salade niçoise' })).toBe(true);
    expect(isSalad({ title: 'Ensalada de garbanzos' })).toBe(true);
    expect(isSalad({ title: 'Bowl', dish_type: 'insalata' })).toBe(true);
    expect(isSalad({ title: 'Bowl', tags: ['salad'] })).toBe(true);
    expect(isSalad({ title: 'Salmon with salsa verde' })).toBe(false);
  });
});

describe('who is home', () => {
  const persons = [
    { id: 'r', name: 'Ruben', is_employee: false },
    { id: 'm', name: 'Marc', is_employee: false },
    { id: 'e', name: 'Marcela', is_employee: true },
  ];

  it('finds Marc, not the employee', () => {
    expect(findSchoolChild(persons)?.id).toBe('m');
    expect(findSchoolChild([persons[0]])).toBeNull();
  });

  it('school marks Marc away for Mon, Tue, Thu, Fri lunch on the given days only', () => {
    const map = withSchoolLunches(new Map(), 'm', true, [0, 1, 2, 3, 4, 5, 6]);
    expect(absencesFrom(map).map((a) => `${a.day}-${a.slot}`)).toEqual(['0-lunch', '1-lunch', '3-lunch', '4-lunch']);
    const pastMonday = withSchoolLunches(new Map(), 'm', true, [3, 4, 5, 6]);
    expect(absencesFrom(pastMonday).map((a) => a.day)).toEqual([3, 4]);
    expect(absencesFrom(withSchoolLunches(map, 'm', false, [0, 1, 3, 4]))).toEqual([]);
  });

  it('going out = everyone away, and toggles back', () => {
    const key = cellKey(5, 'dinner');
    const out = toggleGoingOut(new Map(), key, ['r', 'm']);
    expect(isGoingOut(out.get(key), ['r', 'm'])).toBe(true);
    expect(isGoingOut(toggleGoingOut(out, key, ['r', 'm']).get(key), ['r', 'm'])).toBe(false);
  });

  it('round-trips absences', () => {
    const rows = [{ day: 2, slot: 'dinner' as const, person_id: 'r' }];
    expect(absencesFrom(awayMapFrom(rows))).toEqual(rows);
  });
});

describe('proposeWeek', () => {
  it('hits the salad, meat and fish counts', () => {
    const input = base();
    const { meals } = proposeWeek(input);
    expect(meals).toHaveLength(14);
    const byId = new Map(input.candidates.map((c) => [c.id, c]));
    const t = tally(meals, byId);
    expect(t.salad).toBe(2);
    expect(t.meat).toBe(3);
    expect(t.fish).toBe(2);
  });

  it('puts salads on lunches where someone is away', () => {
    const away = new Map([
      [cellKey(0, 'lunch'), new Set(['m'])],
      [cellKey(3, 'lunch'), new Set(['m'])],
    ]);
    const input = base({ away, styles: new Set(['salad_when_away']) });
    const { meals } = proposeWeek(input);
    const at = (day: number) => meals.find((m) => m.day === day && m.slot === 'lunch')?.recipeId;
    expect(at(0)).toMatch(/^salad/);
    expect(at(3)).toMatch(/^salad/);
  });

  it('leftovers: Tue–Fri lunch reuses the dinner before', () => {
    const { meals } = proposeWeek(base({ styles: new Set(['leftovers']) }));
    const get = (day: number, slot: 'lunch' | 'dinner') => meals.find((m) => m.day === day && m.slot === slot);
    for (const day of [1, 2, 3, 4]) {
      expect(get(day, 'lunch')?.recipeId).toBe(get(day - 1, 'dinner')?.recipeId);
      expect(get(day, 'lunch')?.leftover).toBe(true);
    }
    expect(get(0, 'lunch')?.leftover).toBeUndefined();
  });

  it('plans the week ideas first', () => {
    const { meals } = proposeWeek(base({ preferIds: ['veg6'] }));
    expect(meals.some((m) => m.recipeId === 'veg6')).toBe(true);
  });

  it('swapMeal picks a different dish', () => {
    const input = base();
    const { meals } = proposeWeek(input);
    const target = { day: 2, slot: 'dinner' as const };
    const current = meals.find((m) => m.day === 2 && m.slot === 'dinner')?.recipeId;
    const next = swapMeal(input, meals, target);
    expect(next).toBeTruthy();
    expect(next).not.toBe(current);
  });
});

describe('sides and employee presets', () => {
  it('suggests side dishes and salads first', () => {
    const recipes = [
      { id: '1', title: 'Riz pilaf', meal_type: 'side' },
      { id: '2', title: 'Risotto', meal_type: 'main' },
      { id: '3', title: 'Tomato salad', meal_type: 'main' },
    ];
    expect(sideSuggestions(recipes, '').map((r) => r.id)).toEqual(['1', '3']);
    expect(sideSuggestions(recipes, 'ri').map((r) => r.id)).toEqual(['1', '2']);
  });

  it('presets pick weekday lunches or all weekday meals', () => {
    const rows = [
      { key: 'a', day: 0, slot: 'lunch' as const },
      { key: 'b', day: 0, slot: 'dinner' as const },
      { key: 'c', day: 5, slot: 'lunch' as const },
    ];
    expect([...presetPicks(rows, 'weekday_lunches')]).toEqual(['a']);
    expect([...presetPicks(rows, 'weekdays')]).toEqual(['a', 'b']);
    expect(presetPicks(rows, 'none').size).toBe(0);
  });
});
