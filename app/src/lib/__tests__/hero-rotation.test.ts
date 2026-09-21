import { pickHeroIndex } from '@/lib/hero-rotation';

const DAY = 24 * 60 * 60 * 1000;
// Start of an arbitrary 3-day rotation window (windows are aligned to
// UTC days divisible by 3).
const start = 6906 * 3 * DAY;

describe('pickHeroIndex', () => {
  it('keeps the same hero within a 3-day window', () => {
    expect(pickHeroIndex(6, start)).toBe(pickHeroIndex(6, start + 2 * DAY));
  });

  it('moves to the next suggestion after 3 days', () => {
    const before = pickHeroIndex(6, start);
    const after = pickHeroIndex(6, start + 3 * DAY);
    expect(after).toBe((before + 1) % 6);
  });

  it('wraps around the pool', () => {
    const indexes = new Set(
      Array.from({ length: 6 }, (_, i) => pickHeroIndex(6, start + i * 3 * DAY)),
    );
    expect(indexes.size).toBe(6);
  });

  it('returns 0 for an empty or single-item pool', () => {
    expect(pickHeroIndex(0, start)).toBe(0);
    expect(pickHeroIndex(1, start)).toBe(0);
  });
});
