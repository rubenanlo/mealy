import { router, type Href } from 'expo-router';

/**
 * Back with a web-safe fallback. On the phone there is always a screen to go
 * back to; on the web a deep link or refresh starts a fresh history, where
 * router.back() is a silent no-op — replace to the screen's natural parent.
 */
export function backOr(fallback: Href): void {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace(fallback);
  }
}
