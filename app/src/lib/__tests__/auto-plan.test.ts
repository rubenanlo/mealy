import { autoFillWeek, type AutoCandidate, type EmptyCell } from '../auto-plan';

const cand = (id: string, over: Partial<AutoCandidate> = {}): AutoCandidate => ({
  id,
  category: null,
  fodmapTier: 'low',
  weeksSincePlanned: null,
  totalMinutes: null,
  ...over,
});
const cell = (day: number, slot: 'lunch' | 'dinner' = 'lunch'): EmptyCell => ({ day, slot });

describe('autoFillWeek', () => {
  it('fills every cell without repeats while candidates last', () => {
    const { assignments, unfilled } = autoFillWeek(
      [cell(0), cell(1), cell(2)],
      [cand('a'), cand('b'), cand('c')],
      { lowFodmapOnly: false }
    );
    expect(assignments.map((a) => a.recipeId)).toEqual(['a', 'b', 'c']);
    expect(unfilled).toEqual([]);
  });

  it('avoids back-to-back same category when an alternative exists', () => {
    const { assignments } = autoFillWeek(
      [cell(0), cell(0, 'dinner'), cell(1)],
      [
        cand('meat1', { category: 'meat' }),
        cand('meat2', { category: 'meat' }),
        cand('fish1', { category: 'fish' }),
      ],
      { lowFodmapOnly: false }
    );
    expect(assignments.map((a) => a.recipeId)).toEqual(['meat1', 'fish1', 'meat2']);
  });

  it('prefers recipes not planned recently', () => {
    const { assignments } = autoFillWeek(
      [cell(0)],
      [cand('recent', { weeksSincePlanned: 1 }), cand('fresh')],
      { lowFodmapOnly: false }
    );
    expect(assignments[0].recipeId).toBe('fresh');
  });

  it('ranks longest-ago over recently cooked', () => {
    const { assignments } = autoFillWeek(
      [cell(0)],
      [cand('lastWeek', { weeksSincePlanned: 1 }), cand('lastMonth', { weeksSincePlanned: 5 })],
      { lowFodmapOnly: false, restWeeks: 3 }
    );
    expect(assignments[0].recipeId).toBe('lastMonth');
  });

  it('low-FODMAP mode drops non-low candidates and reports unfilled cells', () => {
    const { assignments, unfilled } = autoFillWeek(
      [cell(0), cell(1)],
      [cand('high1', { fodmapTier: 'high' }), cand('check1', { fodmapTier: 'check' })],
      { lowFodmapOnly: true }
    );
    expect(assignments).toEqual([]);
    expect(unfilled).toHaveLength(2);
  });

  it('reuses candidates when slots outnumber recipes', () => {
    const { assignments, unfilled } = autoFillWeek(
      [cell(0), cell(1), cell(2)],
      [cand('a'), cand('b')],
      { lowFodmapOnly: false }
    );
    expect(assignments).toHaveLength(3);
    expect(unfilled).toEqual([]);
    expect(assignments[2].recipeId).toBe('a');
  });
});

describe('protein spacing', () => {
  it('spreads a repeated category across the week', () => {
    // Four consecutive meals, two meats: the meats must not sit together.
    const { assignments } = autoFillWeek(
      [cell(0), cell(0, 'dinner'), cell(1), cell(1, 'dinner')],
      [
        cand('meat1', { category: 'meat' }),
        cand('meat2', { category: 'meat' }),
        cand('fish1', { category: 'fish' }),
        cand('veg1', { category: 'vegetarian' }),
      ],
      { lowFodmapOnly: false }
    );
    const meatSlots = assignments
      .filter((a) => a.recipeId.startsWith('meat'))
      .map((a) => a.day * 2 + (a.slot === 'dinner' ? 1 : 0));
    expect(meatSlots).toHaveLength(2);
    expect(Math.abs(meatSlots[0] - meatSlots[1])).toBeGreaterThanOrEqual(2);
  });

  it('respects manual meals as spacing anchors', () => {
    // Monday dinner already has meat (manual): the auto pick for Monday
    // lunch and Tuesday lunch must avoid meat next to it.
    const { assignments } = autoFillWeek(
      [cell(0)],
      [cand('meat1', { category: 'meat' }), cand('fish1', { category: 'fish' })],
      {
        lowFodmapOnly: false,
        existing: [{ day: 0, slot: 'dinner', category: 'meat' }],
      }
    );
    expect(assignments[0].recipeId).toBe('fish1');
  });
});

describe('midweek quickness', () => {
  it('puts quick recipes midweek and long ones on the weekend', () => {
    const { assignments } = autoFillWeek(
      [cell(2), cell(5)], // Wednesday and Saturday
      [cand('slow', { totalMinutes: 90 }), cand('quick', { totalMinutes: 25 })],
      { lowFodmapOnly: false }
    );
    const byDay = new Map(assignments.map((a) => [a.day, a.recipeId]));
    expect(byDay.get(2)).toBe('quick');
    expect(byDay.get(5)).toBe('slow');
  });

  it('recipes without time info stay neutral', () => {
    const { assignments } = autoFillWeek(
      [cell(2)],
      [cand('unknown'), cand('slow', { totalMinutes: 120 })],
      { lowFodmapOnly: false }
    );
    expect(assignments[0].recipeId).toBe('unknown');
  });
});

describe('quota-aware fill', () => {
  it('prioritizes categories under their weekly minimum', () => {
    const { assignments } = autoFillWeek(
      [cell(0)],
      [cand('veg1', { category: 'vegetarian' }), cand('fish1', { category: 'fish' })],
      { lowFodmapOnly: false, quotas: [{ category: 'fish', min: 2, max: null }] }
    );
    expect(assignments[0].recipeId).toBe('fish1');
  });

  it('never exceeds a category maximum, counting already-planned meals', () => {
    const { assignments } = autoFillWeek(
      [cell(0), cell(1)],
      [
        cand('meat1', { category: 'meat' }),
        cand('meat2', { category: 'meat' }),
        cand('veg1', { category: 'vegetarian' }),
      ],
      {
        lowFodmapOnly: false,
        quotas: [{ category: 'meat', min: 0, max: 2 }],
        existingCounts: { meat: 1 },
      }
    );
    // Only one meat slot remains (1 already planned, max 2); the rest go veg.
    expect(assignments.filter((a) => a.recipeId.startsWith('meat'))).toHaveLength(1);
    expect(assignments.filter((a) => a.recipeId === 'veg1')).toHaveLength(1);
  });

  it('leaves cells unfilled when every candidate category is capped out', () => {
    const { unfilled } = autoFillWeek(
      [cell(0)],
      [cand('meat1', { category: 'meat' })],
      { lowFodmapOnly: false, quotas: [{ category: 'meat', min: 0, max: 0 }] }
    );
    expect(unfilled).toHaveLength(1);
  });
});

describe('choose again', () => {
  it('avoids last round picks when alternatives exist, reuses them when not', () => {
    const candidates = [cand('a'), cand('b')];
    const first = autoFillWeek([cell(0)], candidates, { lowFodmapOnly: false });
    expect(first.assignments[0].recipeId).toBe('a');
    const again = autoFillWeek([cell(0)], candidates, { lowFodmapOnly: false, avoidIds: ['a'] });
    expect(again.assignments[0].recipeId).toBe('b');
    const only = autoFillWeek([cell(0)], [cand('a')], { lowFodmapOnly: false, avoidIds: ['a'] });
    expect(only.assignments[0].recipeId).toBe('a');
  });

  it('prefers repeating last round over repeating within the week', () => {
    const { assignments } = autoFillWeek(
      [cell(0), cell(3)],
      [cand('a'), cand('lastRound')],
      { lowFodmapOnly: false, avoidIds: ['lastRound'] }
    );
    expect(assignments.map((a) => a.recipeId)).toEqual(['a', 'lastRound']);
  });
});
