import { classifyUnit, type UnitOverride, type UnitOverrides } from '@/lib/aggregate';
import { supabase } from '@/lib/supabase';
import { classifyUnits } from '@/lib/worker';

/**
 * Layered unit resolution for grocery aggregation, mirroring lib/matching.ts:
 *
 *   1. static tables in lib/aggregate.ts (multilingual, incl. common typos)
 *   2. unit_conversions cache (includes cached "unclassifiable" rows)
 *   3. worker LLM fallback (cached, incl. nulls)
 *
 * When the worker is unreachable, leftover units stay unmerged and are NOT
 * cached, so a later session can retry.
 */

/** Cache rows use '' factor semantics: null kind = model gave up (negative). */
interface CacheRow {
  unit: string;
  kind: 'mass' | 'volume' | 'count' | null;
  factor: number | null;
}

function usable(row: CacheRow): UnitOverride | null {
  if (row.kind === 'count') return { kind: 'count', factor: null };
  if ((row.kind === 'mass' || row.kind === 'volume') && row.factor && row.factor > 0) {
    return { kind: row.kind, factor: row.factor };
  }
  return null;
}

/**
 * Resolve the units the static tables don't know into overrides for
 * aggregate(). Input may contain duplicates/known units — they are ignored.
 */
export async function resolveUnitOverrides(units: (string | null)[]): Promise<UnitOverrides> {
  const overrides: UnitOverrides = new Map();
  const unknown = [
    ...new Set(
      units
        .map((u) => (u ?? '').trim().toLowerCase())
        .filter((u) => u.length > 0 && classifyUnit(u).kind === 'other')
    ),
  ];
  if (unknown.length === 0) return overrides;

  // 1. cache (negative rows — kind null — count as resolved: don't re-ask)
  const resolved = new Set<string>();
  const { data: cached } = await supabase
    .from('unit_conversions')
    .select('unit, kind, factor')
    .in('unit', unknown);
  for (const row of (cached as CacheRow[]) ?? []) {
    resolved.add(row.unit);
    const override = usable(row);
    if (override) overrides.set(row.unit, override);
  }

  // 2. worker LLM for cache misses; cache every answer including nulls
  const misses = unknown.filter((u) => !resolved.has(u));
  if (misses.length > 0) {
    const replies = await classifyUnits(misses);
    if (replies !== null) {
      const rows: CacheRow[] = misses.map((unit) => {
        const reply = replies.find((r) => r.unit === unit);
        return {
          unit,
          kind: reply?.kind ?? null,
          factor: reply?.kind === 'count' ? null : (reply?.factor ?? null),
        };
      });
      for (const row of rows) {
        const override = usable(row);
        if (override) overrides.set(row.unit, override);
      }
      await supabase
        .from('unit_conversions')
        .upsert(rows, { onConflict: 'unit', ignoreDuplicates: true });
    }
  }
  return overrides;
}
