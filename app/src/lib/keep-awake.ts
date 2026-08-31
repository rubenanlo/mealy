import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useEffect } from 'react';
import { Platform } from 'react-native';

const TAG = 'mealy';

/**
 * expo-keep-awake's hook, hardened for web: browsers reject wake-lock requests
 * while the tab is hidden (unhandled rejection → red dev overlay), and drop the
 * lock on hide. Swallow the failures and re-acquire on visibilitychange.
 */
export function useKeepAwakeSafe(): void {
  useEffect(() => {
    const activate = () => {
      activateKeepAwakeAsync(TAG).catch(() => {});
    };
    activate();

    let removeVisibilityListener: (() => void) | undefined;
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') activate();
      };
      document.addEventListener('visibilitychange', onVisibilityChange);
      removeVisibilityListener = () =>
        document.removeEventListener('visibilitychange', onVisibilityChange);
    }

    return () => {
      removeVisibilityListener?.();
      Promise.resolve(deactivateKeepAwake(TAG)).catch(() => {});
    };
  }, []);
}
