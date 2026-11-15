import {
  autoFillWeek,
  type AutoCandidate,
  type EmptyCell,
  type PlannedMeal,
  type QuotaConstraint,
} from '@/lib/auto-plan';
import { coreProteins } from '@/lib/category';
import type { MealSlot, PlanAbsence } from '@/lib/plan';
import type { ScoringRule } from '@/lib/plan-routine';

/**
 * ✦ AI week planning (2026-11-15). The guided sheet asks who's home and what
 * the family wants, then builds the first proposal with the deterministic
 * planner (ideas first, plan history, protein spacing). Free-text changes go
 * to the worker (/ai/plan-change). Everything here is pure so it is testable.
 */

export type LunchStyle = 'light' | 'leftovers' | 'salad_when_away';

export interface MealCounts {
  salad: number;
  meat: number;
  fish: number;
}

export const SLOTS: MealSlot[] = ['lunch', 'dinner'];

export const cellKey = (day: number, slot: MealSlot) => `${day}-${slot}`;

/** Weekday lunches a school child eats away (Ruben: Monday, Tuesday, Thursday, Friday). */
export const SCHOOL_LUNCH_DAYS = [0, 1, 3, 4] as const;

const SALAD_RE = /\b(salads?|ensaladas?|salades?|insalat[ae]|amanida)\b/i;

/** True when the recipe reads as a main-course salad (title, dish type or tags). */
export function isSalad(recipe: { title: string; tags?: readonly string[] | null; dish_type?: string | null }): boolean {
  if (SALAD_RE.test(recipe.title)) return true;
  if (recipe.dish_type && SALAD_RE.test(recipe.dish_type)) return true;
  return (recipe.tags ?? []).some((t) => SALAD_RE.test(t));
}

/** The household member the school question is about: the first eater named Marc. */
export function findSchoolChild<T extends { name: string; is_employee: boolean }>(persons: readonly T[]): T | null {
  return persons.find((p) => !p.is_employee && /^marc\b/i.test(p.name.trim())) ?? null;
}

/** Away marks per meal, keyed by cellKey. */
export type AwayMap = Map<string, Set<string>>;

export function awayMapFrom(absences: readonly PlanAbsence[]): AwayMap {
  const map: AwayMap = new Map();
  for (const a of absences) {
    const key = cellKey(a.day, a.slot);
    const set = map.get(key) ?? new Set<string>();
    set.add(a.person_id);
    map.set(key, set);
  }
  return map;
}

export function absencesFrom(map: AwayMap): PlanAbsence[] {
  const out: PlanAbsence[] = [];
  for (const [key, set] of map) {
    const [day, slot] = key.split('-');
    for (const personId of set) out.push({ day: Number(day), slot: slot as MealSlot, person_id: personId });
  }
  return out.sort((a, b) => a.day - b.day || a.slot.localeCompare(b.slot) || a.person_id.localeCompare(b.person_id));
}

/** A meal is "going out" when every eater is marked away. */
export function isGoingOut(away: ReadonlySet<string> | undefined, eaterIds: readonly string[]): boolean {
  return eaterIds.length > 0 && !!away && eaterIds.every((id) => away.has(id));
}

/** Set (or clear) the school child's away mark on the school lunches among `days`. */
export function withSchoolLunches(map: AwayMap, childId: string, atSchool: boolean, days: readonly number[]): AwayMap {
  const next: AwayMap = new Map([...map].map(([k, v]) => [k, new Set(v)]));
  for (const day of SCHOOL_LUNCH_DAYS) {
    if (!days.includes(day)) continue;
    const key = cellKey(day, 'lunch');
    const set = next.get(key) ?? new Set<string>();
    if (atSchool) set.add(childId);
    else set.delete(childId);
    next.set(key, set);
  }
  return next;
}

/** Toggle one person's away mark for one meal. */
export function toggleAway(map: AwayMap, key: string, personId: string): AwayMap {
  const next: AwayMap = new Map([...map].map(([k, v]) => [k, new Set(v)]));
  const set = next.get(key) ?? new Set<string>();
  if (set.has(personId)) set.delete(personId);
  else set.add(personId);
  next.set(key, set);
  return next;
}

/** Mark everyone out for a meal, or everyone back home. */
export function toggleGoingOut(map: AwayMap, key: string, eaterIds: readonly string[]): AwayMap {
  const next: AwayMap = new Map([...map].map(([k, v]) => [k, new Set(v)]));
  next.set(key, isGoingOut(next.get(key), eaterIds) ? new Set() : new Set(eaterIds));
  return next;
}

export interface ProposedMeal {
  day: number;
  slot: MealSlot;
  recipeId: string | null;
  customTitle: string | null;
  /** Lunch reusing the previous evening's dinner ("leftovers" lunch style). */
  leftover?: boolean;
}

export interface ProposalInput {
  /** Meals to fill: future, empty, and someone eats at home. */
  cells: EmptyCell[];
  candidates: AutoCandidate[];
  counts: MealCounts;
  styles: ReadonlySet<LunchStyle>;
  away: AwayMap;
  /** Household quotas from Settings; the family's answers override meat/fish. */
  quotas?: QuotaConstraint[];
  /** Meals already on the grid (planned by hand), for spacing and counting. */
  existing?: PlannedMeal[];
  restWeeks?: number;
  avoidIds?: string[];
  preferIds?: string[];
  lowFodmapOnly?: boolean;
  /** The household's weekly routine (migration 0039), already resolved to recipe ids. */
  routine?: RoutineScoring;
}

/** What the routine means for scoring, computed once per planner session. */
export interface RoutineScoring {
  /** Mon–Fri cap in minutes; null when the quick rule is off. */
  quickMax: number | null;
  /** Saturday/Sunday lunch upper bound; null when off. */
  weekendMax: number | null;
  favouriteIds: ReadonlySet<string>;
  dayBeforeIds: ReadonlySet<string>;
  favouritesMin: number;
  rules: readonly ScoringRule[];
}

/** Candidate kind for routine favourites (counts toward `favouritesMin`). */
export const FAVOURITE_KIND = 'favourite';

const isWeekdayLunch = (cell: EmptyCell) => cell.slot === 'lunch' && cell.day <= 4;

/** The answers become hard weekly counts; other household quotas still apply. */
export function answerQuotas(
  counts: MealCounts,
  household: readonly QuotaConstraint[] = [],
  favouritesMin = 0
): QuotaConstraint[] {
  const out = household.filter(
    (q) => q.category !== 'meat' && q.category !== 'fish' && q.category !== 'salad' && q.category !== FAVOURITE_KIND
  );
  out.push({ category: 'meat', min: counts.meat, max: counts.meat });
  out.push({ category: 'fish', min: counts.fish, max: counts.fish });
  out.push({ category: 'salad', min: counts.salad, max: counts.salad });
  if (favouritesMin > 0) out.push({ category: FAVOURITE_KIND, min: favouritesMin, max: null });
  return out;
}

const quotasOf = (input: ProposalInput) => answerQuotas(input.counts, input.quotas, input.routine?.favouritesMin ?? 0);

function existingCounts(existing: readonly PlannedMeal[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const meal of existing) {
    const buckets = [...(meal.category ? coreProteins(meal.category) : []), ...(meal.kinds ?? [])];
    for (const b of buckets) counts[b] = (counts[b] ?? 0) + 1;
  }
  return counts;
}

function cellBonus(input: ProposalInput) {
  const minutes = (c: AutoCandidate) => c.totalMinutes;
  const salad = (c: AutoCandidate) => (c.kinds ?? []).includes('salad');
  return (c: AutoCandidate, cell: EmptyCell): number => {
    let s = 0;
    if (input.styles.has('light') && isWeekdayLunch(cell)) {
      const m = minutes(c);
      if (m !== null && m <= 30) s += 80;
      if (m !== null && m > 45) s -= 120;
      if (salad(c)) s += 40;
    }
    if (input.styles.has('salad_when_away') && salad(c)) {
      // Save the salads for lunches where someone is away; elsewhere they
      // only land once the other dishes are used up or already counted.
      const away = cell.slot === 'lunch' ? input.away.get(cellKey(cell.day, cell.slot)) : undefined;
      s += away && away.size > 0 ? 400 : -900;
    }
    if (input.routine) s += routineBonus(input.routine, input.away, c, cell);
    return s;
  };
}

const WEEKDAY_LAST = 4;

/**
 * The household routine as a score: quick weekdays (dishes made the day
 * before count as quick), favourites on weekdays, a special weekend lunch, and
 * the household's own rules (a broken rule is near-forbidden).
 */
export function routineBonus(routine: RoutineScoring, away: AwayMap, c: AutoCandidate, cell: EmptyCell): number {
  let s = 0;
  const weekday = cell.day <= WEEKDAY_LAST;
  const favourite = routine.favouriteIds.has(c.id);
  const minutes = c.totalMinutes;
  if (weekday) {
    if (routine.quickMax !== null) {
      if (routine.dayBeforeIds.has(c.id)) s += 80;
      else if (minutes === null) s -= 60;
      else if (minutes <= routine.quickMax) s += 80;
      else s -= 1800;
    }
    if (favourite) s += 220;
  } else if (cell.slot === 'lunch' && routine.weekendMax !== null) {
    if (minutes !== null && minutes > routine.weekendMax) s -= 300;
    else if (minutes !== null && minutes >= 45) s += 260;
    else if (minutes !== null && minutes < 30) s -= 160;
    if (c.weeksSincePlanned === null) s += 140;
    if (favourite) s -= 250;
  }
  for (const rule of routine.rules) {
    if (!rule.avoidIds.has(c.id)) continue;
    if (rule.days && !rule.days.has(cell.day)) continue;
    if (rule.slots && !rule.slots.has(cell.slot)) continue;
    if (rule.personIds.length > 0) {
      const out = away.get(cellKey(cell.day, cell.slot));
      if (!rule.personIds.some((id) => !out?.has(id))) continue;
    }
    s -= 5000;
  }
  return s;
}

/**
 * The first proposal. With the "leftovers" style, Tue–Fri lunches reuse the
 * previous evening's dinner when that dinner is planned.
 */
export function proposeWeek(input: ProposalInput): { meals: ProposedMeal[]; unfilled: EmptyCell[] } {
  const open = new Set(input.cells.map((c) => cellKey(c.day, c.slot)));
  const existingDinner = new Map<number, true>();
  for (const meal of input.existing ?? []) if (meal.slot === 'dinner') existingDinner.set(meal.day, true);

  const leftoverCells = input.styles.has('leftovers')
    ? input.cells.filter(
        (c) =>
          c.slot === 'lunch' &&
          c.day >= 1 &&
          c.day <= 4 &&
          (open.has(cellKey(c.day - 1, 'dinner')) || existingDinner.has(c.day - 1))
      )
    : [];
  const leftoverKeys = new Set(leftoverCells.map((c) => cellKey(c.day, c.slot)));
  const fillCells = input.cells.filter((c) => !leftoverKeys.has(cellKey(c.day, c.slot)));

  const existing = input.existing ?? [];
  const { assignments, unfilled } = autoFillWeek(fillCells, input.candidates, {
    lowFodmapOnly: input.lowFodmapOnly ?? false,
    quotas: quotasOf(input),
    existingCounts: existingCounts(existing),
    existing,
    restWeeks: input.restWeeks ?? 3,
    avoidIds: input.avoidIds,
    preferIds: input.preferIds,
    cellBonus: cellBonus(input),
  });

  const meals: ProposedMeal[] = assignments.map((a) => ({
    day: a.day,
    slot: a.slot,
    recipeId: a.recipeId,
    customTitle: null,
  }));
  const dinnerOn = new Map(meals.filter((m) => m.slot === 'dinner').map((m) => [m.day, m]));
  for (const cell of leftoverCells) {
    const dinner = dinnerOn.get(cell.day - 1);
    if (dinner?.recipeId) {
      meals.push({ day: cell.day, slot: 'lunch', recipeId: dinner.recipeId, customTitle: null, leftover: true });
    } else {
      // The evening before is planned by hand (or unfilled): plan this lunch normally.
      const single = autoFillWeek([cell], input.candidates, {
        lowFodmapOnly: input.lowFodmapOnly ?? false,
        existing: [...existing, ...meals.map((m) => ({ day: m.day, slot: m.slot, category: catOf(input, m.recipeId), kinds: kindsOf(input, m.recipeId) }))],
        restWeeks: input.restWeeks ?? 3,
        avoidIds: [...(input.avoidIds ?? []), ...meals.map((m) => m.recipeId).filter((id): id is string => !!id)],
        cellBonus: cellBonus(input),
      });
      if (single.assignments[0]) {
        meals.push({ day: cell.day, slot: 'lunch', recipeId: single.assignments[0].recipeId, customTitle: null });
      } else unfilled.push(cell);
    }
  }
  meals.sort((a, b) => a.day - b.day || (a.slot === b.slot ? 0 : a.slot === 'lunch' ? -1 : 1));
  return { meals, unfilled };
}

function catOf(input: ProposalInput, id: string | null) {
  return input.candidates.find((c) => c.id === id)?.category ?? null;
}

function kindsOf(input: ProposalInput, id: string | null) {
  return input.candidates.find((c) => c.id === id)?.kinds;
}

/** Pick a different dish for one meal, keeping the rest of the proposal as is. */
export function swapMeal(input: ProposalInput, meals: readonly ProposedMeal[], target: EmptyCell): string | null {
  const others = meals.filter((m) => !(m.day === target.day && m.slot === target.slot));
  const current = meals.find((m) => m.day === target.day && m.slot === target.slot);
  const existing: PlannedMeal[] = [
    ...(input.existing ?? []),
    ...others.map((m) => ({ day: m.day, slot: m.slot, category: catOf(input, m.recipeId), kinds: kindsOf(input, m.recipeId) })),
  ];
  const avoid = [
    ...(input.avoidIds ?? []),
    ...others.map((m) => m.recipeId).filter((id): id is string => !!id),
  ];
  const pool = current?.recipeId ? input.candidates.filter((c) => c.id !== current.recipeId) : input.candidates;
  const { assignments } = autoFillWeek([target], pool, {
    lowFodmapOnly: input.lowFodmapOnly ?? false,
    quotas: quotasOf(input),
    existingCounts: existingCounts(existing),
    existing,
    restWeeks: input.restWeeks ?? 3,
    avoidIds: avoid,
    cellBonus: cellBonus(input),
  });
  return assignments[0]?.recipeId ?? null;
}

/** Up to `n` different dishes for one meal, best first (the change-meal sheet). */
export function suggestForCell(
  input: ProposalInput,
  meals: readonly ProposedMeal[],
  target: EmptyCell,
  n: number
): string[] {
  const picked: string[] = [];
  const current = meals.find((m) => m.day === target.day && m.slot === target.slot)?.recipeId ?? null;
  for (let i = 0; i < n; i++) {
    const exclude = new Set([...picked, ...(current ? [current] : [])]);
    const next = swapMeal(
      { ...input, candidates: input.candidates.filter((c) => !exclude.has(c.id)) },
      meals.filter((m) => !(m.day === target.day && m.slot === target.slot)),
      target
    );
    if (!next) break;
    picked.push(next);
  }
  return picked;
}

/** Salad / meat / fish / other tally for the proposal summary chips. */
export function tally(
  meals: readonly ProposedMeal[],
  candidateById: ReadonlyMap<string, Pick<AutoCandidate, 'category' | 'kinds'>>
): MealCounts & { other: number } {
  const out = { salad: 0, meat: 0, fish: 0, other: 0 };
  for (const meal of meals) {
    const c = meal.recipeId ? candidateById.get(meal.recipeId) : undefined;
    const cores = c?.category ? coreProteins(c.category) : [];
    const salad = (c?.kinds ?? []).includes('salad');
    if (salad) out.salad += 1;
    if (cores.includes('meat')) out.meat += 1;
    if (cores.includes('fish')) out.fish += 1;
    if (!salad && !cores.includes('meat') && !cores.includes('fish')) out.other += 1;
  }
  return out;
}

/** A side added on top of a meal ("+ Tomato salad", "+ Rice"). */
export interface ProposedSide {
  key: string;
  recipeId: string | null;
  customTitle: string | null;
}

/** Sides the picker offers for a search: side dishes and salads first. */
export function sideSuggestions<T extends { id: string; title: string; meal_type?: string | null; tags?: readonly string[] | null; dish_type?: string | null }>(
  recipes: readonly T[],
  query: string,
  limit = 6
): T[] {
  const q = query.trim().toLowerCase();
  const sideLike = (r: T) => r.meal_type === 'side' || isSalad(r);
  const matches = recipes.filter((r) => (q ? r.title.toLowerCase().includes(q) : sideLike(r)));
  return [...matches].sort((a, b) => Number(sideLike(b)) - Number(sideLike(a))).slice(0, limit);
}

/** Default employee picks for the "quick" chips. */
export type EmployeePreset = 'weekday_lunches' | 'weekdays' | 'none';

export function presetPicks(rows: readonly { key: string; day: number; slot: MealSlot }[], preset: EmployeePreset): Set<string> {
  if (preset === 'none') return new Set();
  return new Set(
    rows.filter((r) => r.day <= 4 && (preset === 'weekdays' || r.slot === 'lunch')).map((r) => r.key)
  );
}
