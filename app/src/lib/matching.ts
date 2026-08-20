import {
  buildCanonicalIndex,
  matchCanonical,
  normalizeRaw,
  type CanonicalIngredient,
} from '@/lib/canonical';
import { supabase } from '@/lib/supabase';
import { matchIngredients } from '@/lib/worker';

/**
 * Client-side matching orchestrator (Phase 2 Tasks 3/4/6): layered
 * resolution raw line → canonical ingredient.
 *
 *   1. ingredient_matches cache (includes cached "no match" rows)
 *   2. pure exact/alias matcher (cached as exact|alias)
 *   3. worker LLM fallback, candidates-only (cached as llm, incl. nulls)
 *
 * When the worker is unreachable, leftover lines stay unmatched and are NOT
 * cached, so a later session can retry.
 */

let tablePromise: Promise<CanonicalIngredient[]> | null = null;

/** The reference table, fetched once per session (169 rows, auth-readable). */
export function loadCanonicalIngredients(): Promise<CanonicalIngredient[]> {
  if (!tablePromise) {
    tablePromise = (async () => {
      const { data, error } = await supabase.from('canonical_ingredients').select('*');
      if (error || !data) {
        tablePromise = null; // allow retry next call
        throw new Error(error?.message ?? 'Could not load the ingredient table.');
      }
      return data as CanonicalIngredient[];
    })();
  }
  return tablePromise;
}

export interface ResolvedMatch {
  ingredient: CanonicalIngredient | null;
  normalized: string;
}

/**
 * Resolve raw ingredient lines to canonical rows. Returns a map keyed by the
 * ORIGINAL raw string. Never throws for matching reasons — worst case every
 * line resolves to null (verbatim "unmatched" handling downstream).
 */
export async function resolveMatches(raws: string[]): Promise<Map<string, ResolvedMatch>> {
  const result = new Map<string, ResolvedMatch>();
  const table = await loadCanonicalIngredients();
  const index = buildCanonicalIndex(table);
  const byId = new Map(table.map((row) => [row.id, row]));
  const bySlug = new Map(table.map((row) => [row.slug, row]));

  // Dedupe by normalized form; remember one representative raw per key.
  const byNormalized = new Map<string, string[]>();
  for (const raw of raws) {
    const normalized = normalizeRaw(raw);
    const list = byNormalized.get(normalized) ?? [];
    list.push(raw);
    byNormalized.set(normalized, list);
  }
  const resolvedByNormalized = new Map<string, CanonicalIngredient | null>();

  // 1. cache table
  const keys = [...byNormalized.keys()].filter((k) => k.length > 0);
  if (keys.length > 0) {
    const { data: cached } = await supabase
      .from('ingredient_matches')
      .select('raw_normalized, canonical_id')
      .in('raw_normalized', keys);
    for (const row of (cached as { raw_normalized: string; canonical_id: string | null }[]) ?? []) {
      resolvedByNormalized.set(row.raw_normalized, row.canonical_id ? (byId.get(row.canonical_id) ?? null) : null);
    }
  }

  // 2. pure matcher for cache misses
  const cacheInserts: {
    raw_normalized: string;
    canonical_id: string;
    confidence: number;
    matched_by: string;
  }[] = [];
  const stillUnresolved: string[] = [];
  for (const normalized of keys) {
    if (resolvedByNormalized.has(normalized)) continue;
    const match = matchCanonical(normalized, index);
    if (match) {
      resolvedByNormalized.set(normalized, match.ingredient);
      cacheInserts.push({
        raw_normalized: normalized,
        canonical_id: match.ingredient.id,
        confidence: 1,
        matched_by: match.matchedBy,
      });
    } else {
      stillUnresolved.push(normalized);
    }
  }
  if (cacheInserts.length > 0) {
    // Best-effort cache write; duplicates from concurrent sessions are fine.
    await supabase
      .from('ingredient_matches')
      .upsert(cacheInserts, { onConflict: 'raw_normalized', ignoreDuplicates: true });
  }

  // 3. worker LLM fallback for the rest (raw lines verbatim; candidates = slugs)
  if (stillUnresolved.length > 0) {
    const representative = stillUnresolved.map((n) => byNormalized.get(n)![0]);
    const llm = await matchIngredients(
      representative,
      table.map((row) => row.slug)
    );
    if (llm !== null) {
      const slugByLine = new Map(llm.map((m) => [m.line, m.slug]));
      const llmInserts: {
        raw_normalized: string;
        canonical_id: string | null;
        confidence: number;
        matched_by: string;
      }[] = [];
      stillUnresolved.forEach((normalized, i) => {
        const slug = slugByLine.get(representative[i]) ?? null;
        const ingredient = slug ? (bySlug.get(slug) ?? null) : null;
        resolvedByNormalized.set(normalized, ingredient);
        // Cache LLM answers including "no match" so we don't re-ask every load.
        llmInserts.push({
          raw_normalized: normalized,
          canonical_id: ingredient?.id ?? null,
          confidence: 0.7,
          matched_by: 'llm',
        });
      });
      if (llmInserts.length > 0) {
        await supabase
          .from('ingredient_matches')
          .upsert(llmInserts, { onConflict: 'raw_normalized', ignoreDuplicates: true });
      }
    }
    // llm === null → worker down: leave unresolved (null result, no cache).
  }

  for (const [normalized, rawList] of byNormalized) {
    const ingredient = resolvedByNormalized.get(normalized) ?? null;
    for (const raw of rawList) {
      result.set(raw, { ingredient, normalized });
    }
  }
  return result;
}

/**
 * User correction (spec §4 override): pin a raw line to a canonical row (or
 * to "no match"), recorded as matched_by='user'.
 */
export async function correctMatch(
  raw: string,
  canonicalId: string | null
): Promise<void> {
  const raw_normalized = normalizeRaw(raw);
  if (!raw_normalized) return;
  const { error } = await supabase.from('ingredient_matches').upsert(
    {
      raw_normalized,
      canonical_id: canonicalId,
      confidence: 1,
      matched_by: 'user',
    },
    { onConflict: 'raw_normalized' }
  );
  if (error) throw new Error(`Saving the correction failed: ${error.message}`);
}
