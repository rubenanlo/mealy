import { classifyUnit, lineGrams } from '@/lib/aggregate';
import { normalizeRaw, type CanonicalIngredient } from '@/lib/canonical';
import { supabase } from '@/lib/supabase';
import { fodmapListMatch } from '@/lib/worker';

/**
 * The household's FODMAP list with serving limits (migration 0040), and the
 * ✦ "Is this recipe FODMAP friendly?" check built on it.
 *
 * Rule (Ruben, 2026-11-16): a line is flagged when its matched entry's
 * Overall is amber or red; its amount per serving is then compared with the
 * entry's limits: over "Green up to" = over, otherwise OK at this amount. A
 * green entry whose amount is over its green limit is flagged too. An entry
 * with no green amount (garlic) has no safe amount. Only the matching is AI;
 * every number here is deterministic.
 */

export type Overall = 'green' | 'amber' | 'red';

export interface FodmapListEntry {
  id: string;
  name: string;
  category: string | null;
  overall: Overall;
  green_max: number | null;
  amber_qty: number | null;
  red_qty: number | null;
  unit: 'g' | 'ml';
  notes: string | null;
}

export interface CheckLine {
  raw: string;
  name: string;
  quantity: number | null;
  unit: string | null;
}

/** Where an amount sits against an entry's limits. */
export type Level = 'green' | 'amber' | 'red';

export interface CheckItem {
  raw: string;
  entry: FodmapListEntry | null;
  /** Amount per serving in the entry's unit; null when it can't be worked out. */
  perServing: number | null;
  level: Level | null;
  /** True when the amount is over the green limit (or there is no green amount). */
  over: boolean;
  /** Shown in the answer: rated amber/red, or green but over its limit. */
  flagged: boolean;
}

export interface RecipeCheck {
  items: CheckItem[];
  flagged: CheckItem[];
  /** Flagged lines over their limit: the ones to swap. */
  over: CheckItem[];
  /** Lines with no list entry. */
  unknown: CheckItem[];
  /** Lines with an entry that are fine. */
  fine: CheckItem[];
}

export async function loadFodmapList(householdId: string): Promise<FodmapListEntry[]> {
  const { data, error } = await supabase
    .from('fodmap_list')
    .select('id, name, category, overall, green_max, amber_qty, red_qty, unit, notes')
    .eq('household_id', householdId)
    .order('name');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    ...(row as FodmapListEntry),
    green_max: num(row.green_max),
    amber_qty: num(row.amber_qty),
    red_qty: num(row.red_qty),
  }));
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Cache key for a recipe line: same as the canonical matcher's normalisation. */
export function lineKey(raw: string): string {
  return normalizeRaw(raw) || raw.trim().toLowerCase();
}

/**
 * Resolve each line to a list entry: cached rows first, then one worker call
 * for the rest (results cached, "not in the list" too). Returns raw → entry.
 */
export async function resolveListMatches(
  householdId: string,
  lines: CheckLine[],
  entries: FodmapListEntry[]
): Promise<Map<string, FodmapListEntry | null>> {
  const out = new Map<string, FodmapListEntry | null>();
  if (entries.length === 0 || lines.length === 0) return out;
  const byId = new Map(entries.map((e) => [e.id, e]));
  const keys = [...new Set(lines.map((l) => lineKey(l.raw)))];
  const { data: cached } = await supabase
    .from('fodmap_list_matches')
    .select('line_key, entry_id')
    .eq('household_id', householdId)
    .in('line_key', keys);
  const known = new Map<string, string | null>(
    (cached ?? []).map((row) => [row.line_key as string, (row.entry_id as string | null) ?? null])
  );
  const missing = keys.filter((k) => !known.has(k));
  if (missing.length > 0) {
    const sample = new Map(lines.map((l) => [lineKey(l.raw), l.raw]));
    const reply = await fodmapListMatch(
      missing.map((key) => ({ key, text: sample.get(key) ?? key })),
      entries.map((e, i) => ({ i, name: e.name }))
    );
    if (reply) {
      const rows = reply.map((m) => ({
        household_id: householdId,
        line_key: m.key,
        entry_id: m.index === null ? null : (entries[m.index]?.id ?? null),
        source: 'ai',
      }));
      for (const row of rows) known.set(row.line_key, row.entry_id);
      // Best effort: a failed cache write only means asking again next time.
      await supabase.from('fodmap_list_matches').upsert(rows, { onConflict: 'household_id,line_key' });
    }
  }
  for (const line of lines) {
    const key = lineKey(line.raw);
    if (!known.has(key)) continue; // unresolved this time (worker down): not "not in list"
    const id = known.get(key);
    out.set(line.raw, id ? (byId.get(id) ?? null) : null);
  }
  return out;
}

/**
 * Amount of one line per serving, in `unit` (g or ml). Uses the canonical
 * row's piece weight and density when there is one; otherwise only plain
 * mass/volume units convert (ml ≈ g when the units differ).
 */
export function amountPerServing(
  line: Pick<CheckLine, 'quantity' | 'unit'>,
  servings: number | null,
  unit: 'g' | 'ml',
  canonical?: CanonicalIngredient | null
): number | null {
  if (line.quantity === null || !servings || servings <= 0) return null;
  const family = classifyUnit(line.unit);
  let total: number | null = null;
  if (unit === 'ml' && family.kind === 'volume') total = line.quantity * family.ml;
  else if (canonical) total = lineGrams(line.quantity, line.unit, canonical);
  if (total === null) {
    if (family.kind === 'mass') total = line.quantity * family.grams;
    else if (family.kind === 'volume') total = line.quantity * family.ml;
  }
  return total === null ? null : round(total / servings);
}

/** Where an amount sits: ≤ green → green, ≥ red → red, else amber. */
export function levelFor(entry: FodmapListEntry, amount: number | null): Level | null {
  if (amount === null) return null;
  if (entry.green_max === null) return 'red';
  if (amount <= entry.green_max) return 'green';
  if (entry.red_qty !== null && amount >= entry.red_qty) return 'red';
  // A single limit with nothing above it: over it is red (sheet review log).
  if (entry.red_qty === null && entry.amber_qty === null) return 'red';
  return 'amber';
}

export function checkItem(
  raw: string,
  entry: FodmapListEntry | null,
  perServing: number | null
): CheckItem {
  if (!entry) return { raw, entry: null, perServing, level: null, over: false, flagged: false };
  const level = levelFor(entry, perServing);
  // Unknown amount: trust the rating (amber/red counts as over).
  const over = level === null ? entry.overall !== 'green' : level !== 'green';
  const flagged = entry.overall !== 'green' || over;
  return { raw, entry, perServing, level, over, flagged };
}

export function checkRecipe(
  lines: CheckLine[],
  servings: number | null,
  entryFor: (raw: string) => FodmapListEntry | null,
  canonicalFor: (raw: string) => CanonicalIngredient | null = () => null
): RecipeCheck {
  const items = lines.map((line) => {
    const entry = entryFor(line.raw);
    const perServing = entry ? amountPerServing(line, servings, entry.unit, canonicalFor(line.raw)) : null;
    return checkItem(line.raw, entry, perServing);
  });
  // Worst first: no safe amount / red, then amber, then OK-at-this-amount.
  const rank = (i: CheckItem) => (i.over ? (i.level === 'amber' ? 1 : 0) : 2);
  const flagged = items.filter((i) => i.flagged).sort((a, b) => rank(a) - rank(b));
  return {
    items,
    flagged,
    over: flagged.filter((i) => i.over),
    unknown: items.filter((i) => !i.entry),
    fine: items.filter((i) => i.entry && !i.flagged),
  };
}

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** "1.5 g" / "7.5 ml" */
export function formatAmount(amount: number, unit: string): string {
  return `${round(amount)} ${unit}`;
}
