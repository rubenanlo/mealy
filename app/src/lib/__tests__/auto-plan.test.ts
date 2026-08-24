import { autoFillWeek, type AutoCandidate, type EmptyCell } from '../auto-plan';

const cand = (id: string, over: Partial<AutoCandidate> = {}): AutoCandidate => ({
  id,
  category: null,
  fodmapTier: 'low',
  plannedRecently: false,
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
      [cand('meat1', { category: 'meat' }), cand('meat2', { category: 'meat' }), cand('fish1', { category: 'fish' })],
      { lowFodmapOnly: false }
    );
    expect(assignments.map((a) => a.recipeId)).toEqual(['meat1', 'fish1', 'meat2']);
  });

  it('prefers recipes not planned recently', () => {
    const { assignments } = autoFillWeek(
      [cell(0)],
      [cand('recent', { plannedRecently: true }), cand('fresh')],
      { lowFodmapOnly: false }
    );
    expect(assignments[0].recipeId).toBe('fresh');
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

  it('reuses candidates on a second lap when slots outnumber recipes', () => {
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
