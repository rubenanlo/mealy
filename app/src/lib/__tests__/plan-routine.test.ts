import type { AutoCandidate } from '../auto-plan';
import { FAVOURITE_KIND, answerQuotas, proposeWeek, routineBonus, suggestForCell, type ProposalInput, type RoutineScoring } from '../ai-week';
import {
  PREV_SUNDAY,
  SALAD_MATCH,
  favouriteSets,
  leftoverLinks,
  parseRoutine,
  portionsFor,
  routineLines,
  rulesToCheck,
  scoringRules,
  type PlanRoutine,
  type RoutineRecipe,
} from '../plan-routine';

const cand = (id: string, over: Partial<AutoCandidate> = {}): AutoCandidate => ({
  id,
  category: null,
  fodmapTier: 'low',
  weeksSincePlanned: 5,
  totalMinutes: 25,
  ...over,
});

const scoring = (over: Partial<RoutineScoring> = {}): RoutineScoring => ({
  quickMax: 30,
  weekendMax: 150,
  favouriteIds: new Set(),
  dayBeforeIds: new Set(),
  favouritesMin: 0,
  rules: [],
  ...over,
});

const recipes: RoutineRecipe[] = [
  { id: 'r1', title: 'Ricotta and spinach ravioli', isSalad: false, category: 'vegetarian' },
  { id: 'r2', title: 'Arroz chaufa', isSalad: false, category: 'meat', ingredients: ['rice', 'coriander'] },
  { id: 'r3', title: 'Tomato salad', isSalad: true, category: 'vegetarian' },
  { id: 'r4', title: 'Shrimp saganaki', isSalad: false, category: 'fish' },
];

describe('parseRoutine', () => {
  it('fills defaults from an empty object', () => {
    const r = parseRoutine({});
    expect(r.quick).toEqual({ on: true, maxMinutes: 30 });
    expect(r.leftovers.on).toBe(false);
    expect(r.leftovers.days).toEqual([0, 1, 2, 3, 4]);
    expect(r.rules).toEqual([]);
  });

  it('drops malformed favourites and rules and clamps numbers', () => {
    const r = parseRoutine({
      quick: { on: false, maxMinutes: 9999 },
      favourites: [{ id: 'a', label: 'Salads', match: SALAD_MATCH }, { label: '' }, 'x'],
      rules: [{ id: 'q', text: 'No fish on Monday', days: [0, 9], avoidCategories: ['fish', 'cake'] }, {}],
      leftovers: { on: true, personId: 'm', days: [4, 1, 1] },
    });
    expect(r.quick).toEqual({ on: false, maxMinutes: 240 });
    expect(r.favourites).toHaveLength(1);
    expect(r.rules).toHaveLength(1);
    expect(r.rules[0]).toMatchObject({ title: 'No fish on Monday', days: [0], avoidCategories: ['fish'], on: true });
    expect(r.leftovers).toEqual({ on: true, personId: 'm', days: [1, 4] });
  });
});

describe('favourites', () => {
  it('matches a recipe, a word in titles, and salads', () => {
    const routine = parseRoutine({
      favourites: [
        { id: 'a', label: 'Arroz chaufa', recipeId: 'r2', dayBefore: true },
        { id: 'b', label: 'Ravioli', match: 'RAVIOLI' },
        { id: 'c', label: 'Salads', match: SALAD_MATCH },
      ],
    });
    const { favouriteIds, dayBeforeIds } = favouriteSets(routine, recipes);
    expect([...favouriteIds].sort()).toEqual(['r1', 'r2', 'r3']);
    expect([...dayBeforeIds]).toEqual(['r2']);
  });
});

describe('rules', () => {
  const routine = parseRoutine({
    rules: [
      { id: '1', text: 'No fish on Mondays', title: 'No fish on Mondays', days: [0], avoidCategories: ['fish'] },
      { id: '2', text: 'No coriander for P', title: 'No coriander', avoidWords: ['Coriander'], personIds: ['p'] },
      { id: '3', text: 'Pizza night on Friday', title: 'Pizza night' },
      { id: '4', text: 'Off rule', title: 'Off', on: false, avoidCategories: ['meat'] },
    ],
  });

  it('turns structured rules into recipe exclusions', () => {
    const rules = scoringRules(routine, recipes);
    expect(rules).toHaveLength(2);
    expect([...rules[0].avoidIds]).toEqual(['r4']);
    expect([...rules[1].avoidIds]).toEqual(['r2']);
  });

  it('leaves free-form rules for the AI check', () => {
    expect(rulesToCheck(routine).map((r) => r.id)).toEqual(['3']);
  });

  it('a broken rule is near-forbidden only where it applies', () => {
    const s = scoring({ rules: scoringRules(routine, recipes) });
    const fish = cand('r4');
    expect(routineBonus(s, new Map(), fish, { day: 0, slot: 'dinner' })).toBeLessThan(-4000);
    expect(routineBonus(s, new Map(), fish, { day: 1, slot: 'dinner' })).toBeGreaterThan(0);
    // Coriander only matters when P eats.
    const chaufa = cand('r2');
    expect(routineBonus(s, new Map(), chaufa, { day: 2, slot: 'lunch' })).toBeLessThan(-4000);
    const pAway = new Map([['2-lunch', new Set(['p'])]]);
    expect(routineBonus(s, pAway, chaufa, { day: 2, slot: 'lunch' })).toBeGreaterThan(-4000);
  });

  it('routine lines include every rule that is on', () => {
    const lines = routineLines(routine, { leftoverPerson: null, favourites: ['Salads'] });
    expect(lines.join('\n')).toContain('Pizza night on Friday');
    expect(lines.join('\n')).not.toContain('Off rule');
    expect(lines.join('\n')).toContain('Weekday favourites: Salads.');
  });
});

describe('routineBonus', () => {
  it('keeps weekdays under the cap unless the dish is made the day before', () => {
    const s = scoring({ dayBeforeIds: new Set(['slowAhead']) });
    const cell = { day: 2, slot: 'dinner' as const };
    expect(routineBonus(s, new Map(), cand('slow', { totalMinutes: 70 }), cell)).toBeLessThan(-1000);
    expect(routineBonus(s, new Map(), cand('slowAhead', { totalMinutes: 70 }), cell)).toBeGreaterThan(0);
    expect(routineBonus(s, new Map(), cand('fast', { totalMinutes: 20 }), cell)).toBeGreaterThan(0);
  });

  it('prefers long or new recipes for weekend lunch', () => {
    const s = scoring();
    const lunch = { day: 5, slot: 'lunch' as const };
    const long = routineBonus(s, new Map(), cand('long', { totalMinutes: 120 }), lunch);
    const quick = routineBonus(s, new Map(), cand('quick', { totalMinutes: 15 }), lunch);
    const fresh = routineBonus(s, new Map(), cand('new', { totalMinutes: 60, weeksSincePlanned: null }), lunch);
    expect(long).toBeGreaterThan(quick);
    expect(fresh).toBeGreaterThan(long);
  });
});

describe('proposeWeek with a routine', () => {
  const cells = Array.from({ length: 7 }, (_, day) => [
    { day, slot: 'lunch' as const },
    { day, slot: 'dinner' as const },
  ]).flat();
  const candidates = [
    ...Array.from({ length: 10 }, (_, i) => cand(`quick${i}`, { totalMinutes: 20, category: i % 2 ? 'vegetarian' : 'legume' })),
    ...Array.from({ length: 4 }, (_, i) => cand(`slow${i}`, { totalMinutes: 120, category: 'vegetarian' })),
    cand('fav1', { totalMinutes: 25, kinds: [FAVOURITE_KIND] }),
    cand('fav2', { totalMinutes: 20, kinds: [FAVOURITE_KIND] }),
    cand('fav3', { totalMinutes: 15, kinds: [FAVOURITE_KIND] }),
  ];
  const input = (): ProposalInput => ({
    cells,
    candidates,
    counts: { salad: 0, meat: 0, fish: 0 },
    styles: new Set(),
    away: new Map(),
    routine: scoring({ favouriteIds: new Set(['fav1', 'fav2', 'fav3']), favouritesMin: 3 }),
  });

  it('puts slow dishes only on the weekend and meets the favourites minimum', () => {
    const { meals } = proposeWeek(input());
    for (const m of meals) {
      if (m.recipeId?.startsWith('slow')) expect(m.day).toBeGreaterThanOrEqual(5);
    }
    const favs = meals.filter((m) => m.recipeId?.startsWith('fav'));
    expect(favs).toHaveLength(3);
    for (const m of favs) expect(m.day).toBeLessThanOrEqual(4);
    const weekendLunches = meals.filter((m) => m.slot === 'lunch' && m.day >= 5);
    expect(weekendLunches.every((m) => m.recipeId?.startsWith('slow'))).toBe(true);
  });

  it('adds the favourites minimum as a quota', () => {
    expect(answerQuotas({ salad: 1, meat: 2, fish: 1 }, [], 4)).toContainEqual({ category: FAVOURITE_KIND, min: 4, max: null });
    expect(answerQuotas({ salad: 1, meat: 2, fish: 1 }, [], 0).some((q) => q.category === FAVOURITE_KIND)).toBe(false);
  });

  it('suggests several different dishes for one meal', () => {
    const { meals } = proposeWeek(input());
    const ids = suggestForCell(input(), meals, { day: 1, slot: 'dinner' }, 3);
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    const current = meals.find((m) => m.day === 1 && m.slot === 'dinner')?.recipeId;
    expect(ids).not.toContain(current);
  });
});

describe('leftoverLinks', () => {
  const routine = (over: Partial<PlanRoutine['leftovers']> = {}): PlanRoutine =>
    parseRoutine({ leftovers: { on: true, personId: 'm', days: [0, 1, 2, 3, 4], ...over } });

  it('chains each weeknight to the night before, Monday to last Sunday', () => {
    const links = leftoverLinks({
      routine: routine(),
      days: [0, 1, 2, 3, 4, 5, 6],
      personHome: () => true,
      hasDinner: () => true,
    });
    expect(links.map((l) => [l.day, l.fromDay])).toEqual([
      [0, PREV_SUNDAY],
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
  });

  it('skips nights switched off, nights the person is out, and nights with no dinner before', () => {
    const links = leftoverLinks({
      routine: routine(),
      days: [0, 1, 2, 3, 4],
      personHome: (day) => day !== 3,
      hasDinner: (day) => day !== PREV_SUNDAY,
      off: new Set([2]),
    });
    expect(links.map((l) => l.day)).toEqual([1, 4]);
  });

  it('does nothing when off or without a person', () => {
    expect(leftoverLinks({ routine: routine({ on: false }), days: [1], personHome: () => true, hasDinner: () => true })).toEqual([]);
    expect(leftoverLinks({ routine: routine({ personId: null }), days: [1], personHome: () => true, hasDinner: () => true })).toEqual([]);
  });

  it('counts the extra portion on the dinner that feeds the next night', () => {
    const links = [{ day: 2, fromDay: 1 }];
    expect(portionsFor(2, 1, links)).toBe(3);
    expect(portionsFor(2, 2, links)).toBe(2);
  });
});
