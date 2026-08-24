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

export function autoFillWeek(
  cells: EmptyCell[],
  candidates: AutoCandidate[],
  options: { lowFodmapOnly: boolean }
): { assignments: AutoAssignment[]; unfilled: EmptyCell[] } {
  const pool = options.lowFodmapOnly
    ? candidates.filter((c) => c.fodmapTier === 'low')
    : candidates;
  const ordered = [...pool.filter((c) => !c.plannedRecently), ...pool.filter((c) => c.plannedRecently)];

  const orderedCells = [...cells].sort(
    (a, b) => a.day - b.day || (a.slot === b.slot ? 0 : a.slot === 'lunch' ? -1 : 1)
  );

  const assignments: AutoAssignment[] = [];
  const unfilled: EmptyCell[] = [];
  const used = new Set<string>();
  let prevCategory: string | null = null;

  for (const cell of orderedCells) {
    if (ordered.length === 0) {
      unfilled.push(cell);
      continue;
    }
    // Second lap when every candidate is used (small libraries still fill).
    if (ordered.every((c) => used.has(c.id))) used.clear();
    const pick =
      ordered.find((c) => !used.has(c.id) && (c.category === null || c.category !== prevCategory)) ??
      ordered.find((c) => !used.has(c.id))!;
    used.add(pick.id);
    prevCategory = pick.category;
    assignments.push({ day: cell.day, slot: cell.slot, recipeId: pick.id });
  }

  return { assignments, unfilled };
}
