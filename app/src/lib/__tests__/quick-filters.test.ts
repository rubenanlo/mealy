import { matchesQuickFilters, type QuickFilter } from '../quick-filters';

const base = { prep_minutes: 20, needs_review: false, category: 'meat' as const, fodmapFriendly: true };
const set = (...f: QuickFilter[]) => new Set<QuickFilter>(f);

describe('matchesQuickFilters', () => {
  it('empty set matches everything', () => {
    expect(matchesQuickFilters(base, set())).toBe(true);
  });
  it('under30 requires prep_minutes <= 30 and known', () => {
    expect(matchesQuickFilters(base, set('under30'))).toBe(true);
    expect(matchesQuickFilters({ ...base, prep_minutes: 45 }, set('under30'))).toBe(false);
    expect(matchesQuickFilters({ ...base, prep_minutes: null }, set('under30'))).toBe(false);
  });
  it('protein chips OR within the group', () => {
    expect(matchesQuickFilters(base, set('meat', 'fish'))).toBe(true);
    expect(matchesQuickFilters({ ...base, category: 'fish' }, set('meat', 'fish'))).toBe(true);
    expect(matchesQuickFilters({ ...base, category: null }, set('meat', 'fish'))).toBe(false);
  });
  it('groups AND across: under30 + vegetarian excludes a meat recipe', () => {
    expect(matchesQuickFilters(base, set('under30', 'vegetarian'))).toBe(false);
  });
  it('fodmapFriendly: unknown (null) is excluded', () => {
    expect(matchesQuickFilters({ ...base, fodmapFriendly: null }, set('fodmapFriendly'))).toBe(false);
    expect(matchesQuickFilters(base, set('fodmapFriendly'))).toBe(true);
  });
  it('needsReview matches the flag', () => {
    expect(matchesQuickFilters({ ...base, needs_review: true }, set('needsReview'))).toBe(true);
    expect(matchesQuickFilters(base, set('needsReview'))).toBe(false);
  });
});
