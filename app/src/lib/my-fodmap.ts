import {
  buildCanonicalIndex,
  matchCanonical,
  normalizeRaw,
  type CanonicalIngredient,
} from '@/lib/canonical';
import { supabase } from '@/lib/supabase';

/**
 * The household's own FODMAP list (migration 0035): ingredients the user
 * rated themselves, with a "checked" flag for entries they have confirmed.
 * A linked entry (canonical_id set) overrides the reference table's tier in
 * the recipe FODMAP check; see `applyPersonalRatings` and fodmap.ts.
 */

export type PersonalRating = 'low' | 'moderate' | 'high';

export const PERSONAL_RATINGS: PersonalRating[] = ['low', 'moderate', 'high'];

export interface PersonalFodmapEntry {
  id: string;
  household_id: string;
  name: string;
  canonical_id: string | null;
  rating: PersonalRating;
  safe_portion: string | null;
  notes: string | null;
  checked: boolean;
  checked_by: string | null;
  checked_at: string | null;
  created_at: string;
  updated_at: string;
}

/** What the edit form submits. */
export interface PersonalFodmapDraft {
  name: string;
  canonical_id: string | null;
  rating: PersonalRating | null;
  safe_portion: string;
  notes: string;
  checked: boolean;
}

/** The slice of an entry the FODMAP check needs (attached to canonical rows). */
export interface PersonalRatingInfo {
  rating: PersonalRating;
  safe_portion: string | null;
  checked: boolean;
}

export const EMPTY_DRAFT: PersonalFodmapDraft = {
  name: '',
  canonical_id: null,
  rating: null,
  safe_portion: '',
  notes: '',
  checked: false,
};

export function draftFromEntry(entry: PersonalFodmapEntry): PersonalFodmapDraft {
  return {
    name: entry.name,
    canonical_id: entry.canonical_id,
    rating: entry.rating,
    safe_portion: entry.safe_portion ?? '',
    notes: entry.notes ?? '',
    checked: entry.checked,
  };
}

export type DraftError = 'nameRequired' | 'ratingRequired' | 'duplicateName';

/** Validation: name and rating are required; names are unique per household (case-insensitive). */
export function validateDraft(
  draft: PersonalFodmapDraft,
  existing: Pick<PersonalFodmapEntry, 'id' | 'name'>[],
  editingId: string | null
): DraftError | null {
  const name = draft.name.trim();
  if (!name) return 'nameRequired';
  if (!draft.rating) return 'ratingRequired';
  const key = name.toLowerCase();
  if (existing.some((e) => e.id !== editingId && e.name.trim().toLowerCase() === key)) {
    return 'duplicateName';
  }
  return null;
}

/** Best guess at the canonical ingredient for a typed name (exact/alias only). */
export function suggestCanonical(
  name: string,
  table: CanonicalIngredient[]
): CanonicalIngredient | null {
  const normalized = normalizeRaw(name);
  if (!normalized) return null;
  return matchCanonical(normalized, buildCanonicalIndex(table))?.ingredient ?? null;
}

/** Candidates for the "link to ingredient" picker, by substring on any name/alias. */
export function searchCanonical(
  query: string,
  table: CanonicalIngredient[],
  limit = 8
): CanonicalIngredient[] {
  const q = normalizeRaw(query);
  if (!q) return [];
  const hits: { ing: CanonicalIngredient; rank: number }[] = [];
  for (const ing of table) {
    const names = [ing.name_en, ing.name_fr, ing.name_es, ing.name_it ?? '', ...ing.aliases]
      .filter(Boolean)
      .map((n) => normalizeRaw(n));
    let rank = Infinity;
    for (const n of names) {
      if (n === q) rank = Math.min(rank, 0);
      else if (n.startsWith(q)) rank = Math.min(rank, 1);
      else if (n.includes(q)) rank = Math.min(rank, 2);
    }
    if (rank < Infinity) hits.push({ ing, rank });
  }
  return hits
    .sort((a, b) => a.rank - b.rank || a.ing.name_en.localeCompare(b.ing.name_en))
    .slice(0, limit)
    .map((h) => h.ing);
}

export type ListFilter = 'all' | PersonalRating | 'unchecked';

/** Filter + search + alphabetical sort for the list screen. */
export function filterEntries(
  entries: PersonalFodmapEntry[],
  filter: ListFilter,
  query: string
): PersonalFodmapEntry[] {
  const q = query.trim().toLowerCase();
  return entries
    .filter((e) => {
      if (filter === 'unchecked') return !e.checked;
      if (filter !== 'all') return e.rating === filter;
      return true;
    })
    .filter(
      (e) =>
        !q ||
        e.name.toLowerCase().includes(q) ||
        (e.notes ?? '').toLowerCase().includes(q)
    )
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Attach the household's ratings to reference rows (linked entries only).
 * Returns new objects; rows without an entry are returned unchanged.
 */
export function applyPersonalRatings(
  table: CanonicalIngredient[],
  entries: Pick<PersonalFodmapEntry, 'canonical_id' | 'rating' | 'safe_portion' | 'checked'>[]
): CanonicalIngredient[] {
  const byCanonical = new Map<string, PersonalRatingInfo>();
  for (const e of entries) {
    if (!e.canonical_id) continue;
    byCanonical.set(e.canonical_id, {
      rating: e.rating,
      safe_portion: e.safe_portion,
      checked: e.checked,
    });
  }
  if (byCanonical.size === 0) return table;
  return table.map((row) => {
    const personal = byCanonical.get(row.id);
    return personal ? { ...row, personal } : row;
  });
}

function clean(value: string): string | null {
  const v = value.trim();
  return v ? v : null;
}

// ---- data access (RLS scopes every query to the caller's household) ----

export async function listPersonalEntries(): Promise<PersonalFodmapEntry[]> {
  const { data, error } = await supabase
    .from('my_fodmap_ingredients')
    .select('*')
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as PersonalFodmapEntry[];
}

export async function getPersonalEntry(id: string): Promise<PersonalFodmapEntry | null> {
  const { data, error } = await supabase
    .from('my_fodmap_ingredients')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PersonalFodmapEntry | null) ?? null;
}

export async function savePersonalEntry(
  householdId: string,
  draft: PersonalFodmapDraft,
  id: string | null
): Promise<void> {
  if (!draft.rating) throw new Error('A rating is required.');
  const row = {
    household_id: householdId,
    name: draft.name.trim(),
    canonical_id: draft.canonical_id,
    rating: draft.rating,
    safe_portion: clean(draft.safe_portion),
    notes: clean(draft.notes),
    checked: draft.checked,
  };
  const { error } = id
    ? await supabase.from('my_fodmap_ingredients').update(row).eq('id', id)
    : await supabase.from('my_fodmap_ingredients').insert(row);
  if (error) throw new Error(error.message);
}

export async function deletePersonalEntry(id: string): Promise<void> {
  const { error } = await supabase.from('my_fodmap_ingredients').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
