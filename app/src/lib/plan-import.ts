// "Import a plan": turn a week plan sent as a message (read by the worker's
// /ai/plan-import) into draft meals the family checks, then into plan rows.
//
// Everything here is pure so it is testable. The screen is
// app/(tabs)/plan/import.tsx.

import { effectivePersonIds, weekStart, type CookType, type MealSlot } from '@/lib/plan';
import { foldForSearch } from '@/lib/search-text';

// ---- What the worker sends back -------------------------------------------

export interface ImportDish {
  phrase: string;
  title: string;
  recipe_id: string | null;
}

export interface ImportedMeal {
  day_word: string;
  day_index: number;
  weekday: number;
  slot: MealSlot;
  source: string;
  eating_out: boolean;
  main: ImportDish | null;
  sides: ImportDish[];
  extra_dishes: { dish: ImportDish; for_names: string[]; for_label: string | null }[];
  away_names: string[];
  employee_part: string | null;
  employee_whole: boolean;
  undecided: boolean;
  options: string[];
  note: string | null;
}

/** A phrase matched in an earlier import (table plan_import_matches, migration 0041). */
export interface RememberedMatch {
  phrase: string;
  recipe_id: string | null;
  custom_title: string | null;
}

// ---- Drafts the preview shows ----------------------------------------------

export interface DraftDish {
  /** The sender's own words, used to remember the match. */
  phrase: string;
  title: string;
  recipeId: string | null;
  /** Matched from an earlier import rather than by the AI. */
  fromMemory: boolean;
}

export interface DraftExtra {
  dish: DraftDish;
  /** Who eats this dish instead; empty until someone is picked. */
  personIds: string[];
  /** The sender's words for them when no name fitted ("els nens"). */
  label: string | null;
}

export type DraftKind = 'dish' | 'out' | 'empty';

export interface DraftMeal {
  key: string;
  /** yyyy-mm-dd */
  date: string;
  /** Monday of the meal's week (meal_plans.week_start). */
  week: string;
  /** 0 = Monday … 6 = Sunday. */
  day: number;
  slot: MealSlot;
  /** The bullet as written; empty for a slot the message left out. */
  source: string;
  kind: DraftKind;
  main: DraftDish | null;
  sides: DraftDish[];
  extras: DraftExtra[];
  awayIds: string[];
  /** What the employee prepares when it is only part of the dish. */
  employeePart: string | null;
  employeeWhole: boolean;
  /** Choices still open ("salad or eating out?"). */
  options: string[];
  note: string | null;
  /** The message had this day but not this meal. */
  missing: boolean;
}

export interface PersonLite {
  id: string;
  name: string;
  is_employee: boolean;
}

/** Fold a dish phrase for remembering: lower case, no accents, single spaces. */
export function foldPhrase(s: string): string {
  return foldForSearch(s)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 200);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7;
}

function addDays(date: Date, n: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + n);
  return next;
}

/** The first date on or after `from` that falls on `weekday`. */
export function nextDateFor(weekday: number, from: Date): Date {
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  return addDays(start, (weekday - weekdayOf(start) + 7) % 7);
}

/** Start options for the chips: the next such day, and the one a week before. */
export function startChoices(firstWeekday: number, today: Date): string[] {
  const next = nextDateFor(firstWeekday, today);
  return [isoDate(next), isoDate(addDays(next, -7))];
}

/**
 * Date of each day heading: the first is `start`, each next one is the next
 * date on its weekday, so Thursday → Monday runs into the following week.
 */
export function dayDates(meals: readonly ImportedMeal[], start: Date): Map<number, Date> {
  const dates = new Map<number, Date>();
  let previous: Date | null = null;
  for (const meal of [...meals].sort((a, b) => a.day_index - b.day_index)) {
    if (dates.has(meal.day_index)) continue;
    const date: Date = previous ? nextDateFor(meal.weekday, addDays(previous, 1)) : start;
    dates.set(meal.day_index, date);
    previous = date;
  }
  return dates;
}

function draftDish(
  dish: ImportDish,
  memory: ReadonlyMap<string, RememberedMatch>,
  recipeIds: ReadonlySet<string>
): DraftDish {
  const remembered = memory.get(foldPhrase(dish.phrase));
  if (remembered) {
    if (remembered.recipe_id && recipeIds.has(remembered.recipe_id)) {
      return { phrase: dish.phrase, title: dish.title, recipeId: remembered.recipe_id, fromMemory: true };
    }
    if (remembered.custom_title) {
      return { phrase: dish.phrase, title: remembered.custom_title, recipeId: null, fromMemory: true };
    }
  }
  const recipeId = dish.recipe_id && recipeIds.has(dish.recipe_id) ? dish.recipe_id : null;
  return { phrase: dish.phrase, title: dish.title, recipeId, fromMemory: false };
}

function idsForNames(names: readonly string[], persons: readonly PersonLite[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const want = foldPhrase(name);
    const person = persons.find((p) => foldPhrase(p.name) === want || foldPhrase(p.name).split(' ')[0] === want);
    if (person && !out.includes(person.id)) out.push(person.id);
  }
  return out;
}

export interface DraftContext {
  start: Date;
  memory: ReadonlyMap<string, RememberedMatch>;
  recipeIds: ReadonlySet<string>;
  persons: readonly PersonLite[];
  /** Child away at school for weekday lunches (household routine). */
  schoolChildId?: string | null;
  schoolDays?: readonly number[];
}

/** Draft meals in date order, with a "missing" draft for any slot a day left out. */
export function buildDrafts(meals: readonly ImportedMeal[], ctx: DraftContext): DraftMeal[] {
  const dates = dayDates(meals, ctx.start);
  const drafts: DraftMeal[] = [];
  const seen = new Set<string>();
  const make = (date: Date, slot: MealSlot): Omit<DraftMeal, 'kind' | 'source' | 'missing'> => {
    const day = weekdayOf(date);
    const school =
      slot === 'lunch' && ctx.schoolChildId && (ctx.schoolDays ?? []).includes(day) ? [ctx.schoolChildId] : [];
    return {
      key: `${isoDate(date)}-${slot}`,
      date: isoDate(date),
      week: weekStart(date),
      day,
      slot,
      main: null,
      sides: [],
      extras: [],
      awayIds: school,
      employeePart: null,
      employeeWhole: false,
      options: [],
      note: null,
    };
  };
  for (const meal of meals) {
    const date = dates.get(meal.day_index);
    if (!date) continue;
    const base = make(date, meal.slot);
    if (seen.has(base.key)) continue;
    seen.add(base.key);
    const away = [...new Set([...base.awayIds, ...idsForNames(meal.away_names, ctx.persons)])];
    drafts.push({
      ...base,
      source: meal.source,
      kind: meal.eating_out ? 'out' : meal.main ? 'dish' : 'empty',
      main: meal.eating_out || !meal.main ? null : draftDish(meal.main, ctx.memory, ctx.recipeIds),
      sides: meal.eating_out ? [] : meal.sides.map((s) => draftDish(s, ctx.memory, ctx.recipeIds)),
      extras: meal.eating_out
        ? []
        : meal.extra_dishes.map((x) => ({
            dish: draftDish(x.dish, ctx.memory, ctx.recipeIds),
            personIds: idsForNames(x.for_names, ctx.persons),
            label: x.for_label,
          })),
      awayIds: away,
      employeePart: meal.employee_part,
      employeeWhole: meal.employee_whole && !meal.employee_part,
      options: meal.undecided ? meal.options : [],
      note: meal.note,
      missing: false,
    });
  }
  // Slots the message left out on a day it did cover.
  for (const date of dates.values()) {
    for (const slot of ['lunch', 'dinner'] as const) {
      const base = make(date, slot);
      if (seen.has(base.key)) continue;
      seen.add(base.key);
      drafts.push({ ...base, source: '', kind: 'empty', missing: true });
    }
  }
  return drafts.sort((a, b) => a.date.localeCompare(b.date) || (a.slot === 'lunch' ? -1 : 1));
}

export type CheckReason = 'undecided' | 'who' | 'missing';

/** Why a draft needs the family before saving, or null when it is ready. */
export function checkReason(draft: DraftMeal): CheckReason | null {
  if (draft.options.length > 0) return 'undecided';
  if (draft.extras.some((x) => x.personIds.length === 0)) return 'who';
  if (draft.missing) return 'missing';
  return null;
}

const OUT_WORDS = new Set(['fora', 'fuera', 'out', 'eating out', 'dehors', 'fuori', 'restaurant', 'restaurante']);

export function isOutWord(s: string): boolean {
  return OUT_WORDS.has(foldPhrase(s));
}

/** Settle an undecided meal with one of its options. */
export function chooseOption(draft: DraftMeal, option: string, recipeIdFor?: (title: string) => string | null): DraftMeal {
  if (isOutWord(option)) {
    return { ...draft, options: [], kind: 'out', main: null, sides: [], extras: [] };
  }
  const keep = draft.main && foldPhrase(draft.main.title) === foldPhrase(option);
  const main: DraftDish = keep
    ? (draft.main as DraftDish)
    : { phrase: option, title: option, recipeId: recipeIdFor?.(option) ?? null, fromMemory: false };
  return { ...draft, options: [], kind: 'dish', main, missing: false };
}

// ---- Saving ------------------------------------------------------------------

export interface ImportEntryRow {
  day: number;
  slot: MealSlot;
  recipe_id: string | null;
  custom_title: string | null;
  person_ids: string[];
  guest_count: number;
  assigned_cook: CookType;
  position: number;
  cook_part: boolean;
  instructions: string | null;
}

export interface ImportAbsenceRow {
  day: number;
  slot: MealSlot;
  person_id: string;
}

export interface WeekRows {
  week: string;
  /** Day+slot cells the import fills (existing meals there are replaced). */
  cells: { day: number; slot: MealSlot }[];
  entries: ImportEntryRow[];
  absences: ImportAbsenceRow[];
}

function dishRow(dish: DraftDish) {
  return dish.recipeId
    ? { recipe_id: dish.recipeId, custom_title: null }
    : { recipe_id: null, custom_title: dish.title.trim() || dish.phrase.trim() };
}

/** Group the drafts into plan rows per week. Empty and missing meals are skipped. */
export function planRows(drafts: readonly DraftMeal[], eaterIds: readonly string[]): WeekRows[] {
  const weeks = new Map<string, WeekRows>();
  const weekOf = (week: string) => {
    let rows = weeks.get(week);
    if (!rows) {
      rows = { week, cells: [], entries: [], absences: [] };
      weeks.set(week, rows);
    }
    return rows;
  };
  for (const draft of drafts) {
    if (draft.kind === 'empty') continue;
    const rows = weekOf(draft.week);
    const { day, slot } = draft;
    rows.cells.push({ day, slot });
    const away = draft.kind === 'out' ? [...eaterIds] : draft.awayIds.filter((id) => eaterIds.includes(id));
    for (const person_id of away) rows.absences.push({ day, slot, person_id });
    if (draft.kind === 'out' || !draft.main) continue;

    const extraPeople = new Set(draft.extras.flatMap((x) => x.personIds));
    const awaySet = new Set([...away, ...extraPeople]);
    const mainPeople = effectivePersonIds([], [...eaterIds], awaySet);
    const cook: CookType = draft.employeePart || draft.employeeWhole ? 'employee' : 'family';
    const notes = [draft.employeePart, draft.note].filter(Boolean).join(' · ') || null;
    let position = 0;
    rows.entries.push({
      day,
      slot,
      ...dishRow(draft.main),
      person_ids: mainPeople,
      guest_count: 0,
      assigned_cook: cook,
      position: position++,
      cook_part: Boolean(draft.employeePart),
      instructions: notes,
    });
    for (const side of draft.sides) {
      rows.entries.push({
        day,
        slot,
        ...dishRow(side),
        person_ids: mainPeople,
        guest_count: 0,
        assigned_cook: cook,
        position: position++,
        cook_part: false,
        instructions: null,
      });
    }
    for (const extra of draft.extras) {
      if (extra.personIds.length === 0) continue;
      rows.entries.push({
        day,
        slot,
        ...dishRow(extra.dish),
        person_ids: extra.personIds.filter((id) => !away.includes(id)),
        guest_count: 0,
        assigned_cook: cook,
        position: position++,
        cook_part: false,
        instructions: null,
      });
    }
  }
  return [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
}

/** Phrase → recipe or title, to remember for the next import. Last one wins. */
export function matchRows(drafts: readonly DraftMeal[]): RememberedMatch[] {
  const out = new Map<string, RememberedMatch>();
  const add = (dish: DraftDish | null) => {
    if (!dish) return;
    const phrase = foldPhrase(dish.phrase);
    if (!phrase) return;
    out.set(
      phrase,
      dish.recipeId
        ? { phrase, recipe_id: dish.recipeId, custom_title: null }
        : { phrase, recipe_id: null, custom_title: dish.title.trim() || dish.phrase.trim() }
    );
  };
  for (const draft of drafts) {
    if (draft.kind !== 'dish' || draft.options.length > 0) continue;
    add(draft.main);
    draft.sides.forEach(add);
    draft.extras.forEach((x) => add(x.dish));
  }
  return [...out.values()];
}

/** Monday of each week the drafts touch, e.g. a Thursday → Monday plan touches two. */
export function draftWeeks(drafts: readonly DraftMeal[]): string[] {
  return [...new Set(drafts.map((d) => d.week))].sort();
}
