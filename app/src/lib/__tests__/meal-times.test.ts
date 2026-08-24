import {
  DEFAULT_MEAL_TIMES,
  isMealUpcoming,
  normalizeMealTimes,
  parseHHMM,
} from '../meal-times';

describe('parseHHMM', () => {
  it('parses 24h times to minutes', () => {
    expect(parseHHMM('12:00')).toBe(720);
    expect(parseHHMM('9:05')).toBe(545);
    expect(parseHHMM('23:59')).toBe(1439);
  });
  it('rejects malformed or out-of-range values', () => {
    expect(parseHHMM('25:00')).toBeNull();
    expect(parseHHMM('12:65')).toBeNull();
    expect(parseHHMM('noon')).toBeNull();
    expect(parseHHMM('')).toBeNull();
  });
});

describe('normalizeMealTimes', () => {
  it('falls back to defaults for missing or malformed values', () => {
    expect(normalizeMealTimes(null)).toEqual(DEFAULT_MEAL_TIMES);
    expect(normalizeMealTimes({ lunch: { start: 'bad', end: '14:30' } }).lunch).toEqual({
      start: '12:00',
      end: '14:30',
    });
  });
  it('keeps valid stored windows', () => {
    const stored = { lunch: { start: '13:00', end: '15:30' }, dinner: { start: '20:00', end: '22:00' } };
    expect(normalizeMealTimes(stored)).toEqual(stored);
  });
});

describe('isMealUpcoming', () => {
  const times = normalizeMealTimes({ lunch: { start: '12:00', end: '14:30' } });
  it('future days are always upcoming, past days never', () => {
    expect(isMealUpcoming(3, 'lunch', 0, 0, times)).toBe(true);
    expect(isMealUpcoming(0, 'dinner', 3, 0, times)).toBe(false);
  });
  it("today's meal is upcoming until its window ends", () => {
    // 16:30 (990 min) is past a 14:30 lunch end but before a 23:00 dinner end.
    expect(isMealUpcoming(0, 'lunch', 0, 990, times)).toBe(false);
    expect(isMealUpcoming(0, 'dinner', 0, 990, times)).toBe(true);
    expect(isMealUpcoming(0, 'lunch', 0, 870, times)).toBe(true); // 14:30 sharp
  });
});
