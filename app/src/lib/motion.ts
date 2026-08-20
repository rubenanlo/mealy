import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Reduce-motion preference via AccessibilityInfo (kept out of reanimated so
 * tests can mock this module trivially). Defaults to false until the async
 * query resolves.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => {
        if (!cancelled) setReduced(value);
      })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);

  return reduced;
}

/** Fade+rise stagger (design.md §Motion): 30ms per item, ≤300ms total. */
export const ENTRANCE_DURATION_MS = 180;
export const ENTRANCE_STAGGER_MS = 30;
export const ENTRANCE_MAX_DELAY_MS = 120;
export const ENTRANCE_RISE_PX = 12;

export function entranceDelay(index: number): number {
  return Math.min(index * ENTRANCE_STAGGER_MS, ENTRANCE_MAX_DELAY_MS);
}
