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

/**
 * v2 keeps the app still: no entrance staggers. Only two animations exist,
 * both skipped under reduced motion (design.md §Motion).
 */
export const BOOKMARK_FILL_MS = 150;
export const SEARCH_EXPAND_MS = 200;
