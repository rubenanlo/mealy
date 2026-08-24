import type { FodmapTier } from '@/lib/canonical';
import type { MealSlot } from '@/lib/plan';

/**
 * "Choose for us": deterministic week filler. No LLM — candidates are ranked
 * (fresh before recently planned, preserving the caller's order) and dealt
 * onto the empty slots greedily, avoiding repeats within the fill and
 * back-to-back meals of the same category when possible.
 */

export interface AutoCandidate {
  id: string;
  category: string | null;
  fodmapTier: FodmapTier;
  /** Planned within the household's suggestion rest window. */
  plannedRecently: boolean;
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

export interface AutoFillOptions {
  lowFodmapOnly: boolean;
  /** Weekly category quotas; categories not listed are unconstrained. */
  quotas?: QuotaConstraint[];
  /** Meals already planned this week, counted per category. */
  existingCounts?: Record<string, number>;
  /** "Choose again": last round's picks go to the back of the queue. */
  avoidIds?: string[];
}

export function autoFillWeek(
  cells: EmptyCell[],
  candidates: AutoCandidate[],
  options: AutoFillOptions
): { assignments: AutoAssignment[]; unfilled: EmptyCell[] } {
  const pool = options.lowFodmapOnly
    ? candidates.filter((c) => c.fodmapTier === 'low')
    : candidates;
  const avoid = new Set(options.avoidIds ?? []);
  const rank = (c: AutoCandidate) => (avoid.has(c.id) ? 2 : 0) + (c.plannedRecently ? 1 : 0);
  const ordered = [...pool].sort((a, b) => rank(a) - rank(b));

  const orderedCells = [...cells].sort(
    (a, b) => a.day - b.day || (a.slot === b.slot ? 0 : a.slot === 'lunch' ? -1 : 1)
  );

  const quotas = options.quotas ?? [];
  const counts: Record<string, number> = { ...(options.existingCounts ?? {}) };
  const atMax = (category: string | null) => {
    if (category === null) return false;
    const quota = quotas.find((q) => q.category === category);
    return quota?.max != null && (counts[category] ?? 0) >= quota.max;
  };
  const inDeficit = (category: string | null) => {
    if (category === null) return false;
    const quota = quotas.find((q) => q.category === category);
    return quota !== undefined && (counts[category] ?? 0) < quota.min;
  };

  const assignments: AutoAssignment[] = [];
  const unfilled: EmptyCell[] = [];
  const used = new Set<string>();
  let prevCategory: string | null = null;

  const pickFrom = (available: AutoCandidate[]): AutoCandidate | undefined =>
    // Categories under their weekly minimum first, then variety vs the
    // previous meal, then anything eligible.
    available.find((c) => inDeficit(c.category) && c.category !== prevCategory) ??
    available.find((c) => inDeficit(c.category)) ??
    available.find((c) => c.category === null || c.category !== prevCategory) ??
    available[0];

  for (const cell of orderedCells) {
    const eligible = ordered.filter((c) => !atMax(c.category));
    let pick = pickFrom(eligible.filter((c) => !used.has(c.id)));
    if (!pick && eligible.length > 0) {
      // Second lap when every eligible candidate is used (small libraries).
      used.clear();
      pick = pickFrom(eligible);
    }
    if (!pick) {
      unfilled.push(cell);
      continue;
    }
    used.add(pick.id);
    prevCategory = pick.category;
    if (pick.category !== null) counts[pick.category] = (counts[pick.category] ?? 0) + 1;
    assignments.push({ day: cell.day, slot: cell.slot, recipeId: pick.id });
  }

  return { assignments, unfilled };
}
