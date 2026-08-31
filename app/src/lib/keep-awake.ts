import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { Platform } from 'react-native';

const TAG = 'mealy';

interface WakeLockSentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

/**
 * Keep the screen awake while the app is foregrounded.
 *
 * Native uses expo-keep-awake. On web we own the Wake Lock sentinel
 * ourselves: expo's web module requests it once and never retakes it, but
 * browsers release wake locks aggressively (tab hidden, screen locked once,
 * battery saver) — so we re-acquire on the sentinel's release event and on
 * visibilitychange, and swallow the NotAllowedError thrown for hidden tabs.
 */
export function useKeepAwakeSafe(): void {
  useEffect(() => {
    if (Platform.OS !== 'web') {
      activateKeepAwakeAsync(TAG).catch(() => {});
      return () => {
        Promise.resolve(deactivateKeepAwake(TAG)).catch(() => {});
      };
    }

    const nav = navigator as unknown as {
      wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock || typeof document === 'undefined') return;
    const doc = document;

    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const acquire = () => {
      if (disposed || doc.visibilityState !== 'visible') return;
      nav
        .wakeLock!.request('screen')
        .then((s) => {
          if (disposed) {
            s.release().catch(() => {});
            return;
          }
          sentinel = s;
          s.addEventListener('release', () => {
            sentinel = null;
            // The browser dropped the lock; retake it while we're visible.
            if (!disposed && doc.visibilityState === 'visible') acquire();
          });
        })
        .catch(() => {});
    };

    acquire();
    const onVisibilityChange = () => {
      if (doc.visibilityState === 'visible' && !sentinel) acquire();
    };
    doc.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      doc.removeEventListener('visibilitychange', onVisibilityChange);
      sentinel?.release().catch(() => {});
    };
  }, []);
}
