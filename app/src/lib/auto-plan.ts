import type { FodmapTier } from '@/lib/canonical';
import { coreProteins } from '@/lib/category';
import type { MealSlot } from '@/lib/plan';

/**
 * "Choose for us": deterministic week filler. No LLM — every open slot is
 * scored against every candidate and the best pick wins, cell by cell in
 * chronological order. The score layers the household's rules:
 *
 * 1. Weekly category minimums (meal preferences in Settings) dominate.
 * 2. Core-protein spacing: the same category never lands on adjacent meals
 *    when an alternative exists, and a repeated category is pushed as far
 *    across the week as possible — counting meals already planned by hand.
 * 3. Midweek (Tue–Thu) prefers quick recipes (≤ 45 min total); long ones
 *    (> 60 min) drift toward the weekend.
 * 4. Freshness: recipes never planned rank first, then oldest-cooked;
 *    anything inside the household's rest window is strongly demoted.
 * 5. "Choose again" demotes last round's picks below everything fresh.
 * 6. Ideas parked for the week (preferIds) go in before anything else,
 *    still placed on the slot that suits them best.
 *
 * Category maximums stay hard limits, and a recipe repeats within the week
 * only when every alternative is exhausted (small libraries).
 */

export interface AutoCandidate {
  id: string;
  category: string | null;
  fodmapTier: FodmapTier;
  /** Whole weeks since this recipe last appeared on a past plan; null = never. */
  weeksSincePlanned: number | null;
  /** prep + cook minutes; null when the recipe has no time info. */
  totalMinutes: number | null;
  /**
   * Extra quota buckets beyond the protein category (e.g. 'salad' for the AI
   * planner's salad count). They count, cap and space like categories.
   */
  kinds?: string[];
}

export interface EmptyCell {
  day: number;
  slot: MealSlot;
}

export interface AutoAssignment {
  day: number;
  slot: MealSlot;
  recipeId: string;
}

/** Household-aggregated weekly quota for one category (meal preferences). */
export interface QuotaConstraint {
  category: string;
  min: number;
  max: number | null;
}

/** A meal already on the grid — anchors spacing and quota counting. */
export interface PlannedMeal {
  day: number;
  slot: MealSlot;
  category: string | null;
  kinds?: string[];
}

export interface AutoFillOptions {
  lowFodmapOnly: boolean;
  /** Weekly category quotas; categories not listed are unconstrained. */
  quotas?: QuotaConstraint[];
  /** Meals already planned this week, counted per category. */
  existingCounts?: Record<string, number>;
  /** Meals already on the grid (manual picks) — spacing anchors. */
  existing?: PlannedMeal[];
  /** Household rest window in weeks (suggested_rest_weeks). */
  restWeeks?: number;
  /** "Choose again": last round's picks rank below everything fresh. */
  avoidIds?: string[];
  /** Recipes parked as ideas for this week: picked first (migration 0037). */
  preferIds?: string[];
  /** Extra per-cell score (AI planner: light weekday lunches, salads when someone's away). */
  cellBonus?: (candidate: AutoCandidate, cell: EmptyCell) => number;
}

const SLOTS_PER_DAY = 2;
const MAX_DISTANCE = 14;

const slotIndex = (day: number, slot: MealSlot) =>
  day * SLOTS_PER_DAY + (slot === 'dinner' ? 1 : 0);

const QUICK_MINUTES = 45;
const SLOW_MINUTES = 60;
const MIDWEEK_DAYS = new Set([1, 2, 3]); // Tue–Thu
const WEEKEND_DAYS = new Set([5, 6]);

export function autoFillWeek(
  cells: EmptyCell[],
  candidates: AutoCandidate[],
  options: AutoFillOptions
): { assignments: AutoAssignment[]; unfilled: EmptyCell[] } {
  const pool = options.lowFodmapOnly
    ? candidates.filter((c) => c.fodmapTier === 'low')
    : candidates;
  const avoid = new Set(options.avoidIds ?? []);
  const prefer = new Set(options.preferIds ?? []);
  const restWeeks = options.restWeeks ?? 0;

  const orderedCells = [...cells].sort(
    (a, b) => slotIndex(a.day, a.slot) - slotIndex(b.day, b.slot)
  );

  const quotas = options.quotas ?? [];
  const counts: Record<string, number> = { ...(options.existingCounts ?? {}) };
  // 'fish & meat' meals live in both core-protein buckets: they hit either
  // max, satisfy either deficit, and space against both fish and meat.
  const coresOf = (category: string | null) => (category === null ? [] : coreProteins(category));
  const cores = (item: { category: string | null; kinds?: string[] }) => [
    ...coresOf(item.category),
    ...(item.kinds ?? []),
  ];
  const atMax = (item: AutoCandidate) =>
    cores(item).some((core) => {
      const quota = quotas.find((q) => q.category === core);
      return quota?.max != null && (counts[core] ?? 0) >= quota.max;
    });
  const inDeficit = (item: AutoCandidate) =>
    cores(item).some((core) => {
      const quota = quotas.find((q) => q.category === core);
      return quota !== undefined && (counts[core] ?? 0) < quota.min;
    });

  /** Slot indexes occupied per core protein — manual meals count from the start. */
  const occupied = new Map<string, number[]>();
  const occupy = (item: { category: string | null; kinds?: string[] }, at: number) => {
    for (const core of cores(item)) {
      const list = occupied.get(core) ?? [];
      list.push(at);
      occupied.set(core, list);
    }
  };
  for (const meal of options.existing ?? []) {
    occupy(meal, slotIndex(meal.day, meal.slot));
  }
  const distanceToSame = (item: AutoCandidate, at: number): number => {
    const spots = cores(item).flatMap((core) => occupied.get(core) ?? []);
    if (spots.length === 0) return MAX_DISTANCE;
    return Math.min(...spots.map((s) => Math.abs(s - at)));
  };

  const used = new Set<string>();

  const score = (c: AutoCandidate, cell: EmptyCell): number => {
    let s = 0;
    // 6. The week's ideas outrank everything but an in-week repeat.
    if (prefer.has(c.id)) s += 1500;
    // 1. Fill weekly minimums before anything else.
    if (inDeficit(c)) s += 1000;
    // 2. Protein spacing: adjacency is near-forbidden, same/next day is
    //    strongly discouraged, farther apart scores higher.
    const dist = distanceToSame(c, slotIndex(cell.day, cell.slot));
    s += Math.min(dist, MAX_DISTANCE) * 10;
    if (dist <= 1) s -= 500;
    else if (dist <= 3) s -= 200;
    // 3. Midweek wants quick meals; the weekend absorbs long ones.
    if (MIDWEEK_DAYS.has(cell.day)) {
      if (c.totalMinutes !== null && c.totalMinutes <= QUICK_MINUTES) s += 60;
      if (c.totalMinutes !== null && c.totalMinutes > SLOW_MINUTES) s -= 80;
    } else if (WEEKEND_DAYS.has(cell.day)) {
      if (c.totalMinutes !== null && c.totalMinutes > SLOW_MINUTES) s += 30;
    }
    // 4. Freshness: never planned beats oldest-cooked beats recent.
    if (c.weeksSincePlanned === null) s += 40;
    else s += Math.min(c.weeksSincePlanned, 10) * 4;
    if (restWeeks > 0 && c.weeksSincePlanned !== null && c.weeksSincePlanned < restWeeks)
      s -= 120;
    // 5. Last round's picks ("choose again") and in-week repeats.
    if (avoid.has(c.id)) s -= 700;
    if (used.has(c.id)) s -= 2000;
    if (options.cellBonus) s += options.cellBonus(c, cell);
    return s;
  };

  const assignments: AutoAssignment[] = [];
  const unfilled: EmptyCell[] = [];

  for (const cell of orderedCells) {
    const eligible = pool.filter((c) => !atMax(c));
    if (eligible.length === 0) {
      unfilled.push(cell);
      continue;
    }
    let pick = eligible[0];
    let best = score(pick, cell);
    for (const c of eligible.slice(1)) {
      const value = score(c, cell);
      if (value > best) {
        pick = c;
        best = value;
      }
    }
    used.add(pick.id);
    for (const core of cores(pick)) {
      counts[core] = (counts[core] ?? 0) + 1;
    }
    occupy(pick, slotIndex(cell.day, cell.slot));
    assignments.push({ day: cell.day, slot: cell.slot, recipeId: pick.id });
  }

  return { assignments, unfilled };
}
