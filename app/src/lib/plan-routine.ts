import type { MealSlot } from '@/lib/plan';
import { foldForSearch } from '@/lib/search-text';

/**
 * The household's weekly routine (migration 0039, households.plan_routine).
 * The ✦ AI planner reads it every week:
 * - quick weekday meals (Mon–Fri) under a time cap,
 * - weekday favourites (a recipe or any recipe whose title has a word), some
 *   made the day before,
 * - the leftovers chain: a dinner for the others becomes one person's dinner
 *   the next night,
 * - a special weekend lunch (longer or new-to-us recipes),
 * - the household's own rules, each written in plain words and turned into a
 *   card by Mealy AI (title, summary, and the days, meals, foods or people it
 *   covers when it can tell).
 * Everything here is pure so it is testable.
 */

export interface RoutineFavourite {
  id: string;
  label: string;
  /** One recipe; null when the favourite is a kind of dish matched by `match`. */
  recipeId: string | null;
  /** Word matched in recipe titles (accent/case-insensitive), or SALAD_MATCH. */
  match: string | null;
  /** Cooked the evening before: counts as quick and adds a prep reminder. */
  dayBefore: boolean;
}

export interface RoutineRule {
  id: string;
  /** What the family wrote, verbatim. */
  text: string;
  title: string;
  summary: string;
  on: boolean;
  /** 0 = Monday … 6 = Sunday; empty = every day. */
  days: number[];
  /** Empty = lunch and dinner. */
  slots: MealSlot[];
  /** Protein categories to leave out ('fish', 'meat', 'vegetarian', 'legume'). */
  avoidCategories: string[];
  /** Words to leave out, matched in titles and ingredient names. */
  avoidWords: string[];
  /** Only when these people eat; empty = always. */
  personIds: string[];
}

export interface PlanRoutine {
  quick: { on: boolean; maxMinutes: number };
  favourites: RoutineFavourite[];
  /** Favourites at least this many times a week (0 = just preferred). */
  favouritesMin: number;
  /** On `days`, `personId` has the previous night's dinner. */
  leftovers: { on: boolean; personId: string | null; days: number[] };
  weekendLunch: { on: boolean; maxMinutes: number };
  rules: RoutineRule[];
  /** The old free-text household notes became the first rule card. */
  notesImported: boolean;
}

export const SALAD_MATCH = ':salad';
export const WEEKDAYS = [0, 1, 2, 3, 4] as const;
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const ROUTINE_CATEGORIES = ['fish', 'meat', 'vegetarian', 'legume'] as const;

export const DEFAULT_ROUTINE: PlanRoutine = {
  quick: { on: true, maxMinutes: 30 },
  favourites: [],
  favouritesMin: 0,
  leftovers: { on: false, personId: null, days: [...WEEKDAYS] },
  weekendLunch: { on: true, maxMinutes: 150 },
  rules: [],
  notesImported: false,
};

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
const strList = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const dayList = (v: unknown, fallback: number[]) =>
  Array.isArray(v)
    ? [...new Set(v.filter((x): x is number => Number.isInteger(x) && x >= 0 && x <= 6))].sort()
    : fallback;
const slotList = (v: unknown): MealSlot[] =>
  strList(v).filter((s): s is MealSlot => s === 'lunch' || s === 'dinner');

/** Read whatever is stored (possibly '{}' or an older shape) into a full routine. */
export function parseRoutine(raw: unknown): PlanRoutine {
  const r = isObj(raw) ? raw : {};
  const quick = isObj(r.quick) ? r.quick : {};
  const left = isObj(r.leftovers) ? r.leftovers : {};
  const weekend = isObj(r.weekendLunch) ? r.weekendLunch : {};
  const favourites = (Array.isArray(r.favourites) ? r.favourites : [])
    .filter(isObj)
    .map((f, i) => ({
      id: str(f.id, `fav-${i}`),
      label: str(f.label),
      recipeId: typeof f.recipeId === 'string' ? f.recipeId : null,
      match: typeof f.match === 'string' && f.match.trim() ? f.match : null,
      dayBefore: bool(f.dayBefore, false),
    }))
    .filter((f) => f.label && (f.recipeId || f.match));
  const rules = (Array.isArray(r.rules) ? r.rules : [])
    .filter(isObj)
    .map((x, i) => ({
      id: str(x.id, `rule-${i}`),
      text: str(x.text),
      title: str(x.title) || str(x.text),
      summary: str(x.summary),
      on: bool(x.on, true),
      days: dayList(x.days, []),
      slots: slotList(x.slots),
      avoidCategories: strList(x.avoidCategories).filter((c) =>
        (ROUTINE_CATEGORIES as readonly string[]).includes(c)
      ),
      avoidWords: strList(x.avoidWords).map((w) => w.trim()).filter(Boolean),
      personIds: strList(x.personIds),
    }))
    .filter((x) => x.title);
  return {
    quick: {
      on: bool(quick.on, DEFAULT_ROUTINE.quick.on),
      maxMinutes: num(quick.maxMinutes, DEFAULT_ROUTINE.quick.maxMinutes, 5, 240),
    },
    favourites,
    favouritesMin: num(r.favouritesMin, 0, 0, 14),
    leftovers: {
      on: bool(left.on, false),
      personId: typeof left.personId === 'string' ? left.personId : null,
      days: dayList(left.days, [...WEEKDAYS]),
    },
    weekendLunch: {
      on: bool(weekend.on, DEFAULT_ROUTINE.weekendLunch.on),
      maxMinutes: num(weekend.maxMinutes, DEFAULT_ROUTINE.weekendLunch.maxMinutes, 30, 480),
    },
    rules,
    notesImported: bool(r.notesImported, false),
  };
}

export interface RoutineRecipe {
  id: string;
  title: string;
  isSalad: boolean;
  /** Ingredient names (any language); used by rules. */
  ingredients?: readonly string[];
  category?: string | null;
}

const hasWord = (haystack: string, word: string) => {
  const w = foldForSearch(word.trim());
  return w.length > 0 && foldForSearch(haystack).includes(w);
};

export function favouriteMatches(fav: RoutineFavourite, recipe: RoutineRecipe): boolean {
  if (fav.recipeId) return fav.recipeId === recipe.id;
  if (fav.match === SALAD_MATCH) return recipe.isSalad;
  return !!fav.match && hasWord(recipe.title, fav.match);
}

/** Which recipes count as favourites, and which of those are made the day before. */
export function favouriteSets(routine: PlanRoutine, recipes: readonly RoutineRecipe[]) {
  const favouriteIds = new Set<string>();
  const dayBeforeIds = new Set<string>();
  for (const recipe of recipes) {
    for (const fav of routine.favourites) {
      if (!favouriteMatches(fav, recipe)) continue;
      favouriteIds.add(recipe.id);
      if (fav.dayBefore) dayBeforeIds.add(recipe.id);
    }
  }
  return { favouriteIds, dayBeforeIds };
}

/** How many recipes a favourite covers (shown on its chip). */
export function favouriteCount(fav: RoutineFavourite, recipes: readonly RoutineRecipe[]): number {
  return recipes.filter((r) => favouriteMatches(fav, r)).length;
}

/** A rule the planner can follow by itself (it names days/meals and foods). */
export function isStructuredRule(rule: RoutineRule): boolean {
  return rule.avoidCategories.length > 0 || rule.avoidWords.length > 0;
}

export interface ScoringRule {
  days: ReadonlySet<number> | null;
  slots: ReadonlySet<MealSlot> | null;
  personIds: readonly string[];
  /** Recipes this rule leaves out. */
  avoidIds: ReadonlySet<string>;
}

export function scoringRules(routine: PlanRoutine, recipes: readonly RoutineRecipe[]): ScoringRule[] {
  return routine.rules
    .filter((rule) => rule.on && isStructuredRule(rule))
    .map((rule) => ({
      days: rule.days.length > 0 ? new Set(rule.days) : null,
      slots: rule.slots.length > 0 ? new Set(rule.slots) : null,
      personIds: rule.personIds,
      avoidIds: new Set(
        recipes
          .filter(
            (r) =>
              (r.category != null && rule.avoidCategories.includes(r.category)) ||
              (r.category === 'fish & meat' &&
                (rule.avoidCategories.includes('fish') || rule.avoidCategories.includes('meat'))) ||
              rule.avoidWords.some(
                (w) => hasWord(r.title, w) || (r.ingredients ?? []).some((name) => hasWord(name, w))
              )
          )
          .map((r) => r.id)
      ),
    }));
}

/** Rules Mealy AI should check the finished plan against (on and not followed by the planner). */
export function rulesToCheck(routine: PlanRoutine): RoutineRule[] {
  return routine.rules.filter((rule) => rule.on && !isStructuredRule(rule));
}

/** Everything the planner should keep in mind, as short lines for the AI prompt. */
export function routineLines(
  routine: PlanRoutine,
  names: { leftoverPerson: string | null; favourites: string[] }
): string[] {
  const lines: string[] = [];
  if (routine.quick.on) lines.push(`Monday to Friday meals take at most ${routine.quick.maxMinutes} minutes.`);
  if (names.favourites.length > 0)
    lines.push(`Weekday favourites: ${names.favourites.join(', ')}.`);
  if (routine.leftovers.on && names.leftoverPerson)
    lines.push(
      `${names.leftoverPerson} has the previous night's dinner as leftovers on the marked nights, so those dinners are cooked with one extra portion. Keep that in mind when changing a dinner.`
    );
  if (routine.weekendLunch.on)
    lines.push(`Saturday and Sunday lunch: something more special, longer or new to the family (up to ${routine.weekendLunch.maxMinutes} minutes).`);
  for (const rule of routine.rules) if (rule.on) lines.push(rule.text || rule.title);
  return lines;
}

// ---- Leftovers chain ----------------------------------------------------------

/** Day index for "last Sunday" (previous week's dinner feeding Monday). */
export const PREV_SUNDAY = -1;

export interface LeftoverLink {
  /** The night the person eats the leftovers. */
  day: number;
  /** The dinner it comes from: day - 1, or PREV_SUNDAY for Monday. */
  fromDay: number;
}

/**
 * Nights the leftovers person eats the previous dinner. A night chains when it
 * is in the routine, not switched off for this week, the person eats at home
 * that night, and there is a dinner the night before.
 */
export function leftoverLinks(opts: {
  routine: PlanRoutine;
  days: readonly number[];
  personHome: (day: number) => boolean;
  hasDinner: (day: number) => boolean;
  off?: ReadonlySet<number>;
}): LeftoverLink[] {
  const { routine } = opts;
  if (!routine.leftovers.on || !routine.leftovers.personId) return [];
  const links: LeftoverLink[] = [];
  for (const day of opts.days) {
    if (!routine.leftovers.days.includes(day) || opts.off?.has(day)) continue;
    if (!opts.personHome(day)) continue;
    const fromDay = day === 0 ? PREV_SUNDAY : day - 1;
    if (!opts.hasDinner(fromDay)) continue;
    links.push({ day, fromDay });
  }
  return links;
}

/** Portions to cook for a dinner: its eaters plus one per night it feeds. */
export function portionsFor(eaters: number, day: number, links: readonly LeftoverLink[]): number {
  return eaters + links.filter((l) => l.fromDay === day).length;
}

export const newRoutineId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** "25 min", "2 h", "2 h 30" from templates with {n}, {h} and {m}. */
export function durationLabel(
  minutes: number,
  t: { minutes: string; hours: string; hoursMinutes: string }
): string {
  if (minutes < 60) return t.minutes.replace('{n}', String(minutes));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0
    ? t.hours.replace('{h}', String(h))
    : t.hoursMinutes.replace('{h}', String(h)).replace('{m}', String(m).padStart(2, '0'));
}
