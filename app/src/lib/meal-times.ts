import type { MealSlot } from '@/lib/plan';

/**
 * Household meal-time windows (settings → meal preferences). "HH:MM" 24h
 * strings; the END of a window decides when a planned meal stops being
 * "upcoming" on the plan landing page.
 */
export interface MealWindow {
  start: string;
  end: string;
}

export type MealTimes = Record<MealSlot, MealWindow>;

export const DEFAULT_MEAL_TIMES: MealTimes = {
  lunch: { start: '12:00', end: '15:00' },
  dinner: { start: '19:00', end: '23:00' },
};

/** "HH:MM" → minutes since midnight; null when malformed. */
export function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Merge stored (possibly partial/malformed) times over the defaults. */
export function normalizeMealTimes(stored: unknown): MealTimes {
  const out: MealTimes = {
    lunch: { ...DEFAULT_MEAL_TIMES.lunch },
    dinner: { ...DEFAULT_MEAL_TIMES.dinner },
  };
  if (typeof stored !== 'object' || stored === null) return out;
  for (const slot of ['lunch', 'dinner'] as const) {
    const window = (stored as Record<string, unknown>)[slot];
    if (typeof window !== 'object' || window === null) continue;
    const { start, end } = window as Record<string, unknown>;
    if (typeof start === 'string' && parseHHMM(start) !== null) out[slot].start = start;
    if (typeof end === 'string' && parseHHMM(end) !== null) out[slot].end = end;
  }
  return out;
}

/**
 * Is a planned meal still ahead of us? Future days always are; today's meal
 * is upcoming until the end of its time window; past days never are.
 */
export function isMealUpcoming(
  day: number,
  slot: MealSlot,
  todayIndex: number,
  nowMinutes: number,
  times: MealTimes
): boolean {
  if (day > todayIndex) return true;
  if (day < todayIndex) return false;
  const end = parseHHMM(times[slot].end) ?? parseHHMM(DEFAULT_MEAL_TIMES[slot].end)!;
  return nowMinutes <= end;
}
