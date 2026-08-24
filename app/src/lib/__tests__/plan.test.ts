import {
  addWeeks,
  plannedEvents,
  removeEntryPayload,
  slotCoverage,
  slotEntries,
  upsertEntryPayload,
  weekStart,
} from '../plan';

describe('weekStart', () => {
  it('maps a Wednesday to that week Monday', () => {
    // 2026-08-19 is a Wednesday
    expect(weekStart(new Date(2026, 7, 19))).toBe('2026-08-17');
  });

  it('maps a Sunday to the Monday six days prior', () => {
    // 2026-08-23 is a Sunday
    expect(weekStart(new Date(2026, 7, 23))).toBe('2026-08-17');
  });

  it('is a fixed point on Mondays', () => {
    expect(weekStart(new Date(2026, 7, 17))).toBe('2026-08-17');
  });

  it('crosses month boundaries', () => {
    // 2026-09-01 is a Tuesday → Monday 2026-08-31
    expect(weekStart(new Date(2026, 8, 1))).toBe('2026-08-31');
  });
});

describe('addWeeks', () => {
  it('moves forward and backward by whole weeks', () => {
    expect(addWeeks('2026-08-17', 1)).toBe('2026-08-24');
    expect(addWeeks('2026-08-17', -1)).toBe('2026-08-10');
    expect(addWeeks('2026-08-31', 1)).toBe('2026-09-07');
  });
});

const entry = (over: Partial<Parameters<typeof slotCoverage>[0][number]> & { person_ids: string[] }) => ({
  day: 0,
  slot: 'lunch' as const,
  position: 0,
  ...over,
});

describe('slotCoverage', () => {
  const persons = ['a', 'b', 'c'];

  it('reports everyone uncovered for an empty slot', () => {
    expect(slotCoverage([], 0, 'lunch', persons)).toEqual({
      covered: [],
      uncovered: ['a', 'b', 'c'],
    });
  });

  it('treats empty person_ids as covering the whole household', () => {
    expect(slotCoverage([entry({ person_ids: [] })], 0, 'lunch', persons)).toEqual({
      covered: ['a', 'b', 'c'],
      uncovered: [],
    });
  });

  it('unions partial and overlapping person_ids', () => {
    const entries = [
      entry({ person_ids: ['a'] }),
      entry({ person_ids: ['a', 'b'], position: 1 }),
    ];
    expect(slotCoverage(entries, 0, 'lunch', persons)).toEqual({
      covered: ['a', 'b'],
      uncovered: ['c'],
    });
  });

  it('scopes to the requested day and slot', () => {
    const entries = [entry({ person_ids: [], day: 1 }), entry({ person_ids: [], slot: 'dinner' as const })];
    expect(slotCoverage(entries, 0, 'lunch', persons).uncovered).toEqual(persons);
  });
});

describe('slotEntries', () => {
  it('filters by cell and orders by position', () => {
    const entries = [
      { day: 0, slot: 'lunch' as const, position: 1, id: 'second' },
      { day: 0, slot: 'lunch' as const, position: 0, id: 'first' },
      { day: 0, slot: 'dinner' as const, position: 0, id: 'other' },
    ];
    expect(slotEntries(entries, 0, 'lunch').map((e) => e.id)).toEqual(['first', 'second']);
  });
});

describe('payload builders', () => {
  it('builds an insert payload with household-wide defaults', () => {
    expect(
      upsertEntryPayload({ mealPlanId: 'mp', day: 3, slot: 'dinner', recipeId: 'r1' })
    ).toEqual({
      meal_plan_id: 'mp',
      day: 3,
      slot: 'dinner',
      recipe_id: 'r1',
      custom_title: null,
      person_ids: [],
      guest_count: 0,
      assigned_cook: 'family',
      position: 0,
    });
  });

  it('carries the guest count through, clamping negatives to 0', () => {
    expect(
      upsertEntryPayload({ mealPlanId: 'mp', day: 1, slot: 'lunch', recipeId: 'r1', guestCount: 3 })
        .guest_count
    ).toBe(3);
    expect(
      upsertEntryPayload({ mealPlanId: 'mp', day: 1, slot: 'lunch', recipeId: 'r1', guestCount: -2 })
        .guest_count
    ).toBe(0);
  });

  it('builds a free-text meal payload (custom_title only, recipe_id null)', () => {
    const payload = upsertEntryPayload({
      mealPlanId: 'mp',
      day: 5,
      slot: 'lunch',
      customTitle: '  Leftover soup  ',
    });
    expect(payload.recipe_id).toBeNull();
    expect(payload.custom_title).toBe('Leftover soup');
    expect(payload.person_ids).toEqual([]);
  });

  it('never allows both a recipe and a custom title, nor neither', () => {
    expect(() =>
      upsertEntryPayload({ mealPlanId: 'mp', day: 0, slot: 'lunch', recipeId: 'r1', customTitle: 'x' })
    ).toThrow();
    expect(() => upsertEntryPayload({ mealPlanId: 'mp', day: 0, slot: 'lunch' })).toThrow();
    expect(() =>
      upsertEntryPayload({ mealPlanId: 'mp', day: 0, slot: 'lunch', customTitle: '   ' })
    ).toThrow();
  });

  it('keeps explicit person subset and cook', () => {
    const payload = upsertEntryPayload({
      mealPlanId: 'mp',
      day: 0,
      slot: 'lunch',
      recipeId: 'r1',
      personIds: ['a'],
      assignedCook: 'employee',
      position: 2,
    });
    expect(payload.person_ids).toEqual(['a']);
    expect(payload.assigned_cook).toBe('employee');
    expect(payload.position).toBe(2);
  });

  it('builds a remove filter', () => {
    expect(removeEntryPayload('e1')).toEqual({ id: 'e1' });
  });
});

describe('plannedEvents', () => {
  it('logs one event per (entry, covered person), empty subset = everyone', () => {
    const events = plannedEvents(
      [
        { recipe_id: 'r1', custom_title: null, person_ids: [], day: 0, slot: 'lunch' },
        { recipe_id: 'r2', custom_title: null, person_ids: ['b'], day: 0, slot: 'dinner' },
      ],
      'hh',
      ['a', 'b'],
      '2026-08-17'
    );
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({
      household_id: 'hh',
      person_id: 'a',
      recipe_id: 'r1',
      type: 'planned',
      meta: { week_start: '2026-08-17', day: 0, slot: 'lunch' },
    });
    expect(events[2].person_id).toBe('b');
    expect(events[2].recipe_id).toBe('r2');
  });

  it('logs custom meals with recipe_id null and meta.custom_title', () => {
    const events = plannedEvents(
      [{ recipe_id: null, custom_title: 'Leftover soup', person_ids: [], day: 2, slot: 'dinner' }],
      'hh',
      ['a', 'b'],
      '2026-08-17'
    );
    expect(events).toHaveLength(2);
    expect(events[0].recipe_id).toBeNull();
    expect(events[0].meta).toEqual({
      week_start: '2026-08-17',
      day: 2,
      slot: 'dinner',
      custom_title: 'Leftover soup',
    });
  });
});
