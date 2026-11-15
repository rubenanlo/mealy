// Pure helpers for the Meal plans home (summary page before the week).

import { dayDate } from '@/lib/plan';

/** "Nov 16–22", or "Nov 30 – Dec 6" when the week spans two months. */
export function weekRange(weekIso: string, locale: string): string {
  const start = dayDate(weekIso, 0);
  const end = dayDate(weekIso, 6);
  const startLabel = start.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  if (start.getMonth() === end.getMonth()) {
    return `${startLabel}–${end.toLocaleDateString(locale, { day: 'numeric' })}`;
  }
  return `${startLabel} – ${end.toLocaleDateString(locale, { month: 'short', day: 'numeric' })}`;
}

/** Last week's instructions that are not already on this week's list. */
export function carryOverNotes(current: readonly string[], previous: readonly string[]): string[] {
  const have = new Set(current.map((n) => n.trim().toLowerCase()));
  return previous.filter((n) => n.trim() && !have.has(n.trim().toLowerCase()));
}

/** The order category counts are shown in. */
export const TALLY_ORDER = ['meat', 'fish', 'vegetarian', 'legume', 'salad'] as const;

/** Count category keys (nulls dropped), in TALLY_ORDER. */
export function tallyCounts(keys: readonly (string | null)[]): { key: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const key of keys) if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
  return TALLY_ORDER.filter((k) => counts.has(k)).map((key) => ({ key, n: counts.get(key)! }));
}
