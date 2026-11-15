import { carryOverNotes, tallyCounts, weekRange } from '@/lib/plan-home';

describe('plan home helpers', () => {
  it('formats a week range within and across months', () => {
    expect(weekRange('2026-11-16', 'en-US')).toBe('Nov 16–22');
    expect(weekRange('2026-11-30', 'en-US')).toBe('Nov 30 – Dec 6');
  });

  it('carries over only last week’s lines that are missing', () => {
    expect(carryOverNotes(['Iron shirts'], ['iron shirts ', 'Clean the oven', ''])).toEqual(['Clean the oven']);
    expect(carryOverNotes([], [])).toEqual([]);
  });

  it('counts categories in display order and drops unknowns', () => {
    expect(tallyCounts(['fish', null, 'meat', 'fish', 'salad'])).toEqual([
      { key: 'meat', n: 1 },
      { key: 'fish', n: 2 },
      { key: 'salad', n: 1 },
    ]);
  });
});
