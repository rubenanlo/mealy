import { useEffect, useState } from 'react';

import { buildCanonicalIndex, type CanonicalIndex } from '@/lib/canonical';
import { loadCanonicalIngredients } from '@/lib/matching';

let cachedIndex: CanonicalIndex | null = null;

/**
 * The canonical lookup index as React state. Resolves the session-cached
 * table once; returns null until loaded (callers fall back to tags).
 */
export function useCanonicalIndex(): CanonicalIndex | null {
  const [index, setIndex] = useState<CanonicalIndex | null>(cachedIndex);
  useEffect(() => {
    if (index) return;
    let cancelled = false;
    loadCanonicalIngredients()
      .then((table) => {
        cachedIndex = buildCanonicalIndex(table);
        if (!cancelled) setIndex(cachedIndex);
      })
      .catch(() => {
        // Table unreachable — tags-based fallback stays in effect.
      });
    return () => {
      cancelled = true;
    };
  }, [index]);
  return index;
}
