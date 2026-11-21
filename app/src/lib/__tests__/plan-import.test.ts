import {
  buildDrafts,
  checkReason,
  chooseOption,
  dayDates,
  foldPhrase,
  isoDate,
  matchRows,
  nextDateFor,
  planRows,
  startChoices,
  type DraftMeal,
  type ImportedMeal,
  type RememberedMatch,
} from '../plan-import';

const meal = (over: Partial<ImportedMeal>): ImportedMeal => ({
  day_word: 'Dijous',
  day_index: 0,
  weekday: 3,
  slot: 'lunch',
  source: 'x',
  eating_out: false,
  main: { phrase: 'tacos pollastre', title: 'Tacos de pollastre', recipe_id: null },
  sides: [],
  extra_dishes: [],
  away_names: [],
  employee_part: null,
  employee_whole: false,
  undecided: false,
  options: [],
  note: null,
  ...over,
});

const persons = [
  { id: 'r', name: 'Ruben', is_employee: false },
  { id: 'p', name: 'Patricia', is_employee: false },
  { id: 'm', name: 'Marc', is_employee: false },
  { id: 's', name: 'Sindy', is_employee: true },
];
const eaterIds = ['r', 'p', 'm'];
// Saturday 21 Nov 2026.
const today = new Date(2026, 10, 21);
const thursday = new Date(2026, 10, 26);

const ctx = (memory: RememberedMatch[] = []) => ({
  start: thursday,
  memory: new Map(memory.map((m) => [m.phrase, m])),
  recipeIds: new Set(['r-tacos', 'r-chaufa']),
  persons,
  schoolChildId: 'm',
  schoolDays: [0, 1, 3, 4],
});

describe('dates', () => {
  it('finds the next weekday on or after today', () => {
    expect(isoDate(nextDateFor(3, today))).toBe('2026-11-26');
    expect(isoDate(nextDateFor(5, today))).toBe('2026-11-21');
    expect(startChoices(3, today)).toEqual(['2026-11-26', '2026-11-19']);
  });

  it('runs Thursday to Monday into the next week', () => {
    const dates = dayDates(
      [meal({ day_index: 0, weekday: 3 }), meal({ day_index: 1, weekday: 4 }), meal({ day_index: 2, weekday: 0 })],
      thursday
    );
    expect([...dates.values()].map(isoDate)).toEqual(['2026-11-26', '2026-11-27', '2026-11-30']);
  });
});

describe('foldPhrase', () => {
  it('ignores case, accents and punctuation', () => {
    expect(foldPhrase('  Arròs  Chaufa!! ')).toBe('arros chaufa');
  });
});

describe('buildDrafts', () => {
  it('uses remembered matches first, adds school lunches and missing slots', () => {
    const drafts = buildDrafts(
      [
        meal({ slot: 'lunch', main: { phrase: 'Arròs chaufa', title: 'Arròs chaufa', recipe_id: null } }),
        meal({ slot: 'dinner', main: { phrase: 'tacos pollastre', title: 'Tacos', recipe_id: 'r-tacos' } }),
        meal({ day_word: 'Dilluns', day_index: 1, weekday: 0, slot: 'lunch', away_names: ['patricia'] }),
      ],
      ctx([{ phrase: 'arros chaufa', recipe_id: 'r-chaufa', custom_title: null }])
    );
    expect(drafts.map((d) => d.key)).toEqual([
      '2026-11-26-lunch',
      '2026-11-26-dinner',
      '2026-11-30-lunch',
      '2026-11-30-dinner',
    ]);
    expect(drafts[0].main).toMatchObject({ recipeId: 'r-chaufa', fromMemory: true });
    expect(drafts[0].awayIds).toEqual(['m']);
    expect(drafts[1].main).toMatchObject({ recipeId: 'r-tacos', fromMemory: false });
    expect(drafts[1].awayIds).toEqual([]);
    expect(drafts[2].week).toBe('2026-11-30');
    expect(drafts[2].awayIds).toEqual(['m', 'p']);
    expect(drafts[3]).toMatchObject({ missing: true, kind: 'empty' });
    expect(checkReason(drafts[3])).toBe('missing');
  });

  it('drops unknown recipe ids and keeps remembered quick-meal titles', () => {
    const draft = buildDrafts(
      [meal({ slot: 'dinner', main: { phrase: 'festeta', title: 'Festa', recipe_id: 'gone' } })],
      ctx([{ phrase: 'festeta', recipe_id: null, custom_title: 'Festeta de divendres' }])
    ).find((d) => d.slot === 'dinner')!;
    expect(draft.main).toMatchObject({ recipeId: null, title: 'Festeta de divendres', fromMemory: true });
  });

  it('flags undecided meals and extras without people', () => {
    const drafts = buildDrafts(
      [
        meal({ slot: 'lunch', undecided: true, options: ['Amanida', 'Fora'] }),
        meal({
          slot: 'dinner',
          extra_dishes: [{ dish: { phrase: 'galettes', title: 'Galettes', recipe_id: null }, for_names: [], for_label: 'els nens' }],
        }),
      ],
      ctx()
    );
    expect(checkReason(drafts[0])).toBe('undecided');
    expect(checkReason(drafts[1])).toBe('who');
  });
});

describe('chooseOption', () => {
  const [draft] = buildDrafts([meal({ undecided: true, options: ['Tacos de pollastre', 'Fora'] })], ctx());

  it('turns "fora" into eating out', () => {
    expect(chooseOption(draft, 'Fora')).toMatchObject({ kind: 'out', main: null, options: [] });
  });

  it('keeps the main when it is the chosen option', () => {
    const chosen = chooseOption(draft, 'tacos de pollastre');
    expect(chosen.main?.phrase).toBe('tacos pollastre');
    expect(checkReason(chosen)).toBeNull();
  });
});

describe('planRows', () => {
  const base = (over: Partial<DraftMeal>): DraftMeal => ({
    key: 'k',
    date: '2026-11-26',
    week: '2026-11-23',
    day: 3,
    slot: 'dinner',
    source: '',
    kind: 'dish',
    main: { phrase: 'tacos', title: 'Tacos', recipeId: 'r-tacos', fromMemory: false },
    sides: [],
    extras: [],
    awayIds: [],
    employeePart: null,
    employeeWhole: false,
    options: [],
    note: null,
    missing: false,
    ...over,
  });

  it('writes eating out as absences for everyone and no meal', () => {
    const [week] = planRows([base({ kind: 'out', main: null })], eaterIds);
    expect(week.entries).toEqual([]);
    expect(week.absences.map((a) => a.person_id)).toEqual(['r', 'p', 'm']);
  });

  it('writes the main, sides, extra dish and the employee part', () => {
    const [week] = planRows(
      [
        base({
          awayIds: ['p'],
          sides: [{ phrase: 'quinoa', title: 'Amanida de quinoa', recipeId: null, fromMemory: false }],
          extras: [
            {
              dish: { phrase: 'galettes', title: 'Galettes', recipeId: null, fromMemory: false },
              personIds: ['m'],
              label: null,
            },
          ],
          employeePart: 'patates per la truita',
          note: 'croquetes, pernil',
        }),
      ],
      eaterIds
    );
    expect(week.absences).toEqual([{ day: 3, slot: 'dinner', person_id: 'p' }]);
    expect(week.entries.map((e) => [e.recipe_id ?? e.custom_title, e.person_ids, e.position])).toEqual([
      ['r-tacos', ['r'], 0],
      ['Amanida de quinoa', ['r'], 1],
      ['Galettes', ['m'], 2],
    ]);
    expect(week.entries[0]).toMatchObject({
      assigned_cook: 'employee',
      cook_part: true,
      instructions: 'patates per la truita · croquetes, pernil',
    });
  });

  it('keeps the whole household as [] when nobody is away, and splits weeks', () => {
    const weeks = planRows(
      [base({}), base({ key: 'k2', week: '2026-11-30', day: 0, slot: 'lunch' }), base({ kind: 'empty', main: null })],
      eaterIds
    );
    expect(weeks.map((w) => w.week)).toEqual(['2026-11-23', '2026-11-30']);
    expect(weeks[0].entries[0].person_ids).toEqual([]);
    expect(weeks[0].cells).toEqual([{ day: 3, slot: 'dinner' }]);
  });
});

describe('matchRows', () => {
  it('remembers settled dishes by folded phrase', () => {
    const drafts = buildDrafts(
      [
        meal({ slot: 'lunch', main: { phrase: 'Tacos  pollastre', title: 'Tacos', recipe_id: 'r-tacos' } }),
        meal({ slot: 'dinner', main: { phrase: 'festeta', title: 'Festeta', recipe_id: null } }),
        meal({ day_index: 1, weekday: 4, slot: 'lunch', undecided: true, options: ['A', 'Fora'] }),
      ],
      ctx()
    );
    expect(matchRows(drafts)).toEqual([
      { phrase: 'tacos pollastre', recipe_id: 'r-tacos', custom_title: null },
      { phrase: 'festeta', recipe_id: null, custom_title: 'Festeta' },
    ]);
  });
});
